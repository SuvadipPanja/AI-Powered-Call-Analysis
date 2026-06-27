import { useState, useRef, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  FaInfoCircle,
  FaCloudUploadAlt,
  FaCog,
  FaTachometerAlt,
  FaChartBar,
  FaUserFriends,
  FaUsers,
  FaUserShield,
  FaSignOutAlt,
  FaBars,
} from "react-icons/fa";
import ThemeToggle from "../ui/ThemeToggle";
import UserAvatar from "../ui/UserAvatar";
import { useAppBranding } from "../../utils/appBranding";
import { useAuth } from "../../context/AuthContext";
import "./layout.css";

/**
 * Shared, token-driven top navigation used across all authenticated pages.
 * Self-sufficient: falls back to localStorage for identity and provides a
 * default logout so any page can render <NavBar /> with no props.
 */
export default function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { userType, username, logout } = useAuth();
  const [showMenu, setShowMenu] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuRef = useRef(null);
  const { appName, logoUrl } = useAppBranding();

  const resolvedUserType = userType || "";
  const resolvedUsername = username || "User";

  const handleLogout = logout;

  useEffect(() => {
    const onClick = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setShowMenu(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const canSystem = ["Super Admin", "Admin"].includes(resolvedUserType);
  const canAgents = ["Super Admin", "Admin", "Manager"].includes(resolvedUserType);
  const canUsers = ["Super Admin", "Admin", "Manager"].includes(resolvedUserType);
  const canTeam = ["Team Leader", "Super Admin"].includes(resolvedUserType);

  const links = [
    { to: "/", label: "Dashboard", icon: <FaTachometerAlt />, show: true, exact: true },
    { to: "/upload", label: "Audio Upload", icon: <FaCloudUploadAlt />, show: true },
    { to: "/reports/details", label: "Reports", icon: <FaChartBar />, show: true },
    { to: "/agents", label: "Agents", icon: <FaUserFriends />, show: canAgents },
    { to: "/user-management", label: "Users", icon: <FaUsers />, show: canUsers },
    { to: "/team-leader-section", label: "Team Leader", icon: <FaUserShield />, show: canTeam },
    { to: "/system-monitoring", label: "Monitoring", icon: <FaTachometerAlt />, show: canSystem },
    { to: "/about", label: "About", icon: <FaInfoCircle />, show: true },
  ].filter((l) => l.show);

  const isActive = (l) =>
    l.exact ? location.pathname === l.to : location.pathname.startsWith(l.to);

  return (
    <nav className="app-navbar">
      <div className="app-navbar__brand" onClick={() => navigate("/")}>
        {logoUrl && <img src={logoUrl} alt="" className="app-navbar__brand-logo" />}
        <span className="app-navbar__brand-text">{appName || "Call Analytics"}</span>
      </div>

      <button
        className="app-navbar__burger"
        aria-label="Toggle navigation"
        onClick={() => setMobileOpen((v) => !v)}
      >
        <FaBars />
      </button>

      <ul className={`app-navbar__links ${mobileOpen ? "is-open" : ""}`}>
        {links.map((l) => (
          <li key={l.to}>
            <button
              className={`app-navbar__link ${isActive(l) ? "is-active" : ""}`}
              onClick={() => {
                setMobileOpen(false);
                navigate(l.to);
              }}
            >
              {l.icon}
              <span>{l.label}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="app-navbar__right">
        <ThemeToggle compact />
        <div className="app-navbar__profile" ref={menuRef}>
          <button
            className="app-navbar__profile-btn"
            onClick={() => setShowMenu((v) => !v)}
            aria-label="Profile menu"
          >
            <UserAvatar username={resolvedUsername} size="sm" alt="Profile" />
            <span className="app-navbar__profile-name">{resolvedUsername}</span>
          </button>
          {showMenu && (
            <div className="app-navbar__menu">
              <div className="app-navbar__menu-head">
                <strong>{resolvedUsername}</strong>
                <span>{resolvedUserType}</span>
              </div>
              <button onClick={() => { setShowMenu(false); navigate("/settings"); }}>
                <FaCog /> Settings
              </button>
              <button className="danger" onClick={handleLogout}>
                <FaSignOutAlt /> Logout
              </button>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}
