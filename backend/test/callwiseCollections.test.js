const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const src = fs.readFileSync(
  path.join(__dirname, "../routes/reportRoutes.register.js"),
  "utf8",
);

test("collections call-wise asks for collections columns and scored-call scope", () => {
  assert.match(src, /mode === ['\"]collections['\"]/);
  assert.match(src, /AI_Coll_Score/);
  assert.match(src, /AI_PTP_Genuineness/);
  assert.match(src, /AI_ZTP_Violation/);
  assert.match(src, /collectionsWhere/);
});

test("escalation and hold summaries honor collections=1", () => {
  assert.match(src, /req\.query\.collections === ['\"]1['\"]/);
  assert.match(src, /collectionsWhere/);
});
