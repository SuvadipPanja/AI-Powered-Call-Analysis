/**
 * Sprint 4 — License grace / read-only enforcement.
 *
 * Reads global.licenseState (set during license validation):
 *   - "active"  → no restriction
 *   - "grace"   → read-only: GET allowed, mutations blocked (423) so the system
 *                 keeps serving reports while the customer renews
 *   - "expired" → blocked (403) except license/auth/session routes so a Super
 *                 Admin can still log in and upload a fresh license
 *
 * Mounted AFTER authGate on /api. Always allows the routes needed to recover
 * (license upload/status, login, logout, session checks, branding).
 */

// Paths (relative to the /api mount) that must stay reachable even when expired,
// so an admin can authenticate and install a new license.
const RECOVERY_EXACT = new Set([
  "/verify-license",
  "/license-status",
  "/license-history",
  "/license-details",
  "/upload-license",
  "/check-login-availability",
  "/login",
  "/login-security",
  "/temp-super-admin-login",
  "/logout-track",
  "/check-session",
  "/verify-session",
  "/refresh-session",
  "/invalidate-session",
  "/invalidate-existing-sessions",
  "/check-multiple-sessions",
  "/update-session-inactive-time",
  "/public/branding",
  "/branding/logo",
  "/system-monitor/health",
]);

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function isRecoveryPath(pathname) {
  if (RECOVERY_EXACT.has(pathname)) return true;
  return pathname.startsWith("/internal/");
}

function createLicenseGuard() {
  return function licenseGuard(req, res, next) {
    const state = global.licenseState || (global.isLicenseExpired ? "expired" : "active");

    if (state === "active") return next();

    const pathname = req.path;
    if (isRecoveryPath(pathname)) return next();

    if (state === "grace") {
      // Read-only window: allow safe reads, block mutations.
      if (READ_METHODS.has(req.method)) return next();
      return res.status(423).json({
        success: false,
        code: "LICENSE_GRACE_READ_ONLY",
        message:
          "License expired — the system is in read-only grace mode. Please install a renewed license to restore full access.",
      });
    }

    // expired
    return res.status(403).json({
      success: false,
      code: "LICENSE_EXPIRED",
      message: "License expired. Please contact your administrator to install a renewed license.",
    });
  };
}

module.exports = { createLicenseGuard };
