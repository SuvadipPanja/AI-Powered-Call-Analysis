/**
 * Agent account settings — profile picture, security question, password.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import {
  FaUser,
  FaShieldAlt,
  FaCheckCircle,
  FaTimesCircle,
  FaCameraRetro,
  FaArrowLeft,
  FaKey,
  FaLock,
  FaCamera,
  FaSpinner,
  FaHeadset,
  FaEye,
  FaEyeSlash,
  FaIdBadge,
} from "react-icons/fa";
import config from "../utils/envConfig";
import { useAuth } from "../context/AuthContext";
import {
  Button,
  Input,
  Select,
  Label,
  Badge,
  Spinner,
  UserAvatar,
} from "./ui";
import PageSection from "./ui/PageSection";
import "./settings-page.css";
import "./agent-settings-page.css";

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

function PasswordField({ value, onChange, placeholder, autoComplete, "aria-label": ariaLabel }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="agent-settings-page__password-wrap">
      <Input
        type={visible ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
        aria-label={ariaLabel}
      />
      <button
        type="button"
        className="agent-settings-page__password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide password" : "Show password"}
      >
        {visible ? <FaEyeSlash /> : <FaEye />}
      </button>
    </div>
  );
}

const AgentSettings = () => {
  const navigate = useNavigate();
  const { username: currentUser } = useAuth();
  const [securityQuestion, setSecurityQuestion] = useState("");
  const [newSecurityQuestion, setNewSecurityQuestion] = useState("");
  const [newSecurityAnswer, setNewSecurityAnswer] = useState("");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const fileInputRef = useRef(null);

  const showMessage = useCallback((msg, type) => {
    setMessage(msg);
    setMessageType(type);
    setTimeout(() => {
      setMessage("");
      setMessageType("");
    }, 4000);
  }, []);

  const fetchUserData = useCallback(
    (username) => {
      setIsLoading(true);
      axios
        .get(`${config.apiBaseUrl}/api/user/${username}`)
        .then((response) => {
          if (response.data.success && response.data.user) {
            const u = response.data.user;
            setSecurityQuestion(u.SecurityQuestionType || "Not Set");
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

  useEffect(() => {
    if (currentUser) {
      fetchUserData(currentUser);
    } else {
      showMessage("No user logged in.", "error");
      setIsLoading(false);
    }
  }, [currentUser, fetchUserData, showMessage]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

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
      .catch((err) => {
        const msg = err.response?.data?.message || "Failed to update password.";
        showMessage(msg, "error");
      });
  };

  const MAX_PIC_BYTES = 5 * 1024 * 1024;
  const ALLOWED_PIC_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  const handleProfilePicChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!ALLOWED_PIC_TYPES.includes(file.type)) {
      showMessage("Please choose a JPG, PNG, WEBP or GIF image.", "error");
      return;
    }
    if (file.size > MAX_PIC_BYTES) {
      showMessage("Image must be 5 MB or smaller.", "error");
      return;
    }
    setSelectedFile(file);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const cancelPhotoSelection = () => {
    setSelectedFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleUploadPic = () => {
    if (!selectedFile) {
      showMessage("Please select a file to upload.", "error");
      return;
    }

    setIsUploading(true);
    const formData = new FormData();
    formData.append("profilePic", selectedFile);

    axios
      .post(`${config.apiBaseUrl}/api/user/${currentUser}/profile-picture`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((response) => {
        if (response.data.success) {
          showMessage("Profile picture updated!", "success");
          setSelectedFile(null);
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPreviewUrl("");
          if (fileInputRef.current) fileInputRef.current.value = "";
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

  return (
    <div className="app-page reports-page app-page--stable agent-settings-page">
      <div className="agent-settings-page__toolbar">
        <Button variant="secondary" size="sm" onClick={() => navigate("/")} aria-label="Back to dashboard">
          <FaArrowLeft /> Back to Dashboard
        </Button>
        <h1 className="agent-settings-page__title">
          <FaUser /> Agent Settings
        </h1>
      </div>

      {message && (
        <div
          className={`agent-settings-page__toast agent-settings-page__toast--${messageType === "success" ? "success" : "error"}`}
          role="alert"
          aria-live="polite"
        >
          {messageType === "success" ? <FaCheckCircle /> : <FaTimesCircle />}
          <span>{message}</span>
        </div>
      )}

      {isLoading ? (
        <div className="agent-settings-page__loading">
          <Spinner />
        </div>
      ) : (
        <>
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
                onClick={() => fileInputRef.current?.click()}
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
              <h2 className="settings-hero__name">{currentUser || "Agent"}</h2>
              <span className="settings-hero__email">
                <FaHeadset /> Agent account
              </span>
              <div className="settings-hero__badges">
                <Badge variant="accent"><FaHeadset /> Agent</Badge>
                {securityQuestion && securityQuestion !== "Not Set" && (
                  <Badge><FaKey /> Security question set</Badge>
                )}
              </div>

              {selectedFile ? (
                <div className="settings-photo-actions">
                  <span className="settings-photo-actions__name">
                    <FaCameraRetro /> {selectedFile.name}
                  </span>
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

          <div className="settings-meta">
            <MetaItem
              icon={<FaIdBadge />}
              label="Security question"
              value={securityQuestion || "Not set"}
            />
            <MetaItem
              icon={<FaShieldAlt />}
              label="Account type"
              value="Agent"
            />
          </div>

          <div className="settings-grid">
            <PageSection
              title={<><FaLock style={{ marginRight: 8 }} />Password</>}
              subtitle="Use a strong, unique password"
            >
              <div className="settings-form-row">
                <Label>Current password</Label>
                <PasswordField
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  placeholder="Enter current password"
                  autoComplete="current-password"
                  aria-label="Current password"
                />
              </div>
              <div className="settings-form-row">
                <Label>New password</Label>
                <PasswordField
                  value={newPassword}
                  onChange={handlePasswordInput}
                  placeholder="Enter new password"
                  autoComplete="new-password"
                  aria-label="New password"
                />
                {passwordHint && (
                  <p className={`settings-strength ${passwordHint === "Strong password!" ? "settings-strength--ok" : "settings-strength--weak"}`}>
                    {passwordHint === "Strong password!" ? <FaCheckCircle /> : <FaShieldAlt />} {passwordHint}
                  </p>
                )}
              </div>
              <div className="settings-form-row">
                <Label>Confirm new password</Label>
                <PasswordField
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter new password"
                  autoComplete="new-password"
                  aria-label="Confirm new password"
                />
              </div>
              <Button variant="primary" onClick={handleChangePassword} aria-label="Change password">
                <FaLock /> Update Password
              </Button>
            </PageSection>

            <PageSection
              title={<><FaShieldAlt style={{ marginRight: 8 }} />Security Question</>}
              subtitle={`Current: ${securityQuestion || "Not set"}`}
            >
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
                  aria-label="Security question answer"
                />
              </div>
              <Button variant="primary" onClick={handleUpdateSecurityQuestion} aria-label="Save security question">
                <FaShieldAlt /> Save Security Question
              </Button>
            </PageSection>
          </div>
        </>
      )}
    </div>
  );
};

export default AgentSettings;
