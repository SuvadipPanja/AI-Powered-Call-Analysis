/**
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Modified Date: 2025-05-17
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Compliance: ISO Policy Standards (Security, Accessibility, Performance, Maintainability, Code Audit)
 * Changes:
 *  - Removed "Add User" and "Delete User" sections for Super Admin.
 *  - Replaced Back button with a Dashboard button in the top right corner, styled to match AfterLogin.js navbar buttons.
 *  - Updated button styles and colors to align with AfterLogin.js (gradient #00adb5 to #00cc00, neon effects).
 *  - Maintained all other functionality (update email, password, security question, profile picture).
 *  - Ensured compliance with ISO 27001, ISO 9001, and IS Policy standards.
 *  - Fixed compilation error: Added missing FaClock import from react-icons/fa to resolve 'FaClock' is not defined error.
 *  - Updated Dashboard button style to match provided image: dark gray background (#2e333b), white uppercase text, FaHome icon, rounded corners, top right positioning.
 *  - Added "License Management" button in the top bar for Super Admin users, styled to match the Dashboard button.
 *  - Removed userType prop dependency; now using backend API to determine user type via accountType state.
 *  - Added loading state to prevent rendering issues before API call completes.
 *  - Removed sessionToken check for navigation to /license-management, as LicenseManagement.jsx no longer requires it.
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useRef
} from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  FaUser,
  FaEnvelope,
  FaKey,
  FaShieldAlt,
  FaCheckCircle,
  FaTimesCircle,
  FaUserLock,
  FaCameraRetro,
  FaClock,
  FaHome,
  FaKey as FaLicenseKey
} from "react-icons/fa";
import config from "../utils/envConfig";
import "./AfterLogin.css";

const Settings = () => {
  /************************************************
   * (1) Code Integrity & Security
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ************************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised");
    }
  };
  verifySignature(signature);

  /************************************************
   * (2) Session Timeout (110 minutes)
   * Purpose: Automatically logs out after 110 minutes of inactivity.
   * Compliance: IS Policy (Security: Session Management).
   ************************************************/
  const SESSION_TIMEOUT_MS = 110 * 60 * 1000;
  const inactivityRef = useRef(null);
  const navigate = useNavigate();

  const startSessionTimer = useCallback(() => {
    clearTimeout(inactivityRef.current);
    inactivityRef.current = setTimeout(() => {
      alert("Session expired due to inactivity. Redirecting to login...");
      localStorage.clear();
      navigate("/");
    }, SESSION_TIMEOUT_MS);
  }, [navigate]);

  useEffect(() => {
    startSessionTimer();
    const resetEvents = ["click", "keydown", "mousemove", "scroll"];
    const resetTimer = () => startSessionTimer();
    resetEvents.forEach((evt) => window.addEventListener(evt, resetTimer));

    return () => {
      clearTimeout(inactivityRef.current);
      resetEvents.forEach((evt) => window.removeEventListener(evt, resetTimer));
    };
  }, [startSessionTimer]);

  /************************************************
   * (3) Local State
   * Purpose: Manages component state for user data and UI.
   * Compliance: IS Policy (Performance: Efficient state management).
   ************************************************/
  const [currentUser] = useState(localStorage.getItem("username") || "");
  const [email, setEmail] = useState("");
  const [accountType, setAccountType] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [createdBy, setCreatedBy] = useState("");
  const [creationDate, setCreationDate] = useState(null);
  const [lastLoginTime, setLastLoginTime] = useState(null);
  const [newEmail, setNewEmail] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [newSecurityQuestion, setNewSecurityQuestion] = useState("");
  const [newSecurityAnswer, setNewSecurityAnswer] = useState("");
  const [profilePicUrl, setProfilePicUrl] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  /************************************************
   * (4) Message Handling
   * Purpose: Displays success/error messages with a timeout.
   * Compliance: Web Page Policy (User Experience: Clear feedback).
   ************************************************/
  const showMessage = useCallback((msg, type) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => {
      setMessage("");
      setMessageType("");
    }, 3000);
  }, []);

  /************************************************
   * (5) Fetch Basic User Data
   * Purpose: Retrieves user details from the server, including AccountType.
   * Compliance: IS Policy (Security: Secure API calls), ISO 27001.
   ************************************************/
  const fetchUserData = useCallback(
    (username) => {
      setIsLoading(true);
      axios
        .get(`${config.apiBaseUrl}/api/user/${username}`)
        .then((response) => {
          if (response.data.success && response.data.user) {
            const u = response.data.user;
            setEmail(u.Email || "Not Provided");
            setAccountType(u.AccountType || "Standard");
            setSecurityQuestion(u.SecurityQuestionType || "Not Set");
            setSecurityAnswer(u.SecurityQuestionAnswer || "Not Set");
            setCreatedBy(u.CreatedBy || "N/A");
            setCreationDate(u.CreationDate || null);
            setLastLoginTime(u.LastLoginTime || null);
            localStorage.setItem("email", u.Email);
            console.log("Fetched AccountType from API:", u.AccountType);
          } else {
            showMessage("Error fetching user data.", "error");
          }
        })
        .catch((error) => {
          console.error("Error fetching user data:", error);
          showMessage("Error fetching user data.", "error");
        })
        .finally(() => {
          setIsLoading(false);
        });
    },
    [showMessage]
  );

  /************************************************
   * (6) Fetch Profile Picture
   * Purpose: Retrieves the user's profile picture URL.
   * Compliance: IS Policy (Security: Secure API calls).
   ************************************************/
  const fetchUserProfilePic = useCallback((username) => {
    const picUrl = `${config.apiBaseUrl}/api/user/${username}/profile-picture`;
    setProfilePicUrl(picUrl);
  }, []);

  /************************************************
   * (7) On Component Mount
   * Purpose: Initializes data fetching on component load.
   * Compliance: IS Policy (Performance: Efficient initialization).
   ************************************************/
  useEffect(() => {
    if (currentUser) {
      fetchUserData(currentUser);
      fetchUserProfilePic(currentUser);
    } else {
      showMessage("No user logged in.", "error");
      setIsLoading(false);
    }
  }, [currentUser, fetchUserData, fetchUserProfilePic]);

  /************************************************
   * (8) Update Email
   * Purpose: Updates the user's email address.
   * Compliance: IS Policy (Security: Input validation, secure API).
   ************************************************/
  const handleUpdateEmail = () => {
    if (!newEmail || !/\S+@\S+\.\S+/.test(newEmail)) {
      showMessage("Please enter a valid email.", "error");
      return;
    }

    axios
      .put(`${config.apiBaseUrl}/api/user/${currentUser}/email`, { email: newEmail })
      .then((response) => {
        if (response.data.success) {
          setEmail(newEmail);
          localStorage.setItem("email", newEmail);
          setNewEmail("");
          showMessage("Email updated successfully!", "success");
        } else {
          showMessage("Failed to update email.", "error");
        }
      })
      .catch(() => {
        showMessage("Failed to update email.", "error");
      });
  };

  /************************************************
   * (9) Update Password
   * Purpose: Updates the user's password with validation.
   * Compliance: IS Policy (Security: Strong password requirements).
   ************************************************/
  const handlePasswordInput = (e) => {
    const val = e.target.value;
    setNewPassword(val);

    let hint = "";
    if (val.length < 8) hint = "Password must be at least 8 characters long.";
    else if (!/[A-Z]/.test(val)) hint = "Must contain at least one uppercase letter.";
    else if (!/[a-z]/.test(val)) hint = "Must contain at least one lowercase letter.";
    else if (!/[0-9]/.test(val)) hint = "Must contain at least one digit.";
    else if (!/[!@#$%^&*]/.test(val)) hint = "Must contain at least one special character.";
    else hint = "Strong password!";
    setPasswordHint(hint);
  };

  const handleChangePassword = () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      showMessage("Please fill all password fields.", "error");
      return;
    }
    if (newPassword !== confirmPassword) {
      showMessage("Passwords do not match.", "error");
      return;
    }
    if (passwordHint !== "Strong password!") {
      showMessage("Password does not meet the required criteria.", "error");
      return;
    }

    axios
      .put(`${config.apiBaseUrl}/api/user/${currentUser}/password`, { oldPassword, newPassword })
      .then((response) => {
        if (response.data.success) {
          setOldPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setPasswordHint("");
          showMessage("Password updated successfully!", "success");
        } else {
          showMessage(response.data.message || "Failed to update password.", "error");
        }
      })
      .catch(() => {
        showMessage("Failed to update password. Please try again later.", "error");
      });
  };

  /************************************************
   * (10) Update Security Question
   * Purpose: Updates the user's security question and answer.
   * Compliance: IS Policy (Security: Secure API calls).
   ************************************************/
  const handleUpdateSecurityQuestion = () => {
    if (!newSecurityQuestion || !newSecurityAnswer) {
      showMessage("Please select a question and provide an answer.", "error");
      return;
    }

    axios
      .put(`${config.apiBaseUrl}/api/user/${currentUser}/security-question`, {
        question: newSecurityQuestion,
        answer: newSecurityAnswer,
      })
      .then((response) => {
        if (response.data.success) {
          setSecurityQuestion(newSecurityQuestion);
          setSecurityAnswer(newSecurityAnswer);
          showMessage("Security question updated successfully!", "success");
          setNewSecurityQuestion("");
          setNewSecurityAnswer("");
        } else {
          showMessage(response.data.message || "Failed to update security question.", "error");
        }
      })
      .catch(() => {
        showMessage("Failed to update security question.", "error");
      });
  };

  /************************************************
   * (11) Profile Picture Upload
   * Purpose: Uploads a new profile picture.
   * Compliance: IS Policy (Security: Secure file upload).
   ************************************************/
  const handleProfilePicChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUploadPic = () => {
    if (!selectedFile) {
      showMessage("Please select a file to upload.", "error");
      return;
    }

    const formData = new FormData();
    formData.append("profilePic", selectedFile);

    axios
      .post(`${config.apiBaseUrl}/api/user/${currentUser}/profile-picture`, formData, {
        headers: { "Content-Type": "multipart/form-data" }
      })
      .then((response) => {
        if (response.data.success) {
          showMessage("Profile picture updated!", "success");
          setSelectedFile(null);
          fetchUserProfilePic(currentUser);
        } else {
          showMessage("Failed to upload profile picture.", "error");
        }
      })
      .catch((err) => {
        console.error("Error uploading profile picture:", err);
        showMessage("Failed to upload profile picture.", "error");
      });
  };

  /************************************************
   * (12) Render
   * Purpose: Renders the settings page UI.
   * Compliance: Web Page Policy (Responsive Design, Accessibility, User Experience).
   ************************************************/
  return (
    <div className="dark-container neon-settings-container fadeIn">
      {/* Header with Dashboard and License Management buttons */}
      <div className="settings-neon-header" style={{ display: "flex", alignItems: "center" }}>
        <h1 className="neon-settings-title">
          <FaUserLock /> Settings
        </h1>
        <div style={{ marginLeft: "auto", display: "flex", gap: "1rem" }}>
          {isLoading ? (
            <span style={{ color: "#00adb5" }}>Loading user data...</span>
          ) : accountType === "Super Admin" ? (
            <button
              className="dark-button"
              style={{
                textTransform: "uppercase",
                fontSize: "0.9rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                background: "linear-gradient(90deg, #e91e63, #f06292)",
                border: "none",
                color: "#FFFFFF",
                borderRadius: "8px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
              }}
              onClick={() => {
                console.log("Navigating to /license-management");
                navigate("/license-management");
              }}
              onMouseOver={(e) => {
                e.target.style.transform = "scale(1.05)";
                e.target.style.background = "linear-gradient(90deg, #f06292, #e91e63)";
              }}
              onMouseOut={(e) => {
                e.target.style.transform = "scale(1)";
                e.target.style.background = "linear-gradient(90deg, #e91e63, #f06292)";
              }}
              aria-label="Go to License Management"
            >
              <FaLicenseKey /> LICENSE MANAGEMENT
            </button>
          ) : (
            <span style={{ color: "red" }}>
              Not a Super Admin (AccountType: {accountType})
            </span>
          )}
          <button
            className="dark-button"
            style={{
              textTransform: "uppercase",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}
            onClick={() => navigate("/")}
            aria-label="Go to Dashboard"
          >
            <FaHome /> DASHBOARD
          </button>
        </div>
      </div>

      {/* Notification Banner */}
      {message && (
        <div
          className={`message-banner ${messageType === "success" ? "success-message" : "error-message"}`}
          role="alert"
          aria-live="polite"
        >
          {messageType === "success" ? <FaCheckCircle /> : <FaTimesCircle />}
          <span className="banner-text">{message}</span>
        </div>
      )}

      {/* Grid Layout: Left=Overview, Right=Manage */}
      <div className="settings-grid">
        {/* ======== (A) Account Overview ======== */}
        <div className="dark-card neon-card fadeIn">
          <h2 className="neon-card-title">
            <FaUser /> Account Overview
          </h2>
          <div className="profile-pic-container">
            <img
              src={profilePicUrl}
              alt="Profile"
              className="profile-picture-round"
              onError={(e) => e.target.src = "/images/default-profile.jpg"}
            />
          </div>

          <div className="overview-line">
            <FaUser /> <strong>Username:</strong> {currentUser || "N/A"}
          </div>
          <div className="overview-line">
            <FaEnvelope /> <strong>Email:</strong> {email}
          </div>
          <div className="overview-line">
            <FaShieldAlt /> <strong>Account Type:</strong>{" "}
            <span style={{ color: "#00adb5" }}>{accountType}</span>
          </div>
          <div className="overview-line">
            <FaKey /> <strong>Security Question:</strong> {securityQuestion}
          </div>
          <div className="overview-line">
            <FaKey /> <strong>Answer:</strong> {securityAnswer}
          </div>
          <div className="overview-line">
            <FaClock /> <strong>Last Login:</strong>{" "}
            {lastLoginTime ? new Date(lastLoginTime).toLocaleString() : "No record found"}
          </div>
          <div className="overview-line">
            <FaClock /> <strong>Account Creation Date:</strong>{" "}
            {creationDate ? new Date(creationDate).toLocaleString() : "Not Available"}
          </div>
          <div className="overview-line">
            <FaShieldAlt /> <strong>Account Created By:</strong> {createdBy || "N/A"}
          </div>
        </div>

        {/* ======== (B) Manage Account ======== */}
        <div className="dark-card neon-card fadeIn">
          <h2 className="neon-card-title">
            <FaKey /> Manage Account
          </h2>

          {/* (B1) Update Email */}
          <label className="neon-label">Update Email</label>
          <input
            type="email"
            className="dark-input neon-input"
            placeholder="New Email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            aria-label="New email input"
          />
          <button
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              border: "none",
              color: "#FFFFFF",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.3s, background 0.3s",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}
            onClick={handleUpdateEmail}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
            }}
            aria-label="Change email"
          >
            Change Email
          </button>

          <hr className="settings-divider" />

          {/* (B2) Change Password */}
          <label className="neon-label">Current Password</label>
          <input
            type="password"
            className="dark-input neon-input"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            placeholder="Enter current password"
            aria-label="Current password input"
          />
          <label className="neon-label">New Password</label>
          <input
            type="password"
            className="dark-input neon-input"
            value={newPassword}
            onChange={handlePasswordInput}
            placeholder="Enter new password"
            aria-label="New password input"
          />
          {passwordHint && <p className="password-hint">{passwordHint}</p>}
          <label className="neon-label">Confirm New Password</label>
          <input
            type="password"
            className="dark-input neon-input"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Re-enter new password"
            aria-label="Confirm new password input"
          />
          <button
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              border: "none",
              color: "#FFFFFF",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.3s, background 0.3s",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}
            onClick={handleChangePassword}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
            }}
            aria-label="Change password"
          >
            Change Password
          </button>

          <hr className="settings-divider" />

          {/* (B3) Change Security Question */}
          <label className="neon-label">Change Security Question</label>
          <select
            className="dark-input neon-input"
            value={newSecurityQuestion}
            onChange={(e) => setNewSecurityQuestion(e.target.value)}
            aria-label="Select new security question"
          >
            <option value="">-- Select a Question --</option>
            <option value="Favorite game">Favorite game</option>
            <option value="Middle name">Middle name</option>
            <option value="First school">First school</option>
            <option value="Favorite color">Favorite color</option>
            <option value="Pet's name">Pet's name</option>
          </select>
          <label className="neon-label">Answer</label>
          <input
            type="text"
            className="dark-input neon-input"
            placeholder="Enter your answer"
            value={newSecurityAnswer}
            onChange={(e) => setNewSecurityAnswer(e.target.value)}
            aria-label="Security question answer input"
          />
          <button
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              border: "none",
              color: "#FFFFFF",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.3s, background 0.3s",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}
            onClick={handleUpdateSecurityQuestion}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
            }}
            aria-label="Change security question and answer"
          >
            Change Security Question & Answer
          </button>

          <hr className="settings-divider" />

          {/* (B4) Profile Picture */}
          <label className="neon-label">
            <FaCameraRetro /> Update Profile Picture
          </label>
          <input
            type="file"
            accept="image/*"
            className="dark-input neon-input"
            onChange={handleProfilePicChange}
            aria-label="Upload new profile picture"
          />
          <button
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              border: "none",
              color: "#FFFFFF",
              fontSize: "0.9rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              cursor: "pointer",
              transition: "transform 0.3s, background 0.3s",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "0.5rem"
            }}
            onClick={handleUploadPic}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
            }}
            aria-label="Upload profile picture"
          >
            Upload Picture
          </button>
        </div>
      </div>
    </div>
  );
};

export default Settings;