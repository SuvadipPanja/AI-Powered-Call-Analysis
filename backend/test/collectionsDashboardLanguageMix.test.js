const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { collectionsLanguageMixSelect, collectionsWhere } = require("../services/collectionsReportScope");

const AUDIO_LANG_COALESCE = /COALESCE\(NULLIF\(LTRIM\(RTRIM\(AudioLanguage\)\), ''\), 'Unknown'\)/;

function miscRoutesSource() {
  return fs.readFileSync(
    path.join(__dirname, "../routes/miscRoutes.register.js"),
    "utf8"
  );
}

test("collectionsLanguageMixSelect groups by AudioLanguage and aliases name/count", () => {
  const select = collectionsLanguageMixSelect();
  assert.match(select, /AudioLanguage/);
  assert.match(select, AUDIO_LANG_COALESCE);
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
  const src = miscRoutesSource();
  const emptyBlock = src.match(/router\.get\('\/api\/collections\/dashboard'[\s\S]*?const empty = \{[\s\S]*?\};/);
  assert.ok(emptyBlock, "dashboard handler empty payload not found");
  assert.match(emptyBlock[0], /languageMix:\s*\[\]/);
  assert.match(src, /collectionsLanguageMixSelect/);
});

test("collectionsLanguageMixSelect does not reference OriginalLanguage", () => {
  const select = collectionsLanguageMixSelect();
  assert.equal(select.includes("OriginalLanguage"), false);
  assert.match(select, AUDIO_LANG_COALESCE);
});

test("miscRoutes isolates languageMix so a SQL miss cannot empty the dashboard", () => {
  const src = miscRoutesSource();
  const handler = src.match(
    /router\.get\('\/api\/collections\/dashboard'[\s\S]*?Error in \/api\/collections\/dashboard/
  );
  assert.ok(handler, "collections dashboard handler not found");
  const body = handler[0];

  assert.match(
    body,
    /languageMix:\s*mapMix|languageMix\s*=\s*mapMix/,
    "languageMix must be assigned from mapMix"
  );

  // Nested try after campRes: only the lang query lives here, separate from the outer handler try.
  const nestedLangTry = body.match(
    /campRes[\s\S]*?try\s*\{[\s\S]*?collectionsLanguageMixSelect[\s\S]*?\}\s*catch/
  );
  assert.ok(nestedLangTry, "language mix query must sit in a nested try after campRes");
  assert.match(nestedLangTry[0], /collectionsLanguageMixSelect/);
  assert.match(
    body,
    /GROUP BY COALESCE\(NULLIF\(LTRIM\(RTRIM\(AudioLanguage\)\), ''\), 'Unknown'\)/
  );
});
