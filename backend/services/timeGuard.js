/**
 * Sprint 8 — Monotonic time-tampering guard.
 *
 * Defends against "set the clock back to dodge expiry" and VM-snapshot reverts.
 * A high-water-mark (HWM) timestamp is persisted in the DB. The wall clock is
 * never allowed to fall below the HWM (minus a small skew tolerance). If it
 * does, time tampering is assumed and the caller should fail closed.
 *
 * Storage: dbo.LicenseTimeGuard (single row, Id=1), created by dbMigrate.js.
 *
 * Tunables (env):
 *   LICENSE_TIME_SKEW_MINUTES   allowed backward drift before alarm (default 120)
 *   LICENSE_TIME_GUARD          set "false" to disable (default enabled)
 */

function guardEnabled() {
  return String(process.env.LICENSE_TIME_GUARD || "true").toLowerCase() !== "false";
}

function skewMs() {
  const n = parseInt(process.env.LICENSE_TIME_SKEW_MINUTES || "120", 10);
  return (Number.isFinite(n) && n >= 0 ? n : 120) * 60 * 1000;
}

/**
 * Read the persisted guard row.
 * @returns {Promise<{ hwm: Date|null, lastObserved: Date|null }>}
 */
async function readGuard(pool) {
  const r = await pool
    .request()
    .query("SELECT TOP 1 HighWaterMark, LastObserved FROM dbo.LicenseTimeGuard WHERE Id = 1");
  if (!r.recordset.length) return { hwm: null, lastObserved: null };
  return {
    hwm: r.recordset[0].HighWaterMark ? new Date(r.recordset[0].HighWaterMark) : null,
    lastObserved: r.recordset[0].LastObserved ? new Date(r.recordset[0].LastObserved) : null,
  };
}

/** Insert/advance the HWM to max(existing, now). */
async function advanceGuard(pool, sql, now) {
  await pool
    .request()
    .input("now", sql.DateTime, now)
    .query(`
      MERGE dbo.LicenseTimeGuard AS t
      USING (SELECT 1 AS Id) AS s ON t.Id = s.Id
      WHEN MATCHED THEN
        UPDATE SET
          HighWaterMark = CASE WHEN @now > t.HighWaterMark THEN @now ELSE t.HighWaterMark END,
          LastObserved = @now,
          UpdatedAt = GETDATE()
      WHEN NOT MATCHED THEN
        INSERT (Id, HighWaterMark, LastObserved, UpdatedAt)
        VALUES (1, @now, @now, GETDATE());
    `);
}

/**
 * Check the clock against the HWM, then advance it.
 * @returns {Promise<{ ok: boolean, reason?: string, hwm: Date|null, driftMinutes?: number }>}
 */
async function checkAndAdvance(pool, sql, now = new Date()) {
  if (!guardEnabled()) return { ok: true, hwm: null };
  const { hwm } = await readGuard(pool);
  if (hwm && now.getTime() < hwm.getTime() - skewMs()) {
    const driftMinutes = Math.round((hwm.getTime() - now.getTime()) / 60000);
    // Do NOT advance on a detected rollback (don't let the bad clock poison HWM).
    return {
      ok: false,
      reason: `Clock rollback detected: now=${now.toISOString()} is ${driftMinutes} min behind high-water-mark=${hwm.toISOString()}`,
      hwm,
      driftMinutes,
    };
  }
  await advanceGuard(pool, sql, now);
  return { ok: true, hwm };
}

module.exports = { guardEnabled, checkAndAdvance, readGuard, advanceGuard, skewMs };
