/**
 * Auto Upload admin API routes (Super Admin only).
 */
const express = require("express");
const autoUploadService = require("../services/autoUploadService");

function createAutoUploadRouter({ sql, connectToDatabase, resolveCallerRole, writeLog, getISTTimeString, config }) {
  const router = express.Router();

  function requireSuperAdmin(req, res) {
    if (req.user?.accountType === "Super Admin") {
      return Promise.resolve({
        Username: req.user.username,
        AccountType: req.user.accountType,
      });
    }
    return resolveCallerRole(req).then((caller) => {
      if (!caller || caller.AccountType !== "Super Admin") {
        res.status(403).json({ success: false, message: "Only Super Admin can manage auto-upload." });
        return null;
      }
      return caller;
    });
  }

  function startBackgroundRun(poolPromise, runner, onErrorLabel) {
    Promise.resolve(poolPromise)
      .then((pool) => runner(pool))
      .catch((error) => {
        console.error(`[${getISTTimeString()}] ${onErrorLabel}:`, error.message);
      });
  }

  router.get("/settings", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const settings = await autoUploadService.getSettings(pool);
      return res.status(200).json({
        success: true,
        settings,
        runInProgress: autoUploadService.isRunInProgress(),
      });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload settings GET error:`, error.message);
      return res.status(500).json({ success: false, message: error.message || "Server error." });
    }
  });

  router.put("/settings", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const settings = await autoUploadService.saveSettings(pool, req.body || {}, caller.Username);
      await autoUploadService.refreshScheduler(pool, config);
      writeLog(`[${getISTTimeString()}] Auto-upload settings updated by ${caller.Username}`);
      return res.status(200).json({
        success: true,
        message: "Auto-upload settings saved.",
        settings,
      });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload settings PUT error:`, error.message);
      return res.status(400).json({ success: false, message: error.message || "Failed to save settings." });
    }
  });

  router.post("/run", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      if (autoUploadService.isRunInProgress()) {
        return res.status(409).json({ success: false, message: "An auto-upload run is already in progress." });
      }
      writeLog(`[${getISTTimeString()}] Manual auto-upload triggered by ${caller.Username}`);
      startBackgroundRun(
        connectToDatabase(),
        (pool) => autoUploadService.runAutoUpload(pool, config, {
          triggeredBy: caller.Username,
          startFresh: true,
        }),
        "Auto-upload run error"
      );
      return res.status(202).json({
        success: true,
        message: "Auto-upload run started.",
        runInProgress: true,
      });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload run error:`, error.message);
      return res.status(500).json({ success: false, message: error.message || "Auto-upload run failed." });
    }
  });

  router.post("/stop", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      if (!autoUploadService.isRunInProgress()) {
        return res.status(409).json({ success: false, message: "No auto-upload run is in progress." });
      }
      autoUploadService.requestStop();
      writeLog(`[${getISTTimeString()}] Auto-upload stop requested by ${caller.Username}`);
      return res.status(200).json({
        success: true,
        message: "Stop requested. Run will halt after the current step.",
        runInProgress: true,
      });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload stop error:`, error.message);
      return res.status(500).json({ success: false, message: error.message || "Failed to stop auto-upload." });
    }
  });

  router.post("/resume", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      if (autoUploadService.isRunInProgress()) {
        return res.status(409).json({ success: false, message: "An auto-upload run is already in progress." });
      }
      const pool = await connectToDatabase();
      const targetFolder = (req.body?.targetFolder || "").trim();
      await autoUploadService.validateResumeTarget(pool, targetFolder || undefined);
      writeLog(`[${getISTTimeString()}] Auto-upload resume triggered by ${caller.Username}${targetFolder ? ` for ${targetFolder}` : ""}`);
      startBackgroundRun(
        Promise.resolve(pool),
        (p) => autoUploadService.resumeAutoUpload(p, config, {
          triggeredBy: caller.Username,
          targetFolder: targetFolder || undefined,
        }),
        "Auto-upload resume error"
      );
      return res.status(202).json({
        success: true,
        message: "Auto-upload resume started.",
        runInProgress: true,
      });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload resume error:`, error.message);
      return res.status(400).json({ success: false, message: error.message || "Auto-upload resume failed." });
    }
  });

  router.get("/status", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const statusPayload = await autoUploadService.getRunStatus(pool);
      return res.status(200).json({
        success: true,
        status: statusPayload,
        runInProgress: autoUploadService.isRunInProgress(),
        stoppedRuns: statusPayload.stoppedRuns || [],
      });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload status error:`, error.message);
      return res.status(500).json({ success: false, message: error.message || "Server error." });
    }
  });

  router.get("/history", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
      const runs = await autoUploadService.getRunHistory(pool, limit);
      return res.status(200).json({ success: true, runs });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Auto-upload history error:`, error.message);
      return res.status(500).json({ success: false, message: error.message || "Server error." });
    }
  });

  return router;
}

module.exports = { createAutoUploadRouter };
