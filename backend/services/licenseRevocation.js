/**
 * Sprint 8 — persisted revocation list (CRL merge from uploaded licenses).
 */
const sql = require("../sqlClient");

let revokedCache = new Set();

function revokedSet() {
  return global.revokedLicenseIds || revokedCache;
}

function isRevoked(licenseId) {
  if (!licenseId) return false;
  return revokedSet().has(String(licenseId));
}

async function ensureRevocationTable(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.LicenseRevocationList', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.LicenseRevocationList (
        LicenseId NVARCHAR(64) NOT NULL PRIMARY KEY,
        RevokedAt DATETIME NOT NULL DEFAULT GETDATE(),
        Source NVARCHAR(128) NULL
      );
    END
  `);
}

async function loadRevokedFromDb(pool) {
  await ensureRevocationTable(pool);
  const result = await pool.request().query("SELECT LicenseId FROM dbo.LicenseRevocationList");
  revokedCache = new Set(result.recordset.map((r) => String(r.LicenseId)));
  global.revokedLicenseIds = revokedCache;
  return revokedCache.size;
}

/**
 * Merge CRL ids from a newly uploaded license token.
 * @param {string[]} ids
 * @param {string} [source]
 */
async function mergeRevocationList(pool, ids, source = "license-upload") {
  if (!Array.isArray(ids) || !ids.length) return 0;
  await ensureRevocationTable(pool);
  let added = 0;
  for (const raw of ids) {
    const licenseId = String(raw || "").trim();
    if (!licenseId) continue;
    await pool.request()
      .input("id", sql.NVarChar, licenseId)
      .input("src", sql.NVarChar, source)
      .query(`
        IF NOT EXISTS (SELECT 1 FROM dbo.LicenseRevocationList WHERE LicenseId = @id)
        BEGIN
          INSERT INTO dbo.LicenseRevocationList (LicenseId, Source) VALUES (@id, @src);
        END
      `);
    added += 1;
  }
  await loadRevokedFromDb(pool);
  return added;
}

module.exports = {
  isRevoked,
  loadRevokedFromDb,
  mergeRevocationList,
  ensureRevocationTable,
};
