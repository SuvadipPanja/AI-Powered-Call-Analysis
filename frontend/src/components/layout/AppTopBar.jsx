import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LuChevronRight,
  LuChevronDown,
  LuSettings,
  LuLogOut,
  LuCrown,
} from "../../icons";
import ThemeToggle from "../ui/ThemeToggle";
import UserAvatar from "../ui/UserAvatar";
import { useAppBranding, useDocumentTitle } from "../../utils/appBranding";
import { useAuth } from "../../context/AuthContext";
import "./layout.css";

const ROUTE_CRUMBS = [
  { match: (p) => p === "/", label: "Dashboard", exact: true },
  { match: (p) => p === "/upload", label: "Audio Upload" },
  { match: (p) => p.startsWith("/reports"), label: "Reports" },
  { match: (p) => p.startsWith("/agents"), label: "Agents" },
  { match: (p) => p.startsWith("/user-management"), label: "Users" },
  { match: (p) => p.startsWith("/team-leader"), label: "Team Leader" },
  { match: (p) => p.startsWith("/system-monitoring"), label: "Monitoring" },
  { match: (p) => p.startsWith("/admin-settings"), label: "Admin Settings" },
  { match: (p) => p.startsWith("/audit-section"), label: "Audit" },
  { match: (p) => p.startsWith("/settings"), label: "Settings" },
  { match: (p) => p.startsWith("/agent-settings"), label: "Agent Settings" },
  { match: (p) => p.startsWith("/results"), label: "Call Results" },
  { match: (p) => p.startsWith("/statistics"), label: "Statistics" },
  { match: (p) => p.startsWith("/about"), label: "About" },
];

function resolveCrumb(pathname) {
  const hit = ROUTE_CRUMBS.find((r) => r.match(pathname));
  return hit?.label || "Dashboard";
}

function roleBadgeLabel(userType) {
  if (!userType) return "User";
  if (userType === "Super Admin") return "Admin";
  if (userType === "Team Leader") return "Team Lead";
  return userType;
}

export default function AppTopBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userType, username, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef(null);

  const resolvedUserType = userType || "";
  const resolvedUsername = username || "User";
  const isAgent = resolvedUserType === "Agent";
  const settingsPath = isAgent ? "/agent-settings" : "/settings";
  const pageLabel = useMemo(() => resolveCrumb(location.pathname), [location.pathname]);
  const { appName, logoUrl } = useAppBranding();
  const brandLabel = appName || "Call Analytics";
  useDocumentTitle(pageLabel, appName);

  const handleLogout = logout;

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    setShowMenu(false);
  }, [location.pathname]);

  return (
    <header className="app-topbar">
      <nav className="app-topbar__crumbs" aria-label="Breadcrumb">
        <button type="button" className="app-topbar__crumb-root" onClick={() => navigate("/")}>
          {logoUrl ? <img src={logoUrl} alt="" className="app-topbar__brand-logo" /> : null}
          {brandLabel}
        </button>
        <LuChevronRight className="app-topbar__crumb-sep" aria-hidden />
        <span className="app-topbar__crumb-current">{pageLabel}</span>
      </nav>

      <div className="app-topbar__actions">
        <ThemeToggle compact />
        <span className="app-topbar__divider" aria-hidden />

        <div className="app-topbar__profile" ref={menuRef}>
          <button
            type="button"
            className="app-topbar__profile-pill"
            onClick={() => setShowMenu((v) => !v)}
            aria-expanded={showMenu}
            aria-haspopup="menu"
          >
            <span className="app-topbar__profile-text">
              <strong>{resolvedUsername}</strong>
            </span>
            <span className="app-topbar__role-badge">
              <LuCrown strokeWidth={2} />
              {roleBadgeLabel(resolvedUserType)}
            </span>
            <span className="app-topbar__avatar-wrap">
              <UserAvatar username={resolvedUsername} size="sm" alt={`${resolvedUsername} profile`} />
            </span>
            <LuChevronDown className={`app-topbar__chevron ${showMenu ? "is-open" : ""}`} aria-hidden />
          </button>

          {showMenu && (
            <div className="app-topbar__menu" role="menu">
              <button type="button" role="menuitem" onClick={() => { setShowMenu(false); navigate(settingsPath); }}>
                <LuSettings /> Settings
              </button>
              <button type="button" role="menuitem" className="danger" onClick={handleLogout}>
                <LuLogOut /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
