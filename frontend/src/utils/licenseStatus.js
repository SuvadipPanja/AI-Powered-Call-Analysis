/**
 * Normalized license status from GET /api/license-status and POST /api/verify-license.
 * Sprint 4 adds licenseState ('active' | 'grace' | 'expired') and graceRemaining.
 */

export function parseLicenseStatusResponse(result) {
  if (!result?.success) return null;
  const licenseState = result.licenseState || (result.isExpired ? "expired" : "active");
  return {
    isExpired: Boolean(result.isExpired),
    licenseState,
    graceRemaining: Number.isFinite(result.graceRemaining) ? result.graceRemaining : 0,
    daysUntilExpiration: result.daysUntilExpiration,
    endDate: result.endDate,
  };
}

export function isGraceMode(status) {
  return status?.licenseState === "grace";
}

export function isFullyExpired(status) {
  return Boolean(status?.isExpired);
}

/** Expiring within 7 days but not yet in read-only grace. */
export function isExpiringSoon(status) {
  if (!status || status.isExpired || isGraceMode(status)) return false;
  return status.daysUntilExpiration != null && status.daysUntilExpiration <= 7;
}

export function graceBannerMessage(status) {
  if (!isGraceMode(status)) return "";
  const days = Math.max(0, status.graceRemaining ?? 0);
  const endLabel = status.endDate
    ? new Date(status.endDate).toLocaleDateString()
    : "the expiry date";
  return `License expired on ${endLabel} — the system is in read-only mode. ${days} day(s) left to renew before full lockout. Upload a renewed license or contact your administrator.`;
}
