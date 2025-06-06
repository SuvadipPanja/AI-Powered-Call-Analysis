/**
 * File: withSessionTimeout.js
 * Purpose: Higher-Order Component (HOC) to manage session timeout across all pages in the application.
 * Compliance: IS Policy Standards (Security, Accessibility, Performance, Maintainability, Code Audit)
 *             Web Page Policy (Responsive Design, User Experience, Security)
 *             ISO 27001 (Information Security Management), ISO 9001 (Quality Management)
 * Author: $Panja
 * Creation Date: 2025-03-14
 * Modified Date: 2025-03-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Description: This HOC monitors user inactivity and triggers a session timeout after 110 minutes.
 *              Upon timeout, it calls the logout API (to track logout time), clears localStorage,
 *              refreshes the session, navigates to the login page, and ensures a new session is initialized.
 *              It prevents cache retention and maintains security standards by avoiding console exposure of sensitive data.
 * Changes:
 *  - Migrated API URL to use environment variable from envConfig.
 *  - Updated envConfig import path after moving utils/ into src/.
 */

/**
 * Import necessary React hooks and dependencies
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { keyframes } from "@emotion/react";
import config from "./utils/envConfig"; // Updated path

/**
 * Define animation keyframes for UI effects
 * @type {Object} fadeIn - Animation for fading in the timeout overlay
 * @type {Object} slideUp - Animation for sliding up the timeout modal
 */
const fadeIn = keyframes`
  from { opacity: 0; }
  to { opacity: 1; }
`;

const slideUp = keyframes`
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
`;

/**
 * withSessionTimeout HOC function
 * @param {React.Component} WrappedComponent - The component to wrap with session timeout functionality
 * @returns {React.Component} - Enhanced component with session timeout behavior
 */
const withSessionTimeout = (WrappedComponent) => {
  /**
   * Inner component function with session timeout logic
   * @param {Object} props - Component props including onLogout callback
   * @returns {React.Element} - Rendered component with timeout overlay
   */
  return (props) => {
    const { onLogout } = props;
    const navigate = useNavigate();
    const [isSessionExpired, setIsSessionExpired] = useState(false);
    let inactivityTimer;

    const resetTimer = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer);
      inactivityTimer = setTimeout(handleSessionTimeout, 50 * 60 * 1000);
    };

    const handleSessionTimeout = async () => {
      const username = localStorage.getItem("username");
      const logId = localStorage.getItem("logId");

      if (username && logId) {
        try {
          const response = await fetch(`${config.apiBaseUrl}/api/logout-track`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, logId }),
          });
          const data = await response.json();
          if (data.success) {
            console.log(`[SessionTimeout] Logout tracked for ${username} (LogID: ${logId})`);
          } else {
            console.warn("[SessionTimeout] Logout tracking failed:", data.message);
          }
        } catch (err) {
          console.error("[SessionTimeout] Error calling logout API:", err.message);
        }
      } else {
        console.warn("[SessionTimeout] Missing username or logId, cannot track logout.");
      }

      localStorage.clear();
      if (onLogout) onLogout();
      setIsSessionExpired(true);
    };

    const handleUserActivity = () => {
      if (isSessionExpired) return;
      resetTimer();
    };

    const handleReload = () => {
      navigate("/");
      window.location.reload();
    };

    useEffect(() => {
      if (!localStorage.getItem("isLoggedIn")) return;

      resetTimer();
      window.addEventListener("mousemove", handleUserActivity);
      window.addEventListener("keydown", handleUserActivity);

      return () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        window.removeEventListener("mousemove", handleUserActivity);
        window.removeEventListener("keydown", handleUserActivity);
      };
    }, [isSessionExpired]);

    return (
      <>
        <WrappedComponent {...props} />
        {isSessionExpired && (
          <div style={styles.overlay}>
            <div style={styles.modal}>
              <div style={styles.iconContainer}>
                <span style={styles.clockIcon}>⏰</span>
                <div style={styles.pulseEffect}></div>
              </div>
              <h3 style={styles.title}>Session Timeout!</h3>
              <p style={styles.message}>
                Your session has expired due to inactivity.<br />
                Please log in again to continue.
              </p>
              <button onClick={handleReload} style={styles.button}>
                🚀 Return to Login
              </button>
            </div>
          </div>
        )}
      </>
    );
  };
};

const styles = {
  overlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    animation: `${fadeIn} 0.3s ease-out`,
  },
  modal: {
    backgroundColor: "#fff",
    padding: "2rem",
    borderRadius: "20px",
    boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
    textAlign: "center",
    maxWidth: "400px",
    width: "90%",
    animation: `${slideUp} 0.4s cubic-bezier(0.22, 0.61, 0.36, 1)`,
    background: "linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)",
  },
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
  title: {
    color: "#2d3436",
    fontSize: "1.8rem",
    marginBottom: "1rem",
    fontWeight: "700",
  },
  message: {
    color: "#636e72",
    fontSize: "1rem",
    lineHeight: "1.5",
    marginBottom: "2rem",
  },
  button: {
    backgroundColor: "#0984e3",
    color: "white",
    border: "none",
    padding: "12px 30px",
    borderRadius: "25px",
    fontSize: "1rem",
    fontWeight: "600",
    cursor: "pointer",
    transition: "all 0.3s ease",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: "0 auto",
    "&:hover": {
      backgroundColor: "#74b9ff",
      transform: "translateY(-2px)",
      boxShadow: "0 5px 15px rgba(9, 132, 227, 0.4)",
    },
  },
};

export default withSessionTimeout;