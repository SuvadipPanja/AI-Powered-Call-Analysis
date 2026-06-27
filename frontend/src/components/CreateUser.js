/**
 * File: CreateUser.js
 * Purpose: Component for creating a new user with validation, security questions, and encrypted password storage.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-06-13
 * Summary of Changes:
 *  - Added UserID field for user creation, reflecting the new primary key for login.
 *  - Improved UI with better spacing, modern layout, and enhanced visual feedback.
 *  - Aligned UI with Agents.js, HelpAgents.jsx, AddAgent.js, and UserManagement.js (gradient navbar, neon cards, enhanced animations).
 *  - Updated button styles, sizes, and icons (FaHome for Dashboard).
 *  - Added policy compliance (ISO 27001, ISO 9001, Web Page Policy) with secure navigation, accessibility, and responsive design.
 *  - Compacted navbar and form layout to fit content on one page without scrolling.
 *  - Added signature check for code integrity with proper hook placement.
 *  - Updated security questions to match the predefined list in UserManagement.js.
 *  - Removed "Back to Previous Page" button from the navbar.
 *  - Integrated error handling into the form section.
 *  - Ensured password is sent to the server for hashing (handled by /api/user endpoint).
 */

import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LuUserPlus } from "../icons";
import apiClient from "../utils/apiClient";
import { useAuth } from "../context/AuthContext";
import './management-pages.css';
import { Card, Button, Input, Select, Label, Badge } from './ui';

const CreateUser = () => {
  const navigate = useNavigate();
  const { username: currentUser } = useAuth();
  const [userId, setUserId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [email, setEmail] = useState("");
  const [userType, setUserType] = useState("");
  const [securityQuestionType, setSecurityQuestionType] = useState("");
  const [securityQuestionAnswer, setSecurityQuestionAnswer] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [showHint, setShowHint] = useState(false);
  const [passwordStrength, setPasswordStrength] = useState(0);

  /***************************************
   * 3) FIELD VALIDATION
   * Purpose: Validates form inputs before submission.
   * Compliance: ISO 27001 (Security: Input validation).
   ***************************************/
  const validateFields = () => {
    if (!userId.trim()) {
      setMessage("UserID is required.");
      setMessageType("error");
      return false;
    }
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
      const response = await apiClient.post("/api/user", {
        userId,
        username,
        password,
        email,
        userType,
        SecurityQuestionType: securityQuestionType,
        SecurityQuestionAnswer: securityQuestionAnswer,
        createdBy: currentUser,
      });

      if (response.data.success) {
        setMessage("User created successfully.");
        setMessageType("success");
        setUserId("");
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
      const serverMessage = err?.response?.data?.message;
      setMessage(serverMessage || "Failed to create user.");
      setMessageType("error");
    }
  };

  const securityQuestions = [
    "Favorite game",
    "Mother's maiden name",
    "First pet's name",
    "Favorite color",
    "Where you were born"
  ];

  /***************************************
   * 6) RENDER
   * Purpose: Renders the create user form with validation feedback and modern UI.
   * Compliance: Web Page Policy (User Experience: Smooth interaction), IS Policy (Accessibility).
   ***************************************/
  return (
    <div className="app-page reports-page mgmt-page">
      <div className="mgmt-form-topbar">
        <Button variant="secondary" size="sm" onClick={() => navigate('/user-management')}>
          ← Back to users
        </Button>
      </div>

      {message && (
        <div className={`auth-alert auth-alert--${messageType === 'success' ? 'success' : 'error'}`}>
          {message}
        </div>
      )}

      <div className="mgmt-form-page">
        <Card className="mgmt-form-card">
          <div className="reports-section__head" style={{ marginBottom: 'var(--space-4)' }}>
            <h2>Create user</h2>
            <p>Add a team member — admin, manager, team leader, auditor, or agent login.</p>
          </div>
          <div className="mgmt-form-grid">
          <div>
            <Label>UserID</Label>
            <Input
              type="text"
              placeholder="Enter UserID"
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              aria-label="UserID"
            />
          </div>

          <div>
            <Label>Username</Label>
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              aria-label="Username"
            />
          </div>

          <div>
            <Label>Password</Label>
            <Input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => handlePasswordChange(e.target.value)}
              aria-label="Password"
            />
            {showHint && (
              <div style={{ marginTop: "var(--space-2)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                <div style={{
                  width: "100px",
                  height: "5px",
                  borderRadius: "3px",
                  background: passwordStrength === 100 ? "var(--success)" : passwordStrength >= 80 ? "var(--warning)" : "var(--danger)"
                }} />
                <span style={{
                  color: passwordStrength === 100 ? "var(--success)" : passwordStrength >= 80 ? "var(--warning)" : "var(--danger)",
                  fontSize: "0.82rem",
                  fontWeight: "600"
                }}>
                  {passwordHint}
                </span>
              </div>
            )}
          </div>

          <div>
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="Valid email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-label="Email"
            />
          </div>

          <div>
            <Label>User Type</Label>
            <Select
              value={userType}
              onChange={(e) => setUserType(e.target.value)}
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
            </Select>
          </div>

          <div>
            <Label>Security Question</Label>
            <Select
              value={securityQuestionType}
              onChange={(e) => setSecurityQuestionType(e.target.value)}
              aria-label="Security Question"
            >
              <option value="" disabled>-- Select a Question --</option>
              {securityQuestions.map((question, index) => (
                <option key={index} value={question}>{question}</option>
              ))}
            </Select>
          </div>

          <div>
            <Label>Security Answer</Label>
            <Input
              type="text"
              placeholder="Enter answer"
              value={securityQuestionAnswer}
              onChange={(e) => setSecurityQuestionAnswer(e.target.value)}
              aria-label="Security Question Answer"
            />
          </div>

          <div className="mgmt-form-actions">
            <Button variant="secondary" type="button" onClick={() => navigate('/user-management')}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateUser} aria-label="Create User">
              <LuUserPlus style={{ fontSize: "1.1rem" }} />
              Create User
            </Button>
          </div>
        </div>
        </Card>
      </div>
    </div>
  );
};

export default CreateUser;
