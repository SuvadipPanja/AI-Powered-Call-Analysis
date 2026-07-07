import { useEffect, useMemo } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { installAuthInterceptors } from "./utils/apiClient";
import Login from "./components/Login";
import AfterLogin from "./components/AfterLogin";
import Settings from "./components/Settings";
import UploadPage from "./components/UploadPage";
import Agents from "./components/Agents";
import AddAgent from "./components/AddAgent";
import About from "./components/about";
import HelpPage from "./components/HelpPage";
import HelpAgents from "./components/HelpAgents";
import HelpAddAgent from "./components/HelpAddAgent";
import CreateUser from "./components/CreateUser";
import ForgotPassword from "./components/ForgotPassword";
import ResultPage from "./components/ResultPage";
import ReportDetails from "./components/ReportDetails";
import StatisticsDetails from "./components/StatisticsDetails";
import AgentDashboard from "./components/AgentDashboard";
import TeamLeaderSection from "./components/TeamLeaderSection";
import withSessionTimeout from "./withSessionTimeout";
import { ChatProvider } from "./context/ChatContext";
import { WebSocketProvider } from "./context/WebSocketContext";
import { AuthProvider, useAuth } from "./context/AuthContext";
import ChatPopup from "./components/ChatPopup";
import SystemMonitoring from "./components/SystemMonitoring";
import UserManagement from "./components/UserManagement";
import LicenseErrorPage from "./components/LicenseErrorPage";
import TempSuperAdminLogin from "./components/TempSuperAdminLogin";
import AgentSettings from "./components/AgentSettings";
import AdminSettings from "./components/AdminSettings";
import AuditSection from "./components/AuditSection";
import TeamAuditDashboard from "./components/TeamAuditDashboard";
import AuthenticatedLayout from "./components/layout/AuthenticatedLayout";
import { SidebarStateProvider } from "./context/SidebarStateContext";
import { fetchPublicBranding } from "./utils/appBranding";
import BrandedLoader from "./components/ui/BrandedLoader";
import LicenseGraceBanner from "./components/LicenseGraceBanner";
import { isExpiringSoon, isFullyExpired, isGraceMode } from "./utils/licenseStatus";

installAuthInterceptors();

const AppContent = () => {
  const {
    isLoggedIn,
    username,
    userType,
    isTempLogin,
    licenseValid,
    licenseStatus,
    showWarningBanner,
    graceBlockNotice,
    isInitializing,
    isValidatingSession,
    login,
    tempLogin,
  } = useAuth();

  useEffect(() => {
    fetchPublicBranding();
  }, []);

  const authLayoutElement = useMemo(
    () => <AuthenticatedLayout />,
    [],
  );

  if (isInitializing || isValidatingSession) {
    return <BrandedLoader message="Initializing application…" />;
  }

  if (licenseValid === false || (licenseStatus && isFullyExpired(licenseStatus))) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={login} />} />
        <Route path="/license-error" element={<LicenseErrorPage onTempLogin={tempLogin} />} />
        <Route path="/temp-super-admin-login" element={<TempSuperAdminLogin onLogin={tempLogin} />} />
        {isLoggedIn && isTempLogin && userType === "Super Admin" && (
          <>
            <Route path="/admin-settings" element={<AdminSettings licenseOnly />} />
            <Route path="/license-management" element={<Navigate to="/admin-settings?tab=license" replace />} />
          </>
        )}
        <Route path="*" element={<LicenseErrorPage onTempLogin={tempLogin} />} />
      </Routes>
    );
  }

  const graceActive = isGraceMode(licenseStatus);
  const bannerOffset = graceActive ? "48px" : "0px";

  return (
    <>
      <LicenseGraceBanner licenseStatus={licenseStatus} variant="app" />
      {licenseStatus && showWarningBanner && isExpiringSoon(licenseStatus) && (
        <div
          className="license-warning-banner license-warning-banner--app"
          role="alert"
          aria-live="polite"
          style={{ top: bannerOffset }}
        >
          License will expire in {licenseStatus.daysUntilExpiration} day(s) on {new Date(licenseStatus.endDate).toLocaleDateString()}! Please contact an administrator to renew.
        </div>
      )}
      {graceBlockNotice && (
        <div
          className="license-grace-toast"
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "24px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 1200,
            maxWidth: "min(520px, 92vw)",
          }}
        >
          {graceBlockNotice}
        </div>
      )}
      {isLoggedIn && !isTempLogin && <ChatPopup username={username} />}
      <Routes>
        <Route path="/login" element={<Login onLogin={login} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/license-error" element={<LicenseErrorPage onTempLogin={tempLogin} />} />
        <Route path="/temp-super-admin-login" element={<TempSuperAdminLogin onLogin={tempLogin} />} />
        {!isLoggedIn && <Route path="/" element={<Login onLogin={login} />} />}
        {!isLoggedIn && <Route path="*" element={<Navigate to="/login" replace />} />}
        {isLoggedIn && !isTempLogin && (
          <Route element={authLayoutElement}>
            {userType === "Agent" ? (
              <>
                <Route path="/" element={<AgentDashboard />} />
                <Route path="/agent-settings" element={<AgentSettings />} />
                <Route path="/my-calls/:filename" element={<ResultPage />} />
                <Route path="*" element={<AgentDashboard />} />
              </>
            ) : (
              <>
                <Route path="/" element={<AfterLogin />} />
                <Route path="/about" element={<About />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/agents" element={<Agents />} />
                <Route path="/add-agent" element={<AddAgent />} />
                <Route path="/user-management" element={<UserManagement />} />
                <Route path="/help" element={<HelpPage />} />
                <Route path="/help-agents" element={<HelpAgents />} />
                <Route path="/help-add-agent" element={<HelpAddAgent />} />
                <Route path="/create-user" element={<CreateUser />} />
                <Route path="/results/:filename" element={<ResultPage />} />
                <Route path="/reports/details" element={<ReportDetails />} />
                <Route path="/statistics/details" element={<StatisticsDetails />} />
                <Route path="/recent-activity" element={<Navigate to="/upload" replace />} />
                <Route path="/team-leader-section" element={<TeamLeaderSection />} />
                <Route path="/audit-section" element={<AuditSection />} />
                <Route path="/team-audits" element={<TeamAuditDashboard />} />
                <Route path="/admin-settings" element={<AdminSettings />} />
                <Route path="/system-monitoring" element={<SystemMonitoring />} />
                <Route path="/license-management" element={<Navigate to="/admin-settings?tab=license" replace />} />
                <Route path="*" element={<AfterLogin />} />
              </>
            )}
          </Route>
        )}
        {isLoggedIn && isTempLogin && userType === "Super Admin" && (
          <>
            <Route path="/admin-settings" element={<AdminSettings licenseOnly />} />
            <Route path="/license-management" element={<Navigate to="/admin-settings?tab=license" replace />} />
            <Route path="*" element={<LicenseErrorPage onTempLogin={tempLogin} />} />
          </>
        )}
      </Routes>
    </>
  );
};

const AppWithSessionTimeout = withSessionTimeout(AppContent);

const AppWrapper = () => (
  <Router>
    <SidebarStateProvider>
      <WebSocketProvider>
        <AuthProvider>
          <ChatProvider>
            <AppWithSessionTimeout />
          </ChatProvider>
        </AuthProvider>
      </WebSocketProvider>
    </SidebarStateProvider>
  </Router>
);

export default AppWrapper;
