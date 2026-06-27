/**
 * Centralized authentication gate.
 *
 * Validates the session token (Authorization: Bearer <token>, x-session-token
 * header, or ?token=) against dbo.ActiveSessions (IsActive = 1). Public routes
 * - login, license verification, forgot-password flow, session management and
 * internal callbacks - are allowlisted and pass through untouched.
 *
 * Enforcement can be disabled with API_AUTH_ENFORCE=false (kept on by default).
 */

const ENFORCE = String(process.env.API_AUTH_ENFORCE || "true").toLowerCase() !== "false";

// Optional shared service token for trusted server-to-server clients (e.g. the
// AutoUpload uploader). When SERVICE_TOKEN is set, a request presenting this
// exact token is authenticated as a non-interactive service account without a
// DB session lookup. Leave blank to disable.
const SERVICE_TOKEN = String(process.env.SERVICE_TOKEN || process.env.UPLOAD_SERVICE_TOKEN || "").trim();

// Paths (relative to the /api mount) that never require a user token.
const PUBLIC_EXACT = new Set([
  "/verify-license",
  "/license-status",
  "/login",
  "/login-security",
  "/temp-super-admin-login",
  "/logout-track",
  "/get-username",
  "/get-security-question-type",
  "/reset-password",
  "/check-login-availability",
  "/check-session",
  "/verify-session",
  "/refresh-session",
  "/invalidate-session",
  "/invalidate-existing-sessions",
  "/check-multiple-sessions",
  "/update-session-inactive-time",
  "/system-monitor/health",
  "/public/branding",
  "/branding/logo",
]);

// Prefixes that are public (e.g. internal pipeline callbacks guarded by a secret).
const PUBLIC_PREFIXES = ["/internal/"];

function isPublic(pathname) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

function extractToken(req) {
  const header = req.headers["authorization"];
  if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
  if (req.headers["x-session-token"]) return String(req.headers["x-session-token"]).trim();
  if (req.query && req.query.token) return String(req.query.token).trim();
  return null;
}

/**
 * @param {() => Promise<import('mssql').ConnectionPool>} getPool
 * @param {import('mssql')} sql
 */
function authGate(getPool, sql) {
  return async function (req, res, next) {
    if (!ENFORCE) return next();
    if (req.method === "OPTIONS") return next();
    if (isPublic(req.path)) return next();

    const token = extractToken(req);
    if (!token) {
      return res.status(401).json({ success: false, message: "Authentication required." });
    }

    // Trusted service account (AutoUpload, internal jobs) — constant-time-ish match.
    if (SERVICE_TOKEN && token === SERVICE_TOKEN) {
      req.user = {
        userId: null,
        username: "service-account",
        logId: null,
        accountType: "Service",
        isService: true,
      };
      return next();
    }

    try {
      const pool = await getPool();
      const result = await pool
        .request()
        .input("token", sql.NVarChar, token)
        .query(`
          SELECT TOP 1 s.UserID, s.Username, s.LogID, u.AccountType
          FROM dbo.ActiveSessions s
          LEFT JOIN dbo.Users u ON s.Username = u.Username
          WHERE s.Token = @token AND s.IsActive = 1
        `);
      if (!result.recordset.length) {
        return res.status(401).json({ success: false, message: "Invalid or expired session." });
      }
      const row = result.recordset[0];
      req.user = {
        userId: row.UserID,
        username: row.Username,
        logId: row.LogID,
        accountType: row.AccountType || "",
      };
      return next();
    } catch (err) {
      console.error(`[auth] Session validation error: ${err.message}`);
      return res.status(500).json({ success: false, message: "Authentication check failed." });
    }
  };
}

module.exports = { authGate, isPublic };
