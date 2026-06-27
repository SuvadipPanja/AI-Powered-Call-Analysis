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

  if (licenseValid === false || (licenseStatus && licenseStatus.isExpired)) {
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

  return (
    <>
      {licenseStatus && showWarningBanner && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired && (
        <div className="license-warning-banner" style={{
          padding: "10px",
          textAlign: "center",
          fontSize: "0.9rem",
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 1000,
        }}>
          License will expire in {licenseStatus.daysUntilExpiration} day(s) on {new Date(licenseStatus.endDate).toLocaleDateString()}! Please contact an administrator to renew.
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
