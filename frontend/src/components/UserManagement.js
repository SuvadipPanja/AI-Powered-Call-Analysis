/**
 * File: UserManagement.js
 * Purpose: Component for managing users, including listing, editing, deleting, and searching users. * Creation Date: 2024-12-27 * Updated: 2025-06-13
 * Summary of Changes:
 *  - Added UserID column to the user table to reflect the new primary key for login.
 */

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  FaUserPlus,
  FaEdit,
  FaTrashAlt,
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import './management-pages.css';
import {
  deleteUser as deleteUserApi,
  listUsers,
  searchUsers,
  updateUserEmail,
  updateUserPassword,
  updateUserRole,
  updateUserSecurityQuestion,
} from '../services/usersService';
import { Card, Button, Input, Select, Label, Modal, Badge, UserAvatar } from './ui';

export default function UserManagement() {
  /***************************************
   * 1) HOOKS
   * Purpose: Initialize all React Hooks at the top level to comply with Rules of Hooks.
   * Compliance: ISO 9001 (Quality: Maintainable code structure).
   ***************************************/
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [notification, setNotification] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const [form, setForm] = useState({
    email: '',
    newPass: '',
    question: '',
    answer: '',
    role: ''
  });
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [passwordHint, setPasswordHint] = useState('');
  const [passwordStrength, setPasswordStrength] = useState(0);
  const [showHint, setShowHint] = useState(false);

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

  const showNotification = useCallback((msg, type) => {
    setNotification({ msg, type });
    setTimeout(() => setNotification(null), 4000);
  }, []);

  /***************************************
   * 5) FETCH USERS
   * Purpose: Fetches the list of users from the API on component mount.
   * Compliance: ISO 27001 (Secure API calls).
   ***************************************/
  const loadUsers = useCallback(async () => {
    try {
      const d = await listUsers();
      if (d.success && Array.isArray(d.users)) {
        setUsers(d.users);
      } else {
        setUsers([]);
        showNotification('Failed to load users: Invalid response', 'error');
      }
    } catch {
      setUsers([]);
      showNotification('Failed to load users', 'error');
    }
  }, [showNotification]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  /***************************************
   * 6) SEARCH USERS
   * Purpose: Fetches users filtered by username from the API.
   * Compliance: ISO 27001 (Secure API calls).
   ***************************************/
  const debounce = (func, delay) => {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func(...args), delay);
    };
  };

  const searchUsersHandler = async (query) => {
    try {
      const data = await searchUsers(query);
      if (data.success && Array.isArray(data.users)) {
        setUsers(data.users);
      } else {
        setUsers([]);
        showNotification('No users found', 'error');
      }
    } catch (err) {
      console.error('Error searching users:', err.message);
      setUsers([]);
      showNotification('Failed to search users', 'error');
    }
  };

  const debouncedSearch = debounce((query) => {
    if (query.trim() === '') {
      loadUsers();
    } else {
      searchUsersHandler(query.trim());
    }
  }, 300);

  const handleSearchChange = (e) => {
    const query = e.target.value;
    setSearchQuery(query);
    debouncedSearch(query);
  };

  /***************************************
   * 7) HELPERS
   * Purpose: Utility functions for user actions.
   * Compliance: ISO 9001 (Quality: Modular code).
   ***************************************/
  const openEdit = u => {
    setCurrent(u);
    setForm({
      email: u.Email || '',
      newPass: '',
      question: u.SecurityQuestionType || '',
      answer: u.SecurityQuestionAnswer || '',
      role: u.AccountType || ''
    });
    setEditError('');
    setPasswordHint('');
    setPasswordStrength(0);
    setShowHint(false);
    setIsModalOpen(true);
  };

  const deleteUser = async (u) => {
    if (!window.confirm(`Delete user "${u.Username}"?`)) return;
    try {
      const json = await deleteUserApi(u.Username);
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
    setEditError('');
    const username = current.Username;
    const tasks = [
      updateUserEmail(username, form.email),
    ];

    if (form.newPass) {
      tasks.push(updateUserPassword(username, form.newPass));
    }

    if (form.answer && form.answer.trim()) {
      tasks.push(updateUserSecurityQuestion(username, { question: form.question, answer: form.answer }));
    }

    if (form.role && form.role !== current.AccountType) {
      tasks.push(updateUserRole(username, form.role));
    }

    try {
      const results = await Promise.all(tasks);
      const fail = results.find(r => !r.success);
      if (fail) throw new Error(fail.message || 'Update failed');
      setUsers(prev =>
        prev.map(u =>
          u.Username === username
            ? { ...u, Email: form.email, SecurityQuestionType: form.question, SecurityQuestionAnswer: form.answer, AccountType: form.role }
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

  const securityQuestions = [
    "Favorite game",
    "Mother's maiden name",
    "First pet's name",
    "Favorite color",
    "Where you were born"
  ];

  /***************************************
   * 8) RENDER
   * Purpose: Renders the User Management page with a searchable table, modal, and navigation.
   * Compliance: Web Page Policy (Responsive Design, User Experience), IS Policy (Accessibility).
   ***************************************/
  return (
    <div className="app-page reports-page mgmt-page">
      {notification && (
        <div className={`auth-alert auth-alert--${notification.type === 'success' ? 'success' : 'error'}`}>
          {notification.msg}
        </div>
      )}

      <section className="reports-section mgmt-page__head">
        <div className="mgmt-page__head-row">
          <div className="reports-section__head">
            <h2>Users</h2>
            <p>Manage platform accounts — team leaders, managers, agents, and admins.</p>
          </div>
          <div className="mgmt-toolbar__actions">
            <Button variant="primary" onClick={() => navigate('/create-user')}>
              <FaUserPlus aria-hidden="true" /> Create user
            </Button>
          </div>
        </div>
      </section>

      <div className="mgmt-toolbar">
        <Input
          type="text"
          placeholder="Search by username…"
          value={searchQuery}
          onChange={handleSearchChange}
          aria-label="Search users by username"
        />
      </div>

      <Card className="mgmt-table-card">
        <div className="mgmt-table-wrap ui-table-wrap ui-table-wrap--stack">
        <table className="ui-table ui-table--stack-sm" aria-label="User accounts">
          <thead>
            <tr>
              {['Username', 'UserID', 'Role', 'Email', 'Sec. Question', 'Created By', 'Created At', ''].map(h => (
                <th key={h || 'actions'} scope="col">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.isArray(users) && users.map(u => (
              <tr key={u.Username}>
                <td data-label="Username">
                  <span className="mgmt-user-cell">
                    <UserAvatar username={u.Username} size="sm" alt="" />
                    <span>{u.Username}</span>
                  </span>
                </td>
                <td className="ui-table__col--hide-sm" data-label="UserID">{u.UserID || 'NULL'}</td>
                <td data-label="Role">
                  <Badge variant={
                    u.AccountType === 'Super Admin' ? 'info' :
                    u.AccountType === 'Admin' ? 'info' :
                    u.AccountType === 'Manager' ? 'success' :
                    u.AccountType === 'Team Leader' ? 'warning' :
                    u.AccountType === 'Auditor' ? 'default' :
                    'default'
                  }>
                    {u.AccountType || 'Agent'}
                  </Badge>
                </td>
                <td className="ui-table__col--hide-sm" data-label="Email">{u.Email || 'NULL'}</td>
                <td className="ui-table__col--hide-sm" data-label="Sec. Question">{u.SecurityQuestionType || 'NULL'}</td>
                <td className="ui-table__col--hide-sm" data-label="Created By">{u.CreatedBy || 'NULL'}</td>
                <td data-label="Created At">{u.CreationDate ? new Date(u.CreationDate).toLocaleString() : 'NULL'}</td>
                <td data-label="Actions" className="ui-table__cell--actions" style={{ whiteSpace: 'nowrap' }}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => openEdit(u)}
                    style={{ marginRight: "0.4rem" }}
                    aria-label={`Edit user ${u.Username}`}
                  >
                    <FaEdit />
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => deleteUser(u)}
                    aria-label={`Delete user ${u.Username}`}
                  >
                    <FaTrashAlt />
                  </Button>
                </td>
              </tr>
            ))}
            {(!Array.isArray(users) || users.length === 0) && (
              <tr>
                <td colSpan="8" style={{ textAlign: "center", color: "var(--text-muted)" }}>
                  No users found
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>
      </Card>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} maxWidth="540px">
        {current && (
          <>
            <h3 style={{ margin: "0 0 var(--space-3)", color: "var(--text-strong)", fontFamily: "var(--font-display)" }}>
              Edit &ldquo;{current.Username}&rdquo;
            </h3>

            {editError && (
              <div className="auth-alert auth-alert--error" style={{ marginBottom: "var(--space-3)" }}>
                {editError}
              </div>
            )}

            <div className="mgmt-modal-grid">
              <div className="mgmt-field--full">
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onChange={e => setForm({ ...form, role: e.target.value })}
                >
                  <option value="" disabled>-- Select Role --</option>
                  <option value="Super Admin">Super Admin</option>
                  <option value="Admin">Admin</option>
                  <option value="Manager">Manager</option>
                  <option value="Team Leader">Team Leader</option>
                  <option value="Auditor">Auditor</option>
                  <option value="Agent">Agent</option>
                  <option value="IT">IT</option>
                </Select>
              </div>

              <div className="mgmt-field--full">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                />
              </div>

              <div className="mgmt-field--full">
                <Label>New Password</Label>
                <Input
                  type="password"
                  value={form.newPass}
                  onChange={e => handlePasswordChange(e.target.value)}
                />
                {showHint && (
                  <div style={{ marginTop: "var(--space-2)", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
                    <div style={{
                      width: "100px",
                      height: "4px",
                      borderRadius: "2px",
                      background: passwordStrength === 100 ? "var(--success)" : passwordStrength >= 80 ? "var(--warning)" : "var(--danger)"
                    }} />
                    <span style={{
                      color: passwordStrength === 100 ? "var(--success)" : passwordStrength >= 80 ? "var(--warning)" : "var(--danger)",
                      fontSize: "0.8rem",
                      fontWeight: "600"
                    }}>
                      {passwordHint}
                    </span>
                  </div>
                )}
              </div>

              <div className="mgmt-field--full">
                <Label>Security Question</Label>
                <Select
                  value={form.question}
                  onChange={e => setForm({ ...form, question: e.target.value })}
                >
                  <option value="" disabled>-- Select a Question --</option>
                  {securityQuestions.map((question, index) => (
                    <option key={index} value={question}>{question}</option>
                  ))}
                </Select>
              </div>

              <div className="mgmt-field--full">
                <Label>Answer</Label>
                <Input
                  value={form.answer}
                  onChange={e => setForm({ ...form, answer: e.target.value })}
                />
              </div>
            </div>

            <div className="mgmt-modal-actions">
              <Button variant="secondary" onClick={() => setIsModalOpen(false)} aria-label="Cancel Edit">
                Cancel
              </Button>
              <Button variant="primary" disabled={saving} onClick={saveEdits} aria-label="Save Edits">
                {saving ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
