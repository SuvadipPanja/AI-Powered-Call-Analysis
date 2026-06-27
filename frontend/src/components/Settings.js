/**
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Modified Date: 2025-06-14
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Compliance: ISO Policy Standards (Security, Accessibility, Performance, Maintainability, Code Audit)
 * Changes:
 *  - Modified profile picture upload to rename old picture with current date (e.g., xyz_20250614.jpg) and save new picture as username.jpg.
 *  - Added immediate profile picture refresh after successful upload by calling fetchUserProfilePic, ensuring the latest image is displayed without page reload.
 *  - Ensured compliance with IS Policy, ISO 27001, and Code Audit standards.
 *  - Maintained all existing functionality (email, password, security question, profile picture updates).
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
  FaEnvelope,
  FaKey,
  FaShieldAlt,
  FaCheckCircle,
  FaTimesCircle,
  FaCameraRetro,
  FaClock,
  FaHome,
  FaCamera,
  FaSpinner,
  FaLock,
  FaIdBadge,
  FaUserPlus,
} from "react-icons/fa";
import config from "../utils/envConfig";
import { useAuth } from "../context/AuthContext";
import { Button, Input, Select, Label, Badge, Spinner, UserAvatar } from './ui';
import PageSection from './ui/PageSection';
import './settings-page.css';

/** Compact labelled metadata tile used in the account summary row. */
function MetaItem({ icon, label, value }) {
  return (
    <div className="settings-meta__item">
      <span className="settings-meta__icon">{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div className="settings-meta__label">{label}</div>
        <div className="settings-meta__value">{value}</div>
      </div>
    </div>
  );
}

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

  const { username: currentUser } = useAuth();
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
  const [email, setEmail] = useState("");
  const [accountType, setAccountType] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState("");
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
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");   // instant local preview (object URL)
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
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
   * (7) On Component Mount
   * Purpose: Initializes data fetching on component load.
   * Compliance: IS Policy (Performance: Efficient initialization).
   ************************************************/
  useEffect(() => {
    if (currentUser) {
      fetchUserData(currentUser);
    } else {
      showMessage("No user logged in.", "error");
      setIsLoading(false);
    }
  }, [currentUser, fetchUserData, showMessage]);

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
   * Purpose: Uploads a new profile picture and refreshes the image immediately.
   * Compliance: IS Policy (Security: Secure file upload).
   ************************************************/
  const MAX_PIC_BYTES = 5 * 1024 * 1024; // 5 MB
  const ALLOWED_PIC_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  const handleProfilePicChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!ALLOWED_PIC_TYPES.includes(file.type)) {
      showMessage("Please choose a JPG, PNG, WEBP or GIF image.", "error");
      return;
    }
    if (file.size > MAX_PIC_BYTES) {
      showMessage("Image is too large — please pick one under 5 MB.", "error");
      return;
    }
    // Instant local preview — shows the exact image immediately, no server round-trip.
    setPreviewUrl(URL.createObjectURL(file));
    setSelectedFile(file);
  };

  const cancelPhotoSelection = () => {
    setPreviewUrl("");
    setSelectedFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUploadPic = () => {
    if (!selectedFile) {
      showMessage("Please choose a photo first.", "error");
      return;
    }
    setIsUploading(true);

    const formData = new FormData();
    formData.append("profilePic", selectedFile);

    axios
      // Let the browser/axios set the multipart boundary automatically.
      .post(`${config.apiBaseUrl}/api/user/${currentUser}/profile-picture`, formData)
      .then((response) => {
        if (response.data && response.data.success) {
          showMessage("Profile picture updated!", "success");
          setSelectedFile(null);
          if (fileInputRef.current) fileInputRef.current.value = "";
          // Notify the navbar and every other view (incl. this page's own
          // useProfilePicture hook) to re-fetch the freshly uploaded image.
          window.dispatchEvent(new CustomEvent("profile-pic-updated", { detail: { username: currentUser } }));
        } else {
          showMessage("Failed to upload profile picture.", "error");
        }
      })
      .catch((err) => {
        console.error("Error uploading profile picture:", err);
        showMessage("Failed to upload profile picture.", "error");
      })
      .finally(() => setIsUploading(false));
  };

  // Release the preview object URL when it changes or the page unmounts.
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  /************************************************
   * (12) Render
   * Purpose: Renders the settings page UI.
   * Compliance: Web Page Policy (Responsive Design, Accessibility, User Experience).
   ************************************************/
  // Prefer the instant local preview; UserAvatar loads the server image when preview is cleared.
  return (
    <div className="app-page reports-page app-page--stable">
      {isLoading && (
        <div style={{ display: "flex", justifyContent: "center", padding: "var(--space-6)" }}>
          <Spinner />
        </div>
      )}

      {!isLoading && (
      <>
      {message && (
        <div className={`auth-alert auth-alert--${messageType === "success" ? "success" : "error"}`} role="alert" aria-live="polite" style={{ marginBottom: "var(--space-4)" }}>
          {messageType === "success" ? <FaCheckCircle /> : <FaTimesCircle />}
          <span style={{ marginLeft: "var(--space-2)" }}>{message}</span>
        </div>
      )}

      {/* Profile hero — avatar uploader + identity */}
      <div className="settings-hero">
        <div className="settings-avatar">
          <span className="settings-avatar__ring" />
          <UserAvatar
            username={currentUser}
            src={previewUrl || undefined}
            size="hero"
            className="settings-avatar__img"
            alt="Profile"
          />
          <button
            type="button"
            className="settings-avatar__edit"
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            aria-label="Change profile photo"
            title="Change photo"
          >
            <FaCamera />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onChange={handleProfilePicChange}
            style={{ display: "none" }}
            aria-label="Upload new profile picture"
          />
        </div>

        <div className="settings-hero__info">
          <h2 className="settings-hero__name">{currentUser || "User"}</h2>
          <span className="settings-hero__email"><FaEnvelope /> {email || "No email on file"}</span>
          <div className="settings-hero__badges">
            <Badge variant="accent"><FaShieldAlt /> {accountType || "Standard"}</Badge>
            {securityQuestion && securityQuestion !== "Not Set" && (
              <Badge><FaKey /> Security question set</Badge>
            )}
          </div>

          {selectedFile ? (
            <div className="settings-photo-actions">
              <span className="settings-photo-actions__name"><FaCameraRetro /> {selectedFile.name}</span>
              <Button variant="primary" size="sm" onClick={handleUploadPic} disabled={isUploading}>
                {isUploading
                  ? <><FaSpinner style={{ animation: "spin 0.8s linear infinite" }} /> Saving…</>
                  : <><FaCheckCircle /> Save photo</>}
              </Button>
              <Button variant="ghost" size="sm" onClick={cancelPhotoSelection} disabled={isUploading}>
                Cancel
              </Button>
            </div>
          ) : (
            <span className="settings-photo-hint">
              <FaCamera /> Tap the camera to update your photo · JPG, PNG, WEBP or GIF up to 5&nbsp;MB
            </span>
          )}
        </div>
      </div>

      {/* Account summary */}
      <div className="settings-meta">
        <MetaItem icon={<FaClock />} label="Last login" value={lastLoginTime ? new Date(lastLoginTime).toLocaleString() : "No record"} />
        <MetaItem icon={<FaClock />} label="Account created" value={creationDate ? new Date(creationDate).toLocaleString() : "Not available"} />
        <MetaItem icon={<FaUserPlus />} label="Created by" value={createdBy || "N/A"} />
        <MetaItem icon={<FaIdBadge />} label="Security question" value={securityQuestion || "Not set"} />
      </div>

      {/* Account management */}
      <div className="settings-grid">
        <PageSection title={<><FaEnvelope style={{ marginRight: 8 }} />Email Address</>} subtitle={`Current: ${email || "—"}`}>
          <div className="settings-form-row">
            <Label>New email</Label>
            <Input
              type="email"
              placeholder="you@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              aria-label="New email input"
            />
          </div>
          <Button variant="primary" onClick={handleUpdateEmail} aria-label="Change email">
            <FaEnvelope /> Update Email
          </Button>
        </PageSection>

        <PageSection title={<><FaLock style={{ marginRight: 8 }} />Password</>} subtitle="Use a strong, unique password">
          <div className="settings-form-row">
            <Label>Current password</Label>
            <Input
              type="password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              placeholder="Enter current password"
              aria-label="Current password input"
            />
          </div>
          <div className="settings-form-row">
            <Label>New password</Label>
            <Input
              type="password"
              value={newPassword}
              onChange={handlePasswordInput}
              placeholder="Enter new password"
              aria-label="New password input"
            />
            {passwordHint && (
              <p className={`settings-strength ${passwordHint === "Strong password!" ? "settings-strength--ok" : "settings-strength--weak"}`}>
                {passwordHint === "Strong password!" ? <FaCheckCircle /> : <FaShieldAlt />} {passwordHint}
              </p>
            )}
          </div>
          <div className="settings-form-row">
            <Label>Confirm new password</Label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter new password"
              aria-label="Confirm new password input"
            />
          </div>
          <Button variant="primary" onClick={handleChangePassword} aria-label="Change password">
            <FaLock /> Change Password
          </Button>
        </PageSection>

        <PageSection title={<><FaShieldAlt style={{ marginRight: 8 }} />Security Question</>} subtitle={`Current: ${securityQuestion || "Not set"}`}>
          <div className="settings-form-row">
            <Label>Question</Label>
            <Select
              value={newSecurityQuestion}
              onChange={(e) => setNewSecurityQuestion(e.target.value)}
              aria-label="Select new security question"
            >
              <option value="">-- Select a Question --</option>
              <option value="Favorite game">Favorite game</option>
              <option value="Middle name">Middle name</option>
              <option value="First school">First school</option>
              <option value="Favorite color">Favorite color</option>
              <option value="Pet's name">Pet&apos;s name</option>
            </Select>
          </div>
          <div className="settings-form-row">
            <Label>Answer</Label>
            <Input
              type="text"
              placeholder="Enter your answer"
              value={newSecurityAnswer}
              onChange={(e) => setNewSecurityAnswer(e.target.value)}
              aria-label="Security question answer input"
            />
          </div>
          <Button variant="primary" onClick={handleUpdateSecurityQuestion} aria-label="Change security question and answer">
            <FaShieldAlt /> Update Security Question
          </Button>
        </PageSection>
      </div>
      </>
      )}
    </div>
  );
};

export default Settings;
