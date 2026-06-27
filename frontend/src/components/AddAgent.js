/**
 * File: AddAgent.js
 * Purpose: Component for adding new agents, with improved help pointers and navigation buttons.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-04-26
 * Summary of Changes:
 *  - Aligned UI with Agents.js and HelpAgents.jsx (gradient navbar, neon cards, enhanced animations).
 *  - Updated button styles, sizes, and icons (FaHome for Dashboard, FaUndo for Back to Previous Page).
 *  - Added policy compliance (ISO 27001, ISO 9001, Web Page Policy) with secure navigation, accessibility, and responsive design.
 *  - Simplified initial comment section for consistency.
 *  - Fixed React Hook error by ensuring all hooks are called at the top level before early returns.
 *  - Reduced navbar size and compacted form layout to fit on one page without scrolling.
 */

import React, { useState, useEffect, useRef } from 'react';
import './management-pages.css';
import axios from 'axios';
import {
  FaUser,
  FaEnvelope,
  FaPhone,
  FaUserTie,
  FaStickyNote,
  FaUserCog,
  FaIdBadge,
  FaHome,
  FaUndo,
  FaQuestionCircle
} from 'react-icons/fa';
import { useNavigate } from 'react-router-dom';
import config from '../utils/envConfig';
import { Card, Button, Input, Select, Label, Badge } from './ui';

const AddAgent = () => {
  /***************************************
   * 1) HOOKS
   * Purpose: Initialize all React Hooks at the top level to comply with Rules of Hooks.
   * Compliance: ISO 9001 (Quality: Maintainable code structure).
   ***************************************/
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    agentId: '',
    type: 'Inbound',
    email: '',
    mobile: '',
    supervisor: '',
    manager: '',
    auditor: '',
    notes: '',
    agent_location: ''
  });
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [showHelp, setShowHelp] = useState(false);
  const [pointers, setPointers] = useState([]);

  const [dropdownManagers, setDropdownManagers] = useState([]);
  const [dropdownTeamLeaders, setDropdownTeamLeaders] = useState([]);
  const [dropdownAuditors, setDropdownAuditors] = useState([]);
  const [dropdownLocations, setDropdownLocations] = useState([]);

  const nameRef = useRef(null);
  const agentIdRef = useRef(null);
  const typeRef = useRef(null);
  const emailRef = useRef(null);
  const mobileRef = useRef(null);
  const supervisorRef = useRef(null);
  const managerRef = useRef(null);
  const auditorRef = useRef(null);
  const notesRef = useRef(null);
  const locationRef = useRef(null);
  const submitRef = useRef(null);

  useEffect(() => {
    const fetchDropdowns = async () => {
      try {
        const [mgrRes, tlRes, audRes, locRes] = await Promise.all([
          fetch(`${config.apiBaseUrl}/api/dropdown/managers`).then(r => r.json()),
          fetch(`${config.apiBaseUrl}/api/dropdown/team-leaders`).then(r => r.json()),
          fetch(`${config.apiBaseUrl}/api/dropdown/auditors`).then(r => r.json()),
          fetch(`${config.apiBaseUrl}/api/dropdown/locations`).then(r => r.json()),
        ]);
        if (mgrRes.success) setDropdownManagers(mgrRes.managers || []);
        if (tlRes.success) setDropdownTeamLeaders(tlRes.teamLeaders || []);
        if (audRes.success) setDropdownAuditors(audRes.auditors || []);
        if (locRes.success) setDropdownLocations(locRes.locations || []);
      } catch (err) {
        console.error('Error loading dropdown data:', err.message);
      }
    };
    fetchDropdowns();
  }, []);

  useEffect(() => {
    if (!showHelp) return;

    const newPointers = helpData.map((item) => {
      const rect = item.ref.current?.getBoundingClientRect();
      if (!rect) return null;

      const x1 = rect.left + rect.width / 2;
      const y1 = rect.top + rect.height / 2;
      const x2 = x1 + 200;
      const y2 = y1 - 30;

      const dx = x2 - x1;
      const dy = y2 - y1;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angleRad = Math.atan2(dy, dx);

      return {
        x1,
        y1,
        distance,
        angle: angleRad,
        bubbleX: x2,
        bubbleY: y2,
        text: item.text,
      };
    }).filter(Boolean);

    setPointers(newPointers);

    const hideTime = 20000;
    const timer = setTimeout(() => {
      setShowHelp(false);
    }, hideTime);

    return () => clearTimeout(timer);
  }, [showHelp]);

  const helpData = [
    { ref: nameRef, text: 'Enter the agent\u2019s full name' },
    { ref: agentIdRef, text: 'Provide the Agent Id' },
    { ref: typeRef, text: 'Select agent type (Inbound/Outbound)' },
    { ref: emailRef, text: 'Provide the agent\u2019s email address' },
    { ref: mobileRef, text: 'Enter a valid mobile number' },
    { ref: supervisorRef, text: 'Add the agent\u2019s supervisor name' },
    { ref: managerRef, text: 'Add the agent\u2019s manager name' },
    { ref: auditorRef, text: 'Add the auditor for the agent' },
    { ref: notesRef, text: 'Include additional notes or remarks' },
    { ref: locationRef, text: 'Enter the agent\u2019s location' },
    { ref: submitRef, text: 'Click here to save agent details' },
  ];

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${config.apiBaseUrl}/api/agents`, formData);
      if (res.status === 201) {
        setSuccessMessage('Agent added successfully!');
        setErrorMessage('');
        setFormData({
          name: '',
          agentId: '',
          type: 'Inbound',
          email: '',
          mobile: '',
          supervisor: '',
          manager: '',
          auditor: '',
          notes: '',
          agent_location: ''
        });
      } else {
        setErrorMessage(res.data?.error || 'Failed to add agent. Please try again.');
        setSuccessMessage('');
      }
    } catch (err) {
      console.error('Error adding agent:', err);
      const msg = err.response?.data?.error || err.response?.data?.message;
      setErrorMessage(msg || 'Failed to add agent. Please try again.');
      setSuccessMessage('');
    }
  };

  return (
    <div className="app-page reports-page mgmt-page">
      <div className="mgmt-form-topbar">
        <Button variant="secondary" size="sm" onClick={() => navigate('/agents')}>
          ← Back to agents
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate('/help-add-agent')}>
          <FaQuestionCircle aria-hidden="true" /> Help
        </Button>
      </div>

      {showHelp && (
        <div className="help-overlay-improved">
          {pointers.map((p, i) => (
            <div key={i}>
              <div
                className="line-container"
                style={{
                  left: p.x1,
                  top: p.y1,
                  transform: `rotate(${p.angle}rad)`,
                }}
              >
                <div
                  className="help-line-improved"
                  style={{ '--line-width': `${p.distance}px` }}
                />
                <div
                  className="help-diamond-improved"
                  style={{ '--diamond-dist': `${p.distance * 0.6}px` }}
                />
              </div>
              <div
                className="help-bubble-improved"
                style={{ left: p.bubbleX, top: p.bubbleY }}
              >
                {p.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {successMessage && (
        <div className="auth-alert auth-alert--success" style={{ marginBottom: "var(--space-3)" }}>
          {successMessage}
        </div>
      )}
      {errorMessage && (
        <div className="auth-alert auth-alert--error" style={{ marginBottom: "var(--space-3)" }}>
          {errorMessage}
        </div>
      )}

      <div className="mgmt-form-page">
        <Card className="mgmt-form-card">
          <div className="reports-section__head" style={{ marginBottom: 'var(--space-4)' }}>
            <h2>Add agent</h2>
            <p>Register a new call-center agent for uploads and reporting.</p>
          </div>
          <form onSubmit={handleSubmit} className="mgmt-form-grid">
          <div ref={nameRef}>
            <Label>Name *</Label>
            <Input type="text" name="name" placeholder="Name" value={formData.name} onChange={handleChange} required />
          </div>

          <div ref={agentIdRef}>
            <Label>Agent ID *</Label>
            <Input type="text" name="agentId" placeholder="Agent Id" value={formData.agentId} onChange={handleChange} required />
          </div>

          <div ref={typeRef}>
            <Label>Type *</Label>
            <Select name="type" value={formData.type} onChange={handleChange} required>
              <option value="Inbound">Inbound</option>
              <option value="Outbound">Outbound</option>
            </Select>
          </div>

          <div ref={emailRef}>
            <Label>Email <span className="mgmt-field-optional">(optional)</span></Label>
            <Input type="email" name="email" placeholder="Email" value={formData.email} onChange={handleChange} />
          </div>

          <div ref={mobileRef}>
            <Label>Mobile <span className="mgmt-field-optional">(optional)</span></Label>
            <Input type="text" name="mobile" placeholder="Mobile" value={formData.mobile} onChange={handleChange} />
          </div>

          <div ref={supervisorRef}>
            <Label>Supervisor (Team Leader) *</Label>
            <Select name="supervisor" value={formData.supervisor} onChange={handleChange} required>
              <option value="">-- Select Supervisor --</option>
              {dropdownTeamLeaders.map(tl => (
                <option key={tl.UserID || tl.Username} value={tl.Username}>{tl.Username}</option>
              ))}
            </Select>
          </div>

          <div ref={managerRef}>
            <Label>Manager</Label>
            <Select name="manager" value={formData.manager} onChange={handleChange}>
              <option value="">-- Select Manager --</option>
              {dropdownManagers.map(m => (
                <option key={m.UserID || m.Username} value={m.Username}>{m.Username}</option>
              ))}
            </Select>
          </div>

          <div ref={auditorRef}>
            <Label>Auditor</Label>
            <Select name="auditor" value={formData.auditor} onChange={handleChange}>
              <option value="">-- Select Auditor --</option>
              {dropdownAuditors.map(a => (
                <option key={a.UserID || a.Username} value={a.Username}>{a.Username}</option>
              ))}
            </Select>
          </div>

          <div ref={locationRef}>
            <Label>Location</Label>
            <Select name="agent_location" value={formData.agent_location} onChange={handleChange}>
              <option value="">-- Select Location --</option>
              {dropdownLocations.map(loc => (
                <option key={loc.LocationID || loc.LocationName} value={loc.LocationName}>{loc.LocationName}</option>
              ))}
            </Select>
          </div>

          <div ref={notesRef} className="mgmt-field--full">
            <Label>Notes</Label>
            <textarea
              name="notes"
              placeholder="Notes"
              className="ui-textarea"
              value={formData.notes}
              onChange={handleChange}
              style={{ minHeight: "80px" }}
            />
          </div>

          <div ref={submitRef} className="mgmt-form-actions">
            <Button variant="secondary" type="button" onClick={() => navigate('/agents')}>
              Cancel
            </Button>
            <Button variant="primary" type="submit">Add Agent</Button>
          </div>
        </form>
        </Card>
      </div>
    </div>
  );
};

export default AddAgent;
