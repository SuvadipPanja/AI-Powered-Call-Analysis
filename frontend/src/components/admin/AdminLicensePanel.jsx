/**
 * License management panel — used inside Admin Settings and standalone (expired-license flow).
 * Redesigned with modern dashboard UI, status hero, KPI cards, expiry countdown,
 * copy-key, auto-refresh on focus, and proper error/empty states.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  LuKey, LuShield, LuCalendar, LuUser, LuInfo,
  LuTriangleAlert, LuUpload, LuRefreshCw, LuCheck, LuCopy,
  LuShieldCheck, LuShieldAlert, LuShieldX, LuClock, LuActivity,
  LuFileKey, LuClipboardCheck, LuEye, LuTimer,
} from 'react-icons/lu';
import config from '../../utils/envConfig';
import apiClient from '../../utils/apiClient';
import { Button, Badge, Modal, Spinner, Label, Textarea } from '../ui';

const STATUS_MAP = {
  active: { label: 'Active', icon: LuShieldCheck, tone: 'success', color: 'var(--success)' },
  expiring: { label: 'Expiring Soon', icon: LuShieldAlert, tone: 'warning', color: 'var(--warning)' },
  expired: { label: 'Expired', icon: LuShieldX, tone: 'danger', color: 'var(--danger)' },
  none: { label: 'Not Licensed', icon: LuShieldX, tone: 'danger', color: 'var(--danger)' },
};

function getStatusKey(licenseStatus) {
  if (!licenseStatus) return 'none';
  if (licenseStatus.isExpired) return 'expired';
  if (licenseStatus.daysUntilExpiration <= 14) return 'expiring';
  return 'active';
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function CountdownRing({ days, max = 365 }) {
  const pct = Math.max(0, Math.min(100, (days / max) * 100));
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const color = days <= 7 ? 'var(--danger)' : days <= 14 ? 'var(--warning)' : 'var(--success)';

  return (
    <div className="admin-license__countdown-ring">
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r={radius} fill="none" stroke="var(--border)" strokeWidth="6" />
        <circle
          cx="46" cy="46" r={radius} fill="none"
          stroke={color} strokeWidth="6" strokeLinecap="round"
          strokeDasharray={circumference} strokeDashoffset={offset}
          style={{ transform: 'rotate(-90deg)', transformOrigin: 'center', transition: 'stroke-dashoffset 0.6s ease' }}
        />
      </svg>
      <div className="admin-license__countdown-value">
        <strong style={{ color }}>{days}</strong>
        <span>days</span>
      </div>
    </div>
  );
}

export default function AdminLicensePanel({ username, onNotice }) {
  const [licenseKey, setLicenseKey] = useState('');
  const [licenseHistory, setLicenseHistory] = useState([]);
  const [licenseStatus, setLicenseStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [selectedLicense, setSelectedLicense] = useState(null);
  const [copied, setCopied] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const onNoticeRef = useRef(onNotice);
  onNoticeRef.current = onNotice;

  const notify = useCallback((msg, type = 'success') => {
    onNoticeRef.current?.(msg, type);
  }, []);

  const fetchLicenseData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [historyRes, statusRes] = await Promise.all([
        apiClient.get(`/api/license-history?username=${encodeURIComponent(username || '')}`),
        fetch(`${config.apiBaseUrl}/api/license-status`),
      ]);

      const historyData = historyRes.data;
      const statusData = await statusRes.json();

      if (historyData.success) {
        setLicenseHistory(historyData.licenses || []);
      } else if (historyRes.status === 403) {
        setLicenseHistory([]);
        setError(historyData.message || 'Access denied.');
      } else if (historyRes.status === 401) {
        setLicenseHistory([]);
        setError('Session expired. Please log in again.');
      }

      if (statusData.success) {
        setLicenseStatus({
          isExpired: statusData.isExpired,
          daysUntilExpiration: statusData.daysUntilExpiration,
          endDate: statusData.endDate,
        });
      } else if (statusRes.status === 404) {
        setLicenseStatus(null);
      } else {
        setLicenseStatus({ isExpired: true, daysUntilExpiration: 0 });
      }

      setLastRefreshed(new Date());
    } catch (err) {
      setError('Failed to load license data. Check that the backend is running.');
      if (!silent) notify('Failed to load license data', 'error');
    } finally {
      setLoading(false);
    }
  }, [username, notify]);

  useEffect(() => {
    fetchLicenseData();
  }, [fetchLicenseData]);

  useEffect(() => {
    const onFocus = () => fetchLicenseData(true);
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [fetchLicenseData]);

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!licenseKey.trim()) {
      notify('Please enter a license key', 'error');
      return;
    }
    setUploading(true);
    try {
      const res = await apiClient.post('/api/upload-license', {
        username,
        licenseKey: licenseKey.trim(),
      });
      const data = res.data;
      if (data.success) {
        setLicenseKey('');
        notify(data.message || 'License activated successfully');
        fetchLicenseData();
      } else {
        notify(data.message || 'Upload failed', 'error');
      }
    } catch {
      notify('Error uploading license', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleViewDetails = async (key) => {
    try {
      const res = await apiClient.post('/api/license-details', {
        username,
        licenseKey: key,
      });
      const data = res.data;
      if (data.success) setSelectedLicense(data.license);
      else notify(data.message || 'Could not load details', 'error');
    } catch {
      notify('Error loading license details', 'error');
    }
  };

  const copyToClipboard = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      notify('License key copied to clipboard');
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => notify('Failed to copy', 'error'));
  };

  const statusKey = useMemo(() => getStatusKey(licenseStatus), [licenseStatus]);
  const statusInfo = STATUS_MAP[statusKey];
  const StatusIcon = statusInfo.icon;

  if (loading) {
    return (
      <div className="admin-license">
        <div className="admin-license__loading-state">
          <Spinner />
          <p>Loading license data…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-license">
        <div className="admin-license__error-state">
          <LuTriangleAlert size={36} />
          <h3>Unable to load license data</h3>
          <p>{error}</p>
          <Button variant="primary" onClick={() => fetchLicenseData()}>
            <LuRefreshCw size={14} /> Retry
          </Button>
        </div>
      </div>
    );
  }

  const activeLicense = licenseHistory.find(l => l.IsActive);

  return (
    <div className="admin-license">
      {/* Warning/Expired banner */}
      {(statusKey === 'expired' || statusKey === 'expiring') && (
        <div className={`admin-license__banner admin-license__banner--${statusKey === 'expired' ? 'expired' : 'warning'}`}>
          <LuTriangleAlert size={18} />
          <span>
            {statusKey === 'expired'
              ? 'Your license has expired — upload a new license key to restore full access.'
              : `License expires in ${licenseStatus.daysUntilExpiration} day(s) on ${formatDate(licenseStatus.endDate)}. Renew soon to avoid interruption.`}
          </span>
        </div>
      )}

      {/* Hero status section */}
      <div className="admin-license__hero">
        <div className="admin-license__hero-left">
          <div className={`admin-license__hero-icon admin-license__hero-icon--${statusInfo.tone}`}>
            <StatusIcon size={28} />
          </div>
          <div>
            <div className="admin-license__hero-status">
              <Badge variant={statusInfo.tone}>{statusInfo.label}</Badge>
            </div>
            <h3 className="admin-license__hero-title">License Status</h3>
            <p className="admin-license__hero-subtitle">
              {statusKey === 'active' && `Valid until ${formatDate(licenseStatus?.endDate)}`}
              {statusKey === 'expiring' && `Expires ${formatDate(licenseStatus?.endDate)} — action needed`}
              {statusKey === 'expired' && 'Application features are restricted'}
              {statusKey === 'none' && 'No active license found'}
            </p>
          </div>
        </div>
        {licenseStatus && statusKey !== 'none' && (
          <CountdownRing days={Math.max(0, licenseStatus.daysUntilExpiration || 0)} />
        )}
      </div>

      {/* KPI cards */}
      <div className="admin-license__kpi-grid">
        <div className="admin-license__kpi-card">
          <div className="admin-license__kpi-icon"><LuTimer size={18} /></div>
          <div className="admin-license__kpi-body">
            <span className="admin-license__kpi-label">Days Remaining</span>
            <strong className="admin-license__kpi-value">
              {licenseStatus?.daysUntilExpiration != null
                ? Math.max(0, licenseStatus.daysUntilExpiration)
                : '—'}
            </strong>
          </div>
        </div>
        <div className="admin-license__kpi-card">
          <div className="admin-license__kpi-icon"><LuFileKey size={18} /></div>
          <div className="admin-license__kpi-body">
            <span className="admin-license__kpi-label">License Type</span>
            <strong className="admin-license__kpi-value">Enterprise</strong>
          </div>
        </div>
        <div className="admin-license__kpi-card">
          <div className="admin-license__kpi-icon"><LuUser size={18} /></div>
          <div className="admin-license__kpi-body">
            <span className="admin-license__kpi-label">Issued To</span>
            <strong className="admin-license__kpi-value">{activeLicense?.UploadedBy || username || '—'}</strong>
          </div>
        </div>
        <div className="admin-license__kpi-card">
          <div className="admin-license__kpi-icon"><LuActivity size={18} /></div>
          <div className="admin-license__kpi-body">
            <span className="admin-license__kpi-label">Last Verified</span>
            <strong className="admin-license__kpi-value">
              {lastRefreshed ? lastRefreshed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
            </strong>
          </div>
        </div>
      </div>

      {/* Upload license */}
      <section className="admin-settings__panel">
        <header className="admin-settings__panel-head">
          <div>
            <h3><LuUpload size={18} /> Activate License</h3>
            <p>Paste a new license key to activate or renew the application.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => fetchLicenseData()} title="Refresh license data">
            <LuRefreshCw size={13} /> Refresh
          </Button>
        </header>
        <form className="admin-license__upload-form" onSubmit={handleUpload}>
          <div className="admin-license__upload-area">
            <div className="admin-license__upload-icon">
              <LuKey size={22} />
            </div>
            <div className="admin-license__upload-body">
              <Label htmlFor="admin-license-key">License key</Label>
              <Textarea
                id="admin-license-key"
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Paste your license key here…"
                rows={4}
              />
              <p className="admin-license__upload-hint">
                License keys are encrypted tokens. Contact your administrator to obtain one.
              </p>
            </div>
          </div>
          <div className="admin-settings__panel-actions">
            <Button type="submit" variant="primary" disabled={uploading || !licenseKey.trim()}>
              {uploading ? <LuRefreshCw className="spin-icon" size={14} /> : <LuShieldCheck size={14} />}
              {uploading ? 'Activating…' : 'Activate License'}
            </Button>
          </div>
        </form>
      </section>

      {/* License history */}
      <section className="admin-settings__panel">
        <header className="admin-settings__panel-head">
          <div>
            <h3><LuClock size={18} /> License History</h3>
            <p>All uploaded license keys and their activation status.</p>
          </div>
          <Badge variant="default">{licenseHistory.length} total</Badge>
        </header>

        {licenseHistory.length === 0 ? (
          <div className="admin-license__empty-state">
            <LuFileKey size={36} />
            <h4>No licenses found</h4>
            <p>Upload a license key above to get started.</p>
          </div>
        ) : (
          <div className="mgmt-table-wrap">
            <table className="ui-table admin-license__table">
              <thead>
                <tr>
                  <th>License Key</th>
                  <th>Uploaded By</th>
                  <th>Created</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenseHistory.map((license, index) => (
                  <tr key={license.LicenseKey || index} className={license.IsActive ? 'admin-license__row--active' : ''}>
                    <td className="admin-license__key-cell">
                      <code>{license.LicenseKey?.substring(0, 20)}…</code>
                      <button
                        type="button"
                        className="admin-license__copy-btn"
                        title="Copy full key"
                        onClick={() => copyToClipboard(license.LicenseKey, license.LicenseKey)}
                      >
                        {copied === license.LicenseKey ? <LuClipboardCheck size={13} /> : <LuCopy size={13} />}
                      </button>
                    </td>
                    <td>{license.UploadedBy || '—'}</td>
                    <td className="admin-license__muted">
                      {license.CreatedAt ? new Date(license.CreatedAt).toLocaleString() : '—'}
                    </td>
                    <td className="admin-license__muted">
                      {license.EndDate ? formatDate(license.EndDate) : 'N/A'}
                    </td>
                    <td>
                      <Badge variant={license.IsActive ? 'success' : 'default'}>
                        {license.IsActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </td>
                    <td className="admin-license__actions">
                      <Button variant="secondary" size="sm" onClick={() => handleViewDetails(license.LicenseKey)}>
                        <LuEye size={13} /> Details
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Details modal */}
      <Modal open={!!selectedLicense} onClose={() => setSelectedLicense(null)} maxWidth="480px">
        {selectedLicense && (
          <div className="admin-license__detail">
            <div className="admin-license__detail-header">
              <LuShield size={20} />
              <h3>License Details</h3>
            </div>
            <dl>
              <div>
                <dt>License Key</dt>
                <dd>
                  <code className="admin-license__detail-key">{selectedLicense.licenseKey?.substring(0, 32)}…</code>
                  <button
                    type="button"
                    className="admin-license__copy-btn"
                    onClick={() => copyToClipboard(selectedLicense.licenseKey, 'detail')}
                  >
                    {copied === 'detail' ? <LuClipboardCheck size={13} /> : <LuCopy size={13} />}
                  </button>
                </dd>
              </div>
              <div><dt>Start Date</dt><dd>{formatDate(selectedLicense.startDate)}</dd></div>
              <div><dt>End Date</dt><dd>{formatDate(selectedLicense.endDate)}</dd></div>
              <div><dt>Max Users</dt><dd>{selectedLicense.users ?? '—'}</dd></div>
              <div><dt>MAC Address</dt><dd><code>{selectedLicense.macAddress || '—'}</code></dd></div>
              <div><dt>Application ID</dt><dd><code>{selectedLicense.applicationId || '—'}</code></dd></div>
              <div>
                <dt>Status</dt>
                <dd>
                  <Badge variant={selectedLicense.isActive ? 'success' : 'danger'}>
                    {selectedLicense.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </dd>
              </div>
            </dl>
            <Button variant="secondary" onClick={() => setSelectedLicense(null)} style={{ width: '100%', marginTop: '1.25rem' }}>
              Close
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
}
