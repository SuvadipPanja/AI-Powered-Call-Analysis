/**
 * Session timeout policy — single source of truth for how long a session may
 * stay idle before it is invalidated.
 *
 * The value lives in dbo.AppSettings under 'session_timeout_hours' so admins
 * can change it from the Admin Settings page (no restart needed — cached for
 * at most CACHE_MS). Consumers: authGate (per-request enforcement),
 * /api/check-session, the periodic stale-session sweep, and
 * GET /api/session-config for the frontend idle timer.
 */

const DEFAULT_TIMEOUT_HOURS = 2;
const MIN_TIMEOUT_HOURS = 0.25; // 15 minutes
const MAX_TIMEOUT_HOURS = 24;
const CACHE_MS = 60 * 1000;

let cache = { hours: null, at: 0 };

function clampTimeoutHours(raw) {
  const hours = parseFloat(raw);
  if (!Number.isFinite(hours)) return null;
  return Math.min(Math.max(hours, MIN_TIMEOUT_HOURS), MAX_TIMEOUT_HOURS);
}

/**
 * Current timeout in hours (cached ~60s). Falls back to the default when the
 * AppSettings table/row is missing or unreadable — never throws.
 * @param {() => Promise<import('mssql').ConnectionPool>} getPool
 */
async function getSessionTimeoutHours(getPool) {
  const now = Date.now();
  if (cache.hours !== null && now - cache.at < CACHE_MS) return cache.hours;
  let hours = DEFAULT_TIMEOUT_HOURS;
  try {
    const pool = await getPool();
    const result = await pool
      .request()
      .query("SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = 'session_timeout_hours'");
    const configured = clampTimeoutHours(result.recordset[0]?.SettingValue);
    if (configured !== null) hours = configured;
  } catch (_) {
    /* keep default — schema may not be bootstrapped yet */
  }
  cache = { hours, at: now };
  return hours;
}

async function getSessionTimeoutMs(getPool) {
  return (await getSessionTimeoutHours(getPool)) * 60 * 60 * 1000;
}

/** Call after an admin updates 'session_timeout_hours' so it applies at once. */
function bustSessionTimeoutCache() {
  cache = { hours: null, at: 0 };
}

module.exports = {
  DEFAULT_TIMEOUT_HOURS,
  MIN_TIMEOUT_HOURS,
  MAX_TIMEOUT_HOURS,
  clampTimeoutHours,
  getSessionTimeoutHours,
  getSessionTimeoutMs,
  bustSessionTimeoutCache,
};
