const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { collectionsLanguageMixSelect, collectionsWhere } = require("../services/collectionsReportScope");

test("collectionsLanguageMixSelect groups by AudioLanguage and aliases name/count", () => {
  const select = collectionsLanguageMixSelect();
  assert.match(select, /AudioLanguage/);
  assert.match(select, /COALESCE\(NULLIF\(LTRIM\(RTRIM\(AudioLanguage\)\), ''\), 'Unknown'\)/);
  assert.match(select, /AS name/);
  assert.match(select, /COUNT\(\*\) AS count/);
});

test("the language mix query is collections-scoped (AI_Coll_Score IS NOT NULL)", () => {
  const where = collectionsWhere({ hasRange: true });
  assert.match(where, /AI_Coll_Score IS NOT NULL/);
  const select = collectionsLanguageMixSelect();
  const sql = `SELECT ${select} FROM Consolidated_Audio_Analysis ${where} GROUP BY ${select} ORDER BY count DESC`;
  assert.match(sql, /FROM Consolidated_Audio_Analysis/);
  assert.match(sql, /GROUP BY.*AudioLanguage/);
  assert.match(sql, /ORDER BY count DESC/);
  assert.match(sql, /AI_Coll_Score IS NOT NULL/);
});

test("miscRoutes.register.js wires languageMix empty payload and collectionsLanguageMixSelect", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "../routes/miscRoutes.register.js"),
    "utf8"
  );
  const emptyBlock = src.match(/router\.get\('\/api\/collections\/dashboard'[\s\S]*?const empty = \{[\s\S]*?\};/);
  assert.ok(emptyBlock, "dashboard handler empty payload not found");
  assert.match(emptyBlock[0], /languageMix:\s*\[\]/);
  assert.match(src, /collectionsLanguageMixSelect/);
});
