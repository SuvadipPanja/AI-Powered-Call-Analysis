import { LuTriangleAlert, LuLock } from "react-icons/lu";
import { graceBannerMessage, isGraceMode } from "../utils/licenseStatus";

/**
 * Persistent banner shown when the backend is in license grace (read-only) mode.
 * variant: 'app' — fixed top bar for authenticated shell; 'inline' — login/admin panels.
 */
export default function LicenseGraceBanner({ licenseStatus, variant = "app", className = "" }) {
  if (!isGraceMode(licenseStatus)) return null;

  const message = graceBannerMessage(licenseStatus);
  const isApp = variant === "app";

  return (
    <div
      className={`license-grace-banner license-grace-banner--${variant} ${className}`.trim()}
      role="alert"
      aria-live="polite"
    >
      {isApp ? <LuLock size={16} aria-hidden /> : <LuTriangleAlert size={16} aria-hidden />}
      <span>{message}</span>
    </div>
  );
}
