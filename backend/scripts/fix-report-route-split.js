/**
 * Remove non-report routes mistakenly included in reportRoutes.register.js.
 */
const fs = require("fs");
const path = require("path");

const routesDir = path.join(__dirname, "..", "routes");
const registerPath = path.join(routesDir, "reportRoutes.register.js");
const lines = fs.readFileSync(registerPath, "utf8").split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

const miscChunks = [
  slice(68, 540),
  slice(603, 690),
  slice(2251, 2432),
];

const miscBody = miscChunks.join("\n\n");

const miscRegister = `/**
 * Audio result, profile, login availability, system monitor (Sprint 3.1 split).
 */
module.exports = function registerMiscRoutes(router, deps, H) {
  const {
    sql,
    sqlConnect,
    connectToDatabase,
    writeLog,
    getISTTimeString,
    config,
    assertSelfOrElevated,
    uploadProfilePic,
    profilePicsDir,
    findProfilePictureFile,
    normalizeToneResults,
    validator,
    si,
  } = deps;
  const { mapScoringFields, isMissingDbObjectError } = H;
  const fs = require("fs");
  const path = require("path");

${miscBody}
};
`;

const miscRouter = `/**
 * Non-report API routes split from server.js (audio results, profile, monitoring).
 */
const express = require("express");
const reportHelpers = require("../services/reportHelpers");
const registerMiscRoutes = require("./miscRoutes.register");

function createMiscRouter(deps) {
  const router = express.Router();
  registerMiscRoutes(router, deps, reportHelpers);
  return router;
}

module.exports = { createMiscRouter };
`;

const removeRanges = [
  [68, 540],
  [603, 690],
  [2251, 2432],
];
const removeSet = new Set();
for (const [s, e] of removeRanges) {
  for (let i = s; i <= e; i++) removeSet.add(i);
}
const reportLines = lines.filter((_, idx) => !removeSet.has(idx + 1));

fs.writeFileSync(path.join(routesDir, "miscRoutes.register.js"), miscRegister);
fs.writeFileSync(path.join(routesDir, "miscRoutes.js"), miscRouter);
fs.writeFileSync(registerPath, reportLines.join("\n"));

console.log("Split misc routes out of reportRoutes.register.js");
