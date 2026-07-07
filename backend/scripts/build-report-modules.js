/**
 * One-shot extractor: dashboard + report routes from server.js → reportRoutes bundle.
 * Run: node backend/scripts/build-report-modules.js
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const serverPath = path.join(root, "server.js");
const lines = fs.readFileSync(serverPath, "utf8").split(/\r?\n/);

function slice(start, end) {
  return lines.slice(start - 1, end).join("\n");
}

const helperRanges = [
  [152, 462],
  [464, 839],
  [4759, 4835],
  [7980, 8004],
  [8626, 8683],
  [8761, 8768],
];

let helpersBody = helperRanges.map(([s, e]) => slice(s, e)).join("\n\n");

const helpersFile = `/**
 * Report/dashboard SQL helpers (Sprint 3.1 — extracted from server.js).
 */
const sql = require("../sqlClient");
const { isMissingDbObjectError } = require("../projectPaths");

let writeLog = (msg) => console.log(msg);
let getISTTimeString = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

function initReportHelpers(deps = {}) {
  if (deps.writeLog) writeLog = deps.writeLog;
  if (deps.getISTTimeString) getISTTimeString = deps.getISTTimeString;
}

${helpersBody}

module.exports = {
  initReportHelpers,
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
  mapRecentActivityRow,
  buildRecentActivityQuery,
  parseRecentActivityFilterParams,
  recentActivityWhereConditions,
  bindRecentActivityFilters,
  buildRecentActivityFilteredQuery,
  buildMetricsOverviewQuery,
  metricsOverviewFilterConditions,
  parseDashboardFilterParams,
  bindDashboardFilters,
  dashboardConsolidatedExtraFilters,
  dashboardAudioUploadExtraFilters,
  consolidatedReportExtraFilters,
  bindReportFilters,
  WEEKDAY_LABELS,
  emptyWeekdayMaps,
  runMetricsOverviewQuery,
  queryTopScorerForWeek,
  consolidatedAiScoreExpr,
  buildPerformanceComparisonPeriodCte,
  classifySentimentPolarity,
  parseSentimentPayload,
  aggregateCustomerSentimentSummary,
  intelDateClause,
};
`;

const routeRanges = [
  [3703, 3706],
  [3707, 3740],
  [4220, 4271],
  [4502, 4757],
  [4837, 4851],
  [7042, 7979],
  [8006, 8625],
  [8685, 8756],
  [8912, 9040],
];

let routesBody = routeRanges
  .map(([s, e]) => slice(s, e))
  .join("\n")
  .replace(/^app\.(get|post|put|delete)\(/gm, "router.$1(");

const registerFile = `/**
 * Report + dashboard route handlers (Sprint 3.1 — extracted from server.js).
 */
module.exports = function registerReportRoutes(router, deps, H) {
  const { sql, connectToDatabase, sqlConnect, writeLog, getISTTimeString } = deps;
  H.initReportHelpers(deps);
  const {
    markStaleProcessingAsFailed,
    mapRecentActivityRow,
    parseRecentActivityFilterParams,
    bindRecentActivityFilters,
    buildRecentActivityFilteredQuery,
    parseDashboardFilterParams,
    bindDashboardFilters,
    dashboardAudioUploadExtraFilters,
    dashboardConsolidatedExtraFilters,
    consolidatedReportExtraFilters,
    bindReportFilters,
    runMetricsOverviewQuery,
    emptyWeekdayMaps,
    WEEKDAY_LABELS,
    queryTopScorerForWeek,
    buildPerformanceComparisonPeriodCte,
    aggregateCustomerSentimentSummary,
    intelDateClause,
  } = H;
  const { isMissingDbObjectError } = require("../projectPaths");

${routesBody}
};
`;

const reportRoutesFile = `/**
 * Report + dashboard API router (Sprint 3.1).
 */
const express = require("express");
const reportHelpers = require("../services/reportHelpers");
const registerReportRoutes = require("./reportRoutes.register");

function createReportRouter(deps) {
  const router = express.Router();
  registerReportRoutes(router, deps, reportHelpers);
  return router;
}

module.exports = { createReportRouter };
`;

fs.writeFileSync(path.join(root, "services", "reportHelpers.js"), helpersFile);
fs.writeFileSync(path.join(root, "routes", "reportRoutes.register.js"), registerFile);
fs.writeFileSync(path.join(root, "routes", "reportRoutes.js"), reportRoutesFile);

console.log("Wrote reportHelpers.js, reportRoutes.register.js, reportRoutes.js");
