import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import config from '../utils/envConfig';
import { FaArrowLeft, FaHome, FaSignOutAlt, FaKey, FaCalendar, FaUser, FaShieldAlt, FaTrash, FaInfo, FaExclamationTriangle, FaUpload, FaSpinner } from 'react-icons/fa';
import './AfterLogin.css';

const LicenseManagement = ({ username, onLogout, userType }) => {
  /*************************************************
   * (1) Code Integrity Check
   * Purpose: Ensures the code has not been tampered with.
   * Compliance: IS Policy (Security), Code Audit Policy.
   *************************************************/
  const signature = "$Panja";
  const verifySignature = (sig) => {
    if (sig !== "$Panja") {
      throw new Error("Signature mismatch: Code integrity compromised.");
    }
  };
  verifySignature(signature);

  /*************************************************
   * (2) Access Control
   * Purpose: Restrict access to Super Admins only, no session validation.
   * Compliance: IS Policy (Security: Access Control).
   *************************************************/
  const navigate = useNavigate();
  const [isSuperAdmin, setIsSuperAdmin] = useState(userType === 'Super Admin');

  useEffect(() => {
    console.log('LicenseManagement props:', { username, userType, isSuperAdmin });
    if (!userType || !username) {
      console.error('Missing userType or username props. Redirecting to login...');
      navigate("/login");
      return;
    }
    if (!isSuperAdmin) {
      console.log('User is not a Super Admin. Redirecting to license-error...');
      navigate("/license-error");
    }
  }, [isSuperAdmin, userType, username, navigate]);

  /*************************************************
   * (3) State Variables
   * Purpose: Manages component state for license data and UI.
   * Compliance: IS Policy (Performance: Efficient state management).
   *************************************************/
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseHistory, setLicenseHistory] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(true);
  const [selectedLicense, setSelectedLicense] = useState(null);
  const [licenseStatus, setLicenseStatus] = useState(null);

  /*************************************************
   * (4) Fetch License Data
   * Purpose: Fetches license history and status without session validation.
   * Compliance: IS Policy (Performance: Efficient data fetching).
   *************************************************/
  useEffect(() => {
    const fetchLicenseData = async () => {
      if (!isSuperAdmin) return;

      try {
        console.log('Fetching license history for username:', username);
        const historyResponse = await fetch(`${config.apiBaseUrl}/api/license-history?username=${username}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!historyResponse.ok) {
          const errorText = await historyResponse.text();
          throw new Error(`Failed to fetch license history: HTTP status ${historyResponse.status}, ${errorText}`);
        }
        const historyData = await historyResponse.json();
        console.log('License history response:', historyData);
        if (historyData.success) {
          setLicenseHistory(historyData.licenses || []);
        } else {
          throw new Error(historyData.message || 'Failed to fetch license history.');
        }

        console.log('Fetching license status...');
        const statusResponse = await fetch(`${config.apiBaseUrl}/api/license-status`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          throw new Error(`Failed to fetch license status: HTTP status ${statusResponse.status}, ${errorText}`);
        }
        const statusData = await statusResponse.json();
        console.log('License status response:', statusData);
        if (statusData.success) {
          setLicenseStatus({
            isExpired: statusData.isExpired,
            daysUntilExpiration: statusData.daysUntilExpiration,
            endDate: statusData.endDate,
          });
        } else {
          setLicenseStatus({ isExpired: true, daysUntilExpiration: 0 });
        }
      } catch (err) {
        console.error('Error fetching license data:', err.message);
        setError(`Error fetching license data: ${err.message}. Please try again or contact support.`);
      } finally {
        setLoading(false);
      }
    };

    fetchLicenseData();
  }, [username, isSuperAdmin]);

  /*************************************************
   * (5) Handle License Key Upload
   * Purpose: Uploads a new license key.
   * Compliance: IS Policy (Security: Secure API calls).
   *************************************************/
  const handleUpload = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!licenseKey) {
      setError('Please enter a license key.');
      return;
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      console.log('Uploading license key with secretKey:', config.licenseSecretKey);
      const response = await fetch(`${config.apiBaseUrl}/api/upload-license`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username,
          licenseKey,
          secretKey: config.licenseSecretKey,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to upload license: HTTP status ${response.status}, ${errorText}`);
      }
      const data = await response.json();
      console.log('Upload license response:', data);
      if (data.success) {
        setSuccess(data.message);
        setLicenseKey('');
        const historyResponse = await fetch(`${config.apiBaseUrl}/api/license-history?username=${username}`, {
          method: 'GET',
          headers,
        });
        if (!historyResponse.ok) {
          const errorText = await historyResponse.text();
          throw new Error(`Failed to fetch updated license history: HTTP status ${historyResponse.status}, ${errorText}`);
        }
        const historyData = await historyResponse.json();
        console.log('Updated license history:', historyData);
        if (historyData.success) {
          setLicenseHistory(historyData.licenses);
        }
        const statusResponse = await fetch(`${config.apiBaseUrl}/api/license-status`, {
          method: 'GET',
          headers,
        });
        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          throw new Error(`Failed to fetch updated license status: HTTP status ${statusResponse.status}, ${errorText}`);
        }
        const statusData = await statusResponse.json();
        console.log('Updated license status:', statusData);
        if (statusData.success) {
          setLicenseStatus({
            isExpired: statusData.isExpired,
            daysUntilExpiration: statusData.daysUntilExpiration,
            endDate: statusData.endDate,
          });
        }
      } else {
        throw new Error(data.message || 'Failed to upload license.');
      }
    } catch (err) {
      console.error('Error uploading license:', err.message);
      setError(`Error uploading license: ${err.message}. Please try again or contact support.`);
    }
  };

  /*************************************************
   * (6) Handle License Deletion
   * Purpose: Deletes a license key.
   * Compliance: IS Policy (Security: Secure API calls).
   *************************************************/
  const handleDelete = async (licenseKey) => {
    if (!window.confirm(`Are you sure you want to delete the license: ${licenseKey.substring(0, 30)}...?`)) {
      return;
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      console.log('Deleting license:', licenseKey);
      const response = await fetch(`${config.apiBaseUrl}/api/delete-license`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username,
          licenseKey,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete license: HTTP status ${response.status}, ${errorText}`);
      }
      const data = await response.json();
      console.log('Delete license response:', data);
      if (data.success) {
        setSuccess(data.message);
        const historyResponse = await fetch(`${config.apiBaseUrl}/api/license-history?username=${username}`, {
          method: 'GET',
          headers,
        });
        if (!historyResponse.ok) {
          const errorText = await historyResponse.text();
          throw new Error(`Failed to fetch updated license history: HTTP status ${historyResponse.status}, ${errorText}`);
        }
        const historyData = await historyResponse.json();
        console.log('Updated license history after delete:', historyData);
        if (historyData.success) {
          setLicenseHistory(historyData.licenses);
        }
        const statusResponse = await fetch(`${config.apiBaseUrl}/api/license-status`, {
          method: 'GET',
          headers,
        });
        if (!statusResponse.ok) {
          const errorText = await statusResponse.text();
          throw new Error(`Failed to fetch updated license status: HTTP status ${statusResponse.status}, ${errorText}`);
        }
        const statusData = await statusResponse.json();
        console.log('Updated license status after delete:', statusData);
        if (statusData.success) {
          setLicenseStatus({
            isExpired: statusData.isExpired,
            daysUntilExpiration: statusData.daysUntilExpiration,
            endDate: statusData.endDate,
          });
        }
      } else {
        throw new Error(data.message || 'Failed to delete license.');
      }
    } catch (err) {
      console.error('Error deleting license:', err.message);
      setError(`Error deleting license: ${err.message}. Please try again or contact support.`);
    }
  };

  /*************************************************
   * (7) Handle Viewing License Details
   * Purpose: Fetches and displays details of a specific license.
   * Compliance: IS Policy (Security: Secure API calls).
   *************************************************/
  const handleViewDetails = async (licenseKey) => {
    try {
      const headers = { 'Content-Type': 'application/json' };
      console.log('Fetching license details for:', licenseKey);
      const response = await fetch(`${config.apiBaseUrl}/api/license-details`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          username,
          licenseKey,
        }),
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch license details: HTTP status ${response.status}, ${errorText}`);
      }
      const data = await response.json();
      console.log('License details response:', data);
      if (data.success) {
        setSelectedLicense(data.license);
      } else {
        throw new Error(data.message || 'Failed to fetch license details.');
      }
    } catch (err) {
      console.error('Error fetching license details:', err.message);
      setError(`Error fetching license details: ${err.message}. Please try again or contact support.`);
    }
  };

  /*************************************************
   * (8) Close the Details Modal
   * Purpose: Closes the license details modal.
   * Compliance: Web Page Policy (User Experience).
   *************************************************/
  const closeDetails = () => {
    setSelectedLicense(null);
    setError('');
  };

  /*************************************************
   * (9) Handle Logout
   * Purpose: Logs out the user without session invalidation.
   * Compliance: IS Policy (Security: Simple logout).
   *************************************************/
  const handleLogout = () => {
    console.log('Logging out user:', username);
    onLogout();
    navigate("/login");
  };

  /*************************************************
   * (10) Render
   * Purpose: Renders the license management page UI.
   * Compliance: Web Page Policy (Responsive Design, Accessibility, User Experience).
   *************************************************/
  if (loading) {
    return (
      <div className="dark-container fadeInUp" style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <FaSpinner className="spinner" style={{ fontSize: '1.5rem', color: '#00adb5' }} />
          <p style={{ color: '#EEEEEE', marginTop: '0.3rem', fontSize: '0.9rem' }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="dark-container improved-afterlogin modern-page-animation"
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        padding: '0.5rem 1rem',
        boxSizing: 'border-box'
      }}
    >
      {/* Header with Navbar */}
      <header
        className="settings-neon-header"
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '0.5rem 1rem',
          background: 'linear-gradient(90deg, #2e333b, #1a1f24)',
          borderRadius: '6px',
          marginBottom: '0.5rem'
        }}
      >
        <h1
          className="neon-settings-title"
          style={{
            margin: 0,
            fontSize: '1.2rem',
            color: '#E0FFFF', // Light Cyan for better readability
            textShadow: '0 0 2px rgba(224, 255, 255, 0.2)', // Reduced neon effect
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <FaKey style={{ marginRight: '0.3rem', fontSize: '1rem' }} /> License Management
        </h1>
        <nav className="navbar improved-navbar" style={{ marginLeft: 'auto' }}>
          <ul className="nav-links" style={{ display: 'flex', gap: '0.5rem', margin: 0 }}>
            <li>
              <button
                className="dark-button"
                onClick={() => navigate(-1)}
                aria-label="Go back"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  padding: '0.3rem 0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  background: 'linear-gradient(90deg, #e91e63, #f06292)',
                  border: 'none',
                  color: '#FFFFFF',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'transform 0.3s, background 0.3s',
                  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)'
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = 'scale(1.05)';
                  e.target.style.background = 'linear-gradient(90deg, #f06292, #e91e63)';
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = 'scale(1)';
                  e.target.style.background = 'linear-gradient(90deg, #e91e63, #f06292)';
                }}
              >
                <FaArrowLeft style={{ fontSize: '0.7rem' }} /> Back
              </button>
            </li>
            <li>
              <button
                className="dark-button"
                onClick={() => navigate('/')}
                aria-label="Go to Dashboard"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  padding: '0.3rem 0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  background: 'linear-gradient(90deg, #e91e63, #f06292)',
                  border: 'none',
                  color: '#FFFFFF',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'transform 0.3s, background 0.3s',
                  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)'
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = 'scale(1.05)';
                  e.target.style.background = 'linear-gradient(90deg, #f06292, #e91e63)';
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = 'scale(1)';
                  e.target.style.background = 'linear-gradient(90deg, #e91e63, #f06292)';
                }}
              >
                <FaHome style={{ fontSize: '0.7rem' }} /> Dashboard
              </button>
            </li>
            <li>
              <button
                className="dark-button"
                onClick={handleLogout}
                aria-label="Logout"
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  padding: '0.3rem 0.6rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.2rem',
                  background: 'linear-gradient(90deg, #ff4d4d, #ff6b6b)',
                  border: 'none',
                  color: '#FFFFFF',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  transition: 'transform 0.3s, background 0.3s',
                  boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)'
                }}
                onMouseOver={(e) => {
                  e.target.style.transform = 'scale(1.05)';
                  e.target.style.background = 'linear-gradient(90deg, #ff6b6b, #ff4d4d)';
                }}
                onMouseOut={(e) => {
                  e.target.style.transform = 'scale(1)';
                  e.target.style.background = 'linear-gradient(90deg, #ff4d4d, #ff6b6b)';
                }}
              >
                <FaSignOutAlt style={{ fontSize: '0.7rem' }} /> Logout
              </button>
            </li>
          </ul>
        </nav>
      </header>

      {/* License Status Banner */}
      {licenseStatus && (licenseStatus.isExpired || licenseStatus.daysUntilExpiration <= 7) && (
        <div
          className="dark-card neon-card fadeInUp"
          style={{
            margin: '0.3rem 0',
            background: licenseStatus.isExpired
              ? 'linear-gradient(90deg, #ff4d4d, #ff6b6b)'
              : 'linear-gradient(90deg, #FBBF24, #FFD54F)',
            boxShadow: '0 0 6px rgba(0, 0, 0, 0.5)',
            borderRadius: '6px'
          }}
        >
          <p
            style={{
              color: '#FFFFFF',
              textAlign: 'center',
              padding: '0.4rem',
              fontSize: '0.8rem',
              fontWeight: 500,
              textShadow: '0 0 3px rgba(0, 0, 0, 0.3)',
              margin: 0
            }}
          >
            <FaExclamationTriangle style={{ marginRight: '0.3rem', fontSize: '0.8rem' }} />
            {licenseStatus.isExpired
              ? '🚨 License Expired! Please Upload a New License! 🚀'
              : `⚠️ License expires in ${licenseStatus.daysUntilExpiration} day(s) on ${new Date(licenseStatus.endDate).toLocaleDateString()}!`}
          </p>
        </div>
      )}

      {/* Main Content */}
      <main
        className="dark-card neon-card fadeInUp"
        style={{
          flex: 1,
          margin: '0.3rem 0',
          padding: '0.8rem',
          background: 'linear-gradient(135deg, #2e333b, #1a1f24)',
          overflow: 'hidden'
        }}
      >
        {/* Upload License Section */}
        <section
          className="dark-card neon-card fadeInUp"
          style={{
            marginBottom: '0.5rem',
            padding: '0.8rem',
            background: 'linear-gradient(135deg, #2e333b, #1a1f24)'
          }}
        >
          <h3
            className="neon-card-title"
            style={{
              color: '#00adb5',
              marginBottom: '0.5rem',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <FaUpload style={{ marginRight: '0.3rem', fontSize: '0.9rem' }} /> Upload New License
          </h3>
          <form onSubmit={handleUpload}>
            <div style={{ marginBottom: '0.5rem' }}>
              <label
                htmlFor="licenseKey"
                className="neon-label"
                style={{ color: '#00adb5', marginBottom: '0.2rem', display: 'block', fontSize: '0.8rem' }}
              >
                License Key
              </label>
              <textarea
                id="licenseKey"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Enter your license key here"
                rows="2"
                className="dark-input neon-input"
                style={{
                  width: '100%',
                  background: '#393E46',
                  color: '#EEEEEE',
                  border: '1px solid #00adb5',
                  borderRadius: '4px',
                  padding: '0.3rem',
                  fontSize: '0.75rem',
                  boxShadow: 'inset 0 0 3px rgba(0, 173, 181, 0.2)',
                  resize: 'none'
                }}
              />
            </div>
            <button
              type="submit"
              className="dark-button neon-button"
              style={{
                background: 'linear-gradient(90deg, #00adb5, #00cc00)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.75rem',
                fontWeight: 500,
                padding: '0.3rem 0.6rem',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'transform 0.3s, background 0.3s',
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
                display: 'flex',
                alignItems: 'center',
                gap: '0.2rem'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'scale(1.05)';
                e.target.style.background = 'linear-gradient(90deg, #00cc00, #00adb5)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'scale(1)';
                e.target.style.background = 'linear-gradient(90deg, #00adb5, #00cc00)';
              }}
            >
              <FaKey style={{ fontSize: '0.7rem' }} /> Upload License
            </button>
          </form>
          {error && (
            <p
              className="error-message"
              style={{ color: '#ff4d4d', marginTop: '0.3rem', textAlign: 'center', fontSize: '0.75rem' }}
            >
              {error}
            </p>
          )}
          {success && (
            <p
              className="success-message"
              style={{ color: '#10B981', marginTop: '0.3rem', textAlign: 'center', fontSize: '0.75rem' }}
            >
              {success}
            </p>
          )}
        </section>

        {/* License History Section */}
        <section
          className="dark-card neon-card fadeInUp"
          style={{
            padding: '0.8rem',
            background: 'linear-gradient(135deg, #2e333b, #1a1f24)',
            flex: 1,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          <h3
            className="neon-card-title"
            style={{
              color: '#00adb5',
              marginBottom: '0.5rem',
              fontSize: '1rem',
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <FaCalendar style={{ marginRight: '0.3rem', fontSize: '0.9rem' }} /> License History
          </h3>
          {licenseHistory.length > 0 ? (
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  overflowY: 'auto',
                  maxHeight: '220px',
                  scrollbarWidth: 'thin',
                  scrollbarColor: '#00adb5 #2e333b'
                }}
              >
                <table
                  className="dark-table"
                  style={{ width: '100%', borderCollapse: 'collapse', color: '#EEEEEE', fontSize: '0.75rem' }}
                >
                  <thead>
                    <tr style={{ background: 'linear-gradient(90deg, #393E46, #2e333b)', textAlign: 'left' }}>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #00adb5' }}>License Key</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #00adb5' }}>Uploaded By</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #00adb5' }}>Created At</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #00adb5' }}>End Date</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #00adb5' }}>Status</th>
                      <th style={{ padding: '0.4rem 0.5rem', borderBottom: '1px solid #00adb5' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {licenseHistory.map((license, index) => (
                      <tr
                        key={index}
                        style={{
                          background: index % 2 === 0 ? '#222831' : '#2e333b',
                          transition: 'background 0.3s'
                        }}
                        onMouseOver={(e) => e.currentTarget.style.background = 'rgba(0, 173, 181, 0.1)'}
                        onMouseOut={(e) => e.currentTarget.style.background = index % 2 === 0 ? '#222831' : '#2e333b'}
                      >
                        <td style={{ padding: '0.4rem 0.5rem' }}>{license.LicenseKey.substring(0, 15)}...</td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <FaUser style={{ marginRight: '0.3rem', color: '#00adb5', fontSize: '0.7rem' }} /> {license.UploadedBy}
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>{new Date(license.CreatedAt).toLocaleString()}</td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          {license.EndDate ? new Date(license.EndDate).toLocaleDateString() : 'N/A'}
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem' }}>
                          <span style={{ color: license.IsActive ? '#10B981' : '#ff4d4d', display: 'flex', alignItems: 'center' }}>
                            <FaShieldAlt style={{ marginRight: '0.3rem', fontSize: '0.7rem' }} />
                            {license.IsActive ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td style={{ padding: '0.4rem 0.5rem', display: 'flex', gap: '0.3rem' }}>
                          <button
                            className="dark-button"
                            onClick={() => handleViewDetails(license.LicenseKey)}
                            style={{
                              background: 'linear-gradient(90deg, #00adb5, #00cc00)',
                              border: 'none',
                              color: '#FFFFFF',
                              fontSize: '0.65rem',
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              transition: 'transform 0.3s, background 0.3s',
                              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.2rem'
                            }}
                            onMouseOver={(e) => {
                              e.target.style.transform = 'scale(1.05)';
                              e.target.style.background = 'linear-gradient(90deg, #00cc00, #00adb5)';
                            }}
                            onMouseOut={(e) => {
                              e.target.style.transform = 'scale(1)';
                              e.target.style.background = 'linear-gradient(90deg, #00adb5, #00cc00)';
                            }}
                          >
                            <FaInfo style={{ fontSize: '0.6rem' }} /> Details
                          </button>
                          <button
                            className="dark-button"
                            onClick={() => handleDelete(license.LicenseKey)}
                            style={{
                              background: 'linear-gradient(90deg, #ff4d4d, #ff6b6b)',
                              border: 'none',
                              color: '#FFFFFF',
                              fontSize: '0.65rem',
                              padding: '0.2rem 0.4rem',
                              borderRadius: '4px',
                              cursor: 'pointer',
                              transition: 'transform 0.3s, background 0.3s',
                              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.3)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.2rem'
                            }}
                            onMouseOver={(e) => {
                              e.target.style.transform = 'scale(1.05)';
                              e.target.style.background = 'linear-gradient(90deg, #ff6b6b, #ff4d4d)';
                            }}
                            onMouseOut={(e) => {
                              e.target.style.transform = 'scale(1)';
                              e.target.style.background = 'linear-gradient(90deg, #ff4d4d, #ff6b6b)';
                            }}
                          >
                            <FaTrash style={{ fontSize: '0.6rem' }} /> Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p style={{ textAlign: 'center', color: '#EEEEEE', fontSize: '0.8rem', padding: '0.5rem' }}>
              No licenses found.
            </p>
          )}
        </section>
      </main>

      {/* License Details Modal */}
      {selectedLicense && (
        <div
          className="modal-overlay"
          style={{ background: 'rgba(0, 0, 0, 0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <div
            className="modal-content"
            style={{
              background: 'linear-gradient(135deg, #2e333b, #1a1f24)',
              padding: '1rem',
              borderRadius: '8px',
              width: '90%',
              maxWidth: '400px',
              maxHeight: '80vh',
              boxShadow: '0 0 10px rgba(0, 173, 181, 0.3)',
              color: '#EEEEEE',
              overflowY: 'auto',
              scrollbarWidth: 'thin',
              scrollbarColor: '#00adb5 #2e333b'
            }}
          >
            <h3
              className="neon-card-title"
              style={{ color: '#00adb5', marginBottom: '0.8rem', textAlign: 'center', fontSize: '1rem' }}
            >
              License Details
            </h3>
            <div style={{ fontSize: '0.75rem', lineHeight: '1.4' }}>
              <p><strong style={{ color: '#00adb5' }}>License Key:</strong> {selectedLicense.licenseKey.substring(0, 15)}...</p>
              <p><strong style={{ color: '#00adb5' }}>Start Date:</strong> {new Date(selectedLicense.startDate).toLocaleDateString()}</p>
              <p><strong style={{ color: '#00adb5' }}>End Date:</strong> {new Date(selectedLicense.endDate).toLocaleDateString()}</p>
              <p><strong style={{ color: '#00adb5' }}>Number of Users:</strong> {selectedLicense.users}</p>
              <p><strong style={{ color: '#00adb5' }}>MAC Address:</strong> {selectedLicense.macAddress}</p>
              <p><strong style={{ color: '#00adb5' }}>Application ID:</strong> {selectedLicense.applicationId}</p>
              <p>
                <strong style={{ color: '#00adb5' }}>Status:</strong>{' '}
                <span style={{ color: selectedLicense.isActive ? '#10B981' : '#ff4d4d' }}>
                  {selectedLicense.isActive ? 'Active' : 'Inactive'}
                </span>
              </p>
              <p><strong style={{ color: '#00adb5' }}>Signature:</strong> {selectedLicense.signature}</p>
            </div>
            <button
              className="dark-button"
              onClick={closeDetails}
              style={{
                background: 'linear-gradient(90deg, #ff4d4d, #ff6b6b)',
                border: 'none',
                color: '#FFFFFF',
                fontSize: '0.75rem',
                fontWeight: 500,
                padding: '0.3rem 0.6rem',
                borderRadius: '4px',
                cursor: 'pointer',
                transition: 'transform 0.3s, background 0.3s',
                boxShadow: '0 1px 4px rgba(0, 0, 0, 0.3)',
                display: 'block',
                margin: '0.8rem auto 0',
                textAlign: 'center'
              }}
              onMouseOver={(e) => {
                e.target.style.transform = 'scale(1.05)';
                e.target.style.background = 'linear-gradient(90deg, #ff6b6b, #ff4d4d)';
              }}
              onMouseOut={(e) => {
                e.target.style.transform = 'scale(1)';
                e.target.style.background = 'linear-gradient(90deg, #ff4d4d, #ff6b6b)';
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer
        className="dark-card neon-card"
        style={{
          textAlign: 'center',
          padding: '0.3rem',
          margin: '0.3rem 0',
          background: 'linear-gradient(135deg, #2e333b, #1a1f24)',
          color: '#EEEEEE',
          fontSize: '0.7rem'
        }}
      >
        © 2025 AI Call Analysis | Version - 1.9 | Developed by{' '}
        <span style={{ color: '#ffd700' }}>Suvadip & Pankaj</span>
      </footer>
    </div>
  );
};

export default LicenseManagement;