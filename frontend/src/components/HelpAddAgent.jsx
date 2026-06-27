import React from "react";
import { useNavigate } from "react-router-dom";
import { FaArrowLeft, FaHome, FaUserPlus, FaEnvelope } from "react-icons/fa";
import { Button } from "./ui";
import PageSection from "./ui/PageSection";

const HelpAddAgent = () => {
  const navigate = useNavigate();
  const signature = "$Panja";
  if (!signature) {
    console.error("Signature missing: Code integrity compromised");
    return null;
  }

  return (
    <div className="app-page reports-page app-stagger">
      <PageSection title="Step-by-step guide" className="chart-card-enter">
        <ol style={{ color: "var(--text)", lineHeight: "1.9", paddingLeft: "1.5rem", fontSize: "0.95rem", margin: 0 }}>
          <li>Navigate to the Add New Agent page from Agent Management.</li>
          <li>Enter the agent&apos;s full name.</li>
          <li>Select agent type: Inbound or Outbound.</li>
          <li>Provide email, mobile number, and supervisor name.</li>
          <li>Optionally fill Manager, Auditor, and Notes fields.</li>
          <li>Review all details, then click <strong>Add Agent</strong>.</li>
          <li>Wait for the success confirmation message.</li>
          <li>If errors appear, resolve missing fields and try again.</li>
        </ol>
      </PageSection>

      <PageSection title="Need help?" className="chart-card-enter">
        <p style={{ color: "var(--text-muted)", textAlign: "center", marginBottom: "var(--space-4)" }}>
          Contact support for assistance with agent onboarding.
        </p>
        <div style={{ textAlign: "center" }}>
          <Button variant="secondary" onClick={() => window.location.href = "mailto:help@gmail.com"}>
            <FaEnvelope /> help@gmail.com
          </Button>
        </div>
      </PageSection>
    </div>
  );
};

export default HelpAddAgent;
