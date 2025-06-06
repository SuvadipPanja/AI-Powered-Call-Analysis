import { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import config from "../utils/envConfig";
import { useWebSocket } from "../context/WebSocketContext";

/************************************************
 * ComplexCaptcha Component
 * - Generates a random string of uppercase, lowercase,
 *   digits, and special chars (non-selectable)
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
    <div style={{ marginBottom: "8px" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "6px",
          userSelect: "none",
          MozUserSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        <span
          style={{
            fontSize: "12px",
            fontWeight: "bold",
            color: "#333",
            background: "#f0f0f0",
            padding: "4px",
            borderRadius: "4px",
          }}
        >
          {captchaText}
        </span>
        <button
          type="button"
          onClick={generateCaptcha}
          style={{
            background: "#667eea",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            padding: "2px 6px",
            cursor: "pointer",
            transition: "background 0.3s ease",
            fontSize: "10px",
          }}
          onMouseOver={(e) => (e.target.style.background = "#5a6fd1")}
          onMouseOut={(e) => (e.target.style.background = "#667eea")}
        >
          ↻
        </button>
      </div>
      <input
        type="text"
        placeholder="Enter CAPTCHA"
        value={userInput}
        onChange={(e) => handleChange(e.target.value)}
        required
        style={{
          width: "100%",
          padding: "6px",
          border: "1px solid #ccc",
          borderRadius: "4px",
          fontSize: "12px",
        }}
        onFocus={(e) => (e.target.style.borderColor = "#667eea")}
        onBlur={(e) => (e.target.style.borderColor = "#ccc")}
      />
    </div>
  );
};

const TempSuperAdminLogin = ({ onLogin }) => {
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
   * (2) Clear Local Storage on Page Load
   *************************************************/
  useEffect(() => {
    localStorage.clear();
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
      alert("Session expired due to inactivity. Redirecting to login...");
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
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [questionType, setQuestionType] = useState("");
  const [questionAnswer, setQuestionAnswer] = useState("");
  const [captchaValid, setCaptchaValid] = useState(false);
  const [error, setError] = useState("");

  /*************************************************
   * (5) Logging Utility
   *     Only expose author name in console
   *************************************************/
  const logAttempt = (message) => {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] Author: $Panja - ${message}`;
    console.log(logMessage);
  };

  /*************************************************
   * (6) Submit Handler
   *************************************************/
  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!username || !password) {
      setError('Please enter both username and password.');
      logAttempt("Failed: Missing credentials");
      return;
    }
    if (!questionType || !questionAnswer) {
      setError('Please select a security question and provide an answer.');
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
      setError('Password must have at least 8 chars & 1 special character.');
      logAttempt("Failed: Password policy not met");
      return;
    }

    try {
      logAttempt("Temporary Super Admin login attempt initiated");
      const response = await fetch(`${config.apiBaseUrl}/api/temp-super-admin-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          questionType,
          questionAnswer,
        }),
      });
      const data = await response.json();
      console.log("API Response:", data);

      if (data.success) {
        if (data.userType !== 'Super Admin') {
          setError('Only Super Admins can access this page.');
          logAttempt("Failed: User is not a Super Admin");
          return;
        }
        // Store session token and logId in local storage
        localStorage.setItem("sessionToken", data.sessionToken);
        localStorage.setItem("logId", data.logId);
        console.log("Stored sessionToken:", localStorage.getItem("sessionToken"));
        console.log("Stored logId:", localStorage.getItem("logId"));
        // Call onLogin to set temporary login state
        await onLogin(username, data.userType, data.logId);
        // Establish WebSocket connection after successful login
        connectWebSocket(username, data.userType, data.logId);
        setError("");
        logAttempt("Temporary Super Admin login successful");
        // Navigate with session token in URL
        navigate(`/license-management?session=${data.sessionToken}`);
      } else {
        setError(data.message || 'Login failed. Check your credentials.');
        logAttempt(`Failed: ${data.message || "Unknown error"}`);
      }
    } catch (err) {
      setError('Failed to connect to the server: ' + err.message);
      logAttempt(`Failed: ${err.message || "Server error"}`);
    }
  };

  /*************************************************
   * (7) Render
   *************************************************/
  return (
    <div
      style={{
        backgroundImage: `url(${config.loginBackgroundUrl})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        height: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        fontFamily: "'Poppins', sans-serif",
      }}
    >
      <div
        style={{
          background: "rgba(255, 255, 255, 0.95)",
          padding: "15px",
          borderRadius: "10px",
          boxShadow: "0px 5px 15px rgba(0, 0, 0, 0.2)",
          textAlign: "center",
          width: "300px",
        }}
      >
        <h2
          style={{
            marginBottom: "10px",
            fontSize: "20px",
            fontWeight: 600,
            color: "#333",
          }}
        >
          Super Admin Login
        </h2>
        <p style={{ fontSize: '12px', color: '#555', marginBottom: '15px' }}>
          Please log in to upload a new license.
        </p>
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: "10px", textAlign: "left" }}>
            <label style={{ display: "block", fontSize: "12px", color: "#555", marginBottom: "3px" }}>
              Username:
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#667eea")}
              onBlur={(e) => (e.target.style.borderColor = "#ccc")}
            />
          </div>

          <div style={{ marginBottom: "10px", textAlign: "left" }}>
            <label style={{ display: "block", fontSize: "12px", color: "#555", marginBottom: "3px" }}>
              Password:
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#667eea")}
              onBlur={(e) => (e.target.style.borderColor = "#ccc")}
            />
          </div>

          <div style={{ marginBottom: "10px", textAlign: "left" }}>
            <label style={{ display: "block", fontSize: "12px", color: "#555", marginBottom: "3px" }}>
              Security Question Type:
            </label>
            <select
              value={questionType}
              onChange={(e) => setQuestionType(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#667eea")}
              onBlur={(e) => (e.target.style.borderColor = "#ccc")}
            >
              <option value="">-- Select a Question --</option>
              <option value="Favorite game">Favorite game</option>
              <option value="Mother's maiden name">Mother's maiden name</option>
              <option value="First pet's name">First pet's name</option>
              <option value="Favorite color">Favorite color</option>
              <option value="Birth city">City where you were born</option>
            </select>
          </div>

          <div style={{ marginBottom: "10px", textAlign: "left" }}>
            <label style={{ display: "block", fontSize: "12px", color: "#555", marginBottom: "3px" }}>
              Answer:
            </label>
            <input
              type="text"
              value={questionAnswer}
              onChange={(e) => setQuestionAnswer(e.target.value)}
              required
              style={{
                width: "100%",
                padding: "8px",
                border: "1px solid #ccc",
                borderRadius: "4px",
                fontSize: "12px",
              }}
              onFocus={(e) => (e.target.style.borderColor = "#667eea")}
              onBlur={(e) => (e.target.style.borderColor = "#ccc")}
            />
          </div>

          <div style={{ marginBottom: "10px", textAlign: "left" }}>
            <label style={{ display: "block", fontSize: "12px", color: "#555", marginBottom: "3px" }}>
              Complex CAPTCHA:
            </label>
            <ComplexCaptcha onChange={setCaptchaValid} />
          </div>

          {error && (
            <p style={{ color: "#ff4d4d", fontSize: "12px", marginTop: "8px" }}>{error}</p>
          )}

          <button
            type="submit"
            style={{
              width: "100%",
              padding: "8px",
              background: "#667eea",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              fontSize: "14px",
              fontWeight: 600,
              cursor: "pointer",
              marginBottom: "8px",
              transition: "background 0.3s ease",
            }}
            onMouseOver={(e) => (e.target.style.background = "#5a6fd1")}
            onMouseOut={(e) => (e.target.style.background = "#667eea")}
          >
            Login
          </button>
        </form>
      </div>

      <footer
        style={{
          position: "absolute",
          bottom: 0,
          width: "100%",
          textAlign: "center",
          fontSize: "12px",
          color: "#fff",
          background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
          padding: "8px 0",
        }}
      >
        © 2025 AI Call Analysis | Version - 1.9 | Developed by{" "}
        <span style={{ fontWeight: "bold", color: "#ffd700" }}>Suvadip & Pankaj</span>
      </footer>
    </div>
  );
};

export default TempSuperAdminLogin;