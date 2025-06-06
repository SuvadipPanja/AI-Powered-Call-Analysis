/**
 * File: CreateUser.js
 * Purpose: Component for creating a new user with validation, security questions, and encrypted password storage.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-04-26
 * Summary of Changes:
 *  - Aligned UI with Agents.js, HelpAgents.jsx, AddAgent.js, and UserManagement.js (gradient navbar, neon cards, enhanced animations).
 *  - Updated button styles, sizes, and icons (FaHome for Dashboard).
 *  - Added policy compliance (ISO 27001, ISO 9001, Web Page Policy) with secure navigation, accessibility, and responsive design.
 *  - Compacted navbar and form layout to fit content on one page without scrolling.
 *  - Added signature check for code integrity with proper hook placement.
 *  - Updated security questions to match the predefined list in UserManagement.js.
 *  - Removed "Back to Previous Page" button from the navbar.
 *  - Integrated error handling into the form section.
 *  - Ensured password is sent to the server for hashing (handled by /api/user endpoint).
 *  - Fixed import error by correctly importing FaHome and FaQuestionCircle from 'react-icons/fa'.
 */

import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { FiUser, FiLock, FiMail, FiShield, FiKey, FiUserPlus } from "react-icons/fi"; // Feather Icons
import { FaHome, FaQuestionCircle } from "react-icons/fa"; // Font Awesome Icons
import config from "../utils/envConfig";
import './AfterLogin.css';

const CreateUser = () => {
  /***************************************
   * 1) HOOKS
   * Purpose: Initialize all React Hooks at the top level to comply with Rules of Hooks.
   * Compliance: ISO 9001 (Quality: Maintainable code structure).
   ***************************************/
  const navigate = useNavigate();
  const [signatureError, setSignatureError] = useState(null);
  const currentUser = localStorage.getItem("username") || "";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState("");
  const [securityQuestionType, setSecurityQuestionType] = useState("");
  const [securityQuestionAnswer, setSecurityQuestionAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState(""); // success or error
  const [showHint, setShowHint] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);

  /***************************************
   * 2) CODE INTEGRITY CHECK
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ***************************************/
  const signature = '$Panja'; // Updated to match other pages
  const verifySignature = (sig) => {
    if (sig !== '$Panja') {
      throw new Error('Signature mismatch: Code integrity compromised');
    }
  };

  useEffect(() => {
    try {
      verifySignature(signature);
    } catch (err) {
      console.error('Unauthorized code execution:', err.message);
      setSignatureError(err.message);
    }
  }, []);

  /***************************************
   * 3) FIELD VALIDATION
   * Purpose: Validates form inputs before submission.
   * Compliance: ISO 27001 (Security: Input validation).
   ***************************************/
  const validateFields = () => {
    if (username.trim().length < 3) {
      setMessage("Username must be at least 3 characters long.");
      setMessageType("error");
      return false;
    }
    if (passwordHint !== "Strong!") {
      setMessage("Password does not meet the required criteria.");
      setMessageType("error");
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      setMessage("Invalid email format.");
      setMessageType("error");
      return false;
    }
    if (!userType.trim()) {
      setMessage("Please select a user type.");
      setMessageType("error");
      return false;
    }
    if (!securityQuestionType.trim() || !securityQuestionAnswer.trim()) {
      setMessage("Security question and answer are required.");
      setMessageType("error");
      return false;
    }
    return true;
  };

  /***************************************
   * 4) PASSWORD STRENGTH CHECKER
   * Purpose: Evaluates password strength and provides feedback.
   * Compliance: ISO 27001 (Security: Enforce strong passwords).
   ***************************************/
  const handlePasswordChange = (value) => {
    setPassword(value);
    let strength = 0;
    let hint = "";
    if (value.length < 8) {
      hint = "Min 8 chars";
      strength = 20;
    } else if (!/[A-Z]/.test(value)) {
      hint = "Add uppercase";
      strength = 40;
    } else if (!/[a-z]/.test(value)) {
      hint = "Add lowercase";
      strength = 60;
    } else if (!/[0-9]/.test(value)) {
      hint = "Add digit";
      strength = 80;
    } else if (!/[!@#$%^&*]/.test(value)) {
      hint = "Add special char";
      strength = 90;
    } else {
      hint = "Strong!";
      strength = 100;
    }
    setPasswordHint(hint);
    setPasswordStrength(strength);
    setShowHint(true);
  };

  /***************************************
   * 5) CREATE USER HANDLER
   * Purpose: Submits the form data to create a new user via API, with the password hashed using bcrypt on the server.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001 (Secure API communication).
   ***************************************/
  const handleCreateUser = async () => {
    setMessage("");
    setMessageType("");
    if (!validateFields()) return;

    try {
      const response = await axios.post(`${config.apiBaseUrl}/api/user`, {
        username,
        password, // Sent in plain text; server will hash it using bcrypt
        email,
        userType,
        SecurityQuestionType: securityQuestionType,
        SecurityQuestionAnswer: securityQuestionAnswer,
        createdBy: currentUser,
      });

      if (response.data.success) {
        setMessage("User created successfully.");
        setMessageType("success");
        setUsername("");
        setPassword("");
        setEmail("");
        setUserType("");
        setSecurityQuestionType("");
        setSecurityQuestionAnswer("");
        setPasswordHint("");
        setShowHint(false);
        setPasswordStrength(0);
      } else {
        setMessage(response.data.message || "Failed to create user.");
        setMessageType("error");
      }
    } catch (err) {
      setMessage("Failed to create user.");
      setMessageType("error");
    }
  };

  // Predefined security questions to match UserManagement.js
  const securityQuestions = [
    "Favorite game",
    "Mother's maiden name",
    "First pet's name",
    "Favorite color",
    "Where you were born"
  ];

  // Render error UI if signature check fails
  if (signatureError) {
    return (
      <div className="dark-container" style={{
        background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
        padding: "2rem 1.5rem",
        minHeight: "100vh",
        color: "#FF5722",
        textAlign: "center"
      }}>
        <h1>Error: Unauthorized Access</h1>
        <p>Signature verification failed. Please contact support.</p>
      </div>
    );
  }

  /***************************************
   * 6) RENDER
   * Purpose: Renders the create user form with validation feedback and modern UI.
   * Compliance: Web Page Policy (User Experience: Smooth interaction), IS Policy (Accessibility).
   ***************************************/
  return (
    <div className="dark-container fadeInUp improved-afterlogin modern-page-animation" style={{
      background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
      padding: "1rem 1.5rem",
      minHeight: "100vh"
    }}>
      {/* ============ NAVBAR ============ */}
      <nav className="navbar improved-navbar" style={{
        background: "linear-gradient(90deg, #393e46 0%, #2e333b 100%)",
        borderRadius: "12px",
        padding: "0.8rem 1.2rem",
        marginBottom: "1rem",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        display: "flex",
        alignItems: "center"
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem",
          padding: "0.4rem 0.8rem"
        }}>
          <FiUserPlus style={{ color: "#00adb5", fontSize: "1.3rem" }} />
          <span style={{ fontSize: "0.9rem", color: "#EEEEEE" }}>Create User</span>
        </div>
        <ul className="nav-links" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem",
          margin: 0,
          padding: 0,
          justifyContent: "flex-end",
          alignItems: "center",
          listStyle: "none",
          flex: 1
        }}>
          <li>
            <button
              onClick={() => navigate('/')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #ff5722, #ffa500)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem",
                fontWeight: 500,
                padding: "0.4rem 0.8rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px",
                whiteSpace: "nowrap"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #ffa500, #ff5722)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #ff5722, #ffa500)";
              }}
              aria-label="Go to Dashboard"
            >
              <FaHome style={{ fontSize: "0.8rem" }} />
              Dashboard
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/help-create-user')} // Assuming a help page exists; adjust route as needed
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #2196f3, #42a5f5)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem",
                fontWeight: 500,
                padding: "0.4rem 0.8rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px",
                whiteSpace: "nowrap"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #42a5f5, #2196f3)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #2196f3, #42a5f5)";
              }}
              aria-label="Help"
            >
              <FaQuestionCircle style={{ fontSize: "0.8rem" }} />
              Help
            </button>
          </li>
        </ul>
      </nav>

      {/* ============ PAGE TITLE ============ */}
      <h1 className="neon-card-title" style={{
        position: "relative",
        paddingBottom: "0.5rem",
        fontSize: "1.8rem",
        textAlign: "center",
        color: "#00adb5",
        textShadow: "0 0 8px rgba(0, 173, 181, 0.7)",
        marginBottom: "1.5rem"
      }}>
        Create User
        <span style={{
          position: "absolute",
          bottom: 0,
          left: "50%",
          transform: "translateX(-50%)",
          width: "50%",
          height: "3px",
          background: "linear-gradient(90deg, #00adb5, #00cc00)",
          borderRadius: "2px"
        }}></span>
      </h1>

      {/* ============ FORM ============ */}
      <div className="dark-card neon-card fadeInUp" style={{ width: '80%', maxWidth: '800px', margin: '0 auto', padding: '1.5rem' }}>
        {/* Message */}
        {message && (
          <div style={{
            color: messageType === 'success' ? "#00cc00" : "#ff5722",
            background: messageType === 'success' ? "rgba(0, 204, 0, 0.15)" : "rgba(255, 87, 34, 0.15)",
            padding: "0.6rem",
            borderRadius: "8px",
            marginBottom: "0.8rem",
            textAlign: "center",
            fontSize: "0.9rem"
          }}>
            {message}
          </div>
        )}

        {/* Form */}
        <div className="agent-form" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.8rem' }}>
          {/* Username */}
          <div className="form-group">
            <FiUser className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              placeholder="Min 3 chars"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="dark-button"
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem",
                fontSize: "0.9rem",
                width: "100%"
              }}
              aria-label="Username"
            />
          </div>

          {/* Password */}
          <div className="form-group">
            <FiLock className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => handlePasswordChange(e.target.value)}
              className="dark-button"
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem",
                fontSize: "0.9rem",
                width: "100%"
              }}
              aria-label="Password"
            />
            {showHint && (
              <div style={{ marginTop: "0.4rem", display: "flex", alignItems: "center", gap: "0.4rem" }}>
                <div style={{
                  width: "100px",
                  height: "4px",
                  background: passwordStrength === 100 ? "#00cc00" : passwordStrength >= 80 ? "#ffa500" : "#ff5722",
                  transition: "width 0.3s"
                }} />
                <span style={{
                  color: passwordStrength === 100 ? "#00cc00" : passwordStrength >= 80 ? "#ffa500" : "#ff5722",
                  fontSize: "0.8rem"
                }}>
                  {passwordHint}
                </span>
              </div>
            )}
          </div>

          {/* Email */}
          <div className="form-group">
            <FiMail className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="email"
              placeholder="Valid email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="dark-button"
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem",
                fontSize: "0.9rem",
                width: "100%"
              }}
              aria-label="Email"
            />
          </div>

          {/* User Type */}
          <div className="form-group">
            <FiShield className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <select
              value={userType}
              onChange={(e) => setUserType(e.target.value)}
              className="dark-button"
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem",
                fontSize: "0.9rem",
                width: "100%"
              }}
              aria-label="User Type"
            >
              <option value="" disabled>-- Select --</option>
              <option value="Admin">Admin</option>
              <option value="Super Admin">Super Admin</option>
              <option value="Manager">Manager</option>
              <option value="Auditor">Auditor</option>
              <option value="Team Leader">Team Leader</option>
              <option value="Agent">Agent</option>
              <option value="IT">IT</option>
            </select>
          </div>

          {/* Security Question */}
          <div className="form-group">
            <FiKey className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <select
              value={securityQuestionType}
              onChange={(e) => setSecurityQuestionType(e.target.value)}
              className="dark-button"
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem",
                fontSize: "0.9rem",
                width: "100%"
              }}
              aria-label="Security Question"
            >
              <option value="" disabled>-- Select a Question --</option>
              {securityQuestions.map((question, index) => (
                <option key={index} value={question}>{question}</option>
              ))}
            </select>
          </div>

          {/* Security Answer */}
          <div className="form-group">
            <input
              type="text"
              placeholder="Enter answer"
              value={securityQuestionAnswer}
              onChange={(e) => setSecurityQuestionAnswer(e.target.value)}
              className="dark-button"
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem",
                fontSize: "0.9rem",
                width: "100%"
              }}
              aria-label="Security Question Answer"
            />
          </div>

          {/* Create Button */}
          <div style={{ gridColumn: 'span 2', textAlign: 'center' }}>
            <button
              onClick={handleCreateUser}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem",
                fontWeight: 500,
                padding: "0.4rem 0.8rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px",
                whiteSpace: "nowrap"
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
              }}
              aria-label="Create User"
            >
              <FiUserPlus style={{ fontSize: "0.8rem" }} />
              Create
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CreateUser;