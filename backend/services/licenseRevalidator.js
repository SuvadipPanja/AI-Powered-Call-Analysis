/**
 * Sprint 8 — periodic license re-validation against DB + vendor key + CRL.
 */
const fs = require("fs");
const path = require("path");
const licenseV3 = require("./licenseV3");
const licenseRevocation = require("./licenseRevocation");

/**
 * @param {object} deps — server wiring (pool factory, validators, globals mutators)
 * @returns {Promise<{ changed: boolean, state?: string, reason?: string }>}
 */
async function revalidateActiveLicense(deps) {
  const {
    connectToDatabase,
    licenseFilePath,
    validateV3License,
    validateLegacyLicense,
    applyV3License,
    applyLegacyLicense,
    markLicenseInvalid,
    broadcastLicenseState,
    writeLog,
    getISTTimeString,
  } = deps;

  try {
    const pool = await connectToDatabase();
    await licenseRevocation.loadRevokedFromDb(pool);

    let licenseKey = null;
    const active = await pool.request().query(
      "SELECT TOP 1 LicenseKey FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC"
    );
    if (active.recordset.length && active.recordset[0].LicenseKey) {
      licenseKey = String(active.recordset[0].LicenseKey).trim();
    } else if (licenseFilePath && fs.existsSync(licenseFilePath)) {
      licenseKey = fs.readFileSync(licenseFilePath, "utf8").trim();
    }

    if (!licenseKey) {
      if (global.licensePayload) {
        markLicenseInvalid("License removed from database", { event: "LICENSE_REVOKED" });
        return { changed: true, state: "expired", reason: "no license" };
      }
      return { changed: false };
    }

    const prevState = global.licenseState;

    if (licenseV3.isV3Token(licenseKey)) {
      const v = validateV3License(licenseKey);
      if (!v.ok || v.evaluation?.state === "invalid") {
        const reason = v.reason || v.evaluation?.reason || "revalidation failed";
        markLicenseInvalid(`v3 revalidation: ${reason}`, {
          event: licenseRevocation.isRevoked(v.payload?.licenseId) ? "LICENSE_REVOKED" : "LICENSE_VALIDATED",
        });
        return { changed: prevState !== "expired", state: "expired", reason };
      }
      if (licenseRevocation.isRevoked(v.payload?.licenseId)) {
        markLicenseInvalid("License revoked (CRL)", { event: "LICENSE_REVOKED" });
        return { changed: prevState !== "expired", state: "expired", reason: "revoked" };
      }
      const ev = v.evaluation;
      if (ev.state === "expired") {
        markLicenseInvalid("v3 license expired (grace exhausted)", { event: "LICENSE_EXPIRED" });
        return { changed: prevState !== "expired", state: "expired", reason: "expired" };
      }
      global.isLicenseExpired = ev.state !== "active";
      global.licenseState = ev.state;
      global.licensePayload = deps.normalizeV3Payload(v.payload);
      if (prevState !== ev.state) {
        broadcastLicenseState(`License state: ${ev.state}`);
        writeLog(`[${getISTTimeString()}] License revalidated → ${ev.state}`);
      }
      return { changed: prevState !== ev.state, state: ev.state };
    }

    if (typeof validateLegacyLicense === "function") {
      const legacy = await validateLegacyLicense(pool, licenseKey);
      if (!legacy?.ok) {
        markLicenseInvalid(legacy?.reason || "Legacy license revalidation failed");
        return { changed: prevState !== "expired", state: "expired", reason: legacy.reason };
      }
      if (typeof applyLegacyLicense === "function") {
        await applyLegacyLicense(pool, licenseKey, legacy);
      }
      return { changed: prevState !== global.licenseState, state: global.licenseState };
    }

    return { changed: false };
  } catch (err) {
    deps.writeLog(`[${deps.getISTTimeString()}] License revalidation error: ${err.message}`);
    return { changed: false, reason: err.message };
  }
}

function revalidateIntervalMin() {
  const n = parseInt(process.env.LICENSE_REVALIDATE_INTERVAL_MIN || "30", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

module.exports = { revalidateActiveLicense, revalidateIntervalMin };
