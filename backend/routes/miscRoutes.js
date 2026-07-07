/**
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
