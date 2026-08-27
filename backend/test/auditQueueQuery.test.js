const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

test("audit queue SELECT exposes language, supervisor, and agent start date", () => {
  const src = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = src.indexOf("function buildAuditQueueQuery");
  const chunk = src.slice(start, start + 2500);
  assert.match(chunk, /AudioLanguage AS language/);
  assert.match(chunk, /A\.supervisor AS supervisor/);
  assert.match(chunk, /A\.agent_creation_date AS agentCreationDate/);
});
