import { useState, useEffect } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import config from "./utils/envConfig";
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
import RecentActivityPage from "./components/RecentActivityPage";
import TeamLeaderSection from "./components/TeamLeaderSection";
import withSessionTimeout from "./withSessionTimeout";
import { ChatProvider } from "./context/ChatContext";
import { WebSocketProvider, useWebSocket } from "./context/WebSocketContext";
import ChatPopup from "./components/ChatPopup";
import SystemMonitoring from "./components/SystemMonitoring";
import UserManagement from "./components/UserManagement";
import LicenseErrorPage from "./components/LicenseErrorPage";
import LicenseManagement from "./components/LicenseManagement";
import TempSuperAdminLogin from "./components/TempSuperAdminLogin";

const App = () => {
  /*************************************************
   * (1) Code Integrity Check
   *************************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised.");
    }
  };
  verifySignature(signature);

  /*************************************************
   * (2) Local State & Persistence
   *************************************************/
  const [isLoggedIn, setIsLoggedIn] = useState(
    localStorage.getItem("isLoggedIn") === "true"
  );
  const [username, setUsername] = useState(localStorage.getItem("username") || "");
  const [userType, setUserType] = useState(localStorage.getItem("userType") || "");
  const [logId, setLogId] = useState(localStorage.getItem("logId") || "");
  const [licenseValid, setLicenseValid] = useState(null);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [isTempLogin, setIsTempLogin] = useState(false);
  const [showWarningBanner, setShowWarningBanner] = useState(false);

  const { disconnectWebSocket } = useWebSocket();

  /*************************************************
   * (3) License Validation on Startup
   *************************************************/
  const SECRET_KEY = "HRyXPns88oPVgnWoyBoHOJ5vXWukyWP4";

  useEffect(() => {
    const validateLicense = async () => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/verify-license`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ secretKey: SECRET_KEY }),
        });
        const result = await response.json();
        if (result.success) {
          console.log('License validation successful:', result);
          setLicenseValid(true);
        } else {
          console.error('License validation failed:', result.message);
          setLicenseValid(false);
        }
      } catch (error) {
        console.error('Error validating license:', error);
        setLicenseValid(false);
      }
    };

    const fetchLicenseStatus = async () => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/license-status`, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });
        const result = await response.json();
        if (result.success) {
          setLicenseStatus({
            isExpired: result.isExpired,
            daysUntilExpiration: result.daysUntilExpiration,
            endDate: result.endDate,
          });
        } else {
          console.error('Failed to fetch license status:', result.message);
          setLicenseStatus({ isExpired: true, daysUntilExpiration: 0 });
        }
      } catch (error) {
        console.error('Error fetching license status:', error);
        setLicenseStatus({ isExpired: true, daysUntilExpiration: 0 });
      }
    };

    validateLicense();
    fetchLicenseStatus();
  }, []);

  /*************************************************
   * (4) Centralized Login Handler
   *************************************************/
  const handleLogin = async (user, password, questionType, questionAnswer) => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/login-security`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: user,
          password,
          questionType,
          questionAnswer,
        }),
      });
      const data = await response.json();

      if (data.success) {
        setIsLoggedIn(true);
        setUsername(user);
        setUserType(data.userType);
        setLogId(data.logId);

        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("username", user);
        localStorage.setItem("userType", data.userType);
        localStorage.setItem("logId", data.logId);

        // Show the warning banner if license is expiring soon, then hide after 20 seconds
        if (licenseStatus && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired) {
          setShowWarningBanner(true);
          setTimeout(() => {
            setShowWarningBanner(false);
          }, 20000); // 20 seconds
        }

        console.log(`User ${user} logged in successfully with LogID: ${data.logId}`);
      } else {
        throw new Error(data.message || "Login failed. Check your credentials.");
      }
    } catch (err) {
      console.error("Login error:", err.message);
      throw err;
    }
  };

  /*************************************************
   * (4.1) Temporary Super Admin Login Handler
   *************************************************/
  const handleTempLogin = async (user, userType, logId) => {
    if (userType !== 'Super Admin') {
      throw new Error('Only Super Admins can access this page.');
    }
    setIsLoggedIn(true);
    setUsername(user);
    setUserType(userType);
    setLogId(logId);
    setIsTempLogin(true);

    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("username", user);
    localStorage.setItem("userType", userType);
    localStorage.setItem("logId", logId);

    // Show the warning banner if license is expiring soon, then hide after 20 seconds
    if (licenseStatus && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired) {
      setShowWarningBanner(true);
      setTimeout(() => {
        setShowWarningBanner(false);
      }, 20000); // 20 seconds
    }

    console.log(`Super Admin ${user} logged in temporarily with LogID: ${logId}`);
  };

  /*************************************************
   * (5) Centralized Logout Handler
   *************************************************/
  const handleLogout = async () => {
    try {
      const currentUser = username;
      const currentLogId = logId;

      if (currentUser && currentLogId) {
        const response = await fetch(`${config.apiBaseUrl}/api/logout-track`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: currentUser,
            logId: currentLogId,
          }),
        });
        const data = await response.json();
        if (data.success) {
          console.log(`User ${currentUser} logged out successfully with LogID: ${currentLogId}`);
        } else {
          console.error("Logout tracking failed:", data.message);
        }
      } else {
        console.warn("No user or logId found for logout tracking.");
      }
    } catch (err) {
      console.error("Error tracking logout:", err.message);
    } finally {
      disconnectWebSocket();

      localStorage.clear();
      setIsLoggedIn(false);
      setUsername("");
      setUserType("");
      setLogId("");
      setIsTempLogin(false);
      setShowWarningBanner(false);

      window.location.href = "/";
    }
  };

  /*************************************************
   * (6) Render Based on License Validation
   *************************************************/
  if (licenseValid === null) {
    return (
      <div className="loading-container">
        <h2>Validating License...</h2>
      </div>
    );
  }

  if (!licenseValid || (licenseStatus && licenseStatus.isExpired)) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/license-error" element={<LicenseErrorPage />} />
        <Route path="/temp-super-admin-login" element={<TempSuperAdminLogin onLogin={handleTempLogin} />} />
        {isLoggedIn && isTempLogin && userType === "Super Admin" && (
          <Route
            path="/license-management"
            element={
              <LicenseManagement
                username={username}
                userType={userType}
                onLogout={handleLogout}
              />
            }
          />
        )}
        <Route path="*" element={<LicenseErrorPage />} />
      </Routes>
    );
  }

  /*************************************************
   * (7) Routes
   *************************************************/
  return (
    <>
      {/* License Expiration Warning Banner */}
      {licenseStatus && showWarningBanner && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired && (
        <div
          style={{
            background: "linear-gradient(90deg, #ff5722, #ffa500)",
            color: "#fff",
            padding: "10px",
            textAlign: "center",
            fontFamily: "'Orbitron', sans-serif",
            fontSize: "1rem",
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 1000,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)"
          }}
        >
          ⚠️ License will expire in {licenseStatus.daysUntilExpiration} day(s) on {new Date(licenseStatus.endDate).toLocaleDateString()}! Please contact an administrator to renew.
        </div>
      )}

      {isLoggedIn && !isTempLogin && <ChatPopup username={username} />}
      <Routes>
        <Route path="/login" element={<Login onLogin={handleLogin} />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/license-error" element={<LicenseErrorPage />} />
        {!isLoggedIn && (
          <Route path="/" element={<Login onLogin={handleLogin} />} />
        )}
        {isLoggedIn && userType === "Agent" && (
          <>
            <Route
              path="/"
              element={<AgentDashboard onLogout={handleLogout} />}
            />
            <Route
              path="*"
              element={<AgentDashboard onLogout={handleLogout} />}
            />
          </>
        )}
        {isLoggedIn && userType !== "Agent" && !isTempLogin && (
          <>
            <Route
              path="/"
              element={
                <AfterLogin
                  username={username}
                  userType={userType}
                  onLogout={handleLogout}
                  isAuthenticated={isLoggedIn}
                />
              }
            />
            <Route path="/about" element={<About />} />
            <Route path="/settings" element={<Settings username={username} />} />
            <Route path="/upload" element={<UploadPage username={username} />} />
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
            <Route path="/recent-activity" element={<RecentActivityPage />} />
            <Route
              path="/team-leader-section"
              element={<TeamLeaderSection username={username} />}
            />
            <Route path="/system-monitoring" element={<SystemMonitoring />} />
            <Route
              path="/license-management"
              element={
                <LicenseManagement
                  username={username}
                  userType={userType}
                  onLogout={handleLogout}
                />
              }
            />
            <Route
              path="*"
              element={
                <AfterLogin
                  username={username}
                  userType={userType}
                  onLogout={handleLogout}
                  isAuthenticated={isLoggedIn}
                />
              }
            />
          </>
        )}
        {isLoggedIn && isTempLogin && userType === "Super Admin" && (
          <>
            <Route
              path="/license-management"
              element={
                <LicenseManagement
                  username={username}
                  userType={userType}
                  onLogout={handleLogout}
                />
              }
            />
            <Route path="*" element={<LicenseErrorPage />} />
          </>
        )}
      </Routes>
    </>
  );
};

/*************************************************
 * (8) Wrap App with Session Timeout and Providers
 *************************************************/
const AppWithSessionTimeout = withSessionTimeout(App);

/*************************************************
 * (9) Export Top-Level Router
 *************************************************/
const AppWrapper = () => (
  <Router>
    <WebSocketProvider>
      <ChatProvider>
        <AppWithSessionTimeout />
      </ChatProvider>
    </WebSocketProvider>
  </Router>
);

export default AppWrapper;