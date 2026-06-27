import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { keyframes } from "@emotion/react";
import config from "./utils/envConfig";
import { useAuth } from "./context/AuthContext";

const globalState = {
  lastActivity: null,
  inactivityTimer: null,
};

const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

const withSessionTimeout = (WrappedComponent) => {
  return (props) => {
    const { logout } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();
    const [isSessionExpired, setIsSessionExpired] = useState(false);
    const isCheckingSessionRef = useRef(false);
    const retryCountRef = useRef(0);

    const INACTIVITY_TIMEOUT_MS = 45 * 60 * 1000; // Match backend 45-minute timeout
    const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;
    const SESSION_CHECK_INTERVAL_MS = 10 * 60 * 1000;
    const MAX_RETRIES = 3;
    const lastHeartbeatRef = useRef(0);

    const updateSessionInactiveTime = useCallback(async () => {
      const userId = localStorage.getItem("userId");
      const logId = localStorage.getItem("logId");

      if (!userId || !logId) {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Skipping SessionInactiveTime update: Missing credentials`);
        return false;
      }

      if (isCheckingSessionRef.current) {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Skipping SessionInactiveTime update: Already updating`);
        return false;
      }

      try {
        isCheckingSessionRef.current = true;
        retryCountRef.current = 0;
        const response = await fetch(`${config.apiBaseUrl}/api/update-session-inactive-time`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, logId, inactiveTime: new Date().toISOString() }),
        });
        const data = await response.json();
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] SessionInactiveTime update response:`, data);
        if (!data.success) {
          console.warn(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Failed to update SessionInactiveTime: ${data.message}`);
          return false;
        }
        return true;
      } catch (err) {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Error updating SessionInactiveTime:`, err.message);
        if (retryCountRef.current < MAX_RETRIES) {
          retryCountRef.current += 1;
          console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Retrying update (${retryCountRef.current}/${MAX_RETRIES})`);
          setTimeout(updateSessionInactiveTime, 1000 * retryCountRef.current);
        }
        return false;
      } finally {
        isCheckingSessionRef.current = false;
      }
    }, []);

    const handleSessionTimeout = useCallback(async () => {
      const userId = localStorage.getItem("userId");
      const logId = localStorage.getItem("logId");
      const token = localStorage.getItem("token");

      if (userId && logId && token) {
        try {
          console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Tracking logout due to timeout for UserID: ${userId}, LogID: ${logId}`);
          const response = await fetch(`${config.apiBaseUrl}/api/logout-track`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId, logId, token }),
          });
          const data = await response.json();
          if (!data.success) {
            console.warn(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Failed to track logout: ${data.message}`);
          } else {
            console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Logout tracked successfully for UserID: ${userId}`);
          }
        } catch (err) {
          console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Error calling logout API:`, err.message);
        }
      }

      if (logout) logout();
      setIsSessionExpired(true);
      window.location.reload();
    }, [logout]);

    const resetInactivityTimer = useCallback(() => {
      const now = Date.now();
      globalState.lastActivity = now;

      if (globalState.inactivityTimer) clearTimeout(globalState.inactivityTimer);
      globalState.inactivityTimer = setTimeout(async () => {
        if (Date.now() - globalState.lastActivity >= INACTIVITY_TIMEOUT_MS) {
          console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Inactivity timeout reached, updating SessionInactiveTime and triggering session timeout`);
          await updateSessionInactiveTime();
          handleSessionTimeout();
        }
      }, INACTIVITY_TIMEOUT_MS);

      if (now - lastHeartbeatRef.current >= HEARTBEAT_INTERVAL_MS) {
        lastHeartbeatRef.current = now;
        updateSessionInactiveTime();
      }

      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Inactivity timer reset`);
    }, [updateSessionInactiveTime, handleSessionTimeout]);

    const validateActiveSession = useCallback(async () => {
      const userId = localStorage.getItem("userId");
      const token = localStorage.getItem("token");
      if (!userId || !token || isSessionExpired) {
        return;
      }
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/check-session`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, token }),
        });
        const data = await response.json();
        if (!data.success) {
          console.warn(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Session no longer valid: ${data.message}`);
          handleSessionTimeout();
        }
      } catch (err) {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Session validation error:`, err.message);
        // Do not logout on transient network errors during background checks.
      }
    }, [handleSessionTimeout, isSessionExpired]);

    const handleUserActivity = useCallback(() => {
      if (isSessionExpired || location.pathname === "/login" || document.hidden) {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Skipping user activity: ${isSessionExpired ? "Session expired" : location.pathname === "/login" ? "On login page" : "Browser hidden"}`);
        return;
      }
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] User activity detected, resetting inactivity timer`);
      resetInactivityTimer();
    }, [isSessionExpired, location.pathname, resetInactivityTimer]);

    const handleVisibilityChange = useCallback(() => {
      if (!document.hidden && !isSessionExpired) {
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Browser became visible, checking inactivity`);
        const now = Date.now();
        if (globalState.lastActivity && now - globalState.lastActivity >= INACTIVITY_TIMEOUT_MS) {
          handleSessionTimeout();
        } else {
          resetInactivityTimer();
        }
      }
    }, [isSessionExpired, resetInactivityTimer, handleSessionTimeout]);

    useEffect(() => {
      const isLoggedIn = localStorage.getItem("isLoggedIn") === "true";
      if (!isLoggedIn || location.pathname === "/login") {
        setIsSessionExpired(false);
        clearTimeout(globalState.inactivityTimer);
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Not logged in or on login page, clearing inactivity timer`);
        return;
      }

      resetInactivityTimer();

      window.addEventListener("mousemove", handleUserActivity);
      window.addEventListener("keydown", handleUserActivity);
      window.addEventListener("click", handleUserActivity);
      window.addEventListener("visibilitychange", handleVisibilityChange);

      const handleNavigation = () => {
        if (!isSessionExpired && isLoggedIn && !document.hidden) {
          console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [SessionTimeout] Navigation detected, resetting inactivity timer`);
          resetInactivityTimer();
        }
      };
      window.addEventListener("popstate", handleNavigation);

      const sessionCheckInterval = setInterval(validateActiveSession, SESSION_CHECK_INTERVAL_MS);
      validateActiveSession();

      return () => {
        clearInterval(sessionCheckInterval);
        window.removeEventListener("mousemove", handleUserActivity);
        window.removeEventListener("keydown", handleUserActivity);
        window.removeEventListener("click", handleUserActivity);
        window.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("popstate", handleNavigation);
      };
    }, [handleUserActivity, handleVisibilityChange, resetInactivityTimer, validateActiveSession, isSessionExpired, location.pathname]);

    return (
      <>
        <WrappedComponent {...props} />
        {isSessionExpired && location.pathname !== "/login" && (
          <div className="ui-modal-overlay" style={{ animation: `${fadeIn} 0.3s ease-out` }}>
            <div className="ui-modal session-timeout-modal" style={{ animation: `${slideUp} 0.4s cubic-bezier(0.22, 0.61, 0.36, 1)` }}>
              <div style={styles.iconContainer}>
                <span style={styles.clockIcon}>⏰</span>
                <div style={styles.pulseEffect}></div>
              </div>
              <h3 style={{ margin: "0 0 1rem", fontSize: "1.4rem", fontWeight: 700, color: "var(--text-strong)" }}>
                Session expired
              </h3>
              <p style={{ color: "var(--text-muted)", fontSize: "0.95rem", lineHeight: 1.5, marginBottom: "1.5rem" }}>
                Your session has expired due to inactivity. Please sign in again to continue.
              </p>
              <button type="button" className="auth-submit" onClick={() => navigate("/login", { replace: true })}>
                Return to login
              </button>
            </div>
          </div>
        )}
      </>
    );
  };
};

const styles = {
  iconContainer: {
    position: "relative",
    marginBottom: "1.5rem",
  },
  clockIcon: {
    fontSize: "3.5rem",
    display: "inline-block",
    transform: "rotate(0deg)",
    animation: `${keyframes`
      0% { transform: rotate(0deg); }
      25% { transform: rotate(10deg); }
      50% { transform: rotate(-10deg); }
      75% { transform: rotate(5deg); }
      100% { transform: rotate(0deg); }
    `} 1s ease-in-out infinite`,
  },
  pulseEffect: {
    position: "absolute",
    top: "-10%",
    left: "-10%",
    right: "-10%",
    bottom: "-10%",
    border: "2px solid rgba(255, 59, 48, 0.4)",
    borderRadius: "50%",
    animation: `${keyframes`
      0% { transform: scale(0.8); opacity: 1; }
      100% { transform: scale(1.5); opacity: 0; }
    `} 1.5s ease-out infinite`,
  },
};

export default withSessionTimeout;