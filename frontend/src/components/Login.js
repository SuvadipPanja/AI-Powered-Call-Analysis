import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  FaUser,
  FaLock,
  FaShieldAlt,
  FaKey,
  FaEye,
  FaEyeSlash,
  FaSyncAlt,
  FaSpinner,
  FaArrowRight,
  FaExclamationCircle,
} from "react-icons/fa";
import { useWebSocket } from "../context/WebSocketContext";
import config from "../utils/envConfig";
import AuthLayout from "./layout/AuthLayout";
import { getAppFooter } from "../utils/appMeta";
import { clearAuthStorage } from "../utils/uiPreferences";
import { useAppBranding, useDocumentTitle } from "../utils/appBranding";

// Password input with leading lock icon + eye toggle
function PasswordInput({ value, onChange, ...rest }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="auth-input-wrap">
      <span className="auth-input-icon"><FaLock /></span>
      <input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        className="auth-input-has-icon auth-password-input"
        {...rest}
      />
      <button
        type="button"
        className="auth-password-toggle"
        onClick={() => setVisible((v) => !v)}
        tabIndex={0}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <FaEyeSlash /> : <FaEye />}
      </button>
    </div>
  );
}

// ComplexCaptcha unchanged, but more compact
const ComplexCaptcha = ({ onChange }) => {
  const [captchaText, setCaptchaText] = useState("");
  const [userInput, setUserInput] = useState("");
  const [shakeKey, setShakeKey] = useState(0);
  const generateCaptcha = useCallback(() => {
    const chars = "ABCDEFGHIJKLMNOPRSTUVWXYZabcdefghijklmnoprstuvwxyz0123456789!@#$%^&*";
    let result = "";
    for (let i = 0; i < 2; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setCaptchaText(result);
    setShakeKey((k) => k + 1);
    onChange(false);
    setUserInput("");
  }, [onChange]);
  useEffect(() => { generateCaptcha(); }, [generateCaptcha]);
  const handleChange = (val) => {
    setUserInput(val);
    onChange(val === captchaText);
  };
  return (
    <div className="auth-captcha-row">
      <div key={shakeKey} className="auth-captcha-box auth-captcha-shake" aria-label={`CAPTCHA code: ${captchaText}`}>{captchaText}</div>
      <input
        type="text"
        placeholder="Enter CAPTCHA"
        value={userInput}
        onChange={(e) => handleChange(e.target.value)}
        maxLength={2}
        required
        aria-required="true"
      />
      <button
        type="button"
        onClick={generateCaptcha}
        className="auth-captcha-btn"
        aria-label="Refresh CAPTCHA"
      ><FaSyncAlt /></button>
    </div>
  );
};

export default function Login({ onLogin }) {
  const signature = "$Panja";
  if (signature !== "$Panja") throw new Error("Signature mismatch – code integrity compromised.");
  const navigate = useNavigate();
  const { connectWebSocket } = useWebSocket();
  const { appName } = useAppBranding();
  useDocumentTitle("Login", appName);
  const footerText = getAppFooter(appName);
  const SESSION_TIMEOUT_MS = 15 * 60 * 1000;
  const inactivityRef = useRef(null);

  /* Login follows the platform theme (light by default). */
  useEffect(() => {
    try {
      const stored = localStorage.getItem("app-theme");
      document.documentElement.setAttribute("data-theme", stored === "dark" ? "dark" : "light");
    } catch {
      document.documentElement.setAttribute("data-theme", "light");
    }
    import("../theme/chartTheme")
      .then((m) => m.refreshChartTheme?.())
      .catch(() => {});
  }, []);

  const startSessionTimer = useCallback(() => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      alert("Session expired due to inactivity. Redirecting to login...");
      clearAuthStorage();
      navigate("/");
    }, SESSION_TIMEOUT_MS);
  }, [navigate]);
  useEffect(() => {
    const hadSession = localStorage.getItem("isLoggedIn") === "true";
    if (!hadSession) {
      clearAuthStorage();
    }
    startSessionTimer();
    const resetEvents = ["click", "keydown", "mousemove", "scroll"];
    const resetTimer = () => startSessionTimer();
    resetEvents.forEach((evt) => window.addEventListener(evt, resetTimer));
    return () => {
      clearTimeout(inactivityRef.current);
      resetEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [startSessionTimer]);

  const [userId, setUserId] = useState("");
  const [password, setPassword] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [captchaValid, setCaptchaValid] = useState(false);
  const [error, setError] = useState("");
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const fetchLicenseStatus = async () => {
      try {
        const response = await fetch(`${config.apiBaseUrl}/api/license-status`);
        const result = await response.json();
        if (result.success) {
          setLicenseStatus({
            isExpired: result.isExpired,
            daysUntilExpiration: result.daysUntilExpiration,
            endDate: result.endDate,
          });
        } else {
          setLicenseStatus({ isExpired: true, daysUntilExpiration: 0 });
        }
      } catch (err) {
        setLicenseStatus({ isExpired: true, daysUntilExpiration: 0 });
      }
    };
    fetchLicenseStatus();
  }, []);

  const logAttempt = useCallback((msg) => {
    const ts = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    console.log(`[${ts}] Author: $Panja – ${msg}`);
  }, []);

  const checkLoginAvailability = async () => {
    try {
      const response = await fetch(`${config.apiBaseUrl}/api/check-login-availability`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const result = await response.json();
      if (!result.success) {
        setError(result.message);
        logAttempt(`Login blocked: ${result.message}`);
        return false;
      }
      return true;
    } catch (err) {
      setError("Failed to check login availability. Please try again.");
      logAttempt("Failed to check login availability");
      return false;
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    // Check login availability first
    const isLoginAllowed = await checkLoginAvailability();
    if (!isLoginAllowed) {
      setIsLoading(false);
      return;
    }

    // Existing validation
    if (!userId || !password) {
      setError("Please enter both UserID and password.");
      setIsLoading(false);
      logAttempt("Failed: Missing credentials");
      return;
    }
    if (!questionType || !questionAnswer) {
      setError("Please select a security question and answer.");
      setIsLoading(false);
      logAttempt("Failed: Missing security question");
      return;
    }
    if (!captchaValid) {
      setError("Invalid CAPTCHA. Please try again.");
      setIsLoading(false);
      logAttempt("Failed: Invalid CAPTCHA");
      return;
    }
    const trimmedUserId = userId.trim();
    const isNumericId = /^\d+$/.test(trimmedUserId);
    const isUsername = /^[a-zA-Z][a-zA-Z0-9._-]{2,49}$/.test(trimmedUserId);
    const isAliasCode = /^[a-zA-Z]{1,10}[0-9]{1,10}$/.test(trimmedUserId);
    if (!isNumericId && !isUsername && !isAliasCode) {
      setError("Enter numeric UserID (e.g. 9), username (e.g. admin), or login code (e.g. SUPER001).");
      setIsLoading(false);
      logAttempt("Failed: Invalid UserID format");
      return;
    }
    const pwdRegex = /^(?=.*[!@#$%^&*])[A-Za-z\d!@#$%^&*]{8,}$/;
    if (!pwdRegex.test(password)) {
      setError("Password must be ≥8 chars & include a special character.");
      setIsLoading(false);
      logAttempt("Failed: Password policy not met");
      return;
    }

    try {
      logAttempt("Login attempt initiated");
      const res = await onLogin(userId, password, questionType, questionAnswer);
      const { username, userType, logId, token } = res;
      if (!username || !userType || !logId || !token) throw new Error("Incomplete login response – missing fields");
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("userId", userId);
      localStorage.setItem("logId", String(logId));
      localStorage.setItem("token", token);

      try {
        await connectWebSocket(userId, userType, String(logId));
        console.log(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [Login] WebSocket connected`);
      } catch (wsError) {
        console.error(`[${new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}] [Login] WebSocket connection failed:`, wsError.message);
      }
      logAttempt("Login successful");
      setError("");
      navigate("/");
    } catch (err) {
      setError(err.message || "Failed to connect to the server");
      logAttempt(`Failed: ${err.message || "Server error"}`);
    } finally {
      setIsLoading(false);
    }
  };

  // UI
  return (
    <AuthLayout
      title="Secure Login"
      footer={footerText}
      showTopBar={false}
    >
      {licenseStatus &&
        (licenseStatus.isExpired || licenseStatus.daysUntilExpiration <= 7) && (
          <div className="license-warning-banner" role="alert">
            {licenseStatus.isExpired
              ? "License expired — contact your administrator."
              : `License expires in ${licenseStatus.daysUntilExpiration} day(s).`}
          </div>
        )}
      <form onSubmit={handleSubmit} noValidate className="auth-form-compact">
        <div className="auth-field auth-field--tight">
          <label htmlFor="userId">User ID</label>
          <div className="auth-input-wrap">
            <span className="auth-input-icon"><FaUser /></span>
            <input
              id="userId"
              name="userId"
              className="auth-input-has-icon"
              placeholder="User ID or username"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              required
              autoComplete="username"
              disabled={isLoading}
            />
          </div>
        </div>
        <div className="auth-field auth-field--tight">
          <label htmlFor="password">Password</label>
          <PasswordInput
            id="password"
            name="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            autoComplete="current-password"
            required
            disabled={isLoading}
          />
        </div>
        <div className="auth-field-row">
          <div className="auth-field">
            <label htmlFor="questionType">Security Q.</label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><FaShieldAlt /></span>
              <select
                id="questionType"
                name="questionType"
                className="auth-input-has-icon"
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value)}
                required
                disabled={isLoading}
              >
                <option value="" disabled>-- Select --</option>
                <option value="Favorite game">Favorite game</option>
                <option value="Mother's maiden name">Mother's maiden name</option>
                <option value="First pet's name">First pet's name</option>
                <option value="Favorite color">Favorite color</option>
                <option value="Where you were born">Where you were born</option>
              </select>
            </div>
          </div>
          <div className="auth-field">
            <label htmlFor="questionAnswer">Answer</label>
            <div className="auth-input-wrap">
              <span className="auth-input-icon"><FaKey /></span>
              <input
                id="questionAnswer"
                name="questionAnswer"
                className="auth-input-has-icon"
                placeholder="Answer"
                value={questionAnswer}
                onChange={(e) => setQuestionAnswer(e.target.value)}
                required
                disabled={isLoading}
              />
            </div>
          </div>
        </div>
        <div className="auth-field auth-field--tight">
          <label>Captcha</label>
          <ComplexCaptcha onChange={setCaptchaValid} />
        </div>
        {error && (
          <p className="auth-alert auth-alert--error" role="alert">
            <FaExclamationCircle style={{ marginRight: 6, flexShrink: 0 }} />
            {error}
          </p>
        )}
        <button type="submit" className="auth-submit" disabled={isLoading}>
          {isLoading ? (
            <><FaSpinner className="auth-submit__spin" /> Signing in…</>
          ) : (
            <>Sign in <FaArrowRight className="auth-submit__arrow" /></>
          )}
        </button>
        <Link to="/forgot-password" className="auth-link">Forgot password?</Link>
      </form>
    </AuthLayout>
  );
}