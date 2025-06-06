import React from 'react';
import { Link } from 'react-router-dom';
import './AfterLogin.css'; // Import the neon theme styles

const LicenseErrorPage = () => {
  return (
    <div className="license-error-container">
      <h1 className="error-title">License Validation Failed</h1>
      <p className="error-message">
        The application cannot proceed due to an invalid or expired license.
        Please contact the administrator to resolve this issue.
      </p>
      <Link to="/temp-super-admin-login" className="error-link">
        Super Admin: Upload New License
      </Link>
      <Link to="/login" className="error-link" style={{ marginLeft: '10px' }}>
        Back to Login
      </Link>
    </div>
  );
};

export default LicenseErrorPage;