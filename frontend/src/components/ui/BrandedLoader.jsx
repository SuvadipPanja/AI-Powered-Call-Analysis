import { useAppBranding } from "../../utils/appBranding";
import { usernameInitials } from "../../utils/userDisplay";
import "./ui.css";

/** App boot / session restore screen — uses admin-configured name + logo. */
export default function BrandedLoader({ message = "Initializing application…" }) {
  const { appName, logoUrl } = useAppBranding();
  const label = appName || "Call Analytics";

  return (
    <div className="branded-loader" role="status" aria-live="polite" aria-busy="true">
      <div className="branded-loader__brand">
        {logoUrl ? (
          <img src={logoUrl} alt="" className="branded-loader__logo" />
        ) : (
          <span className="branded-loader__mark" aria-hidden="true">
            {usernameInitials(label).slice(0, 1)}
          </span>
        )}
      </div>
      <div className="loading-spinner branded-loader__spinner" aria-hidden="true" />
      <h2 className="branded-loader__message">{message}</h2>
      <p className="branded-loader__app">{label}</p>
    </div>
  );
}
