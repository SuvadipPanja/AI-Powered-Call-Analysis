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
import { parseLicenseStatusResponse, isFullyExpired } from "../utils/licenseStatus";
import {
  checkSession,
  invalidateExistingSessions,
  loginSecurity,
  logoutTrack,
  updateSessionInactiveTime,
} from "../services/authService";
import { setAuthInterceptorReady } from "../utils/apiClient";
import {
  readSession,
  persistSession,
  patchSession as patchStoredSession,
  buildLoginSession,
  buildTempLoginSession,
} from "../utils/authSession";
import { getLicenseStatus, verifyLicense } from "../services/licenseService";

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
  const [logId, setLogId] = useState("");
  const [loginAlias, setLoginAlias] = useState("");
  const [licenseValid, setLicenseValid] = useState(null);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [isTempLogin, setIsTempLogin] = useState(false);
  const [showWarningBanner, setShowWarningBanner] = useState(false);
  const [graceBlockNotice, setGraceBlockNotice] = useState(null);
  const [isValidatingSession, setIsValidatingSession] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);
  const [initializationComplete, setInitializationComplete] = useState(false);

  const validateLicense = useCallback(async () => {
    try {
      logAuth("Validating license…");
      const result = await verifyLicense();
      logAuth("License validation response", result);

      if (result.success) {
        setLicenseValid(true);
        if (result.licenseState) {
          setLicenseStatus((prev) => ({
            ...(prev || {}),
            licenseState: result.licenseState,
            isExpired: result.licenseState === "expired",
          }));
        }
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
      const result = await getLicenseStatus();
      logAuth("License status response", result);

      if (result.success) {
        const status = parseLicenseStatusResponse(result);
        if (status) {
          setLicenseStatus(status);
          return status;
        }
      }
      const status = { isExpired: true, daysUntilExpiration: 0, licenseState: "expired", graceRemaining: 0 };
      setLicenseStatus(status);
      return status;
    } catch (error) {
      logAuth("License status could not reach server; treating as transient", error.message);
      const status = { isExpired: false, daysUntilExpiration: null, licenseState: "active", graceRemaining: 0 };
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
      const data = await checkSession(sessionUserId, sessionToken);
      logAuth("Session check response", data);
      if (data._httpStatus >= 500) {
        logAuth(`Session check server error (${data._httpStatus}); keeping local session`);
        return true;
      }
      if (!data.success) {
        logAuth(`Session invalid: ${data.message}`);
        return false;
      }
      if (data.userId && data.userId !== sessionUserId) {
        persistSession({ userId: data.userId });
      }
      return true;
    } catch (err) {
      console.error("[Auth] Error checking session:", err.message);
      return true;
    }
  }, []);

  const restoreSessionFromStorage = useCallback(async () => {
    const stored = readSession();
    const { userId: storedUserId, token: storedToken, isLoggedIn: storedIsLoggedIn, logId: storedLogId } = stored;

    logAuth(`Initializing session: storedToken exists=${!!storedToken}, isLoggedIn=${storedIsLoggedIn}`);

    if (storedUserId && storedToken && storedIsLoggedIn) {
      setIsValidatingSession(true);
      if (storedLogId) {
        try {
          await updateSessionInactiveTime({
            userId: storedUserId,
            logId: storedLogId,
            inactiveTime: new Date().toISOString(),
          });
        } catch {
          /* keep going — session check is authoritative */
        }
      }
      const isValid = await validateSession(storedUserId, storedToken);
      if (isValid) {
        const resolved = readSession();
        setUserId(resolved.userId || storedUserId);
        setToken(resolved.token || storedToken);
        setUsername(resolved.username);
        setUserType(resolved.userType);
        setLogId(resolved.logId);
        setLoginAlias(resolved.loginAlias);
        setIsLoggedIn(true);
        setIsTempLogin(resolved.isTempLogin);
        logAuth("Session restored from localStorage");
        setAuthInterceptorReady(true);

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
        setLogId("");
        setLoginAlias("");
        setIsTempLogin(false);
        setIsValidatingSession(false);
        navigate("/login", { replace: true });
        setAuthInterceptorReady(true);
        return;
      }
      setIsValidatingSession(false);
    } else {
      logAuth("No session data");
      setIsValidatingSession(false);
      setAuthInterceptorReady(true);
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

        const shouldShowLicenseError = !isLicenseValid || isFullyExpired(licenseStatusData);
        logAuth(`License check: Valid=${isLicenseValid}, Expired=${licenseStatusData.isExpired}, State=${licenseStatusData.licenseState}, ShouldShowError=${shouldShowLicenseError}`);

        if (shouldShowLicenseError) {
          if (
            location.pathname !== "/license-error"
            && location.pathname !== "/license-management"
            && location.pathname !== "/temp-super-admin-login"
          ) {
            logAuth("Redirecting to license-error due to invalid license");
            navigate("/license-error", { replace: true });
          }
          setAuthInterceptorReady(true);
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

    const data = await loginSecurity({
      userId: loginUserId,
      password,
      questionType,
      questionAnswer,
    });
    logAuth("Login response", data);

    if (!data.success) {
      throw new Error(data.message || "Login failed. Check your credentials.");
    }

    const session = buildLoginSession(data, loginUserId);
    persistSession(session);
    setIsLoggedIn(true);
    setUserId(session.userId);
    setUsername(session.username);
    setUserType(session.userType);
    setToken(session.token);
    setLogId(session.logId);
    setLoginAlias(session.loginAlias);
    setIsTempLogin(false);

    try {
      const invalidateData = await invalidateExistingSessions({
        userId: data.userId || loginUserId,
        currentLogId: data.logId,
      });
      logAuth("Invalidate sessions response", invalidateData);
    } catch (err) {
      console.error("[Auth] Error invalidating existing sessions:", err.message);
    }

    if (licenseStatus && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired) {
      setShowWarningBanner(true);
      setTimeout(() => setShowWarningBanner(false), 20000);
    }

    logAuth("Redirecting to / after login");
    setAuthInterceptorReady(true);
    navigate("/", { replace: true });
    return data;
  }, [licenseStatus, navigate]);

  const tempLogin = useCallback(async (tempUsername, tempUserType, tempLogId, sessionToken, loginUserId) => {
    logAuth(`Temp login for username: ${tempUsername}, userType: ${tempUserType}`);

    const session = buildTempLoginSession({
      username: tempUsername,
      userType: tempUserType,
      logId: tempLogId,
      sessionToken,
      userId: loginUserId || tempUsername,
    });
    persistSession(session);
    setIsLoggedIn(true);
    setUserId(session.userId);
    setUsername(session.username);
    setUserType(session.userType);
    setToken(session.token);
    setLogId(session.logId);
    setLoginAlias("");
    setIsTempLogin(true);

    if (licenseStatus && licenseStatus.daysUntilExpiration <= 7 && !licenseStatus.isExpired) {
      setShowWarningBanner(true);
      setTimeout(() => setShowWarningBanner(false), 20000);
    }

    logAuth(`Temp login successful for ${tempUsername}`);
    setAuthInterceptorReady(true);
    navigate("/admin-settings?tab=license", { replace: true });
    return { success: true };
  }, [licenseStatus, navigate]);

  const patchSession = useCallback((patch) => {
    patchStoredSession(patch);
    if (patch.userId !== undefined) setUserId(patch.userId);
    if (patch.username !== undefined) setUsername(patch.username);
    if (patch.userType !== undefined) setUserType(patch.userType);
    if (patch.token !== undefined) setToken(patch.token);
    if (patch.logId !== undefined) setLogId(patch.logId);
    if (patch.loginAlias !== undefined) setLoginAlias(patch.loginAlias);
    if (patch.isTempLogin === true) setIsTempLogin(true);
    else if (patch.isTempLogin === false) setIsTempLogin(false);
  }, []);

  const logout = useCallback(async () => {
    try {
      const currentUserId = userId;
      const currentToken = token;
      const currentLogId = logId;
      if (currentUserId && currentToken && currentLogId) {
        logAuth(`Initiating logout for UserID: ${currentUserId}, LogID: ${currentLogId}`);
        const data = await logoutTrack({
          userId: currentUserId,
          logId: currentLogId,
          token: currentToken,
        });
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
      setAuthInterceptorReady(false);
      setIsLoggedIn(false);
      setUserId("");
      setUsername("");
      setUserType("");
      setToken("");
      setLogId("");
      setLoginAlias("");
      setIsTempLogin(false);
      setShowWarningBanner(false);
      navigate("/login", { replace: true });
      window.location.reload();
    }
  }, [userId, token, logId, disconnectWebSocket, navigate]);

  useEffect(() => {
    let timer;
    const onGraceBlocked = (e) => {
      const msg = e.detail?.message || "This action is blocked — the license is in read-only grace mode.";
      setGraceBlockNotice(msg);
      clearTimeout(timer);
      timer = setTimeout(() => setGraceBlockNotice(null), 8000);
    };
    const onLicenseChanged = (e) => {
      const detail = e.detail || {};
      const state = detail.state || (detail.isExpired ? "expired" : "active");
      setLicenseStatus((prev) => ({
        ...prev,
        licenseState: state,
        isExpired: state === "expired",
        graceRemaining: detail.graceRemaining ?? prev?.graceRemaining ?? 0,
      }));
      if (state === "expired" && isLoggedIn) {
        setGraceBlockNotice(detail.reason || "License expired — you will be signed out.");
        clearTimeout(timer);
        timer = setTimeout(() => logout(), 4000);
      } else if (state === "grace") {
        setGraceBlockNotice("License is in read-only grace mode. Some actions are disabled.");
        clearTimeout(timer);
        timer = setTimeout(() => setGraceBlockNotice(null), 10000);
      }
    };
    window.addEventListener("license-grace-blocked", onGraceBlocked);
    window.addEventListener("license-state-changed", onLicenseChanged);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("license-grace-blocked", onGraceBlocked);
      window.removeEventListener("license-state-changed", onLicenseChanged);
    };
  }, [isLoggedIn, logout]);

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
    logId,
    loginAlias,
    isTempLogin,
    licenseValid,
    licenseStatus,
    showWarningBanner,
    graceBlockNotice,
    isInitializing,
    isValidatingSession,
    initializationComplete,
    login,
    logout,
    tempLogin,
    patchSession,
  }), [
    isLoggedIn,
    userId,
    username,
    userType,
    token,
    logId,
    loginAlias,
    isTempLogin,
    licenseValid,
    licenseStatus,
    showWarningBanner,
    graceBlockNotice,
    isInitializing,
    isValidatingSession,
    initializationComplete,
    login,
    logout,
    tempLogin,
    patchSession,
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
