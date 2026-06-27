/**
 * File: HelpAgents.jsx
 * Purpose: Help page for the Agent Management Console.
 * Author: $Panja
 * Creation Date: 2024-12-27
 * Updated: 2025-04-26
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { FaUndo, FaHome, FaQuestionCircle, FaEnvelope, FaPhone } from 'react-icons/fa';
import { Card, Button } from './ui';
import PageSection from './ui/PageSection';

const HelpAgents = () => {
  const navigate = useNavigate();

  return (
    <div className="app-page reports-page">
      <PageSection title="Functionality Overview">
        <ul style={{ color: 'var(--text)', lineHeight: '1.8', paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
          <li>
            <strong>Modify Inbound/Outbound Agents:</strong> Edit, update, or delete existing agents in the system.
          </li>
          <li>
            <strong>Add New Agent:</strong> Create and add new agents, specifying details like name, type (inbound/outbound), contact information, and supervisor.
          </li>
        </ul>
      </PageSection>

      <PageSection title="Add New Agent">
        <p style={{ color: 'var(--text)', lineHeight: '1.8', fontSize: '0.95rem', marginBottom: '1rem' }}>
          To add a new agent:
        </p>
        <ul style={{ color: 'var(--text)', lineHeight: '1.8', paddingLeft: '1.5rem', fontSize: '0.95rem' }}>
          <li>Fill in the <strong>Name</strong> of the agent.</li>
          <li>Select whether the agent is <strong>Inbound</strong> or <strong>Outbound</strong>.</li>
          <li>Provide the agent's <strong>Email</strong> address.</li>
          <li>Enter the <strong>Mobile</strong> number of the agent.</li>
          <li>Specify the <strong>Supervisor</strong> responsible for the agent.</li>
          <li>Include additional fields like <strong>Manager</strong>, <strong>Auditor</strong>, or <strong>Notes</strong> as required.</li>
          <li>Click on <strong>Add Agent</strong> to save the new agent details to the system.</li>
        </ul>
      </PageSection>

      <PageSection title="Contact Support">
        <p style={{ color: 'var(--accent)', fontWeight: 600, marginBottom: '1rem', textAlign: 'center' }}>
          For more assistance, please contact our support team:
        </p>
        <div style={{ display: "flex", justifyContent: "center", gap: "var(--space-3)", flexWrap: "wrap" }}>
          <Button
            variant="secondary"
            onClick={() => window.location.href = 'mailto:sample@aipoweredcallanalysis.com'}
            aria-label="Email Support"
          >
            <FaEnvelope /> sample@aipoweredcallanalysis.com
          </Button>
          <Button
            onClick={() => window.location.href = 'tel:+919876543210'}
            aria-label="Call Support"
          >
            <FaPhone /> +91 9876543210
          </Button>
        </div>
      </PageSection>
    </div>
  );
};

export default HelpAgents;
