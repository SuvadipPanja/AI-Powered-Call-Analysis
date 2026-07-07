import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FaTimes, FaLock, FaEye, FaEyeSlash, FaCopy, FaKey, FaRandom, FaDownload,
} from 'react-icons/fa';
import { Button, Spinner } from '../ui';
import { generateStrongPassword } from './resultUtils';
import { downloadSecureAudio } from '../../services/mediaService';

export default function SecureDownloadModal({ isOpen, onClose, filename }) {
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
      const blob = await downloadSecureAudio(filename, password);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${filename.replace(/\.[^.]+$/, '')}_secure.zip`;
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
