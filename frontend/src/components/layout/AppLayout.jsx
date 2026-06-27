import Sidebar from "./Sidebar";
import AppTopBar from "./AppTopBar";
import { SkipLink } from "../ui";
import { useSidebarCollapsed } from "../../context/SidebarStateContext";
import "./layout.css";

/**
 * Sri Kuber shell: sidebar + top bar (profile/breadcrumb) + main canvas.
 */
export default function AppLayout({
  showNav = true,
  children,
}) {
  const { collapsed, toggleCollapsed } = useSidebarCollapsed();

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      {showNav && <SkipLink />}
      {showNav && (
        <Sidebar
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
      )}
      <div className="app-shell__main">
        {showNav && <AppTopBar />}
        <main id="main-content" className="app-shell__content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
