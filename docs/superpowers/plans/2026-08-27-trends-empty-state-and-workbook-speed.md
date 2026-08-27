# Trends Empty State + Quality Workbook Speed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dashboard Trends section from showing a raw `Server error.` when call data is sparse, and make the ICICI HFC Quality workbook download fast, honest, and click-safe.

**Architecture:** Three independent fixes. (1) The Trends 500 is a real backend exception in the top-scorer fallback query, not an empty result — make that query safe and make the section degrade per-chart instead of all-or-nothing. (2) Isolate the workbook's data gathering into its own service with a **sargable** date predicate so the existing `IX_CAA_UploadDate` index is usable, and instrument SQL vs Excel time so cache claims are measurable. (3) Rework the workbook card: one primary Download button with a real spinner/disabled state, no preview, no marketing copy.

**Tech Stack:** CRA React 18 JS (`frontend/`), Express + `mssql` (`backend/`), Jest via `react-scripts test`, Node test runner via `node --test`, ExcelJS. No new npm packages.

## Global Constraints

- Product chrome title stays **Call Analysis**. Active tenant work is **ICICI HFC / ICIC Home Finance** collections only.
- Do **not** change `ai-mvp/**`, AI services, AI images, scoring, PTP detection/genuineness, or Intelligence math.
- Do **not** change the **contents** of `buildIcicQualityReportBuffer` — sheet layout, columns, and report math stay byte-identical. This plan only changes how rows are fetched and how the response is cached/reported.
- Do **not** change the shared helper `consolidatedReportDateBetween` in `backend/services/reportHelpers.js`. Other reports depend on it. Add a new clause used only by the workbook.
- Do **not** remove `role` from `buildQualityCacheKey`. Report scope varies by role; a shared key across roles is a data-leak risk. TTL is the lever, not the key.
- Keep the Strong/Weak PTP dashboard cards and the Audit language/TL/tenure breakdowns working — do not touch those files.
- After verify: `sp-frontend.tar` + `sp-backend.tar` only. Do **not** rebuild AI tars.

---

## Root causes (evidence, not theory)

### Problem 1 — Trends shows `Server error.`

The user's read ("no trend data, so it errors") is right about *when* it happens but the mechanism is a genuine exception, so an empty-state alone would not fix it.

`backend/services/reportHelpers.js` `queryTopScorerForWeek` (lines 1054–1130) tries three queries in order and returns the first real scorer. Two defects:

1. **Unsafe cast in the third fallback.** Queries 1 and 2 use `TRY_CAST`; query 3 uses `AVG(CAST(APR.AIScoring AS FLOAT))` (line 1100). Any non-numeric `AIScoring` value raises a conversion error. The catch at lines 1122–1126 only swallows *missing DB object* errors and **rethrows everything else** → route returns `500 { message: "Server error." }`.

   This fires exactly in the user's situation: queries 1 and 2 require `> 0` scores. With 113 outbound calls mostly scored `0.0%`, both return no qualifying row, execution falls through to query 3, and a single bad `AIScoring` string 500s the endpoint.

2. **Duplicate `@callType` bind.** `bindDashboardFilters` (line 880–882) already binds `@callType` when the direction filter is not `All`; line 1116 then binds it again unconditionally → `mssql` "parameter name callType has already been declared" → 500. Latent today (user is on *All directions*) and guaranteed to break the moment anyone picks Inbound or Outbound.

Frontend amplifies it: `frontend/src/components/DashboardStatistics.jsx` `fetchStats` (lines 121–181) uses `Promise.all` and throws if **any** of the three responses is not `success`, so a top-scorer failure blanks the volume and duration charts too. The component already has the correct `EmptyState` for true-empty (lines 287–303); it is simply never reached.

### Problem 2 — Quality workbook slow every time

`GET /api/collections/quality-report` (`backend/routes/miscRoutes.register.js` lines 672–791) is already cache-first. The remaining cold-path cost is the SELECT, and its date filter is **non-sargable**:

```sql
CAST(COALESCE(UploadDate, SelectedCallDate) AS DATE) BETWEEN @fromDate AND @toDate
```

Wrapping the column in `CAST`/`COALESCE` makes `IX_CAA_UploadDate` (created in `backend/services/dbMigrate.js` line 50) unusable, forcing a scan of `Consolidated_Audio_Analysis` across ~90 wide columns including `AI_Summary` and `AI_Feedback`.

Cache TTL is only **600s** (`backend/services/qualityReportCache.js`, `QUALITY_REPORT_CACHE_TTL_SEC` default 600). Repeat downloads more than 10 minutes apart always MISS, which is exactly "cache not working".

The card also cannot tell the user anything true: during background prefetch `busy` is `false`, so both buttons stay enabled with no spinner, and clicking again just waits on the same in-flight promise. Hence the multi-click behaviour.

---

## File structure

| File | Responsibility |
|------|----------------|
| `backend/services/reportHelpers.js` | Make `queryTopScorerForWeek` safe: `TRY_CAST`, no duplicate bind, never throw out of the fallback loop. |
| `backend/test/topScorerWeek.test.js` | Node tests for the fallback loop using a fake pool. |
| `frontend/src/components/DashboardStatistics.jsx` | Per-request degradation, human error copy, reachable empty state. |
| `frontend/src/components/DashboardStatistics.test.jsx` | Jest for partial failure and empty data. |
| `backend/services/qualityWorkbookData.js` | Isolated, sargable, instrumented workbook data gathering. |
| `backend/test/qualityWorkbookData.test.js` | Node tests for the clause and query shape. |
| `backend/routes/miscRoutes.register.js` | Use the new data service; add build telemetry + `Server-Timing`. |
| `frontend/src/components/reports/analytics/ReportsDownloadTab.jsx` | Single Download button, spinner + disabled, no preview, no marketing copy. |
| `frontend/src/components/reports/analytics/ReportsDownloadTab.test.jsx` | Update expectations for the new card. |
| `production/.env` | `QUALITY_REPORT_CACHE_TTL_SEC=21600` (ops step, no code change). |

Out of scope: column trimming inside the workbook SELECT (would risk blanking official cells — needs a full per-sheet column audit first), new DB indexes, `reportCatalog.js`, `ReportPreviewModal.jsx`.

---

### Task 1: Make the top-scorer fallback query safe

**Files:**
- Modify: `backend/services/reportHelpers.js` — `queryTopScorerForWeek` (lines 1054–1130)
- Test: `backend/test/topScorerWeek.test.js`

**Interfaces:**
- Consumes: nothing new. `queryTopScorerForWeek` is already exported (line 1409).
- Produces: `queryTopScorerForWeek(pool, callType, params)` → resolves to `{ agentName, avgScore, callCount }` or `null`. **Never rejects.**

- [ ] **Step 1: Write the failing test**

Create `backend/test/topScorerWeek.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const { queryTopScorerForWeek } = require("../services/reportHelpers");

/**
 * Fake mssql pool. `behaviors` is one entry per query attempt: an Error to
 * throw, or an array to use as the recordset. Rebinding a parameter throws
 * the same message mssql uses, so a duplicate bind fails the test loudly.
 */
function fakePool(behaviors) {
  let attempt = 0;
  const queries = [];
  return {
    queries,
    request() {
      const bound = new Set();
      const req = {
        input(name) {
          if (bound.has(name)) {
            throw new Error(
              `The parameter name ${name} has already been declared. Parameter names must be unique`,
            );
          }
          bound.add(name);
          return req;
        },
        async query(text) {
          queries.push(text);
          const behavior = behaviors[attempt];
          attempt += 1;
          if (behavior instanceof Error) throw behavior;
          return { recordset: behavior || [] };
        },
      };
      return req;
    },
  };
}

const params = {
  fromDateStr: "2026-07-27",
  toDateStr: "2026-08-27",
  location: "All",
  tl: "All",
  callType: "All",
  agent: "All",
};

test("returns the first scorer without running later fallbacks", async () => {
  const pool = fakePool([[{ agentName: "Priya", avgScore: 88.4, callCount: 12 }]]);
  const result = await queryTopScorerForWeek(pool, "outbound", params);
  assert.deepEqual(result, { agentName: "Priya", avgScore: 88.4, callCount: 12 });
  assert.equal(pool.queries.length, 1);
});

test("returns null instead of throwing when every fallback fails", async () => {
  const pool = fakePool([
    new Error("Conversion failed when converting the nvarchar value 'N/A' to data type float"),
    new Error("Invalid column name 'Overall_Scoring'"),
    new Error("Conversion failed when converting the nvarchar value '' to data type float"),
  ]);
  assert.equal(await queryTopScorerForWeek(pool, "outbound", params), null);
});

test("returns null when no agent has a qualifying score", async () => {
  const pool = fakePool([[], [], []]);
  assert.equal(await queryTopScorerForWeek(pool, "inbound", params), null);
});

test("does not double-bind callType when a direction filter is active", async () => {
  const pool = fakePool([[{ agentName: "Amit", avgScore: 0.91, callCount: 4 }]]);
  const result = await queryTopScorerForWeek(pool, "outbound", {
    ...params,
    callType: "Outbound",
  });
  assert.equal(result.agentName, "Amit");
  assert.equal(result.avgScore, 91);
});

test("never casts AIScoring without TRY_CAST", async () => {
  const pool = fakePool([[], [], []]);
  await queryTopScorerForWeek(pool, "outbound", params);
  const joined = pool.queries.join("\n");
  assert.ok(!/[^_]CAST\(APR\.AIScoring/.test(joined), "AIScoring must use TRY_CAST");
  assert.match(joined, /TRY_CAST\(APR\.AIScoring/);
});
```

- [ ] **Step 2: Run it to verify it fails**

Working directory: `backend`

```powershell
node --test test/topScorerWeek.test.js
```

Expected: FAIL. The duplicate-bind test throws `The parameter name callType has already been declared`, the all-fail test rejects instead of resolving `null`, and the `TRY_CAST` assertion fails.

- [ ] **Step 3: Fix the third fallback query**

In `backend/services/reportHelpers.js`, inside `queryTopScorerForWeek`, change line 1100 from `AVG(CAST(APR.AIScoring AS FLOAT))` to a safe cast and require a real score, matching queries 1 and 2:

```javascript
    `
      SELECT TOP 1 AU.SelectedAgent AS agentName,
             AVG(TRY_CAST(APR.AIScoring AS FLOAT)) AS avgScore,
             COUNT(*) AS callCount
      FROM AudioUploads AU
      JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
      WHERE LOWER(LTRIM(RTRIM(AU.CallType))) = @callType
        AND APR.AIScoring IS NOT NULL
        AND TRY_CAST(APR.AIScoring AS FLOAT) IS NOT NULL
        AND ${uploadDateClause}
        ${uploadExtra}
      GROUP BY AU.SelectedAgent
      ORDER BY avgScore DESC
    `,
```

- [ ] **Step 4: Bind `callType` once and stop the loop from throwing**

Replace the `for (const query of queries)` loop (lines 1113–1127) with:

```javascript
  for (const query of queries) {
    try {
      const request = pool.request();
      request.input("callType", sql.NVarChar, callType);
      const result = await bindDashboardFilters(request, params).query(query);
      const mapped = mapTopRow(result.recordset[0]);
      if (mapped && mapped.agentName !== "—" && mapped.callCount > 0) {
        return mapped;
      }
    } catch (err) {
      // A missing table, a bad legacy score string, or a filter with no rows
      // must not fail the whole Trends section — fall through and report
      // "no top scorer" instead.
      console.warn(`[top-scorer] ${callType} fallback skipped: ${err.message}`);
    }
  }
```

`callType` is now bound **before** `bindDashboardFilters`, and that helper already skips binding when the filter is `All`. To make the direction filter safe, change the `callType` branch of `bindDashboardFilters` (lines 880–882) to skip a name that is already bound:

```javascript
  if (params.callType && params.callType !== "All" && !request.parameters?.callType) {
    request.input("callType", sql.NVarChar, String(params.callType).toLowerCase());
  }
```

`mssql` exposes bound parameters as `request.parameters`; the optional chain keeps the fake pool in the test working.

- [ ] **Step 5: Run the tests to verify they pass**

```powershell
node --test test/topScorerWeek.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Confirm no other report regressed**

```powershell
node --test test/ptpQuality.test.js test/dashboardDrilldown.test.js test/auditQueueQuery.test.js test/topScorerWeek.test.js
```

Expected: PASS (all previously green suites still green).

- [ ] **Step 7: Commit**

```bash
git add backend/services/reportHelpers.js backend/test/topScorerWeek.test.js
git commit -m "Stop a bad legacy score value from failing the Trends top scorer."
```

---

### Task 2: Trends degrades per chart instead of showing a raw server error

**Files:**
- Modify: `frontend/src/components/DashboardStatistics.jsx` — `fetchStats` (lines 121–181) and the render branch (lines 269–305)
- Test: `frontend/src/components/DashboardStatistics.test.jsx`

**Interfaces:**
- Consumes: `getInboundOutboundWeek`, `getDailyDurationWeek`, `getTopScorerAgentsWeek` from `../services/reportsService`
- Produces: no exported API change. Behaviour contract: volume/duration charts render whenever their own request succeeds; the section only shows `PageError` when **every** request fails; the empty state is reachable.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/DashboardStatistics.test.jsx`:

```javascript
import { render, screen, waitFor } from "@testing-library/react";
import DashboardStatistics from "./DashboardStatistics";
import {
  getDailyDurationWeek,
  getInboundOutboundWeek,
  getTopScorerAgentsWeek,
} from "../services/reportsService";

jest.mock("../services/reportsService", () => ({
  getInboundOutboundWeek: jest.fn(),
  getDailyDurationWeek: jest.fn(),
  getTopScorerAgentsWeek: jest.fn(),
}));

const labels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const zeros = [0, 0, 0, 0, 0, 0, 0];

const volume = (outbound) => ({ success: true, labels, inbound: zeros, outbound });
const duration = () => ({ success: true, labels, inbound: zeros, outbound: zeros });

describe("DashboardStatistics", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("still renders volume charts when only top scorers fail", async () => {
    getInboundOutboundWeek.mockResolvedValue(volume([4, 0, 2, 0, 0, 0, 0]));
    getDailyDurationWeek.mockResolvedValue(duration());
    getTopScorerAgentsWeek.mockRejectedValue(new Error("Server error."));

    render(<DashboardStatistics filters={{}} filterPeriodLabel="Last 1 month" />);

    await waitFor(() => expect(getInboundOutboundWeek).toHaveBeenCalled());
    expect(await screen.findByText("Trends")).toBeInTheDocument();
    expect(screen.queryByText("Server error.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows a plain-language empty message when there are no calls", async () => {
    getInboundOutboundWeek.mockResolvedValue(volume(zeros));
    getDailyDurationWeek.mockResolvedValue(duration());
    getTopScorerAgentsWeek.mockResolvedValue({ success: true, inbound: null, outbound: null });

    render(<DashboardStatistics filters={{}} filterPeriodLabel="Last 1 month" />);

    expect(await screen.findByText(/No call trends for this period yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Server error.")).not.toBeInTheDocument();
  });

  it("only shows a retry when every trends request fails", async () => {
    getInboundOutboundWeek.mockRejectedValue(new Error("Server error."));
    getDailyDurationWeek.mockRejectedValue(new Error("Server error."));
    getTopScorerAgentsWeek.mockRejectedValue(new Error("Server error."));

    render(<DashboardStatistics filters={{}} filterPeriodLabel="Last 1 month" />);

    expect(
      await screen.findByText(/Trends could not be loaded right now/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Server error.")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Working directory: `frontend`

```powershell
$env:CI='true'; npm test -- --watchAll=false --testPathPattern=DashboardStatistics.test
```

Expected: FAIL — `Server error.` is rendered in the first and third cases.

- [ ] **Step 3: Replace `Promise.all` with per-request degradation**

In `frontend/src/components/DashboardStatistics.jsx`, replace the body of `fetchStats` (lines 121–181) with the settled version. Keep the existing `setCallVolume` / `setDuration` / `setTopScorers` mapping calls exactly as they are today — only the orchestration and error handling change:

```javascript
  const fetchStats = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const qs = buildDashboardQueryParams(filters);
      const [volRes, durRes, topRes] = await Promise.allSettled([
        getInboundOutboundWeek(qs),
        getDailyDurationWeek(qs),
        getTopScorerAgentsWeek(qs),
      ]);

      const ok = (settled) =>
        settled.status === "fulfilled" && settled.value?.success ? settled.value : null;
      const vol = ok(volRes);
      const dur = ok(durRes);
      const top = ok(topRes);

      // Only a total outage is worth blocking the section. A single failing
      // panel (usually top scorers on sparse data) leaves the charts usable.
      if (!vol && !dur && !top) {
        setFetchError("Trends could not be loaded right now. Please retry.");
        setCallVolume(null);
        setDuration(null);
        setTopScorers(null);
        return;
      }

      setCallVolume(vol);
      setDuration(dur);
      setTopScorers(top);
    } catch (err) {
      console.error("Failed to fetch dashboard statistics:", err);
      setFetchError("Trends could not be loaded right now. Please retry.");
    } finally {
      setLoading(false);
    }
  }, [filters]);
```

If the existing code maps the payloads into shaped objects before `setCallVolume` (for example `setCallVolume({ labels: vol.labels, inbound: vol.inbound, outbound: vol.outbound })`), keep that mapping and apply it to `vol` / `dur` / `top`, guarding each with the null check — do not change the shape the charts already consume.

- [ ] **Step 4: Make the empty state reachable and plain-language**

`hasNoData` (line 249) already computes zero inbound + zero outbound. Extend it so a section with no successful volume payload is treated as empty rather than broken, and reword the copy:

```javascript
  const hasNoData = !loading && !fetchError
    && (!callVolume || (totalInbound === 0 && totalOutbound === 0));
```

Then update the `EmptyState` (lines 287–303) copy:

```jsx
        <EmptyState
          compact
          fill
          icon={<LuInbox aria-hidden />}
          title="No call trends for this period yet"
        >
          Trends appear once calls are processed across more than one day, agent, or
          direction. Try a wider date range, or process more calls.
        </EmptyState>
```

- [ ] **Step 5: Run the tests to verify they pass**

```powershell
$env:CI='true'; npm test -- --watchAll=false --testPathPattern=DashboardStatistics.test
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/DashboardStatistics.jsx frontend/src/components/DashboardStatistics.test.jsx
git commit -m "Show a plain-language Trends message instead of a raw server error."
```

---

### Task 3: One clear Download button on the Quality workbook card

**Files:**
- Modify: `frontend/src/components/reports/analytics/ReportsDownloadTab.jsx` — `QualityWorkbookCard` (lines 33–81) and `downloadQuality` (lines 127–150)
- Modify: `frontend/src/components/reports/analytics/ReportsDownloadTab.test.jsx` — line 86 expectation
- No CSS change: reuse `analytics-dl-card__status` and the shared `Spinner`

**Interfaces:**
- Consumes: `Spinner` from `../../ui`; existing `qualityState` (`{ status, blob, error }`) and `busyKey`
- Produces: card with a single primary action. Disabled + spinner whenever the workbook is being prepared (background prefetch **or** click), so a second click is impossible.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/reports/analytics/ReportsDownloadTab.test.jsx`, inside the existing `describe("ReportsDownloadTab")`:

```javascript
  it("shows a busy Download button and no preview or marketing copy", async () => {
    let resolveWorkbook;
    downloadCollectionsQualityReport.mockReturnValue(
      new Promise((resolve) => { resolveWorkbook = resolve; }),
    );

    render(
      <ReportsDownloadTab
        filters={filters}
        isCollections
        periodLabel="2026-07-21 to 2026-08-21"
        buildBulkExportBody={() => ({})}
      />,
    );

    const button = await screen.findByRole("button", { name: /Preparing workbook/i });
    expect(button).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Preview sheets/i })).not.toBeInTheDocument();

    resolveWorkbook(new Blob(["official-xlsx"]));

    const ready = await screen.findByRole("button", { name: /Download \.xlsx/i });
    expect(ready).toBeEnabled();
    expect(screen.queryByText(/download is instant/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Same one-click Excel download as before/i)).not.toBeInTheDocument();
  });
```

Also update the existing assertion at line 86, which asserts the removed copy:

```javascript
    await waitFor(() => expect(screen.getByRole("button", { name: /Download \.xlsx/i })).toBeEnabled());
```

- [ ] **Step 2: Run it to verify it fails**

Working directory: `frontend`

```powershell
$env:CI='true'; npm test -- --watchAll=false --testPathPattern=ReportsDownloadTab.test
```

Expected: FAIL — no `Preparing workbook` button, `Preview sheets` still present, old copy still asserted.

- [ ] **Step 3: Import the shared spinner**

Change line 2 of `ReportsDownloadTab.jsx`:

```javascript
import { Button, Spinner } from "../../ui";
```

- [ ] **Step 4: Rewrite `QualityWorkbookCard`**

Replace lines 33–81 with a single-action card. `preparing` covers background prefetch *and* an explicit click, so the button is never clickable while work is in flight:

```jsx
function QualityWorkbookCard({
  title,
  format,
  description,
  periodLabel,
  status,
  hasBlob,
  busy,
  error,
  onDownload,
}) {
  const preparing = busy || (status === "loading" && !hasBlob);
  return (
    <article className="analytics-dl-card">
      <header className="analytics-dl-card__head">
        <h3>{title}</h3>
        <span className="analytics-dl-card__badge">{format}</span>
      </header>
      <p className="analytics-dl-card__desc">{description}</p>
      <p className="analytics-dl-card__period">{periodLabel}</p>
      {preparing && (
        <p className="analytics-dl-card__status" aria-live="polite">
          Gathering call data and building sheets…
        </p>
      )}
      {error && (
        <p className="analytics-dl-card__error">
          <LuTriangleAlert aria-hidden size={14} />
          <span>{error}</span>
        </p>
      )}
      <div className="analytics-dl-card__actions">
        <Button
          variant="primary"
          onClick={onDownload}
          disabled={preparing}
          aria-busy={preparing}
        >
          {preparing ? (
            <>
              <Spinner decorative className="analytics-dl-card__spinner" />
              Preparing workbook…
            </>
          ) : (
            <>
              <LuDownload aria-hidden style={{ verticalAlign: "-2px", marginRight: 6 }} />
              Download .xlsx
            </>
          )}
        </Button>
      </div>
    </article>
  );
}
```

- [ ] **Step 5: Drop the preview prop from the call site**

In the render block near line 199, remove `onPreview` from the `QualityWorkbookCard` element only. Leave `DownloadCard` and `openPreview` untouched — the other seven extract cards still use preview:

```jsx
          card.key === "quality" ? (
            <QualityWorkbookCard
              key={card.key}
              title={card.title}
              format={card.format}
              description={card.description}
              periodLabel={periodLabel}
              status={qualityState.status}
              hasBlob={Boolean(qualityState.blob)}
              busy={busyKey === "quality"}
              error={errors.quality || qualityState.error}
              onDownload={downloadQuality}
            />
          ) : (
```

Keep the exact prop names already passed for `status`, `hasBlob`, `busy`, and `error` if they differ from the above — only `onPreview` is being removed.

- [ ] **Step 6: Add the spinner sizing rule**

Append to `frontend/src/components/reports/reports-page.css`:

```css
.analytics-dl-card__spinner {
  width: 14px;
  height: 14px;
  margin-right: 6px;
  vertical-align: -2px;
  display: inline-block;
}
```

- [ ] **Step 7: Run the tests to verify they pass**

```powershell
$env:CI='true'; npm test -- --watchAll=false --testPathPattern=ReportsDownloadTab.test
```

Expected: PASS, 4 tests.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/reports/analytics/ReportsDownloadTab.jsx frontend/src/components/reports/analytics/ReportsDownloadTab.test.jsx frontend/src/components/reports/reports-page.css
git commit -m "Give the Quality workbook one clear Download button with real progress."
```

---

### Task 4: Isolate workbook data gathering behind a sargable query

**Files:**
- Create: `backend/services/qualityWorkbookData.js`
- Test: `backend/test/qualityWorkbookData.test.js`
- Modify: `backend/routes/miscRoutes.register.js` — the workbook build closure (lines 728–777)

**Interfaces:**
- Consumes: `consolidatedReportExtraFilters`, `bindReportFilters` from `backend/services/reportHelpers.js`; `mssql` types
- Produces:
  - `qualityWorkbookDateClause()` → sargable SQL string
  - `buildQualityWorkbookQuery({ selectCols, hasRange, extraFilters })` → full SELECT text
  - `fetchQualityWorkbookRows(pool, { selectCols, hasRange, fromDate, toDate, params, bindReportFilters, sqlTypes })` → `{ rows, sqlMs }`

- [ ] **Step 1: Write the failing test**

Create `backend/test/qualityWorkbookData.test.js`:

```javascript
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  qualityWorkbookDateClause,
  buildQualityWorkbookQuery,
  fetchQualityWorkbookRows,
} = require("../services/qualityWorkbookData");

test("date clause is sargable so IX_CAA_UploadDate stays usable", () => {
  const clause = qualityWorkbookDateClause();
  assert.ok(
    !/CAST\(\s*COALESCE/i.test(clause),
    "must not wrap the indexed column in CAST(COALESCE(...))",
  );
  assert.match(clause, /UploadDate >= @fromDate/);
  assert.match(clause, /UploadDate < DATEADD\(DAY, 1, @toDate\)/);
  assert.match(clause, /UploadDate IS NULL/);
  assert.match(clause, /SelectedCallDate >= @fromDate/);
});

test("query keeps the collections scope, filters, and ordering", () => {
  const text = buildQualityWorkbookQuery({
    selectCols: "AudioFileName, AgentName",
    hasRange: true,
    extraFilters: " AND TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))",
  });
  assert.match(text, /SELECT AudioFileName, AgentName/);
  assert.match(text, /FROM Consolidated_Audio_Analysis/);
  assert.match(text, /AI_Coll_Score IS NOT NULL/);
  assert.match(text, /@location/);
  assert.match(text, /ORDER BY COALESCE\(UploadDate, SelectedCallDate\) DESC/);
});

test("falls back to a rolling 30 day window when no range is given", () => {
  const text = buildQualityWorkbookQuery({ selectCols: "AudioFileName", hasRange: false });
  assert.match(text, /DATEADD\(DAY, -30, CAST\(GETDATE\(\) AS DATE\)\)/);
  assert.ok(!text.includes("@fromDate"), "must not reference an unbound parameter");
});

test("binds the range once and reports elapsed sql time", async () => {
  const bound = [];
  const pool = {
    request() {
      const req = {
        input(name, type, value) { bound.push([name, value]); return req; },
        async query() { return { recordset: [{ AudioFileName: "a.mp3" }] }; },
      };
      return req;
    },
  };
  const result = await fetchQualityWorkbookRows(pool, {
    selectCols: "AudioFileName",
    hasRange: true,
    fromDate: "2026-07-27",
    toDate: "2026-08-27",
    params: { location: "All" },
    bindReportFilters: () => {},
    sqlTypes: { Date: "date" },
  });
  assert.deepEqual(result.rows, [{ AudioFileName: "a.mp3" }]);
  assert.equal(typeof result.sqlMs, "number");
  assert.deepEqual(bound, [["fromDate", "2026-07-27"], ["toDate", "2026-08-27"]]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Working directory: `backend`

```powershell
node --test test/qualityWorkbookData.test.js
```

Expected: FAIL — `Cannot find module '../services/qualityWorkbookData'`.

- [ ] **Step 3: Implement the service**

Create `backend/services/qualityWorkbookData.js`:

```javascript
/**
 * Isolated data gathering for the ICICI HFC quality workbook.
 *
 * The reports-wide helper wraps the date columns in CAST(COALESCE(...)), which
 * is not sargable and forces a full scan of Consolidated_Audio_Analysis across
 * ~90 wide columns. This module keeps the identical row set but expresses the
 * range as plain half-open comparisons so IX_CAA_UploadDate can be used.
 */

/** Sargable equivalent of "COALESCE(UploadDate, SelectedCallDate) date-between". */
function qualityWorkbookDateClause() {
  return `(
        (UploadDate IS NOT NULL
          AND UploadDate >= @fromDate
          AND UploadDate < DATEADD(DAY, 1, @toDate))
        OR (UploadDate IS NULL
          AND SelectedCallDate >= @fromDate
          AND SelectedCallDate < DATEADD(DAY, 1, @toDate))
      )`;
}

function buildQualityWorkbookQuery({ selectCols, hasRange, extraFilters = "" }) {
  const dateClause = hasRange
    ? qualityWorkbookDateClause()
    : "COALESCE(UploadDate, SelectedCallDate) >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE))";
  return `
        SELECT ${selectCols}
        FROM Consolidated_Audio_Analysis
        WHERE AI_Coll_Score IS NOT NULL AND ${dateClause}${extraFilters}
        ORDER BY COALESCE(UploadDate, SelectedCallDate) DESC
      `;
}

async function fetchQualityWorkbookRows(pool, {
  selectCols,
  hasRange,
  fromDate,
  toDate,
  params,
  extraFilters = "",
  bindReportFilters,
  sqlTypes,
}) {
  const request = pool.request();
  if (hasRange) {
    request.input("fromDate", sqlTypes.Date, fromDate);
    request.input("toDate", sqlTypes.Date, toDate);
  }
  bindReportFilters(request, params);
  const query = buildQualityWorkbookQuery({ selectCols, hasRange, extraFilters });
  const startedAt = Date.now();
  const result = await request.query(query);
  return { rows: result.recordset || [], sqlMs: Date.now() - startedAt };
}

module.exports = {
  qualityWorkbookDateClause,
  buildQualityWorkbookQuery,
  fetchQualityWorkbookRows,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```powershell
node --test test/qualityWorkbookData.test.js
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Use the service in the route**

In `backend/routes/miscRoutes.register.js`, add to the requires near line 47:

```javascript
  const { fetchQualityWorkbookRows } = require("../services/qualityWorkbookData");
```

Then in the `/api/collections/quality-report` handler, delete the local `dateClause` / `where` construction (lines 728–732) and replace the build closure's query block (lines 745–763) so it calls the service. Keep `selectCols`, the 409 on empty, the `buildIcicQualityReportBuffer` call, and the caching exactly as they are:

```javascript
    const buildPromise = rememberQualityBuild(cacheKey, (async () => {
      const { rows: calls, sqlMs } = await fetchQualityWorkbookRows(pool, {
        selectCols,
        hasRange,
        fromDate,
        toDate,
        params,
        extraFilters: consolidatedReportExtraFilters(params),
        bindReportFilters,
        sqlTypes: sql,
      });
      if (!calls.length) {
        const empty = new Error('No collections-scored calls found for this period.');
        empty.statusCode = 409;
        throw empty;
      }

      const excelStartedAt = Date.now();
      const buffer = await buildIcicQualityReportBuffer({
        calls,
        dims,
        mapStatuses: (row) => (mapCollectionsScoring(row) || {}).statuses || {},
        period: hasRange ? { fromDate, toDate } : null,
        orgName: 'ICICI HFC',
      });
      const excelMs = Date.now() - excelStartedAt;
      const bytes = Buffer.from(buffer);
      console.info(
        `[quality-report] build rows=${calls.length} sqlMs=${sqlMs} excelMs=${excelMs} bytes=${bytes.length}`,
      );
      if (shouldStoreWorkbook(bytes)) {
        await cacheService.setBuffer(cacheKey, bytes, QUALITY_CACHE_TTL_SEC);
      }
      return bytes;
    })());
```

Confirm `consolidatedReportExtraFilters` and `bindReportFilters` are already destructured in this file (they are used by the current handler). If `extra` was computed once outside the closure and is still referenced elsewhere in the handler, leave that variable in place.

- [ ] **Step 6: Confirm the route still parses and the suite is green**

```powershell
node --check routes/miscRoutes.register.js
node --test test/qualityWorkbookData.test.js test/ptpQuality.test.js test/dashboardDrilldown.test.js test/auditQueueQuery.test.js test/topScorerWeek.test.js
```

Expected: `node --check` silent (valid syntax); all suites PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/services/qualityWorkbookData.js backend/test/qualityWorkbookData.test.js backend/routes/miscRoutes.register.js
git commit -m "Gather quality workbook rows with an index-friendly date range."
```

---

### Task 5: Make cache behaviour observable and long enough to matter

**Files:**
- Modify: `backend/routes/miscRoutes.register.js` — `sendWorkbook` (lines 677–686)
- Modify: `production/.env` — add `QUALITY_REPORT_CACHE_TTL_SEC`

**Interfaces:**
- Consumes: existing `X-Cache` status string
- Produces: `Server-Timing: cache;desc="HIT|MISS"` plus a wall-clock line in logs, so "cache is not working" becomes a measurable claim instead of a guess.

- [ ] **Step 1: Add response timing to `sendWorkbook`**

Replace lines 677–686 of `backend/routes/miscRoutes.register.js`:

```javascript
  const requestStartedAt = Date.now();
  const sendWorkbook = (bytes, cacheStatus) => {
    const stamp = hasRange ? `${fromDate}_to_${toDate}` : new Date().toISOString().slice(0, 10);
    const filename = `ICICI_HFC_Quality_Report_${stamp}.xlsx`;
    const totalMs = Date.now() - requestStartedAt;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', bytes.length);
    res.setHeader('X-Cache', cacheStatus);
    res.setHeader('Server-Timing', `cache;desc="${cacheStatus}", total;dur=${totalMs}`);
    console.info(
      `[quality-report] cache=${cacheStatus} totalMs=${totalMs} bytes=${bytes.length}`,
    );
    return res.status(200).end(bytes);
  };
```

- [ ] **Step 2: Verify syntax**

Working directory: `backend`

```powershell
node --check routes/miscRoutes.register.js
```

Expected: no output.

- [ ] **Step 3: Raise the prod cache TTL (no code change)**

`backend/services/qualityReportCache.js` already reads `QUALITY_REPORT_CACHE_TTL_SEC` and defaults to 600s, which is why a second download ten minutes later rebuilds. Add to `production/.env`:

```
# Quality workbook byte cache — 6h so repeat downloads of the same range are instant.
QUALITY_REPORT_CACHE_TTL_SEC=21600
```

Do not edit `production/.env.container` by hand; it is generated.

- [ ] **Step 4: Commit the route change only**

`production/.env` holds live prod values and is not committed.

```bash
git add backend/routes/miscRoutes.register.js
git commit -m "Report quality workbook cache status and build time on every download."
```

---

### Task 6: Verify, build, and ship ICICI HFC tars

**Files:** build artifacts only — `production/docker-images/sp-frontend.tar`, `production/docker-images/sp-backend.tar`

**Interfaces:**
- Consumes: Tasks 1–5
- Produces: verified bundle + a backend image whose `/app/server.js`, `/app/routes/miscRoutes.register.js`, `/app/services/reportHelpers.js` and new `/app/services/qualityWorkbookData.js` carry these fixes, with Strong/Weak PTP and the audit breakdowns intact

- [ ] **Step 1: Run the focused suites**

Backend (from `backend`):

```powershell
node --test test/topScorerWeek.test.js test/qualityWorkbookData.test.js test/ptpQuality.test.js test/dashboardDrilldown.test.js test/auditQueueQuery.test.js
```

Frontend (from `frontend`):

```powershell
$env:CI='true'; npm test -- --watchAll=false --testPathPattern="DashboardStatistics.test|ReportsDownloadTab.test|AuditSection.test|CollectionsDashboardSection.test"
```

Expected: PASS.

- [ ] **Step 2: Production frontend build**

```powershell
cd frontend
npm run build
```

Expected: compile succeeds. Record the new `build/static/js/main.*.js` hash.

- [ ] **Step 3: Confirm the removed copy is gone from the bundle**

From the repo root:

```powershell
Select-String -Path "frontend\build\static\js\main.*.js" -Pattern "download is instant","Preview sheets","Same one-click Excel download"
```

Expected: **no matches**. Then confirm the new copy is present:

```powershell
Select-String -Path "frontend\build\static\js\main.*.js" -Pattern "Preparing workbook","No call trends for this period yet","Trends could not be loaded"
```

Expected: all three match.

- [ ] **Step 4: Build the frontend tar**

```powershell
docker build -t sp-frontend:prod -f production-build/docker/Dockerfile.frontend-static.patch frontend
docker save -o production/docker-images/sp-frontend.tar sp-frontend:prod
```

Must be `FROM sp-frontend:base` — never patch `prod` onto itself.

- [ ] **Step 5: Build the backend tar as a scoped overlay**

Do **not** use `Dockerfile.backend.patch` or `.repatch`; both copy dozens of unrelated working-tree files. Preserve the current image, then overlay only this plan's backend files.

```powershell
docker tag sp-backend:prod sp-backend:pre-trends-workbook
```

Create an uncommitted `production-build/_tmp_workbook_overlay/Dockerfile.backend.workbook-only`:

```dockerfile
FROM sp-backend:prod AS patched
COPY backend/services/reportHelpers.js /app/services/reportHelpers.js
COPY backend/services/qualityWorkbookData.js /app/services/qualityWorkbookData.js
COPY backend/routes/miscRoutes.register.js /app/routes/miscRoutes.register.js
RUN node /app/tools/build-integrity-manifest.js /app /app/integrity-manifest.json \
  && node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync('/app/integrity-manifest.json','utf8'));if(!Object.keys(m).length)process.exit(1)"
```

```powershell
docker build -t sp-backend:prod -f production-build/_tmp_workbook_overlay/Dockerfile.backend.workbook-only .
docker build --provenance=false -t sp-backend:prod -f production-build/docker/Dockerfile.backend.flatten .
docker save -o production/docker-images/sp-backend.tar sp-backend:prod
```

Do **not** rebuild AI images.

- [ ] **Step 6: Verify the backend image**

```powershell
docker run --rm --entrypoint sh sp-backend:prod -c "grep -c 'TRY_CAST(APR.AIScoring' /app/services/reportHelpers.js; grep -c 'DATEADD(DAY, 1, @toDate)' /app/services/qualityWorkbookData.js; grep -c 'Server-Timing' /app/routes/miscRoutes.register.js"
docker run --rm --entrypoint node sp-backend:prod -e "require('/app/services/qualityWorkbookData.js'); require('/app/services/ptpQuality.js'); console.log('modules-ok')"
```

Expected: each `grep -c` at least `1`, then `modules-ok`.

Confirm nothing else drifted — these must match `sp-backend:pre-trends-workbook`:

```powershell
docker run --rm --entrypoint sha256sum sp-backend:prod /app/services/tenancy.js /app/services/ptpQuality.js /app/services/dashboardDrilldown.js /app/server.js
docker run --rm --entrypoint sha256sum sp-backend:pre-trends-workbook /app/services/tenancy.js /app/services/ptpQuality.js /app/services/dashboardDrilldown.js /app/server.js
```

Expected: identical hashes for all four.

- [ ] **Step 7: Record hashes**

```powershell
Get-FileHash "production\docker-images\sp-frontend.tar","production\docker-images\sp-backend.tar" -Algorithm SHA256 | Format-List
```

- [ ] **Step 8: Prod deploy**

Copy both tars to `/home/suvadip/Call-Analysis/Project/production/docker-images/`, then add the TTL line from Task 5 Step 3 to `production/.env` on the host:

```bash
cd /home/suvadip/Call-Analysis/Project/production
docker load -i docker-images/sp-frontend.tar
docker load -i docker-images/sp-backend.tar
bash scripts/bootstrap-prod-secrets.sh
docker compose up -d --force-recreate --no-deps backend frontend
```

Confirm:

```bash
docker exec sp_frontend sh -c 'ls /usr/share/nginx/html/static/js/main.*.js'
docker exec sp_backend node -e "require('/app/services/qualityWorkbookData.js'); console.log('ok')"
docker exec sp_backend printenv QUALITY_REPORT_CACHE_TTL_SEC
docker compose logs --tail=40 backend | grep quality-report
```

Then hard refresh (`Ctrl+Shift+R`) and check:

1. Dashboard → Trends shows the plain-language empty message (or charts), never `Server error.`
2. Reports → Report center → Quality workbook shows one **Download .xlsx** button, disabled with a spinner while preparing, and no preview button or "download is instant" line
3. Download the same range twice. The backend log line shows `cache=MISS` with `sqlMs`/`excelMs` the first time and `cache=HIT` with a small `totalMs` the second time.

- [ ] **Step 9: No tar commits**

Do not commit `production/docker-images/*.tar`, `production/.env`, or the temp overlay Dockerfile.

---

## Self-review

**Spec coverage**
- Trends "Server error." replaced with a dynamic, gentle message → Tasks 1 + 2
- Root cause actually fixed, not masked (bad legacy score value, duplicate `callType` bind) → Task 1
- Isolated API for quick data gathering by date range → Task 4 (`qualityWorkbookData.js`, sargable predicate reusing `IX_CAA_UploadDate`)
- Caching that actually holds between downloads → Task 5 (TTL 600s → 21600s, measured via `X-Cache` + `Server-Timing`)
- Download button shows it was clicked → Task 3 (disabled + spinner + `aria-busy` during prefetch **and** click)
- Preview removed from this report only → Task 3 Steps 4–5 (other seven cards keep `DownloadCard` preview)
- Marketing copy removed → Task 3 Step 4, verified against the built bundle in Task 6 Step 3

**Placeholder scan:** none. Every step names exact files, shows the code, and gives the command with expected output.

**Type consistency:** `qualityWorkbookDateClause()` / `buildQualityWorkbookQuery({ selectCols, hasRange, extraFilters })` / `fetchQualityWorkbookRows(pool, opts) → { rows, sqlMs }` are used with those exact names and shapes in Task 4 Step 5. `queryTopScorerForWeek(pool, callType, params) → object | null` is unchanged for existing callers in `reportRoutes.register.js`. `qualityState` stays `{ status, blob, error }`; `QualityWorkbookCard` drops only `onPreview`.

**Deliberately out of scope (report if you hit it, do not fix):** trimming unused `AI_*` columns from the workbook SELECT (needs a per-sheet column audit first), new DB indexes, `reportCatalog.js` `instantPreview` cleanup, and the `openPreview` branch that is now unreachable for the quality card.
