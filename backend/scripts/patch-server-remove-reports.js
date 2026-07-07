/**
 * Remove extracted report/dashboard blocks from server.js (run once after build-report-modules.js).
 */
const fs = require("fs");
const path = require("path");

const serverPath = path.join(__dirname, "..", "server.js");
const lines = fs.readFileSync(serverPath, "utf8").split(/\r?\n/);

const removeRanges = [
  [152, 839],
  [3703, 4851],
  [7042, 8757],
  [8912, 9040],
];

const removeSet = new Set();
for (const [start, end] of removeRanges) {
  for (let i = start; i <= end; i++) removeSet.add(i);
}

const kept = lines.filter((_, idx) => !removeSet.has(idx + 1));
let content = kept.join("\n");

const importBlock = `
const reportHelpers = require("./services/reportHelpers");
const { createReportRouter } = require("./routes/reportRoutes");
`;

if (!content.includes('require("./services/reportHelpers")')) {
  content = content.replace(
    'const { createSessionRouter } = require("./routes/sessionRoutes");',
    `const { createSessionRouter } = require("./routes/sessionRoutes");\n${importBlock.trim()}`
  );
}

const helperInit = `
reportHelpers.initReportHelpers({ writeLog, getISTTimeString });
const {
  normalizeDisplayStatus,
  buildAudioProgressPayload,
  buildProcessingSubtasks,
  resolveDisplayAiStatus,
  PROCESS_STAGE_LABELS,
  extractFailureDetails,
  mapScoringFields,
  isTerminalProcessingStatus,
  isActiveProcessingStatus,
  markStaleProcessingAsFailed,
} = reportHelpers;
`;

if (!content.includes("reportHelpers.initReportHelpers")) {
  content = content.replace(
    /(function writeLog\(message\) \{[\s\S]*?\n\})\s*\n/,
    `$1\n${helperInit}\n`
  );
}

const mountBlock = `
app.use(
  "/api",
  createReportRouter({
    sql,
    connectToDatabase,
    sqlConnect,
    writeLog,
    getISTTimeString,
  })
);
`;

if (!content.includes("createReportRouter({")) {
  content = content.replace(
    /app\.use\(\s*\n\s*"\/api",\s*\n\s*createSessionRouter\(\{[\s\S]*?\}\)\s*\n\s*\);\s*\n/,
    (match) => `${match}\n${mountBlock}\n`
  );
}

fs.writeFileSync(serverPath, content);
console.log("Patched server.js — removed extracted report/dashboard blocks.");
