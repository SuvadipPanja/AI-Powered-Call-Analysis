/**
 * Bank configuration API — Super Admin manages; AI services read via internal route.
 */
const express = require("express");
const bankSettingsService = require("../services/bankSettingsService");

function createBankSettingsRouter({
  connectToDatabase,
  resolveCallerRole,
  writeLog,
  getISTTimeString,
}) {
  const router = express.Router();

  async function requireSuperAdmin(req, res) {
    if (req.user?.accountType === "Super Admin") {
      return { Username: req.user.username, AccountType: req.user.accountType };
    }
    const caller = await resolveCallerRole(req);
    if (!caller || caller.AccountType !== "Super Admin") {
      res.status(403).json({ success: false, message: "Only Super Admin can manage bank configuration." });
      return null;
    }
    return caller;
  }

  async function requireAdminRead(req, res) {
    if (req.user?.accountType && ["Super Admin", "Admin"].includes(req.user.accountType)) {
      return { Username: req.user.username, AccountType: req.user.accountType };
    }
    const caller = await resolveCallerRole(req);
    if (!caller || !["Super Admin", "Admin"].includes(caller.AccountType)) {
      res.status(403).json({ success: false, message: "Only Admin/Super Admin can view bank configuration." });
      return null;
    }
    return caller;
  }

  /** GET /api/admin/bank-settings */
  router.get("/", async (req, res) => {
    try {
      if (!(await requireAdminRead(req, res))) return;
      const pool = await connectToDatabase();
      const config = await bankSettingsService.getBankSettings(pool);
      return res.status(200).json({ success: true, config });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Error fetching bank settings:`, error.message, error.stack);
      const detail = process.env.NODE_ENV === "production" ? "" : ` (${error.message})`;
      return res.status(500).json({ success: false, message: `Server error fetching bank settings.${detail}` });
    }
  });

  /** PUT /api/admin/bank-settings */
  router.put("/", async (req, res) => {
    try {
      const caller = await requireSuperAdmin(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const config = await bankSettingsService.saveBankSettings(pool, req.body || {}, caller.Username);
      writeLog(`[${getISTTimeString()}] Bank settings updated by ${caller.Username}: ${config.bankName}`);
      return res.status(200).json({ success: true, message: "Bank settings saved.", config });
    } catch (error) {
      const msg = error.message || "Server error saving bank settings.";
      console.error(`[${getISTTimeString()}] Error saving bank settings:`, msg);
      return res.status(error.message === "Bank name is required." ? 400 : 500).json({
        success: false,
        message: msg,
      });
    }
  });

  return router;
}

function createBankSettingsInternalRouter({
  connectToDatabase,
  getISTTimeString,
}) {
  const router = express.Router();

  /** GET /api/internal/bank-settings — service token or callback secret */
  router.get("/", async (req, res) => {
    const serviceToken = process.env.SERVICE_TOKEN || process.env.UPLOAD_SERVICE_TOKEN;
    const callbackSecret = process.env.CALLBACK_SECRET;
    const authHeader = req.headers.authorization || "";
    const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    const provided = bearer || req.headers["x-service-token"] || req.headers["x-callback-secret"];

    const allowed = (serviceToken && provided === serviceToken)
      || (callbackSecret && provided === callbackSecret);

    if (!allowed) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      const pool = await connectToDatabase();
      const config = await bankSettingsService.getBankSettings(pool);
      return res.status(200).json({ success: true, config });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Internal bank settings error:`, error.message);
      return res.status(500).json({ success: false, message: "Server error." });
    }
  });

  return router;
}

module.exports = { createBankSettingsRouter, createBankSettingsInternalRouter };
