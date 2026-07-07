/**
 * Validates that a session token belongs to the claimed user (and optional logId).
 * Used on public session-management endpoints that cannot rely on authGate alone.
 */

const { extractToken } = require("./auth");

async function verifySessionOwnership(getPool, sql, { token, userId, logId = null }) {
  if (!token || !userId) {
    return { ok: false, status: 401, message: "Token and userId are required." };
  }

  const pool = await getPool();
  const request = pool
    .request()
    .input("token", sql.NVarChar, token)
    .input("userId", sql.NVarChar, String(userId));

  let query = `
    SELECT TOP 1 LogID
    FROM dbo.ActiveSessions
    WHERE Token = @token AND UserID = @userId AND IsActive = 1
  `;

  if (logId != null && logId !== "") {
    request.input("logId", sql.Int, logId);
    query += " AND LogID = @logId";
  }

  const result = await request.query(query);
  if (!result.recordset.length) {
    return { ok: false, status: 403, message: "Session token does not match the requested user." };
  }

  return { ok: true, logId: result.recordset[0].LogID };
}

function tokenFromRequest(req) {
  return extractToken(req) || (req.body?.token ? String(req.body.token).trim() : null);
}

async function assertSessionOwnership(req, res, getPool, sql, { userId, logId = null }) {
  const token = tokenFromRequest(req);
  let resolvedUserId = userId;
  try {
    const pool = await getPool();
    resolvedUserId = await resolveSessionUserId(pool, userId);
  } catch {
    /* keep original userId */
  }
  const check = await verifySessionOwnership(getPool, sql, { token, userId: resolvedUserId, logId });
  if (!check.ok) {
    res.status(check.status).json({ success: false, message: check.message });
    return false;
  }
  return true;
}

module.exports = { verifySessionOwnership, assertSessionOwnership, tokenFromRequest };
