/**
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
