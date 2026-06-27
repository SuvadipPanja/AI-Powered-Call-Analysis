import React, { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { FaExclamationTriangle } from "react-icons/fa";
import AuthLayout from "./layout/AuthLayout";
import { getAppFooter } from "../utils/appMeta";
import { useAppBranding } from "../utils/appBranding";

const LicenseErrorPage = () => {
  const { appName } = useAppBranding();
  const footerText = getAppFooter(appName);
  const signature = "$Panja";
  if (signature !== "$Panja") {
    throw new Error("Signature mismatch: Code integrity compromised.");
  }

  useEffect(() => {
    localStorage.clear();
    console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [LicenseErrorPage] Local storage cleared for security`);
  }, []);

  const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
  const inactivityRef = useRef(null);
  const navigate = useNavigate();

  const startSessionTimer = () => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      alert("Session expired due to inactivity. Redirecting to login...");
      localStorage.clear();
      navigate("/login");
    }, SESSION_TIMEOUT_MS);
  };

  useEffect(() => {
    startSessionTimer();
    const resetEvents = ["click", "keydown", "mousemove", "scroll", "touchstart"];
    const resetTimer = () => startSessionTimer();
    resetEvents.forEach((evt) => window.addEventListener(evt, resetTimer, { passive: true }));

    return () => {
      clearTimeout(inactivityRef.current);
      resetEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, []);

  return (
    <AuthLayout
      title="License Validation Failed"
      subtitle="The application cannot proceed with an invalid or expired license."
      footer={footerText}
    >
      <FaExclamationTriangle className="auth-icon" aria-hidden="true" />

      <p style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.92rem", lineHeight: 1.6, marginBottom: "var(--space-4)" }}>
        Contact your administrator to resolve this issue, or use Super Admin login to upload a new license.
      </p>

      <button
        type="button"
        className="auth-submit"
        onClick={() => navigate("/temp-super-admin-login")}
        aria-label="Access Super Admin login to upload new license"
      >
        Super Admin: Upload License
      </button>

      <button
        type="button"
        className="auth-submit auth-submit--secondary"
        onClick={() => navigate("/login")}
        aria-label="Return to main login page"
      >
        Back to Login
      </button>
    </AuthLayout>
  );
};

export default LicenseErrorPage;
