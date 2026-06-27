import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import config from "../utils/envConfig";
import { useWebSocket } from "../context/WebSocketContext";
import { FaEye, FaEyeSlash } from "react-icons/fa";
import AuthLayout from "./layout/AuthLayout";
import { getAppFooter } from "../utils/appMeta";
import { useAppBranding } from "../utils/appBranding";

/************************************************
 * ComplexCaptcha Component
 * - Generates a random 5-character string with letters, numbers, and special chars
 * - Compares user input for verification
 ************************************************/
const ComplexCaptcha = ({ onChange }) => {
  const [captchaText, setCaptchaText] = useState("");
  const [userInput, setUserInput] = useState("");

  const generateCaptcha = () => {
    const chars = "ABCDEFGHIJKLMNOPRSTUVWXYZabcdefghijklmnoprstuvwxyz0123456789!@#$%^&*";
    let result = "";
    for (let i = 0; i < 5; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaText(result);
    onChange(false);
    setUserInput("");
  };

  useEffect(() => {
    generateCaptcha();
  }, []);

  const handleChange = (val) => {
    setUserInput(val);
    onChange(val === captchaText);
  };

  return (
    <div className="auth-captcha-row">
      <div className="auth-captcha-box" aria-label={`CAPTCHA code: ${captchaText}`}>{captchaText}</div>
      <input
        type="text"
        placeholder="Enter CAPTCHA"
        value={userInput}
        onChange={(e) => handleChange(e.target.value)}
        required
        style={{ flex: 1, minWidth: 0 }}
        aria-required="true"
      />
      <button type="button" onClick={generateCaptcha} className="auth-captcha-btn" aria-label="Refresh CAPTCHA">
        ↻
      </button>
    </div>
  );
};

const TempSuperAdminLogin = ({ onLogin }) => {
  const { appName } = useAppBranding();
  const footerText = getAppFooter(appName);

  /*************************************************
   * (2) Clear Local Storage on Page Load
   *************************************************/
  useEffect(() => {
    localStorage.clear();
    console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Local storage cleared`);
  }, []);

  /*************************************************
   * (3) Session Timeout (15 minutes)
   *************************************************/
  const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
  const inactivityRef = useRef(null);
  const navigate = useNavigate();
  const { connectWebSocket } = useWebSocket();

  const startSessionTimer = () => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      alert("Session expired due to inactivity. Redirecting to license-error...");
      localStorage.clear();
      navigate("/license-error");
    }, SESSION_TIMEOUT_MS);
  };

  useEffect(() => {
    startSessionTimer();
    const resetEvents = ["click", "keydown", "mousemove", "scroll"];
    const resetTimer = () => startSessionTimer();
    resetEvents.forEach((evt) => window.addEventListener(evt, resetTimer));

    return () => {
      clearTimeout(inactivityRef.current);
      resetEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, []);

  /*************************************************
   * (4) State Variables
   *************************************************/
  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [captchaValid, setCaptchaValid] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false); // Added missing state

  /*************************************************
   * (5) Logging Utility
   *************************************************/
  const logAttempt = (message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Author: $Panja - ${message}`);
  };

  /*************************************************
   * (6) Submit Handler
   *************************************************/
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!userId || !password) {
      setError("Please enter both UserID and password.");
      logAttempt("Failed: Missing credentials");
      return;
    }
    if (!questionType || !questionAnswer) {
      setError("Please select a security question and provide an answer.");
      logAttempt("Failed: Missing security question");
      return;
    }
    if (!captchaValid) {
      setError("Invalid CAPTCHA. Please try again.");
      logAttempt("Failed: Invalid CAPTCHA");
      return;
    }

    const pwdRegex = /^(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
    if (!pwdRegex.test(password)) {
      setError("Password must have at least 8 chars & 1 special character.");
      logAttempt("Failed: Password policy not met");
      return;
    }

    try {
      logAttempt("Temporary Super Admin login attempt initiated");
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Sending request to: ${config.apiBaseUrl}/api/temp-super-admin-login`);
      const response = await fetch(`${config.apiBaseUrl}/api/temp-super-admin-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId.trim(),
          password: password.trim(),
          questionType: questionType.trim(),
          questionAnswer: questionAnswer.trim(),
        }),
      });
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Response received:`, response);
      const data = await response.json();
      console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Response data:`, data);

      if (data.success) {
        if (data.userType !== "Super Admin") {
          setError("Only Super Admins can access this page.");
          logAttempt("Failed: User is not a Super Admin");
          return;
        }
        // Store session token and logId in localStorage
        localStorage.setItem("sessionToken", data.sessionToken);
        localStorage.setItem("logId", data.logId);
        localStorage.setItem("isLoggedIn", "true");
        localStorage.setItem("userId", userId);
        localStorage.setItem("username", data.username);
        localStorage.setItem("userType", data.userType);
        localStorage.setItem("token", data.sessionToken);
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Stored sessionToken: ${data.sessionToken}`);
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Stored logId: ${data.logId}`);

        // Call onLogin to set temporary login state
        await onLogin(data.username, data.userType, data.logId);
        // Establish WebSocket connection after successful login
        await connectWebSocket(userId, data.username, data.userType, String(data.logId));
        setError("");
        logAttempt("Temporary Super Admin login successful");
        // Navigate with session token in URL (mimicking old behavior)
        navigate(`/admin-settings?tab=license`);
      } else {
        setError(data.message || "Login failed. Check your credentials.");
        logAttempt(`Failed: ${data.message || "Unknown error"}`);
      }
    } catch (err) {
      console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [TempSuperAdminLogin] Full error:`, err);
      setError("Failed to connect to the server: " + err.message);
      logAttempt(`Failed: ${err.message || "Server error"}`);
    }
  };

  const handleKeyDown = (e, action) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  };

  /*************************************************
   * (7) Render
   *************************************************/
  return (
    <AuthLayout
      title="Super Admin Login"
      subtitle="Emergency access to upload a new license"
      footer={footerText}
    >
      <form onSubmit={handleSubmit} noValidate aria-label="Super Admin Emergency Login Form">
        <div className="auth-field">
          <label htmlFor="userId">User ID</label>
          <input
            id="userId"
            type="text"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            required
            placeholder="e.g. SUPER001"
            autoComplete="username"
            onKeyDown={(e) => handleKeyDown(e, handleSubmit)}
          />
        </div>

        <div className="auth-field">
          <label htmlFor="password">Password</label>
          <div className="auth-password-wrap">
            <input
              id="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="Enter password"
              autoComplete="current-password"
              style={{ paddingRight: "2.5rem" }}
              onKeyDown={(e) => handleKeyDown(e, handleSubmit)}
            />
            <button
              type="button"
              className="auth-password-toggle"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <FaEyeSlash /> : <FaEye />}
            </button>
          </div>
        </div>

        <div className="auth-field">
          <label htmlFor="questionType">Security question</label>
          <select
            id="questionType"
            value={questionType}
            onChange={(e) => setQuestionType(e.target.value)}
            required
            onKeyDown={(e) => handleKeyDown(e, handleSubmit)}
          >
            <option value="" disabled>-- Select a question --</option>
            <option value="Favorite game">Favorite game</option>
            <option value="Mother's maiden name">Mother's maiden name</option>
            <option value="First pet's name">First pet's name</option>
            <option value="Favorite color">Favorite color</option>
            <option value="City where you were born">City where you were born</option>
          </select>
        </div>

        <div className="auth-field">
          <label htmlFor="questionAnswer">Answer</label>
          <input
            id="questionAnswer"
            type="text"
            value={questionAnswer}
            onChange={(e) => setQuestionAnswer(e.target.value)}
            required
            placeholder="Your answer"
            autoComplete="off"
            onKeyDown={(e) => handleKeyDown(e, handleSubmit)}
          />
        </div>

        <div className="auth-field">
          <label>Captcha</label>
          <ComplexCaptcha onChange={setCaptchaValid} />
        </div>

        {error && (
          <div className="auth-alert auth-alert--error" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="auth-submit">
          Sign in
        </button>

        <button
          type="button"
          className="auth-submit auth-submit--secondary"
          onClick={() => navigate("/license-error")}
          aria-label="Go back to license error screen"
        >
          Back
        </button>
      </form>
    </AuthLayout>
  );
};

export default TempSuperAdminLogin;