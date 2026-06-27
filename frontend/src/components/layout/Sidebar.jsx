import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LuLayoutDashboard,
  LuUpload,
  LuChartBar,
  LuUserCog,
  LuUsers,
  LuCrown,
  LuActivity,
  LuCircleHelp,
  LuChevronLeft,
  LuMenu,
  LuX,
  LuSettings,
  LuShieldCheck,
  LuAudioLines,
  LuClipboardCheck,
} from "../../icons";
import { useAppBranding } from "../../utils/appBranding";
import { useAuth } from "../../context/AuthContext";
import "./layout.css";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: LuLayoutDashboard, show: true, exact: true },
  { to: "/agent-settings", label: "Settings", icon: LuSettings, showKey: "agentSettings" },
  { to: "/upload", label: "Audio Upload", icon: LuUpload, showKey: "upload" },
  { to: "/reports/details", label: "Reports", icon: LuChartBar, show: true },
  { to: "/agents", label: "Agents", icon: LuUserCog, showKey: "agents" },
  { to: "/user-management", label: "Users", icon: LuUsers, showKey: "users" },
  { to: "/team-leader-section", label: "Team Leader", icon: LuCrown, showKey: "team" },
  { to: "/audit-section", label: "Audit", icon: LuShieldCheck, showKey: "audit" },
  { to: "/team-audits", label: "Audit Dashboard", icon: LuClipboardCheck, showKey: "auditDash" },
  { to: "/system-monitoring", label: "Monitoring", icon: LuActivity, showKey: "system" },
  { to: "/admin-settings", label: "Admin Settings", icon: LuSettings, showKey: "admin" },
  { to: "/about", label: "About", icon: LuCircleHelp, show: true },
];

export default function Sidebar({ collapsed, onToggleCollapse }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { appName, logoUrl } = useAppBranding();
  const { userType } = useAuth();
  const canSystem = ["Super Admin", "Admin"].includes(userType);
  const canAdmin = ["Super Admin", "Admin"].includes(userType);
  const canAgents = ["Super Admin", "Admin", "Manager", "Team Leader"].includes(userType);
  const canUsers = ["Super Admin", "Admin", "Manager"].includes(userType);
  const canTeam = ["Team Leader", "Super Admin"].includes(userType);
  const canAudit = ["Auditor", "Super Admin", "Admin"].includes(userType);
  const canAuditDash = ["Super Admin", "Admin", "Manager", "Team Leader"].includes(userType);
  const canUpload = userType !== "Auditor";
  const isAgent = userType === "Agent";

  const links = NAV_LINKS.filter((l) => {
    if (isAgent) {
      return l.showKey === "agentSettings" || (l.show && l.exact);
    }
    if (l.showKey === "agentSettings") return false;
    if (l.show) return true;
    if (l.showKey === "upload") return canUpload;
    if (l.showKey === "notAgent") return userType !== "Agent";
    if (l.showKey === "agents") return canAgents;
    if (l.showKey === "users") return canUsers;
    if (l.showKey === "team") return canTeam;
    if (l.showKey === "audit") return canAudit;
    if (l.showKey === "auditDash") return canAuditDash;
    if (l.showKey === "system") return canSystem;
    if (l.showKey === "admin") return canAdmin;
    return false;
  });

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  const isActive = (l) =>
    l.exact ? location.pathname === l.to : location.pathname.startsWith(l.to);

  const go = (to) => {
    setMobileOpen(false);
    navigate(to);
  };

  const sidebarClass = [
    "app-sidebar",
    collapsed ? "is-collapsed" : "",
    mobileOpen ? "is-mobile-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <>
      <button
        type="button"
        className="app-sidebar__mobile-trigger"
        aria-label="Open menu"
        onClick={() => setMobileOpen(true)}
      >
        <LuMenu />
      </button>

      {mobileOpen && (
        <button
          type="button"
          className="app-sidebar__backdrop"
          aria-label="Close menu"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside className={sidebarClass}>
        <div className="app-sidebar__toolbar">
          <button type="button" className="app-sidebar__brand" onClick={() => go("/")}>
            {logoUrl
              ? <img src={logoUrl} alt="" className="app-sidebar__brand-logo" />
              : <span className="app-sidebar__brand-mark"><LuAudioLines /></span>}
            <span className="app-sidebar__brand-text">{appName || "Call Analytics"}</span>
          </button>
          <button
            type="button"
            className="app-sidebar__collapse"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            onClick={onToggleCollapse}
          >
            <LuChevronLeft />
          </button>
          <button
            type="button"
            className="app-sidebar__close-mobile"
            aria-label="Close menu"
            onClick={() => setMobileOpen(false)}
          >
            <LuX />
          </button>
        </div>

        <nav className="app-sidebar__nav" aria-label="Main navigation">
          {links.map((l) => {
            const Icon = l.icon;
            return (
              <button
                key={l.to}
                type="button"
                className={`app-sidebar__link ${isActive(l) ? "is-active" : ""}`}
                onClick={() => go(l.to)}
                title={l.label}
                aria-label={l.label}
                aria-current={isActive(l) ? "page" : undefined}
              >
                <span className="app-sidebar__link-icon" aria-hidden="true">
                  <Icon strokeWidth={2} />
                </span>
                <span className="app-sidebar__link-label">{l.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
