import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FaTimes, FaLock, FaEye, FaEyeSlash, FaCopy, FaKey, FaRandom, FaDownload, FaPlay, FaShieldAlt,
} from 'react-icons/fa';
import { Button, Spinner, Badge, EmptyState } from '../ui';
import { generateStrongPassword, formatTimeSec } from './resultUtils';

export default function SecureDownloadModal({ isOpen, onClose, filename, apiBaseUrl }) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setPassword('');
      setShowPassword(false);
      setDownloading(false);
      setError('');
      setCopied(false);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const handleGenerate = () => {
    setPassword(generateStrongPassword(16));
    setShowPassword(true);
    setError('');
  };

  const handleCopy = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = password;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleDownload = async () => {
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setDownloading(true);
    try {
      const token = localStorage.getItem('token') || localStorage.getItem('sessionToken') || '';
      const resp = await fetch(`${apiBaseUrl}/api/download-secure-audio`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ filename, password }),
      });
      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || `Download failed (${resp.status})`);
      }
      const blob = await resp.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = resp.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="?([^"]+)"?/);
      a.download = match ? match[1] : `${filename.replace(/\.[^.]+$/, '')}_secure.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
      onClose();
    } catch (err) {
      setError(err.message || 'Download failed. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  const passwordStrength = (() => {
    if (!password) return null;
    let score = 0;
    if (password.length >= 8) score++;
    if (password.length >= 12) score++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    if (score <= 2) return { label: 'Weak', cls: 'weak' };
    if (score <= 3) return { label: 'Fair', cls: 'fair' };
    return { label: 'Strong', cls: 'strong' };
  })();

  return createPortal(
    <div className="rp-modal-overlay rp-sdl-overlay" onClick={onClose}>
      <div className="rp-sdl-modal" onClick={(e) => e.stopPropagation()}>
        <div className="rp-modal__header">
          <h3 className="rp-modal__title">
            <FaLock className="rp-modal__title-icon" />
            Secure Download
          </h3>
          <button type="button" className="rp-modal__close" onClick={onClose} aria-label="Close">
            <FaTimes />
          </button>
        </div>

        <div className="rp-sdl-body">
          <div className="rp-sdl-info">
            <FaKey className="rp-sdl-info__icon" />
            <p>Your download will be a <strong>password-protected ZIP</strong> containing the audio file and a metadata CSV. Save the password — you will need it to unzip.</p>
          </div>

          <label className="rp-sdl-label" htmlFor="sdl-password">ZIP Password</label>
          <div className="rp-sdl-pw-row">
            <div className="rp-sdl-pw-field">
              <input
                id="sdl-password"
                type={showPassword ? 'text' : 'password'}
                className="ui-input rp-sdl-pw-input"
                placeholder="Enter or generate a password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                autoFocus
                autoComplete="off"
              />
              <button
                type="button"
                className="rp-sdl-pw-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? <FaEyeSlash /> : <FaEye />}
              </button>
            </div>
            <button type="button" className="rp-sdl-copy-btn" onClick={handleCopy} disabled={!password}>
              <FaCopy />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {password && passwordStrength && (
            <div className={`rp-sdl-strength rp-sdl-strength--${passwordStrength.cls}`}>
              <div className="rp-sdl-strength__bar"><div className="rp-sdl-strength__fill" /></div>
              <span className="rp-sdl-strength__label">{passwordStrength.label}</span>
            </div>
          )}

          <button type="button" className="rp-sdl-generate-btn" onClick={handleGenerate}>
            <FaRandom />
            Generate Strong Password
          </button>

          {error && <div className="rp-sdl-error">{error}</div>}
        </div>

        <div className="rp-modal__actions">
          <Button variant="ghost" onClick={onClose} disabled={downloading}>Cancel</Button>
          <Button variant="primary" onClick={handleDownload} disabled={downloading || !password}>
            {downloading ? (
              <><Spinner style={{ width: 14, height: 14 }} /> Creating ZIP...</>
            ) : (
              <><FaDownload style={{ marginRight: 6 }} /> Download Secure ZIP</>
            )}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Taboo / policy phrase hits panel — shared by scoring and compliance tabs. */
export function TabooAnalysisPanel({ toneAnalysis, showEmptyHint = false, onSeek }) {
  const taboo = toneAnalysis?.taboo_analysis;

  if (!taboo) {
    if (!showEmptyHint) return null;
    return (
      <EmptyState icon={<FaShieldAlt />} title="Policy analysis not available">
        <p>
          Taboo / prohibited phrase results appear here after AI processing with the latest version.
          Re-upload or re-process this call to run policy checks against your Bank Config rules.
        </p>
      </EmptyState>
    );
  }

  const hits = taboo.hits || [];
  if (!hits.length) {
    return (
      <div className="rp-taboo-panel rp-taboo-panel--clean">
        <div className="rp-taboo-panel__head">
          <FaShieldAlt />
          <div>
            <h4>Prohibited Phrases</h4>
            <p>{taboo.summary || 'No taboo or prohibited phrases detected.'}</p>
          </div>
        </div>
      </div>
    );
  }

  const severityColor = (sev) => (
    sev === 'high' ? 'var(--color-danger)' : sev === 'low' ? 'var(--color-warning)' : 'var(--color-accent)'
  );

  return (
    <div className="rp-taboo-panel">
      <div className="rp-taboo-panel__head">
        <FaShieldAlt />
        <div>
          <h4>Prohibited Phrases Detected</h4>
          <p>{taboo.summary}</p>
          {taboo.total_penalty > 0 && (
            <Badge variant="danger">Score impact: -{taboo.total_penalty} overall (agent)</Badge>
          )}
        </div>
      </div>
      <div className="rp-taboo-table-wrap">
        <table className="rp-taboo-table">
          <thead>
            <tr>
              <th>Word</th>
              <th>Speaker</th>
              <th>Audio time</th>
              <th>Severity</th>
              <th>Score impact</th>
              <th>Context</th>
            </tr>
          </thead>
          <tbody>
            {hits.map((hit, idx) => (
              <tr key={`taboo-${idx}`} className={hit.role === 'Agent' ? 'is-agent-violation' : ''}>
                <td><strong>{hit.word}</strong></td>
                <td>{hit.role}</td>
                <td>
                  <button
                    type="button"
                    className="rp-taboo-seek"
                    onClick={() => onSeek?.(hit.start)}
                    title="Play from this moment"
                  >
                    <FaPlay size={10} />
                    {formatTimeSec(hit.start)}
                    {hit.end ? ` – ${formatTimeSec(hit.end)}` : ''}
                  </button>
                </td>
                <td>
                  <span className="rp-taboo-sev" style={{ color: severityColor(hit.severity) }}>
                    {hit.severity}
                  </span>
                  <span className="rp-taboo-cat">{hit.category}</span>
                </td>
                <td>
                  {hit.role === 'Agent' && hit.score_impact ? (
                    <span>
                      Overall {hit.score_impact.Overall_Scoring},
                      {' '}Tone {hit.score_impact.Polite_Tone},
                      {' '}Protocol {hit.score_impact.Adherence_to_Protocol}
                    </span>
                  ) : '—'}
                </td>
                <td className="rp-taboo-context">{hit.matched_in}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
