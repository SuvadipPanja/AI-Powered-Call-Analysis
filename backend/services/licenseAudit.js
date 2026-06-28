/**
 * Sprint 4 — Banking-grade license audit trail.
 *
 * Appends immutable events to dbo.LicenseAuditLog. Best-effort: a failure to
 * write an audit row must never crash the server or block license validation.
 */

/**
 * @param {import('mssql')} sql
 * @param {() => Promise<import('mssql').ConnectionPool>} getPool
 * @param {object} evt
 * @param {string} evt.event       short event code (e.g. LICENSE_VALIDATED)
 * @param {('success'|'failure'|'info'|'warning')} [evt.outcome]
 * @param {string} [evt.detail]    human-readable detail (no secrets)
 * @param {string} [evt.actor]     username or "System"
 * @param {string} [evt.fingerprint]
 */
async function logLicenseEvent(sql, getPool, evt) {
  try {
    const pool = await getPool();
    await pool
      .request()
      .input("EventType", sql.NVarChar(100), String(evt.event || "UNKNOWN").slice(0, 100))
      .input("Outcome", sql.NVarChar(20), String(evt.outcome || "info").slice(0, 20))
      .input("Detail", sql.NVarChar(sql.MAX), evt.detail ? String(evt.detail).slice(0, 4000) : null)
      .input("Actor", sql.NVarChar(150), evt.actor ? String(evt.actor).slice(0, 150) : "System")
      .input("Fingerprint", sql.NVarChar(128), evt.fingerprint ? String(evt.fingerprint).slice(0, 128) : null)
      .query(`
        INSERT INTO dbo.LicenseAuditLog (EventType, Outcome, Detail, Actor, Fingerprint, CreatedAt)
        VALUES (@EventType, @Outcome, @Detail, @Actor, @Fingerprint, GETDATE())
      `);
  } catch (err) {
    // Never throw from the audit path.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[license-audit] failed to record event:", err.message);
    }
  }
}

module.exports = { logLicenseEvent };
