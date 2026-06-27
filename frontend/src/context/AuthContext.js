import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { clearAuthStorage } from "../utils/uiPreferences";
import { useWebSocket } from "./WebSocketContext";
import { apiGet, apiPost, apiUrl } from "../utils/apiHelpers";

const AuthContext = createContext(null);

function logAuth(message, detail) {
  const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  if (detail !== undefined) console.log(`[${ts}] [Auth] ${message}`, detail);
  else console.log(`[${ts}] [Auth] ${message}`);
}

export function AuthProvider({ children }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { disconnectWebSocket } = useWebSocket();

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [userType, setUserType] = useState("");
  const [token, setToken] = useState("");
  const [licenseValid, setLicenseValid] = useState(null);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [isTempLogin, setIsTempLogin] = useState(false);
  const [showWarningBanner, setShowWarningBanner] = useState(false);
  const [isValidatingSession, setIsValidatingSession] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initializationComplete, setInitializationComplete] = useState(false);

  const validateLicense = useCallback(async () => {
    try {
      logAuth("Validating license…");
      const result = await apiPost("/api/verify-license", {}, {
        label: "verify-license",
        signal: AbortSignal.timeout(15000),
      });
      logAuth("License validation response", result);

      if (result.success) {
        setLicenseValid(true);
        return true;
      }
      setLicenseValid(false);
      return false;
    } catch (error) {
      logAuth("License validation could not reach server; treating as transient", error.message);
      setLicenseValid(true);
      return true;
    }
  }, []);

  const fetchLicenseStatus = useCallback(async () => {
    try {
      logAuth("Fetching license status…");
      const result = await apiGet("/api/license-status", {
        label: "license-status",
        signal: AbortSignal.timeout(15000),
      });
      logAuth("License status response", result);

      if (result.success) {
        const status = {
          isExpired: result.isExpired,
          daysUntilExpiration: result.daysUntilExpiration,
          endDate: result.endDate,
        };
        setLicenseStatus(status);
        return status;
      }
      const status = { isExpired: true, daysUntilExpiration: 0 };
      setLicenseStatus(status);
      return status;
    } catch (error) {
      logAuth("License status could not reach server; treating as transient", error.message);
      const status = { isExpired: false, daysUntilExpiration: null };
      setLicenseStatus(status);
      return status;
    }
  }, []);

  const validateSession = useCallback(async (sessionUserId, sessionToken) => {
    if (!sessionUserId || !sessionToken) {
      logAuth("No session data for validation");
      return false;
    }
    try {
      const response = await fetch(apiUrl("/api/check-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: sessionUserId, token: sessionToken }),
        signal: AbortSignal.timeout(5000),
      });
      if (response.status >= 500) {
        logAuth(`Session check server error (${response.status}); keeping local session`);
        return true;
      }
      const data = await response.json();
      logAuth("Session check response", data);
      if (!data.success) {
        logAuth(`Session invalid: ${data.message}`);
        return false;
      }
      if (data.userId && data.userId !== sessionUserId) {
        localStorage.setItem("userId", data.userId);
      }
      return true;
    } catch (err) {
      console.error("[Auth] Error checking session:", err.message);
      return true;
    }
  }, []);

  const restoreSessionFromStorage = useCallback(async () => {
    const storedUserId = localStorage.getItem("userId");
    const storedToken = localStorage.getItem("token");
    const storedIsLoggedIn = localStorage.getItem("isLoggedIn") === "true";

    logAuth(`Initializing session: storedToken exists=${!!storedToken}, isLoggedIn=${storedIsLoggedIn}`);

    if (storedUserId && storedToken && storedIsLoggedIn) {
      setIsValidatingSession(true);
      const isValid = await validateSession(storedUserId, storedToken);
      if (isValid) {
        const resolvedUserId = localStorage.getItem("userId") || storedUserId;
        setUserId(resolvedUserId);
        setToken(storedToken);
        setUsername(localStorage.getItem("username") || "");
        setUserType(localStorage.getItem("userType") || "");
        setIsLoggedIn(true);
        setIsTempLogin(localStorage.getItem("isTempLogin") === "true");
        logAuth("Session restored from localStorage");

        const currentPath = location.pathname;
        if (currentPath === "/login" || currentPath === "/") {
          navigate("/", { replace: true });
        }
      } else {
        logAuth("Invalid session from localStorage, clearing and redirecting to login");
        clearAuthStorage();
        setIsLoggedIn(false);
        setUserId("");
        setUsername("");
        setUserType("");
        setToken("");
        setIsTempLogin(false);
        setIsValidatingSession(false);
        navigate("/login", { replace: true });
        return;
      }
      setIsValidatingSession(false);
    } else {
      logAuth("No session data");
      setIsValidatingSession(false);
      const publicPaths = ["/login", "/forgot-password", "/license-error", "/temp-super-admin-login"];
      if (!publicPaths.some((p) => location.pathname === p || location.pathname.startsWith(p))) {
        navigate("/login", { replace: true });
      }
    }
  }, [validateSession, navigate, location.pathname]);

  useEffect(() => {
    if (initializationComplete) return undefined;

    const initializeApp = async () => {
      try {
        setIsInitializing(true);
        logAuth("Starting app initialization…");

        const isLicenseValid = await validateLicense();
        const licenseStatusData = await fetchLicenseStatus();

        const shouldShowLicenseError = !isLicenseValid || licenseStatusData.isExpired;
        logAuth(`License check: Valid=${isLicenseValid}, Expired=${licenseStatusData.isExpired}, ShouldShowError=${shouldShowLicenseError}`);

        if (shouldShowLicenseError) {
          if (
            location.pathname !== "/license-error"
            && location.pathname !== "/license-management"
            && location.pathname !== "/temp-super-admin-login"
          ) {
            logAuth("Redirecting to license-error due to invalid license");
            navigate("/license-error", { replace: true });
          }
        } else {
          await restoreSessionFromStorage();
        }
      } catch (error) {
        console.error("[Auth] Initialization error:", error);
        if (location.pathname !== "/license-error") {
          navigate("/license-error", { replace: true });
        }
      } finally {
        setIsInitializing(false);
        setIsValidatingSession(false);
        setInitializationComplete(true);
      }
    };

    initializeApp();
  }, [
    validateLicense,
    fetchLicenseStatus,
    restoreSessionFromStorage,
    navigate,
    location.pathname,
    initializationComplete,
  ]);

  const login = useCallback(async (loginUserId, password, questionType, questionAnswer) => {
    logAuth(`Attempting login for userId: ${loginUserId}`);

    const data = await apiPost("/api/login-security", {
      userId: loginUserId,
      password,
      questionType,
      questionAnswer,
    }, { label: "login-security" });
    logAuth("Login response", data);

    if (!data.success) {
      throw new Error(data.message || "Login failed. Check your credentials.");
    }

    const sessionUserId = data.userId || loginUserId;
    setIsLoggedIn(true);
    setUserId(sessionUserId);
    setUsername(data.username);
    setUserType(data.userType);
    setToken(data.token);
    setIsTempLogin(false);

    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("userId", sessionUserId);
    localStorage.setItem("loginAlias", loginUserId);
    localStorage.setItem("username", data.username);
    localStorage.setItem("userType", data.userType);
    localStorage.setItem("token", data.token);
    localStorage.setItem("logId", String(data.logId));
    localStorage.removeItem("isTempLogin");

    try {
      const invalidateData = await apiPost("/api/invalidate-existing-sessions", {
        userId: data.userId || loginUserId,
        currentLogId: data.logId,
      }, { label: "invalidate-existing-sessions" });
      logAuth("Invalidate sessions response", invalidateData);
    } catch (err) {
      console.error("[Auth] Error invalidating existing sessions:", err.message);
    }

    if (licenseStatus && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired) {
      setShowWarningBanner(true);
      setTimeout(() => setShowWarningBanner(false), 20000);
    }

    logAuth("Redirecting to / after login");
    navigate("/", { replace: true });
    return data;
  }, [licenseStatus, navigate]);

  const tempLogin = useCallback(async (tempUsername, tempUserType, logId) => {
    logAuth(`Temp login for username: ${tempUsername}, userType: ${tempUserType}`);

    setIsLoggedIn(true);
    setUserId(tempUsername);
    setUsername(tempUsername);
    setUserType(tempUserType);
    setToken(localStorage.getItem("sessionToken") || localStorage.getItem("token"));
    setIsTempLogin(true);

    localStorage.setItem("isLoggedIn", "true");
    localStorage.setItem("userId", tempUsername);
    localStorage.setItem("username", tempUsername);
    localStorage.setItem("userType", tempUserType);
    localStorage.setItem("isTempLogin", "true");
    if (logId) {
      localStorage.setItem("logId", String(logId));
    }

    if (licenseStatus && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired) {
      setShowWarningBanner(true);
      setTimeout(() => setShowWarningBanner(false), 20000);
    }

    logAuth(`Temp login successful for ${tempUsername}`);
    navigate("/admin-settings?tab=license", { replace: true });
    return { success: true };
  }, [licenseStatus, navigate]);

  const logout = useCallback(async () => {
    try {
      const currentUserId = userId;
      const currentToken = token;
      const currentLogId = localStorage.getItem("logId");
      if (currentUserId && currentToken && currentLogId) {
        logAuth(`Initiating logout for UserID: ${currentUserId}, LogID: ${currentLogId}`);
        const data = await apiPost("/api/logout-track", {
          userId: currentUserId,
          logId: currentLogId,
          token: currentToken,
        }, { label: "logout-track" });
        if (!data.success) {
          console.warn(`[Auth] Logout tracking failed: ${data.message}`);
        }
      } else {
        logAuth(`Missing logout data: userId=${currentUserId}, token=${!!currentToken}, logId=${currentLogId}`);
      }
    } catch (err) {
      console.error("[Auth] Error tracking logout:", err.message);
    } finally {
      disconnectWebSocket();
      clearAuthStorage();
      setIsLoggedIn(false);
      setUserId("");
      setUsername("");
      setUserType("");
      setToken("");
      setIsTempLogin(false);
      setShowWarningBanner(false);
      navigate("/login", { replace: true });
      window.location.reload();
    }
  }, [userId, token, disconnectWebSocket, navigate]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === "isLoggedIn" && e.newValue !== "true" && isLoggedIn) {
        logAuth("Storage change detected: isLoggedIn changed, triggering logout");
        logout();
      }
    };
    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [isLoggedIn, logout]);

  const value = useMemo(() => ({
    isLoggedIn,
    isAuthenticated: isLoggedIn,
    userId,
    username,
    userType,
    token,
    isTempLogin,
    licenseValid,
    licenseStatus,
    showWarningBanner,
    isInitializing,
    isValidatingSession,
    initializationComplete,
    login,
    logout,
    tempLogin,
  }), [
    isLoggedIn,
    userId,
    username,
    userType,
    token,
    isTempLogin,
    licenseValid,
    licenseStatus,
    showWarningBanner,
    isInitializing,
    isValidatingSession,
    initializationComplete,
    login,
    logout,
    tempLogin,
  ]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}

export default AuthContext;
