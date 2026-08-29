const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  issueToken,
  verifyToken,
  normalizeFilters,
  normalizeListOptions,
  operationalPredicate,
  tonePredicate,
  insightPredicate,
  fetchPage,
} = require("../services/dashboardDrilldown");

const SECRET = "dashboard-drilldown-test-secret-that-is-long-enough";
const BASE = {
  kind: "collections",
  key: "ptp",
  filters: {
    fromDate: "2026-07-01",
    toDate: "2026-07-31",
    location: "Kolkata",
    tl: "TL One",
    agent: "Agent A",
    leadClassification: "Warm Lead",
  },
  username: "Suvadip",
  tenant: "ca_icic",
  expectedCount: 87,
  nowSeconds: 1000,
  secret: SECRET,
};

describe("dashboard drill-down security contract", () => {
  it("round-trips a signed, user and tenant-bound definition", () => {
    const token = issueToken(BASE);
    const claims = verifyToken(token, {
      username: "suvadip",
      tenant: "CA_ICIC",
      nowSeconds: 1010,
      secret: SECRET,
    });
    assert.equal(claims.key, "ptp");
    assert.equal(claims.expectedCount, 87);
    assert.equal(claims.filters.leadClassification, "Warm Lead");
  });

  it("rejects tampering, another user, another tenant and expiry", () => {
    const token = issueToken(BASE);
    assert.throws(() => verifyToken(`${token.slice(0, -1)}x`, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    }), /Invalid/);
    assert.throws(() => verifyToken(token, {
      username: "Other", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    }), /different user/);
    assert.throws(() => verifyToken(token, {
      username: "Suvadip", tenant: "ca_other", nowSeconds: 1010, secret: SECRET,
    }), /different organization/);
    assert.throws(() => verifyToken(token, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1000 + (31 * 60), secret: SECRET,
    }), /expired/);
  });

  it("allows only whitelisted categories and bounded other-category values", () => {
    assert.throws(() => issueToken({ ...BASE, key: "sql", value: "1=1" }), /Unsupported/);
    const token = issueToken({
      ...BASE,
      key: "disposition-other",
      excludedValues: ["Call back", "Promise to pay"],
    });
    const claims = verifyToken(token, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    });
    assert.deepEqual(claims.excludedValues, ["Call back", "Promise to pay"]);
  });

  it("allows only exact role-separated tone buckets", () => {
    const token = issueToken({
      ...BASE,
      kind: "tone",
      key: "agent-negative",
      expectedCount: 12,
    });
    const claims = verifyToken(token, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    });
    assert.equal(claims.kind, "tone");
    assert.equal(claims.key, "agent-negative");
    assert.throws(() => issueToken({
      ...BASE,
      kind: "tone",
      key: "agent-anything",
    }), /Unsupported/);
  });

  it("allows only whitelisted operational-insight definitions with required values", () => {
    const token = issueToken({
      ...BASE,
      kind: "insight",
      key: "query-type",
      value: "Loan EMI/Repayment",
      expectedCount: 213,
    });
    const claims = verifyToken(token, {
      username: "suvadip", tenant: "CA_ICIC", nowSeconds: 1010, secret: SECRET,
    });
    assert.equal(claims.kind, "insight");
    assert.equal(claims.value, "Loan EMI/Repayment");
    assert.throws(() => issueToken({ ...BASE, kind: "insight", key: "query-type", value: "" }), /required/);
    assert.throws(() => issueToken({ ...BASE, kind: "insight", key: "hold-longest", value: "0" }), /invalid/);
    assert.throws(() => issueToken({ ...BASE, kind: "insight", key: "arbitrary" }), /Unsupported/);
  });

  it("allows collections ptp-strong and ptp-weak keys", () => {
    const strong = issueToken({ ...BASE, key: "ptp-strong", expectedCount: 40 });
    const weak = issueToken({ ...BASE, key: "ptp-weak", expectedCount: 12 });
    assert.equal(verifyToken(strong, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    }).key, "ptp-strong");
    assert.equal(verifyToken(weak, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    }).key, "ptp-weak");
  });

  it("rejects malformed dates instead of silently widening the scope", () => {
    assert.throws(() => issueToken({
      ...BASE,
      filters: { ...BASE.filters, fromDate: "not-a-date" },
    }), /date range/i);
  });

  it("allows language and language-other collections keys and rejects a language value-less token", () => {
    const hindi = issueToken({
      ...BASE,
      key: "language",
      value: "Hindi",
      expectedCount: 88,
    });
    const claims = verifyToken(hindi, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    });
    assert.equal(claims.key, "language");
    assert.equal(claims.value, "Hindi");
    assert.throws(() => issueToken({ ...BASE, key: "language", value: "" }), /required/i);
    assert.throws(() => issueToken({ ...BASE, key: "language-hack" }), /Unsupported/);
    const other = issueToken({
      ...BASE,
      key: "language-other",
      excludedValues: ["Hindi", "Marathi"],
      expectedCount: 6,
    });
    assert.deepEqual(verifyToken(other, {
      username: "Suvadip", tenant: "ca_icic", nowSeconds: 1010, secret: SECRET,
    }).excludedValues, ["Hindi", "Marathi"]);
    assert.throws(() => issueToken({ ...BASE, key: "language-other", excludedValues: [] }), /grouped category/i);
  });
});

describe("dashboard drill-down query normalization", () => {
  it("normalizes shared dashboard filters", () => {
    assert.deepEqual(normalizeFilters({
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      location: "All",
      supervisor: " TL One ",
      callType: "OUTBOUND",
    }), {
      fromDate: "2026-01-01",
      toDate: "2026-01-31",
      location: null,
      tl: "TL One",
      callType: "outbound",
      agent: null,
      leadClassification: null,
    });
  });

  it("bounds pagination and sort input", () => {
    assert.deepEqual(normalizeListOptions({ page: -2, pageSize: 900, sort: "DROP TABLE", direction: "SIDEWAYS" }), {
      page: 1,
      pageSize: 100,
      search: null,
      sort: "callDate",
      direction: "DESC",
    });
  });

  it("uses the canonical operational status predicates", () => {
    assert.match(operationalPredicate("success"), /APR\.Status/);
    assert.match(operationalPredicate("failed", "full"), /CAA\.Status/);
    assert.doesNotMatch(operationalPredicate("failed", "fallback"), /CAA\.Status/);
  });

  it("parameterizes the role tone bucket and preserves acoustic-first fallback logic", () => {
    const inputs = {};
    const request = { input(name, _type, value) { inputs[name] = value; return this; } };
    const sql = { NVarChar: "NVarChar" };
    const predicate = tonePredicate({ key: "customer-negative" }, request, sql);
    assert.equal(inputs.toneBucket, "negative");
    assert.match(predicate, /Overall_Emotion\.Customer/);
    assert.match(predicate, /OPENJSON/);
    assert.match(predicate, /Sentiment Polarity/);
    assert.match(predicate, /= @toneBucket/);
  });

  it("uses fixed parameterized predicates for outcome, longest hold, and escalation categories", () => {
    const inputs = {};
    const request = { input(name, _type, value) { inputs[name] = value; return this; } };
    const sql = { NVarChar: "NVarChar", Float: "Float" };

    assert.match(insightPredicate({ key: "query-type", value: "Loan EMI/Repayment" }, request, sql), /= @categoryValue/);
    assert.equal(inputs.categoryValue, "Loan EMI/Repayment");
    assert.match(insightPredicate({ key: "hold-longest", value: "117" }, request, sql), /= @metricValue/);
    assert.equal(inputs.metricValue, 117);
    assert.match(insightPredicate({ key: "escalation-not-actioned" }, request, sql), /AI_Escalation_Actioned/);
    assert.match(insightPredicate({ key: "escalation-csat" }, request, sql), /AI_CSAT_Transferred/);
  });

  it("uses the same successful-call scope for tone drill-down pages", async () => {
    let capturedQuery = "";
    const inputs = {};
    const request = {
      input(name, _type, value) { inputs[name] = value; return this; },
      async query(query) {
        capturedQuery = query;
        return { recordsets: [[{ total: 3 }], [{ total: 3 }], [{ callId: 7 }]] };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar" };
    const claims = {
      kind: "tone",
      key: "agent-positive",
      expectedCount: 3,
      sourceVariant: "full",
      filters: normalizeFilters(BASE.filters),
    };
    const result = await fetchPage(pool, sql, claims, {});

    assert.equal(inputs.toneBucket, "positive");
    assert.match(capturedQuery, /INNER JOIN dbo\.AI_Processing_Result/);
    assert.match(capturedQuery, /INNER JOIN dbo\.Consolidated_Audio_Analysis/);
    assert.match(capturedQuery, /APR\.Status/);
    assert.match(capturedQuery, /AI_Lead_Classification/);
    assert.equal(result.currentCount, 3);
    assert.equal(result.countChanged, false);
    assert.match(result.title, /Agent tone: Positive/);
  });

  it("keeps category and dashboard filters parameterized while reconciling the unsearched count", async () => {
    let capturedQuery = "";
    const inputs = {};
    const request = {
      input(name, _type, value) { inputs[name] = value; return this; },
      async query(query) {
        capturedQuery = query;
        return {
          recordsets: [
            [{ total: 87 }],
            [{ total: 1 }],
            [{ callId: 42, audioFileName: "call-42.wav", agentName: "Agent A" }],
          ],
        };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar" };
    const claims = {
      kind: "collections",
      key: "disposition",
      value: "Promise to pay",
      expectedCount: 87,
      filters: normalizeFilters(BASE.filters),
    };
    const result = await fetchPage(pool, sql, claims, { search: "call-42", pageSize: 25 });

    assert.equal(inputs.categoryValue, "Promise to pay");
    assert.equal(inputs.search, "%call-42%");
    assert.equal(inputs.leadClassification, "warm lead");
    assert.match(capturedQuery, /AI_Coll_Disposition/);
    assert.match(capturedQuery, /= @categoryValue/);
    assert.doesNotMatch(capturedQuery, /Promise to pay/);
    assert.equal(result.currentCount, 87);
    assert.equal(result.total, 1);
    assert.equal(result.countChanged, false);
    assert.equal(result.rows[0].callId, 42);
  });

  it("lists exact insight calls from the same successful consolidated scope", async () => {
    let capturedQuery = "";
    const inputs = {};
    const request = {
      input(name, _type, value) { inputs[name] = value; return this; },
      async query(query) {
        capturedQuery = query;
        return { recordsets: [[{ total: 10 }], [{ total: 10 }], [{ callId: 8, holdCount: 2 }]] };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar", Float: "Float" };
    const claims = {
      kind: "insight",
      key: "hold-detected",
      expectedCount: 10,
      filters: normalizeFilters(BASE.filters),
    };
    const result = await fetchPage(pool, sql, claims, {});

    assert.match(capturedQuery, /FROM dbo\.Consolidated_Audio_Analysis CAA/);
    assert.match(capturedQuery, /CAA\.Status/);
    assert.match(capturedQuery, /AI_Hold_Detected/);
    assert.match(capturedQuery, /AI_Hold_Count AS INT/);
    assert.match(capturedQuery, /AI_Lead_Classification/);
    assert.equal(result.currentCount, 10);
    assert.match(result.title, /Calls with agent hold/);
  });

  it("filters Strong PTP to Genuine secured promises", async () => {
    let capturedQuery = "";
    const request = {
      input() { return this; },
      async query(query) {
        capturedQuery = query;
        return { recordsets: [[{ total: 40 }], [{ total: 40 }], [{ callId: 9 }]] };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar" };
    const claims = {
      kind: "collections",
      key: "ptp-strong",
      expectedCount: 40,
      filters: normalizeFilters(BASE.filters),
    };
    const result = await fetchPage(pool, sql, claims, {});
    assert.match(capturedQuery, /AI_PTP_Present/);
    assert.match(capturedQuery, /AI_PTP_Genuineness/);
    assert.match(capturedQuery, /'genuine'/);
    assert.match(result.title, /Strong PTP/i);
  });

  it("filters Weak PTP to non-Genuine secured promises", async () => {
    let capturedQuery = "";
    const request = {
      input() { return this; },
      async query(query) {
        capturedQuery = query;
        return { recordsets: [[{ total: 12 }], [{ total: 12 }], [{ callId: 3 }]] };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar" };
    const claims = {
      kind: "collections",
      key: "ptp-weak",
      expectedCount: 12,
      filters: normalizeFilters(BASE.filters),
    };
    const result = await fetchPage(pool, sql, claims, {});
    assert.match(capturedQuery, /AI_PTP_Present/);
    assert.match(capturedQuery, /NOT \(/);
    assert.match(result.title, /Weak PTP/i);
  });

  it("filters language drill-down on AudioLanguage with a bound category value", async () => {
    let capturedQuery = "";
    const inputs = {};
    const request = {
      input(name, _type, value) { inputs[name] = value; return this; },
      async query(query) {
        capturedQuery = query;
        return {
          recordsets: [
            [{ total: 88 }],
            [{ total: 1 }],
            [{ callId: 42, audioFileName: "call-42.wav", agentName: "Agent A" }],
          ],
        };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar" };
    const result = await fetchPage(pool, sql, {
      kind: "collections",
      key: "language",
      value: "Hindi",
      expectedCount: 88,
      filters: normalizeFilters(BASE.filters),
    }, { search: "call-42", pageSize: 25 });

    assert.equal(inputs.categoryValue, "Hindi");
    assert.match(capturedQuery, /CAA\.AudioLanguage/);
    assert.match(capturedQuery, /= @categoryValue/);
    assert.doesNotMatch(capturedQuery, /Hindi/);
    assert.match(result.title, /Language: Hindi/);
    assert.equal(result.currentCount, 88);
  });

  it("filters language-other with parameterized excluded language names", async () => {
    let capturedQuery = "";
    const inputs = {};
    const request = {
      input(name, _type, value) { inputs[name] = value; return this; },
      async query(query) {
        capturedQuery = query;
        return { recordsets: [[{ total: 6 }], [{ total: 6 }], [{ callId: 7 }]] };
      },
    };
    const pool = { request: () => request };
    const sql = { Date: "Date", Int: "Int", NVarChar: "NVarChar" };
    const result = await fetchPage(pool, sql, {
      kind: "collections",
      key: "language-other",
      excludedValues: ["Hindi", "Marathi"],
      expectedCount: 6,
      filters: normalizeFilters(BASE.filters),
    }, {});

    assert.equal(inputs.excluded0, "Hindi");
    assert.equal(inputs.excluded1, "Marathi");
    assert.match(capturedQuery, /AudioLanguage/);
    assert.match(capturedQuery, /NOT IN \(@excluded0, @excluded1\)/);
    assert.doesNotMatch(capturedQuery, /Hindi/);
    assert.match(result.title, /Other languages/);
  });
});
