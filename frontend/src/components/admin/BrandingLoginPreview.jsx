import { DEFAULT_APP_NAME } from "../../utils/appBranding";

/** Mini mock of the login screen — shown in Admin → Application after logo/name changes. */
export default function BrandingLoginPreview({ appName, logoUrl }) {
  const name = appName?.trim() || DEFAULT_APP_NAME;

  return (
    <div className="branding-login-preview" aria-hidden="true">
      <p className="branding-login-preview__label">Login preview</p>
        <div className="branding-login-preview__frame">
        <div className="branding-login-preview__hero">
          <span className="branding-login-preview__hero-title">{name}</span>
          <span className="branding-login-preview__hero-tagline">Secure call analytics workspace</span>
        </div>
        <div className="branding-login-preview__card">
          {logoUrl && (
            <img src={logoUrl} alt="" className="branding-login-preview__card-logo" />
          )}
          <span className="branding-login-preview__card-title">Sign in</span>
          <span className="branding-login-preview__card-line" />
          <span className="branding-login-preview__card-line branding-login-preview__card-line--short" />
        </div>
      </div>
    </div>
  );
}
