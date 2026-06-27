/**
 * Query-category API.
 *  - Read (any authenticated user): GET /api/query-categories  (for chart colours + AI)
 *  - Manage (Admin / Super Admin):  POST / PUT / DELETE
 */
const express = require("express");
const svc = require("../services/queryCategoryService");

function createQueryCategoryRouter({
  connectToDatabase,
  resolveCallerRole,
  writeLog,
  getISTTimeString,
}) {
  const router = express.Router();

  async function requireManage(req, res) {
    const direct = req.user?.accountType;
    if (direct && ["Super Admin", "Admin"].includes(direct)) {
      return { Username: req.user.username, AccountType: direct };
    }
    const caller = await resolveCallerRole(req);
    if (!caller || !["Super Admin", "Admin"].includes(caller.AccountType)) {
      res.status(403).json({ success: false, message: "Only Admin / Super Admin can manage query categories." });
      return null;
    }
    return caller;
  }

  function fail(res, error) {
    const status = error.status || 500;
    if (status === 500) {
      console.error(`[${getISTTimeString && getISTTimeString()}] Query-category error:`, error.message);
    }
    return res.status(status).json({ success: false, message: error.message || "Server error." });
  }

  // GET — list (any authenticated user; activeOnly via ?active=1)
  router.get("/", async (req, res) => {
    try {
      const pool = await connectToDatabase();
      const categories = await svc.listCategories(pool, { activeOnly: req.query.active === "1" });
      return res.status(200).json({ success: true, categories });
    } catch (error) {
      return fail(res, error);
    }
  });

  // POST — create
  router.post("/", async (req, res) => {
    try {
      const caller = await requireManage(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const category = await svc.createCategory(pool, req.body || {}, caller.Username);
      writeLog && writeLog(`[${getISTTimeString()}] Query category created by ${caller.Username}: ${category.name}`);
      return res.status(201).json({ success: true, category });
    } catch (error) {
      return fail(res, error);
    }
  });

  // PUT — update
  router.put("/:id", async (req, res) => {
    try {
      const caller = await requireManage(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      const category = await svc.updateCategory(pool, req.params.id, req.body || {}, caller.Username);
      writeLog && writeLog(`[${getISTTimeString()}] Query category updated by ${caller.Username}: ${category.name}`);
      return res.status(200).json({ success: true, category });
    } catch (error) {
      return fail(res, error);
    }
  });

  // DELETE
  router.delete("/:id", async (req, res) => {
    try {
      const caller = await requireManage(req, res);
      if (!caller) return;
      const pool = await connectToDatabase();
      await svc.deleteCategory(pool, req.params.id);
      writeLog && writeLog(`[${getISTTimeString()}] Query category deleted by ${caller.Username}: id=${req.params.id}`);
      return res.status(200).json({ success: true });
    } catch (error) {
      return fail(res, error);
    }
  });

  return router;
}

module.exports = { createQueryCategoryRouter };
