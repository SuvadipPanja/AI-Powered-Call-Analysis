/**
 * Session lifecycle APIs (Sprint 3.1 — extracted from server.js).
 */
const express = require("express");
const { assertSessionOwnership } = require("../middleware/sessionProof");
const { resolveSessionUserId } = require("../authHelper");
const { isMissingDbObjectError } = require("../projectPaths");
const { getSessionTimeoutHours, getSessionTimeoutMs } = require("../sessionPolicy");

function createSessionRouter({
  sql,
  sqlConnect,
  writeLog,
  getISTTimeString,
}) {
  const router = express.Router();

  /**
   * GET /session-config — current session policy for the logged-in frontend
   * (idle-logout timer). Authenticated via authGate (not in the public list).
   */
  router.get("/session-config", async (req, res) => {
    const timeoutHours = await getSessionTimeoutHours(sqlConnect);
    return res.status(200).json({ success: true, timeoutHours });
  });

  router.post("/update-session-inactive-time", async (req, res) => {
    let { userId, logId, inactiveTime } = req.body;
    if (!userId || !logId || !inactiveTime) {
      console.log(`[${getISTTimeString()}] Missing fields in /api/update-session-inactive-time: ${JSON.stringify({ userId, logId, inactiveTime })}`);
      return res.status(400).json({ success: false, message: "UserID, logId, and inactiveTime are required." });
    }

    if (!(await assertSessionOwnership(req, res, sqlConnect, sql, { userId, logId }))) {
      return;
    }

    try {
      const pool = await sqlConnect();
      userId = await resolveSessionUserId(pool, userId);

      // A heartbeat must not REVIVE a session that already sat idle past the
      // timeout (e.g. page refresh 2h+ after walking away, before the sweep
      // job ran). Same policy authGate enforces.
      try {
        const current = await pool.request()
          .input("UserID", sql.NVarChar, userId)
          .input("LogID", sql.Int, logId)
          .query(`
            SELECT TOP 1 SessionInactiveTime, LoginTime
            FROM ActiveSessions
            WHERE UserID = @UserID AND LogID = @LogID AND IsActive = 1;
          `);
        if (current.recordset.length) {
          const row = current.recordset[0];
          const lastActivity = row.SessionInactiveTime || row.LoginTime;
          const timeoutMs = await getSessionTimeoutMs(sqlConnect);
          if (lastActivity && Date.now() - new Date(lastActivity).getTime() >= timeoutMs) {
            await pool.request()
              .input("UserID", sql.NVarChar, userId)
              .input("LogID", sql.Int, logId)
              .query("UPDATE ActiveSessions SET IsActive = 0 WHERE UserID = @UserID AND LogID = @LogID");
            writeLog(`[${getISTTimeString()}] Heartbeat rejected — session for UserID ${userId} idle past timeout; invalidated.`);
            return res.status(401).json({ success: false, message: "Session timed out due to inactivity." });
          }
        }
      } catch (guardErr) {
        if (!isMissingDbObjectError(guardErr)) throw guardErr;
        /* pre-SessionInactiveTime schema — fall through to the legacy update */
      }

      let result;
      try {
        result = await pool.request()
          .input("UserID", sql.NVarChar, userId)
          .input("LogID", sql.Int, logId)
          .input("InactiveTime", sql.DateTime, new Date(inactiveTime))
          .query(`
            UPDATE ActiveSessions
            SET SessionInactiveTime = @InactiveTime
            WHERE UserID = @UserID AND LogID = @LogID AND IsActive = 1;
          `);
      } catch (columnErr) {
        if (!isMissingDbObjectError(columnErr)) {
          throw columnErr;
        }
        result = await pool.request()
          .input("UserID", sql.NVarChar, userId)
          .input("LogID", sql.Int, logId)
          .input("InactiveTime", sql.DateTime, new Date(inactiveTime))
          .query(`
            UPDATE ActiveSessions
            SET LoginTime = @InactiveTime
            WHERE UserID = @UserID AND LogID = @LogID AND IsActive = 1;
          `);
      }

      if (result.rowsAffected[0] === 0) {
        console.log(`[${getISTTimeString()}] No active session found for UserID ${userId}, LogID: ${logId}`);
        return res.status(404).json({ success: false, message: "No active session found." });
      }

      writeLog(`[${getISTTimeString()}] SessionInactiveTime updated for UserID ${userId}, LogID: ${logId} at ${new Date(inactiveTime).toISOString()}`);
      return res.status(200).json({ success: true, message: "SessionInactiveTime updated successfully." });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Error in /api/update-session-inactive-time: ${error.message}`);
      return res.status(500).json({ success: false, message: "Server error updating SessionInactiveTime." });
    }
  });

  router.post("/check-session", async (req, res) => {
    let { userId, token } = req.body;
    if (!userId || !token) {
      console.log(`[${getISTTimeString()}] Missing fields in /api/check-session: ${JSON.stringify({ userId, token })}`);
      return res.status(400).json({ success: false, message: "UserID and token are required." });
    }
    try {
      const pool = await sqlConnect();
      console.log(`[${getISTTimeString()}] Checking session for UserID ${userId}`);

      const lookupSession = async (sessionUserId) => {
        try {
          return await pool.request()
            .input("UserID", sql.NVarChar, sessionUserId)
            .input("Token", sql.NVarChar, token)
            .query(`
              SELECT IsActive, SessionInactiveTime, LoginTime
              FROM ActiveSessions
              WHERE UserID = @UserID AND Token = @Token;
            `);
        } catch (columnErr) {
          if (!isMissingDbObjectError(columnErr)) {
            throw columnErr;
          }
          return pool.request()
            .input("UserID", sql.NVarChar, sessionUserId)
            .input("Token", sql.NVarChar, token)
            .query(`
              SELECT IsActive, LoginTime
              FROM ActiveSessions
              WHERE UserID = @UserID AND Token = @Token;
            `);
        }
      };

      let result = await lookupSession(userId);
      if (result.recordset.length === 0) {
        const resolvedUserId = await resolveSessionUserId(pool, userId);
        if (resolvedUserId !== userId) {
          console.log(`[${getISTTimeString()}] Retrying session check with resolved UserID ${resolvedUserId}`);
          result = await lookupSession(resolvedUserId);
          userId = resolvedUserId;
        }
      }
      if (result.recordset.length === 0) {
        try {
          const byToken = await pool.request()
            .input("Token", sql.NVarChar, token)
            .query(`
              SELECT UserID, IsActive, SessionInactiveTime, LoginTime
              FROM ActiveSessions
              WHERE Token = @Token;
            `);
          if (byToken.recordset.length === 1) {
            userId = byToken.recordset[0].UserID;
            result = { recordset: [byToken.recordset[0]] };
          }
        } catch {
          const byToken = await pool.request()
            .input("Token", sql.NVarChar, token)
            .query(`
              SELECT UserID, IsActive, LoginTime
              FROM ActiveSessions
              WHERE Token = @Token;
            `);
          if (byToken.recordset.length === 1) {
            userId = byToken.recordset[0].UserID;
            result = { recordset: [{ ...byToken.recordset[0], SessionInactiveTime: null }] };
          }
        }
      }
      if (result.recordset.length === 0) {
        console.log(`[${getISTTimeString()}] No session found for UserID ${userId}`);
        return res.status(200).json({ success: false, message: "Session not found." });
      }
      const session = result.recordset[0];
      if (!session.IsActive) {
        console.log(`[${getISTTimeString()}] Session is inactive for UserID ${userId}`);
        return res.status(401).json({ success: false, message: "Session is inactive." });
      }
      const now = new Date();
      const inactiveTime = session.SessionInactiveTime
        ? new Date(session.SessionInactiveTime)
        : new Date(session.LoginTime);
      // Admin-configurable (AppSettings 'session_timeout_hours', default 2h) —
      // same policy the authGate enforces on every API request.
      const INACTIVITY_TIMEOUT_MS = await getSessionTimeoutMs(sqlConnect);
      if (inactiveTime && now - inactiveTime >= INACTIVITY_TIMEOUT_MS) {
        console.log(`[${getISTTimeString()}] Session timed out due to inactivity for UserID ${userId}`);
        await pool.request()
          .input("UserID", sql.NVarChar, userId)
          .input("Token", sql.NVarChar, token)
          .query(`
            UPDATE ActiveSessions
            SET IsActive = 0
            WHERE UserID = @UserID AND Token = @Token;
          `);
        return res.status(401).json({ success: false, message: "Session timed out due to inactivity." });
      }
      console.log(`[${getISTTimeString()}] Session is active for UserID ${userId}`);
      return res.status(200).json({ success: true, message: "Session is active.", userId });
    } catch (error) {
      console.error(`[${getISTTimeString()}] Error in /api/check-session: ${error.message}`);
      return res.status(500).json({ success: false, message: "Server error checking session." });
    }
  });

  router.post("/check-multiple-sessions", async (req, res) => {
    const { userId } = req.body;
    if (!userId) {
      writeLog(`[${getISTTimeString()}] Missing userId in /api/check-multiple-sessions`);
      return res.status(400).json({ success: false, message: "userId is required." });
    }

    try {
      const pool = await sqlConnect();
      const result = await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .query(`
          SELECT COUNT(*) as activeSessions
          FROM ActiveSessions
          WHERE UserID = @UserID AND IsActive = 1;
        `);

      const activeSessions = result.recordset[0].activeSessions;
      return res.status(200).json({ success: true, activeSessions });
    } catch (error) {
      writeLog(`[${getISTTimeString()}] Error in /api/check-multiple-sessions: ${error.message}`);
      return res.status(500).json({ success: false, message: "Server error checking multiple sessions." });
    }
  });

  router.post("/invalidate-existing-sessions", async (req, res) => {
    const { userId, currentLogId } = req.body;
    if (!userId) {
      writeLog(`[${getISTTimeString()}] Missing userId in /api/invalidate-existing-sessions`);
      return res.status(400).json({ success: false, message: "userId is required." });
    }

    if (!(await assertSessionOwnership(req, res, sqlConnect, sql, { userId, logId: currentLogId }))) {
      return;
    }

    try {
      const pool = await sqlConnect();
      await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .input("CurrentLogID", sql.Int, currentLogId || -1)
        .query(`
          UPDATE ActiveSessions
          SET IsActive = 0
          WHERE UserID = @UserID AND IsActive = 1 AND LogID != @CurrentLogID;
        `);

      writeLog(`[${getISTTimeString()}] Invalidated existing sessions for UserID ${userId}, excluding LogID ${currentLogId}`);
      return res.status(200).json({ success: true, message: "Existing sessions invalidated." });
    } catch (error) {
      writeLog(`[${getISTTimeString()}] Error in /api/invalidate-existing-sessions: ${error.message}`);
      return res.status(500).json({ success: false, message: "Server error invalidating sessions." });
    }
  });

  return router;
}

module.exports = { createSessionRouter };
