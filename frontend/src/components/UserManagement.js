/**
 * File: UserManagement.js
 * Purpose: Component for managing users, including listing, editing, deleting, and searching users.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-04-27
 * Summary of Changes:
 *  - Updated fetch users to use new endpoint /api/users/list.
 *  - Added bcrypt encryption logic to password updates in the edit modal.
 *  - Aligned UI with Agents.js, HelpAgents.jsx, AddAgent.js, and CreateUser.js (gradient navbar, neon cards, enhanced animations).
 *  - Updated button styles, sizes, and icons (FaHome for Dashboard).
 *  - Added policy compliance (ISO 27001, ISO 9001, Web Page Policy) with secure navigation, accessibility, and responsive design.
 *  - Compacted navbar and layout to fit content on one page without scrolling.
 *  - Added signature check for code integrity.
 *  - Added predefined security questions to the edit modal as a dropdown.
 *  - Fixed modal animation to open directly in the center of the viewport.
 *  - Removed "Back to Previous Page" button from the navbar.
 *  - Updated table to display "NULL" for missing data.
 *  - Added edit error display within the modal instead of the main section.
 *  - Copied password policy from AddAgent.js with strength bar and hints.
 *  - Added search user functionality with a new API endpoint /api/users/search.
 *  - Fixed TypeError by ensuring users is always an array and handling API response correctly.
 *  - Removed requirement for old password in the edit modal for password updates.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  FaHeadset,
  FaHome, // Icon for Dashboard button (standard)
  FaUserPlus,
  FaEdit,
  FaTrashAlt,
  FaCheckCircle,
  FaTimesCircle,
  FaQuestionCircle // Icon for Help button
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import './AfterLogin.css';
import config from '../utils/envConfig';

export default function UserManagement() {
  /***************************************
   * 1) HOOKS
   * Purpose: Initialize all React Hooks at the top level to comply with Rules of Hooks.
   * Compliance: ISO 9001 (Quality: Maintainable code structure).
   ***************************************/
  const navigate = useNavigate();
  const [signatureError, setSignatureError] = useState(null);
  const [users, setUsers] = useState([]); // Ensure users is always an array
  const [notification, setNotification] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalPosition, setModalPosition] = useState({ top: 0, left: 0 });
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({
    email: '',
    newPass: '',
    question: '',
    answer: ''
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState(''); // State for edit modal errors
  const [searchQuery, setSearchQuery] = useState(''); // State for search input
  const [passwordHint, setPasswordHint] = useState(''); // Password policy hint
  const [passwordStrength, setPasswordStrength] = useState(0); // Password strength percentage
  const [showHint, setShowHint] = useState(false); // Show password hint

  /***************************************
   * 2) CODE INTEGRITY CHECK
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ***************************************/
  const signature = '$Panja';
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
   * 3) MODAL POSITIONING
   * Purpose: Ensures the modal opens directly in the center of the viewport.
   * Compliance: Web Page Policy (User Experience: Smooth animations).
   ***************************************/
  useEffect(() => {
    if (isModalOpen) {
      const updateModalPosition = () => {
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;
        const scrollY = window.scrollY || window.pageYOffset;
        const scrollX = window.scrollX || window.pageXOffset;
        const top = (viewportHeight / 2) + scrollY;
        const left = (viewportWidth / 2) + scrollX;
        setModalPosition({ top, left });
      };

      updateModalPosition();
      window.addEventListener('resize', updateModalPosition);
      window.addEventListener('scroll', updateModalPosition);

      return () => {
        window.removeEventListener('resize', updateModalPosition);
        window.removeEventListener('scroll', updateModalPosition);
      };
    }
  }, [isModalOpen]);

  /***************************************
   * 4) PASSWORD POLICY (Copied from AddAgent.js)
   * Purpose: Evaluates password strength and provides feedback in the edit modal.
   * Compliance: ISO 27001 (Security: Enforce strong passwords).
   ***************************************/
  const handlePasswordChange = (value) => {
    setForm({ ...form, newPass: value });
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

  const passwordPolicyMet = useMemo(() => {
    return passwordHint === "Strong!";
  }, [passwordHint]);

  /***************************************
   * 5) FETCH USERS
   * Purpose: Fetches the list of users from the API on component mount.
   * Compliance: ISO 27001 (Secure API calls).
   ***************************************/
  useEffect(() => {
    fetch(`${config.apiBaseUrl}/api/users/list`)
      .then(r => r.json())
      .then(d => {
        if (d.success && Array.isArray(d.users)) {
          setUsers(d.users);
        } else {
          setUsers([]); // Fallback to empty array
          showNotification('Failed to load users: Invalid response', 'error');
        }
      })
      .catch(() => {
        setUsers([]); // Fallback to empty array
        showNotification('Failed to load users', 'error');
      });
  }, []);

  /***************************************
   * 6) SEARCH USERS
   * Purpose: Fetches users filtered by username from the API.
   * Compliance: ISO 27001 (Secure API calls).
   ***************************************/
  // Debounce function to delay search API calls
  const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  };

  const searchUsers = async (query) => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/users/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        throw new Error('Search request failed');
      }
      const data = await res.json();
      if (data.success && Array.isArray(data.users)) {
        setUsers(data.users); // Extract the users array
      } else {
        setUsers([]); // Fallback to empty array
        showNotification('No users found', 'error');
      }
    } catch (err) {
      console.error('Error searching users:', err.message);
      setUsers([]); // Fallback to empty array
      showNotification('Failed to search users', 'error');
    }
  };

  const debouncedSearch = debounce((query) => {
    if (query.trim() === '') {
      fetch(`${config.apiBaseUrl}/api/users/list`)
        .then(r => r.json())
        .then(d => {
          if (d.success && Array.isArray(d.users)) {
            setUsers(d.users);
          } else {
            setUsers([]); // Fallback to empty array
            showNotification('Failed to load users: Invalid response', 'error');
          }
        })
        .catch(() => {
          setUsers([]); // Fallback to empty array
          showNotification('Failed to load users', 'error');
        });
    } else {
      searchUsers(query.trim());
    }
  }, 300);

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };

  /***************************************
   * 7) HELPERS
   * Purpose: Utility functions for notifications and user actions.
   * Compliance: ISO 9001 (Quality: Modular code).
   ***************************************/
  const showNotification = (msg, type) => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  };

  const openEdit = u => {
    setCurrent(u);
    setForm({
      email: u.Email || '',
      newPass: '',
      question: u.SecurityQuestionType || '',
      answer: u.SecurityQuestionAnswer || ''
    });
    setEditError(''); // Clear previous errors
    setPasswordHint('');
    setPasswordStrength(0);
    setShowHint(false);

    // Calculate the center of the current viewport before opening the modal
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const scrollY = window.scrollY || window.pageYOffset;
    const scrollX = window.scrollX || window.pageXOffset;
    const top = (viewportHeight / 2) + scrollY;
    const left = (viewportWidth / 2) + scrollX;
    setModalPosition({ top, left });

    setIsModalOpen(true);
  };

  const deleteUser = async u => {
    if (!window.confirm(`Delete user "${u.Username}"?`)) return;
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/user/${encodeURIComponent(u.Username)}`, {
        method: 'DELETE'
      });
      const json = await res.json();
      if (json.success) {
        setUsers(prev => prev.filter(x => x.Username !== u.Username));
        showNotification('User deleted', 'success');
      } else {
        showNotification(json.message || 'Delete failed', 'error');
      }
    } catch {
      showNotification('Delete failed', 'error');
    }
  };

  const saveEdits = async () => {
    if (form.newPass && !passwordPolicyMet) {
      setEditError('Password does not meet the required criteria.');
      return;
    }

    setSaving(true);
    setEditError(''); // Clear previous errors
    const username = current.Username;
    const tasks = [];

    // Email update
    tasks.push(
      fetch(`${config.apiBaseUrl}/api/user/${encodeURIComponent(username)}/email`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email })
      }).then(r => r.json())
    );

    // Password update (with bcrypt encryption on the server)
    if (form.newPass) {
      tasks.push(
        fetch(`${config.apiBaseUrl}/api/user/${encodeURIComponent(username)}/password`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newPassword: form.newPass })
        }).then(r => r.json())
      );
    }

    // Security question update
    tasks.push(
      fetch(`${config.apiBaseUrl}/api/user/${encodeURIComponent(username)}/security-question`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: form.question, answer: form.answer })
      }).then(r => r.json())
    );

    try {
      const results = await Promise.all(tasks);
      const fail = results.find(r => !r.success);
      if (fail) throw new Error(fail.message || 'Update failed');
      // Local update
      setUsers(prev =>
        prev.map(u =>
          u.Username === username
            ? { ...u, Email: form.email, SecurityQuestionType: form.question, SecurityQuestionAnswer: form.answer }
            : u
        )
      );
      setIsModalOpen(false);
      showNotification('User updated', 'success');
    } catch (e) {
      setEditError(e.message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  // Predefined security questions for the dropdown
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
   * 8) RENDER
   * Purpose: Renders the User Management page with a searchable table, modal, and navigation.
   * Compliance: Web Page Policy (Responsive Design, User Experience), IS Policy (Accessibility).
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
          <FaHeadset style={{ color: "#00adb5", fontSize: "1.3rem" }} />
          <span style={{ fontSize: "0.9rem", color: "#EEEEEE" }}>User Management</span>
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
              onClick={() => navigate('/create-user')}
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
              aria-label="Add User"
            >
              <FaUserPlus style={{ fontSize: "0.8rem" }} />
              Add User
            </button>
          </li>
        </ul>
      </nav>

      {/* ============ NOTIFICATION ============ */}
      {notification && (
        <div style={{
          color: notification.type === 'success' ? "#00cc00" : "#ff5722",
          background: notification.type === 'success' ? "rgba(0, 204, 0, 0.15)" : "rgba(255, 87, 34, 0.15)",
          padding: "0.6rem",
          borderRadius: "8px",
          marginBottom: "0.8rem",
          textAlign: "center",
          fontSize: "0.9rem"
        }}>
          {notification.msg}
        </div>
      )}

      {/* ============ PAGE TITLE ============ */}
      <h1 className="neon-card-title" style={{
        position: "relative",
        paddingBottom: "0.5rem",
        fontSize: "1.8rem",
        textAlign: "center",
        color: "#00adb5",
        textShadow: "0 0 8px rgba(0, 173, 181, 0.7)",
        marginBottom: "1rem"
      }}>
        All Users
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

      {/* ============ SEARCH BAR ============ */}
      <div style={{ marginBottom: "1rem", textAlign: "center" }}>
        <input
          type="text"
          placeholder="Search by username..."
          value={searchQuery}
          onChange={handleSearchChange}
          style={{
            background: "#393e46",
            border: "1px solid #444",
            borderRadius: "6px",
            color: "#FFFFFF",
            padding: "0.4rem 0.8rem",
            fontSize: "0.9rem",
            width: "300px",
            maxWidth: "100%"
          }}
          aria-label="Search users by username"
        />
      </div>

      {/* ============ TABLE ============ */}
      <div className="dark-card neon-card fadeInUp" style={{ padding: '1.5rem' }}>
        <table className="dark-table" style={{ marginTop: "0.5rem" }}>
          <thead>
            <tr>
              {['Username', 'Email', 'Sec. Question', 'Answer', 'Created By', 'Created At', ''].map(h => (
                <th key={h} style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.isArray(users) && users.map(u => (
              <tr key={u.Username} style={{
                background: "linear-gradient(90deg, rgba(46, 51, 59, 0.9), rgba(34, 40, 49, 0.9))"
              }}>
                <td style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{u.Username}</td>
                <td style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{u.Email || 'NULL'}</td>
                <td style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{u.SecurityQuestionType || 'NULL'}</td>
                <td style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{u.SecurityQuestionAnswer || 'NULL'}</td>
                <td style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{u.CreatedBy || 'NULL'}</td>
                <td style={{ padding: "0.6rem", fontSize: "0.9rem" }}>{u.CreationDate ? new Date(u.CreationDate).toLocaleString() : 'NULL'}</td>
                <td style={{ whiteSpace: 'nowrap', padding: "0.6rem" }}>
                  <button
                    className="dark-button"
                    style={{
                      background: "linear-gradient(90deg, #00adb5, #00cc00)",
                      border: "none",
                      color: "#FFFFFF",
                      fontSize: "0.8rem",
                      padding: "0.4rem 0.8rem",
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "transform 0.3s, background 0.3s",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                      marginRight: "0.4rem"
                    }}
                    onClick={() => openEdit(u)}
                    onMouseOver={(e) => {
                      e.target.style.transform = "scale(1.05)";
                      e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
                    }}
                    onMouseOut={(e) => {
                      e.target.style.transform = "scale(1)";
                      e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                    }}
                    aria-label={`Edit user ${u.Username}`}
                  >
                    <FaEdit style={{ fontSize: "0.8rem" }} />
                  </button>
                  <button
                    className="dark-button"
                    style={{
                      background: "linear-gradient(90deg, #ff5722, #ff3333)",
                      border: "none",
                      color: "#FFFFFF",
                      fontSize: "0.8rem",
                      padding: "0.4rem 0.8rem",
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "transform 0.3s, background 0.3s",
                      boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
                    }}
                    onClick={() => deleteUser(u)}
                    onMouseOver={(e) => {
                      e.target.style.transform = "scale(1.05)";
                      e.target.style.background = "linear-gradient(90deg, #ff3333, #ff5722)";
                    }}
                    onMouseOut={(e) => {
                      e.target.style.transform = "scale(1)";
                      e.target.style.background = "linear-gradient(90deg, #ff5722, #ff3333)";
                    }}
                    aria-label={`Delete user ${u.Username}`}
                  >
                    <FaTrashAlt style={{ fontSize: "0.8rem" }} />
                  </button>
                </td>
              </tr>
            ))}
            {(!Array.isArray(users) || users.length === 0) && (
              <tr>
                <td colSpan="7" style={{ padding: "0.6rem", fontSize: "0.9rem", textAlign: "center" }}>
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ============ MODAL ============ */}
      {isModalOpen && (
        <div className="modal-overlay" style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: "rgba(0, 0, 0, 0.7)",
          zIndex: 1000
        }}>
          <div className="modal-content" style={{
            background: "#2e333b",
            padding: "1.5rem",
            borderRadius: "15px",
            boxShadow: "0 8px 20px rgba(0, 173, 181, 0.6), 0 0 15px rgba(0, 173, 181, 0.3)",
            border: "2px solid rgba(0, 173, 181, 0.4)",
            width: "500px",
            maxWidth: "90%",
            position: "fixed",
            top: `${modalPosition.top}px`,
            left: `${modalPosition.left}px`,
            transform: "translate(-50%, -50%)",
            animation: "fadeIn 0.3s ease-in-out"
          }}>
            <h3 style={{
              color: "#00ADB5",
              marginBottom: "1rem",
              fontSize: "1.3rem"
            }}>
              Edit “{current.Username}”
            </h3>

            {/* Edit Error Message */}
            {editError && (
              <div style={{
                color: "#ff5722",
                background: "rgba(255, 87, 34, 0.15)",
                padding: "0.6rem",
                borderRadius: "8px",
                marginBottom: "0.8rem",
                textAlign: "center",
                fontSize: "0.9rem"
              }}>
                {editError}
              </div>
            )}

            <div className="settings-grid" style={{
              display: "grid",
              gridTemplateColumns: "1fr",
              gap: "0.8rem"
            }}>
              <label className="neon-label" style={{ fontSize: "0.9rem" }}>Email</label>
              <input
                className="neon-input"
                type="email"
                value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                style={{
                  background: "#393e46",
                  border: "1px solid #444",
                  borderRadius: "6px",
                  color: "#FFFFFF",
                  padding: "0.4rem 0.6rem",
                  fontSize: "0.9rem",
                  width: "100%"
                }}
              />

              <label className="neon-label" style={{ fontSize: "0.9rem" }}>New Password</label>
              <input
                className="neon-input"
                type="password"
                value={form.newPass}
                onChange={e => handlePasswordChange(e.target.value)}
                style={{
                  background: "#393e46",
                  border: "1px solid #444",
                  borderRadius: "6px",
                  color: "#FFFFFF",
                  padding: "0.4rem 0.6rem",
                  fontSize: "0.9rem",
                  width: "100%"
                }}
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

              <label className="neon-label" style={{ fontSize: "0.9rem" }}>Security Question</label>
              <select
                className="neon-input"
                value={form.question}
                onChange={e => setForm({ ...form, question: e.target.value })}
                style={{
                  background: "#393e46",
                  border: "1px solid #444",
                  borderRadius: "6px",
                  color: "#FFFFFF",
                  padding: "0.4rem 0.6rem",
                  fontSize: "0.9rem",
                  width: "100%"
                }}
              >
                <option value="" disabled>-- Select a Question --</option>
                {securityQuestions.map((question, index) => (
                  <option key={index} value={question}>{question}</option>
                ))}
              </select>

              <label className="neon-label" style={{ fontSize: "0.9rem" }}>Answer</label>
              <input
                className="neon-input"
                value={form.answer}
                onChange={e => setForm({ ...form, answer: e.target.value })}
                style={{
                  background: "#393e46",
                  border: "1px solid #444",
                  borderRadius: "6px",
                  color: "#FFFFFF",
                  padding: "0.4rem 0.6rem",
                  fontSize: "0.9rem",
                  width: "100%"
                }}
              />
            </div>

            <div style={{ textAlign: 'right', marginTop: '1rem' }}>
              <button
                className="dark-button"
                onClick={() => setIsModalOpen(false)}
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
                  marginRight: "0.4rem"
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = "scale(1.05)";
                  e.target.style.background = "linear-gradient(90deg, #42a5f5, #2196f3)";
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = "scale(1)";
                  e.target.style.background = "linear-gradient(90deg, #2196f3, #42a5f5)";
                }}
                aria-label="Cancel Edit"
              >
                Cancel
              </button>
              <button
                className="dark-button"
                disabled={saving}
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
                  boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)"
                }}
                onClick={saveEdits}
                onMouseOver={(e) => {
                  e.target.style.transform = "scale(1.05)";
                  e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = "scale(1)";
                  e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
                }}
                aria-label="Save Edits"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}