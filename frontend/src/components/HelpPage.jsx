/**
 * Help Page Component
 * Creation Date: 2024-12-27
 * Author: SPanja
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import './AfterLogin.css'; // Reusing the same CSS

// Hardcoded signature for SPanja
const signature = "SPanja";

const HelpPage = () => {
  const navigate = useNavigate();

  // Check for signature before rendering
  if (signature !== "SPanja") {
    console.error("Unauthorized code execution! Signature mismatch.");
    return null; // Exit if the signature does not match
  }

  return (
    <div className="dark-container">
      {/* Navigation Buttons */}
      <div className="dark-card fadeIn" style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <button
          className="dark-button"
          style={{
            padding: '0.8rem 1.5rem',
            marginRight: '1rem',
            fontSize: '1rem',
            borderRadius: '8px',
            background: '#00ADB5',
            color: '#FFF',
            cursor: 'pointer',
          }}
          onClick={() => navigate('/upload')}
        >
          Back to Audio Upload Page
        </button>
        <button
          className="dark-button"
          style={{
            padding: '0.8rem 1.5rem',
            fontSize: '1rem',
            borderRadius: '8px',
            background: '#FF5722',
            color: '#FFF',
            cursor: 'pointer',
          }}
          onClick={() => navigate('/')}
        >
          Back to Home Page
        </button>
      </div>

      {/* Page Header */}
      <div className="dark-card fadeIn">
        <h1 className="card-title">Help: How to Upload Audio Files</h1>
        <p>This guide provides step-by-step instructions to upload audio files for AI analysis.</p>
      </div>

      {/* Instructions Section */}
      <div className="dark-card fadeIn">
        <h2 className="card-title">Audio Upload Guidelines</h2>
        <ol style={{ color: '#EEEEEE', lineHeight: '1.8', paddingLeft: '1.5rem' }}>
          <li>Click on the "Choose File" button on the Upload page.</li>
          <li>Select an audio file from your device .</li>
          <li>Ensure that the file size does not exceed <strong>15 MB</strong>.</li>
          <li>Select the call date using the date picker provided.</li>
          <li>Choose the type of call: <strong>Inbound</strong> or <strong>Outbound</strong>.</li>
          <li>Pick an agent from the dropdown list.</li>
          <li>Once all fields are filled, click on the <strong>"Submit for AI Analysis"</strong> button.</li>
          <li>Wait for the upload process to complete. A confirmation message will appear on success.</li>
          <li>Contact support if you face persistent issues while uploading.</li>
        </ol>
      </div>

      {/* Contact Section */}
      <div className="dark-card fadeIn">
        <p style={{ color: '#00ADB5', fontWeight: 'bold', textAlign: 'center' }}>
          For more assistance, please contact our support team at: <br />
          <a
            href="support@gmail.com"
            style={{ color: '#FFD700', textDecoration: 'underline', fontWeight: 'bold' }}
          >
            support@gmail.com
          </a>
        </p>
      </div>
    </div>
  );
};

export default HelpPage;
