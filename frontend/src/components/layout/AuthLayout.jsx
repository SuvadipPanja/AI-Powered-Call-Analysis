import ThemeToggle from "../ui/ThemeToggle";
import AuthDecor from "./AuthBackground";
import AuthHero from "./AuthHero";
import { useAppBranding } from "../../utils/appBranding";
import "./auth-layout.css";

/**
 * Split-screen auth shell (theme-proof):
 *   Left  — colorful gradient brand panel (hidden on mobile)
 *   Right — login card on a solid surface (always readable in any theme)
 *
 * API preserved: title, subtitle, children, footer, hero.
 */
export default function AuthLayout({ title, subtitle, children, footer, hero = true }) {
  const { logoUrl, appName } = useAppBranding();

  return (
    <div className="auth2">
      {hero && (
        <aside className="auth2__brand">
          <AuthDecor />
          <div className="auth2__brand-inner">
            <AuthHero />
          </div>
        </aside>
      )}

      <main className="auth2__main">
        <div className="auth2__theme">
          <ThemeToggle compact />
        </div>

        <div className="auth2__card auth-card-enter">
          {logoUrl && (
            <div className="auth2__card-logo">
              <img src={logoUrl} alt="" className="auth2__card-logo-img" />
              <span>{appName}</span>
            </div>
          )}
          {!logoUrl && appName && (
            <div className="auth2__card-logo auth2__card-logo--text-only">
              <span>{appName}</span>
            </div>
          )}
          {title && <h1 className="auth2__title">{title}</h1>}
          {subtitle && <p className="auth2__subtitle">{subtitle}</p>}
          <div className="auth-form-stagger">{children}</div>
        </div>

        {footer && <footer className="auth2__footer">{footer}</footer>}
      </main>
    </div>
  );
}
