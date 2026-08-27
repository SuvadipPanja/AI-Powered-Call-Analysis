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

test("returns an empty array when the range has no scored calls", async () => {
  const pool = {
    request() {
      const req = {
        input() { return req; },
        async query() { return {}; },
      };
      return req;
    },
  };
  const result = await fetchQualityWorkbookRows(pool, {
    selectCols: "AudioFileName",
    hasRange: false,
    params: {},
    bindReportFilters: () => {},
    sqlTypes: { Date: "date" },
  });
  assert.deepEqual(result.rows, []);
});
