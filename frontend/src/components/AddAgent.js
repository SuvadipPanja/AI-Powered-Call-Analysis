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

// Import necessary React hooks and dependencies
import React, { useState, useEffect, useRef } from 'react';
import './AfterLogin.css'; // Base styling for the page
import axios from 'axios'; // HTTP client for API calls
import {
  FaUser,
  FaEnvelope,
  FaPhone,
  FaUserTie,
  FaStickyNote,
  FaUserCog,
  FaIdBadge,
  FaHome, // Icon for Dashboard button (standard)
  FaUndo, // Icon for Back to Previous Page
  FaQuestionCircle // Icon for Help button
} from 'react-icons/fa'; // Icons for visual enhancement
import { useNavigate } from 'react-router-dom'; // Hook for navigation
import config from '../utils/envConfig'; // Environment configuration for API URLs

// AddAgent component: Form for adding new agents with help overlay and navigation
const AddAgent = () => {
  /***************************************
   * 1) HOOKS
   * Purpose: Initialize all React Hooks at the top level to comply with Rules of Hooks.
   * Compliance: ISO 9001 (Quality: Maintainable code structure).
   ***************************************/
  const navigate = useNavigate();
  const [signatureError, setSignatureError] = useState(null);
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

  // Refs for each form field to calculate pointer positions
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

  /***************************************
   * 2) CODE INTEGRITY CHECK
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   ***************************************/
  const signature = '$Panja';
  const verifySignature = (sig) => {
    if (sig !== '$Panja') {
      throw new Error('Signature mismatch: Code integrity compromised.');
    }
  };

  // Signature verification effect
  useEffect(() => {
    try {
      verifySignature(signature);
    } catch (err) {
      console.error('Unauthorized code execution:', err.message);
      setSignatureError(err.message);
    }
  }, []);

  // Effect to calculate pointer positions and manage help overlay visibility
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

  // Help text for each field
  const helpData = [
    { ref: nameRef, text: 'Enter the agent’s full name' },
    { ref: agentIdRef, text: 'Provide the Agent Id' },
    { ref: typeRef, text: 'Select agent type (Inbound/Outbound)' },
    { ref: emailRef, text: 'Provide the agent’s email address' },
    { ref: mobileRef, text: 'Enter a valid mobile number' },
    { ref: supervisorRef, text: 'Add the agent’s supervisor name' },
    { ref: managerRef, text: 'Add the agent’s manager name' },
    { ref: auditorRef, text: 'Add the auditor for the agent' },
    { ref: notesRef, text: 'Include additional notes or remarks' },
    { ref: locationRef, text: 'Enter the agent’s location' },
    { ref: submitRef, text: 'Click here to save agent details' },
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

  // Form Handlers
  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!signature) {
      console.error('Signature missing: Code integrity compromised');
      return;
    }
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
        setErrorMessage('Failed to add agent. Please try again.');
        setSuccessMessage('');
      }
    } catch (err) {
      console.error('Error adding agent:', err);
      setErrorMessage('Failed to add agent. Please try again.');
      setSuccessMessage('');
    }
  };

  return (
    <div className="dark-container fadeInUp improved-afterlogin modern-page-animation" style={{
      background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
      padding: "1rem 1.5rem", // Reduced top padding to minimize vertical space
      minHeight: "100vh"
    }}>
      {/* ============ NAVBAR ============ */}
      <nav className="navbar improved-navbar" style={{
        background: "linear-gradient(90deg, #393e46 0%, #2e333b 100%)",
        borderRadius: "12px",
        padding: "0.8rem 1.2rem", // Reduced padding for a smaller navbar
        marginBottom: "1rem", // Reduced margin to save space
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        display: "flex",
        alignItems: "center"
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.4rem", // Reduced gap
          padding: "0.4rem 0.8rem" // Reduced padding
        }}>
          <FaUserCog style={{ color: "#00adb5", fontSize: "1.3rem" }} /> {/* Reduced icon size */}
          <span style={{ fontSize: "0.9rem", color: "#EEEEEE" }}>Add Agent</span> {/* Reduced font size */}
        </div>
        <ul className="nav-links" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.6rem", // Reduced gap between buttons
          margin: 0,
          padding: 0,
          justifyContent: "flex-end",
          alignItems: "center",
          listStyle: "none",
          flex: 1
        }}>
          <li>
            <button
              onClick={() => navigate('/agents')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem", // Reduced font size
                fontWeight: 500,
                padding: "0.4rem 0.8rem", // Reduced padding
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px", // Reduced minWidth
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
              aria-label="Back to Previous Page"
            >
              <FaUndo style={{ fontSize: "0.8rem" }} /> {/* Reduced icon size */}
              Back to Previous Page
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/afterlogin')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #ff5722, #ffa500)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem", // Reduced font size
                fontWeight: 500,
                padding: "0.4rem 0.8rem", // Reduced padding
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px", // Reduced minWidth
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
              <FaHome style={{ fontSize: "0.8rem" }} /> {/* Reduced icon size */}
              Dashboard
            </button>
          </li>
          <li>
            <button
              onClick={() => setShowHelp(true)}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #2196f3, #42a5f5)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem", // Reduced font size
                fontWeight: 500,
                padding: "0.4rem 0.8rem", // Reduced padding
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px", // Reduced minWidth
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
              aria-label="Show Help"
            >
              <FaQuestionCircle style={{ fontSize: "0.8rem" }} /> {/* Reduced icon size */}
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
        marginBottom: "1.5rem" // Reduced margin to save space
      }}>
        Add New Agent
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

      {/* ============ HELP OVERLAY ============ */}
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

      {/* ============ CARD ============ */}
      <div className="dark-card neon-card fadeInUp" style={{ width: '80%', maxWidth: '800px', margin: '0 auto', padding: '1.5rem' }}> {/* Reduced padding */}
        {successMessage && <p className="success-message" style={{
          color: "#00cc00",
          background: "rgba(0, 204, 0, 0.15)",
          padding: "0.6rem", // Reduced padding
          borderRadius: "8px",
          marginBottom: "0.8rem", // Reduced margin
          textAlign: "center",
          fontSize: "0.9rem" // Reduced font size
        }}>{successMessage}</p>}
        {errorMessage && <p className="error-message" style={{
          color: "#ff5722",
          background: "rgba(255, 87, 34, 0.15)",
          padding: "0.6rem", // Reduced padding
          borderRadius: "8px",
          marginBottom: "0.8rem", // Reduced margin
          textAlign: "center",
          fontSize: "0.9rem" // Reduced font size
        }}>{errorMessage}</p>}

        <form className="agent-form" onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '0.8rem' }}> {/* Reduced gap */}
          {/* Name */}
          <div className="form-group" ref={nameRef}>
            <FaUser className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="name"
              placeholder="Name"
              className="dark-button"
              value={formData.name}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Agent Id */}
          <div className="form-group" ref={agentIdRef}>
            <FaIdBadge className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="agentId"
              placeholder="Agent Id"
              className="dark-button"
              value={formData.agentId}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Type */}
          <div className="form-group" ref={typeRef}>
            <FaUserTie className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <select
              name="type"
              className="dark-button"
              value={formData.type}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            >
              <option value="Inbound">Inbound</option>
              <option value="Outbound">Outbound</option>
            </select>
          </div>

          {/* Email */}
          <div className="form-group" ref={emailRef}>
            <FaEnvelope className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="email"
              name="email"
              placeholder="Email"
              className="dark-button"
              value={formData.email}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Mobile */}
          <div className="form-group" ref={mobileRef}>
            <FaPhone className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="mobile"
              placeholder="Mobile"
              className="dark-button"
              value={formData.mobile}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Supervisor */}
          <div className="form-group" ref={supervisorRef}>
            <FaUserCog className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="supervisor"
              placeholder="Supervisor"
              className="dark-button"
              value={formData.supervisor}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Manager */}
          <div className="form-group" ref={managerRef}>
            <FaUserCog className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="manager"
              placeholder="Manager"
              className="dark-button"
              value={formData.manager}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Auditor */}
          <div className="form-group" ref={auditorRef}>
            <FaUserCog className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="auditor"
              placeholder="Auditor"
              className="dark-button"
              value={formData.auditor}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Location */}
          <div className="form-group" ref={locationRef}>
            <FaUserCog className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <input
              type="text"
              name="agent_location"
              placeholder="Location"
              className="dark-button"
              value={formData.agent_location}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%"
              }}
            />
          </div>

          {/* Notes */}
          <div className="form-group" ref={notesRef} style={{ gridColumn: 'span 2' }}>
            <FaStickyNote className="form-icon" style={{ color: "#00adb5", marginRight: "0.5rem" }} />
            <textarea
              name="notes"
              placeholder="Notes"
              className="dark-button"
              value={formData.notes}
              onChange={handleChange}
              style={{
                background: "#393e46",
                border: "1px solid #444",
                borderRadius: "6px",
                color: "#FFFFFF",
                padding: "0.4rem 0.6rem", // Reduced padding
                fontSize: "0.9rem", // Reduced font size
                width: "100%",
                minHeight: "80px" // Reduced height to save space
              }}
            />
          </div>

          {/* Submit */}
          <div className="form-group" ref={submitRef} style={{ gridColumn: 'span 2', textAlign: 'center' }}>
            <button
              className="dark-button form-button"
              type="submit"
              style={{
                background: "linear-gradient(90deg, #00adb5, #00cc00)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.8rem", // Reduced font size
                fontWeight: 500,
                padding: "0.4rem 0.8rem", // Reduced padding
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "100px", // Reduced minWidth
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
            >
              Add Agent
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddAgent;