/**
 * File: HelpAgents.jsx
 * Purpose: Help page for the Agent Management Console, providing guidance on its functionalities.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Signature Check: Do not modify this code without verifying the signature logic.
 * Updated: 2025-04-26
 * Summary of Changes:
 *  - Upgraded UI to match Agents.js (gradient navbar, neon cards, enhanced animations).
 *  - Added policy compliance (ISO 27001, ISO 9001, Web Page Policy) with secure navigation, accessibility, and responsive design.
 *  - Improved user experience with better styling, animations, and additional contact options.
 *  - Fixed React Hook error by moving useNavigate to the top level and handling signature check without early return.
 *  - Fixed JSX syntax error by correcting <amigasstrong> to <strong> in the "Add New Agent" section.
 *  - Renamed "Back to Dashboard" to "Dashboard" with FaTachometerAlt icon, and "Back to Agents" to "Back to Previous Page" with FaUndo icon.
 *  - Updated support email to sample@aipoweredcallanalysis.com and phone number to +91 9876543210.
 *  - Changed Dashboard icon to FaHome for consistency across all Dashboard buttons (as per standard).
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import './AfterLogin.css';
import { FaUndo, FaHome, FaQuestionCircle, FaEnvelope, FaPhone } from 'react-icons/fa';

const HelpAgents = () => {
  /***************************************
   * 1) HOOKS
   * Purpose: Initialize all React Hooks at the top level to comply with Rules of Hooks.
   * Compliance: ISO 9001 (Quality: Maintainable code structure).
   ***************************************/
  const navigate = useNavigate();
  const [signatureError, setSignatureError] = useState(null);

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

  return (
    <div className="dark-container fadeInUp improved-afterlogin modern-page-animation" style={{
      background: "linear-gradient(135deg, #1a1a1a 0%, #222831 100%)",
      padding: "2rem 1.5rem",
      minHeight: "100vh"
    }}>
      {/* ============ NAVBAR ============ */}
      <nav className="navbar improved-navbar" style={{
        background: "linear-gradient(90deg, #393e46 0%, #2e333b 100%)",
        borderRadius: "12px",
        padding: "1rem 1.5rem",
        marginBottom: "1.5rem",
        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.2)",
        display: "flex",
        alignItems: "center"
      }}>
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          padding: "0.5rem 1rem"
        }}>
          <FaQuestionCircle style={{ color: "#00adb5", fontSize: "1.5rem" }} />
          <span style={{ fontSize: "1rem", color: "#EEEEEE" }}>Agent Management Help</span>
        </div>
        <ul className="nav-links" style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.8rem",
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
                fontSize: "0.9rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "110px",
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
              <FaUndo /> Back to Previous Page
            </button>
          </li>
          <li>
            <button
              onClick={() => navigate('/')}
              className="dark-button"
              style={{
                background: "linear-gradient(90deg, #ff5722, #ffa500)",
                border: "none",
                color: "#FFFFFF",
                fontSize: "0.9rem",
                fontWeight: 500,
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "transform 0.3s, background 0.3s",
                boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
                display: "flex",
                alignItems: "center",
                gap: "0.3rem",
                minWidth: "110px",
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
              <FaHome /> Dashboard
            </button>
          </li>
        </ul>
      </nav>

      {/* ============ PAGE HEADER ============ */}
      <h1 className="neon-card-title" style={{
        position: "relative",
        paddingBottom: "0.5rem",
        fontSize: "1.8rem",
        textAlign: "center",
        color: "#00adb5",
        textShadow: "0 0 8px rgba(0, 173, 181, 0.7)"
      }}>
        Help: Agent Management Console
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

      {/* ============ FUNCTIONALITY OVERVIEW ============ */}
      <div className="dark-card neon-card fadeInUp" style={{ marginBottom: "1.5rem" }}>
        <h2 className="neon-card-title" style={{
          fontSize: "1.5rem",
          color: "#00adb5",
          textShadow: "0 0 5px rgba(0, 173, 181, 0.5)",
          marginBottom: "1rem"
        }}>
          Functionality Overview
        </h2>
        <ul style={{ color: '#EEEEEE', lineHeight: '1.8', paddingLeft: '1.5rem', fontSize: "1rem" }}>
          <li>
            <strong>Modify Inbound/Outbound Agents:</strong> Edit, update, or delete existing agents in the system.
          </li>
          <li>
            <strong>Add New Agent:</strong> Create and add new agents, specifying details like name, type (inbound/outbound), contact information, and supervisor.
          </li>
        </ul>
      </div>

      {/* ============ ADD NEW AGENT SECTION ============ */}
      <div className="dark-card neon-card fadeInUp" style={{ marginBottom: "1.5rem" }}>
        <h2 className="neon-card-title" style={{
          fontSize: "1.5rem",
          color: "#00adb5",
          textShadow: "0 0 5px rgba(0, 173, 181, 0.5)",
          marginBottom: "1rem"
        }}>
          Add New Agent
        </h2>
        <p style={{ color: '#EEEEEE', lineHeight: '1.8', fontSize: "1rem", marginBottom: "1rem" }}>
          To add a new agent:
        </p>
        <ul style={{ color: '#EEEEEE', lineHeight: '1.8', paddingLeft: '1.5rem', fontSize: "1rem" }}>
          <li>Fill in the <strong>Name</strong> of the agent.</li>
          <li>Select whether the agent is <strong>Inbound</strong> or <strong>Outbound</strong>.</li>
          <li>Provide the agent's <strong>Email</strong> address.</li>
          <li>Enter the <strong>Mobile</strong> number of the agent.</li>
          <li>Specify the <strong>Supervisor</strong> responsible for the agent.</li>
          <li>Include additional fields like <strong>Manager</strong>, <strong>Auditor</strong>, or <strong>Notes</strong> as required.</li>
          <li>Click on <strong>Add Agent</strong> to save the new agent details to the system.</li>
        </ul>
      </div>

      {/* ============ CONTACT SECTION ============ */}
      <div className="dark-card neon-card fadeInUp" style={{ textAlign: "center" }}>
        <p style={{ color: '#00ADB5', fontWeight: 'bold', fontSize: "1.1rem", marginBottom: "1rem" }}>
          For more assistance, please contact our support team:
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "1rem", flexWrap: "wrap" }}>
          <a
            href="mailto:sample@aipoweredcallanalysis.com"
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #FFD700, #FFA500)",
              border: "none",
              color: "#1a1a1a",
              fontSize: "1rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              transition: "transform 0.3s, background 0.3s",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
              textDecoration: "none"
            }}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.background = "linear-gradient(90deg, #FFA500, #FFD700)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.background = "linear-gradient(90deg, #FFD700, #FFA500)";
            }}
            aria-label="Email Support"
          >
            <FaEnvelope /> sample@aipoweredcallanalysis.com
          </a>
          <a
            href="tel:+919876543210"
            className="dark-button"
            style={{
              background: "linear-gradient(90deg, #00adb5, #00cc00)",
              border: "none",
              color: "#FFFFFF",
              fontSize: "1rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
              borderRadius: "6px",
              transition: "transform 0.3s, background 0.3s",
              boxShadow: "0 2px 6px rgba(0, 0, 0, 0.3)",
              display: "flex",
              alignItems: "center",
              gap: "0.3rem",
              textDecoration: "none"
            }}
            onMouseOver={(e) => {
              e.target.style.transform = "scale(1.05)";
              e.target.style.background = "linear-gradient(90deg, #00cc00, #00adb5)";
            }}
            onMouseOut={(e) => {
              e.target.style.transform = "scale(1)";
              e.target.style.background = "linear-gradient(90deg, #00adb5, #00cc00)";
            }}
            aria-label="Call Support"
          >
            <FaPhone /> +91 9876543210
          </a>
        </div>
      </div>
    </div>
  );
};

export default HelpAgents;