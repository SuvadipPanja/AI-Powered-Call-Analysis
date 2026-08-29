const test = require("node:test");
const assert = require("node:assert/strict");
const { collectionsDateClause, collectionsWhere, collectionsAuditCoverageQuery } = require("../services/collectionsReportScope");

test("range is sargable and prefers UploadDate", () => {
  const clause = collectionsDateClause({ hasRange: true });
  assert.ok(!/CAST\(\s*COALESCE/i.test(clause));
  assert.match(clause, /UploadDate >= @fromDate/);
  assert.match(clause, /UploadDate < DATEADD\(DAY, 1, @toDate\)/);
  assert.match(clause, /UploadDate IS NULL/);
  assert.match(clause, /SelectedCallDate >= @fromDate/);
});

test("scopes every collections extract to scored calls", () => {
  const where = collectionsWhere({ hasRange: true, extraFilters: " AND AgentName = @agent" });
  assert.match(where, /AI_Coll_Score IS NOT NULL/);
  assert.match(where, /@agent/);
});

test("falls back to a rolling 30 days when no range is given", () => {
  const clause = collectionsDateClause({ hasRange: false });
  assert.match(clause, /DATEADD\(DAY, -30/);
  assert.ok(!clause.includes("@fromDate"));
});

test("collectionsAuditCoverageQuery joins CallAudits on AudioFileName inside the collections where", () => {
  const sql = collectionsAuditCoverageQuery("WHERE AI_Coll_Score IS NOT NULL");
  assert.match(sql, /FROM Consolidated_Audio_Analysis/);
  assert.match(sql, /LEFT JOIN dbo\.CallAudits CA ON CA\.AudioFileName = scoped\.AudioFileName/);
  assert.match(sql, /AS aiOnly/);
  assert.match(sql, /AS manualReviewed/);
  assert.match(sql, /OverallManualScore/);
  assert.equal(sql.includes("OriginalLanguage"), false);
  assert.match(sql, /WHERE AI_Coll_Score IS NOT NULL/);
});
