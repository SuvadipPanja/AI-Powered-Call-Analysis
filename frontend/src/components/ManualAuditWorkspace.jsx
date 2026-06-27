/**
 * File: ManualAuditWorkspace.jsx
 * Purpose: Full-screen audit drawer — listen to audio, score each rubric parameter with rationale,
 *          add tone notes + overall comments, then save to the CallAudits table.
 * Author: $Panja
 * Date: 2025-06-18
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import WaveSurfer from 'wavesurfer.js';
import config from '../utils/envConfig';
import apiClient from '../utils/apiClient';
import { Button, Spinner, Badge, Textarea } from './ui';
import { FaTimes, FaPlay, FaPause, FaSave, FaClipboardCheck, FaVolumeUp, FaCommentDots } from 'react-icons/fa';
import { toast } from 'react-toastify';
import './manual-audit.css';

const RUBRIC = [
  'Opening Speech', 'Empathy', 'Query Handling', 'Adherence to Protocol',
  'Resolution Assurance', 'Query Resolution', 'Polite Tone',
  'Authentication Verification', 'Escalation Handling', 'Closing Speech',
];

function formatAudioTime(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '0:00';
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function ManualAuditWorkspace({
  open,
  onClose,
  filename,
  audioDetails,
  aiScoring,
  transcriptSnippet,
  onAuditSaved,
}) {
  const [scores, setScores] = useState({});
  const [rationales, setRationales] = useState({});
  const [overallComments, setOverallComments] = useState('');
  const [toneNotes, setToneNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [existingAudit, setExistingAudit] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [waveReady, setWaveReady] = useState(false);
  const [audioLoadError, setAudioLoadError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const waveRef = useRef(null);
  const waveWrapRef = useRef(null);
  const wsRef = useRef(null);

  const loadExistingAudit = useCallback(async () => {
    if (!filename) return;
    setLoading(true);
    try {
      const resp = await apiClient.get(`/api/audits/${encodeURIComponent(filename)}`);
      if (resp.data.success && resp.data.audit) {
        const audit = resp.data.audit;
        setExistingAudit(audit);
        setOverallComments(audit.OverallComments || '');
        setToneNotes(audit.ToneNotes || '');
        const sc = {};
        const ra = {};
        (audit.scores || []).forEach(s => {
          sc[s.ParameterName] = s.ManualScore != null ? String(s.ManualScore) : '';
          ra[s.ParameterName] = s.Rationale || '';
        });
        setScores(sc);
        setRationales(ra);
      } else {
        setExistingAudit(null);
        if (aiScoring) {
          const prefill = {};
          RUBRIC.forEach(p => { prefill[p] = ''; });
          setScores(prefill);
        }
      }
    } catch {
      setExistingAudit(null);
    } finally {
      setLoading(false);
    }
  }, [filename]);

  useEffect(() => {
    if (open) {
      setSaveError('');
      loadExistingAudit();
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [open, loadExistingAudit]);

  useEffect(() => {
    const audioFile = audioDetails?.AudioFileName || filename;
    if (!open || !waveRef.current || !audioFile) return;

    let ws = null;
    let cancelled = false;

    const initWaveform = () => {
      if (cancelled || !waveRef.current || !waveWrapRef.current) return;
      const container = waveRef.current;
      container.innerHTML = '';
      setAudioLoadError('');
      setWaveReady(false);
      setCurrentTime(0);
      setDuration(0);

      ws = WaveSurfer.create({
        container,
        waveColor: 'rgba(13, 148, 136, 0.35)',
        progressColor: '#0f766e',
        cursorColor: '#14b8a6',
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        height: 80,
        responsive: true,
        normalize: true,
        backend: 'MediaElement',
        fillParent: true,
        scrollParent: false,
        hideScrollbar: true,
        interact: true,
        mediaControls: false,
      });

      const audioUrl = `${config.apiBaseUrl}/audio/${encodeURIComponent(audioFile)}`;
      ws.load(audioUrl);
      ws.on('ready', () => {
        if (cancelled) return;
        setWaveReady(true);
        setDuration(ws.getDuration() || 0);
      });
      ws.on('audioprocess', () => setCurrentTime(ws.getCurrentTime()));
      ws.on('seek', () => setCurrentTime(ws.getCurrentTime()));
      ws.on('timeupdate', () => setCurrentTime(ws.getCurrentTime()));
      ws.on('error', () => setAudioLoadError('Could not load call recording. Check that the file exists on the server.'));
      ws.on('play', () => setIsPlaying(true));
      ws.on('pause', () => setIsPlaying(false));
      ws.on('finish', () => setIsPlaying(false));
      wsRef.current = ws;
    };

    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(initWaveform);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      try { ws?.destroy(); } catch {}
      wsRef.current = null;
      setWaveReady(false);
      setIsPlaying(false);
      setAudioLoadError('');
      setCurrentTime(0);
      setDuration(0);
    };
  }, [open, audioDetails, filename]);

  const togglePlay = () => {
    if (wsRef.current) {
      wsRef.current.playPause();
    }
  };

  const handleScoreChange = (param, val) => {
    if (val !== '' && (isNaN(parseFloat(val)) || parseFloat(val) < 0 || parseFloat(val) > 100)) return;
    setScores(prev => ({ ...prev, [param]: val }));
  };

  const handleRationaleChange = (param, val) => {
    setRationales(prev => ({ ...prev, [param]: val }));
  };

  const rubricPercent = (v) => {
    const n = parseFloat(v);
    if (isNaN(n) || n <= 0) return 0;
    if (n <= 10) return n * 10;
    return Math.min(n, 100);
  };

  const getScoreBand = (pct) => {
    if (pct >= 80) return 'good';
    if (pct >= 50) return 'ok';
    return 'low';
  };

  const computeOverall = () => {
    const vals = RUBRIC.map(p => scores[p]).filter(v => v != null && v !== '' && !isNaN(parseFloat(v))).map(v => rubricPercent(parseFloat(v)));
    if (vals.length === 0) return null;
    return (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1);
  };

  const handleSave = async () => {
    const filledScores = RUBRIC.filter(p => scores[p] != null && scores[p] !== '');
    if (filledScores.length === 0) {
      const msg = 'Please score at least one parameter before saving.';
      setSaveError(msg);
      toast.warn(msg);
      return;
    }

    setSaving(true);
    setSaveError('');
    try {
      const scorePayload = RUBRIC.map(param => ({
        parameterName: param,
        manualScore: scores[param] != null && scores[param] !== '' ? rubricPercent(parseFloat(scores[param])) : null,
        aiScore: aiScoring ? rubricPercent(parseFloat(aiScoring[param])) || null : null,
        rationale: rationales[param] || '',
      }));

      const body = {
        audioFileName: filename,
        scores: scorePayload,
        overallComments,
        toneNotes,
        agentName: audioDetails?.AgentName || audioDetails?.agentName || null,
        agentId: audioDetails?.AgentID || null,
        agentLocation: audioDetails?.AgentLocation || audioDetails?.agentLocation || null,
        agentSupervisor: audioDetails?.AgentSupervisor || audioDetails?.agentSupervisor || null,
        aiScoresSnapshot: aiScoring || {},
      };

      const resp = await apiClient.post('/api/audits', body);
      if (resp.data.success) {
        toast.success('Audit saved successfully!');
        if (onAuditSaved) onAuditSaved(resp.data.auditId);
        onClose();
      } else {
        const msg = resp.data.message || 'Unknown error';
        setSaveError(msg);
        toast.error(`Save failed: ${msg}`);
      }
    } catch (err) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.message;
      let msg = serverMsg || err?.message || 'Server error saving audit.';
      if (status === 404) {
        msg = 'Audit API not available. Restart the backend server and try again.';
      } else if (status === 403) {
        msg = serverMsg || 'You do not have permission to save audits.';
      } else if (status === 401) {
        msg = 'Session expired. Please log in again.';
      }
      setSaveError(msg);
      toast.error(msg);
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const overallScore = computeOverall();
  const aiOverall = aiScoring?.['Overall Scoring'];

  return createPortal(
    <div className="audit-ws-overlay" onClick={onClose}>
      <div className="audit-ws" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <header className="audit-ws__header">
          <div className="audit-ws__header-left">
            <FaClipboardCheck className="audit-ws__header-icon" />
            <div>
              <h2 className="audit-ws__title">Manual Audit</h2>
              <span className="audit-ws__subtitle">{filename}</span>
            </div>
          </div>
          <div className="audit-ws__header-right">
            {existingAudit && (
              <Badge variant="accent">Editing Existing Audit</Badge>
            )}
            <button type="button" className="audit-ws__close" onClick={onClose} aria-label="Close">
              <FaTimes />
            </button>
          </div>
        </header>

        {loading ? (
          <div className="audit-ws__loading"><Spinner /> Loading audit data...</div>
        ) : (
          <div className="audit-ws__body">
            {/* Left Panel — Audio + Transcript */}
            <div className="audit-ws__left">
              <div className="audit-ws__audio-card">
                <div className="audit-ws__audio-label">
                  <FaVolumeUp /> Call Recording
                </div>
                <div className="audit-ws__player">
                  <button
                    type="button"
                    className="audit-ws__play-btn"
                    onClick={togglePlay}
                    disabled={!waveReady}
                    aria-label={isPlaying ? 'Pause recording' : 'Play recording'}
                  >
                    {isPlaying ? <FaPause /> : <FaPlay />}
                  </button>
                  <div className="audit-ws__wave-wrap" ref={waveWrapRef}>
                    {!waveReady && !audioLoadError && (
                      <div className="audit-ws__wave-skeleton" aria-hidden="true">
                        {Array.from({ length: 48 }).map((_, i) => (
                          <span key={i} className="audit-ws__wave-skeleton-bar" style={{ animationDelay: `${(i % 8) * 0.08}s` }} />
                        ))}
                      </div>
                    )}
                    <div className="audit-ws__waveform" ref={waveRef} />
                    {waveReady && duration > 0 && (
                      <div
                        className="audit-ws__wave-progress"
                        style={{ width: `${Math.min(100, (currentTime / duration) * 100)}%` }}
                        aria-hidden="true"
                      />
                    )}
                    {waveReady && duration > 0 && (
                      <div
                        className="audit-ws__wave-playhead"
                        style={{ left: `${Math.min(100, (currentTime / duration) * 100)}%` }}
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <span className="audit-ws__time" aria-live="polite">
                    {formatAudioTime(currentTime)} / {formatAudioTime(duration)}
                  </span>
                </div>
                {audioLoadError && (
                  <p className="audit-ws__audio-error" role="alert">{audioLoadError}</p>
                )}
              </div>

              {transcriptSnippet && transcriptSnippet.length > 0 && (
                <div className="audit-ws__transcript-card">
                  <div className="audit-ws__section-label">Transcript Preview</div>
                  <div className="audit-ws__transcript-body">
                    {transcriptSnippet.slice(0, 20).map((msg, i) => (
                      <div key={i} className={`audit-ws__transcript-msg audit-ws__transcript-msg--${msg.speaker || 'agent'}`}>
                        <span className="audit-ws__msg-speaker">{msg.speaker === 'customer' ? 'Customer' : 'Agent'}:</span>
                        <span className="audit-ws__msg-text">{msg.text}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Score Summary */}
              <div className="audit-ws__summary-card">
                <div className="audit-ws__section-label">Score Summary</div>
                <div className="audit-ws__score-rings">
                  {aiOverall != null && (
                    <div className="audit-ws__ring-item">
                      <div className="audit-ws__ring-label">AI Score</div>
                      <div className={`audit-ws__ring-value audit-ws__ring-value--${getScoreBand(rubricPercent(aiOverall))}`}>
                        {rubricPercent(aiOverall).toFixed(0)}%
                      </div>
                    </div>
                  )}
                  {overallScore != null && (
                    <div className="audit-ws__ring-item">
                      <div className="audit-ws__ring-label">Manual Score</div>
                      <div className={`audit-ws__ring-value audit-ws__ring-value--${getScoreBand(parseFloat(overallScore))}`}>
                        {overallScore}%
                      </div>
                    </div>
                  )}
                  {aiOverall != null && overallScore != null && (
                    <div className="audit-ws__ring-item">
                      <div className="audit-ws__ring-label">Delta</div>
                      <div className="audit-ws__ring-value audit-ws__ring-value--delta">
                        {(parseFloat(overallScore) - rubricPercent(aiOverall)).toFixed(1)}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Right Panel — Scoring Form */}
            <div className="audit-ws__right">
              <div className="audit-ws__section-label" style={{ marginBottom: 12 }}>
                <FaClipboardCheck style={{ marginRight: 6 }} /> Score Each Parameter
              </div>

              <div className="audit-ws__params">
                {RUBRIC.map(param => {
                  const aiVal = aiScoring ? aiScoring[param] : null;
                  const aiPct = rubricPercent(aiVal);
                  const manualVal = scores[param] || '';
                  const manualPct = manualVal !== '' ? rubricPercent(parseFloat(manualVal)) : 0;

                  return (
                    <div key={param} className="audit-ws__param-card">
                      <div className="audit-ws__param-header">
                        <span className="audit-ws__param-name">{param}</span>
                        {aiPct > 0 && (
                          <Badge variant={aiPct >= 80 ? 'success' : aiPct >= 50 ? 'warning' : 'error'}>
                            AI: {aiPct.toFixed(0)}%
                          </Badge>
                        )}
                      </div>

                      <div className="audit-ws__param-row">
                        <div className="audit-ws__param-score">
                          <label className="audit-ws__input-label">Score (0-100)</label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="1"
                            className="audit-ws__score-input"
                            value={manualVal}
                            onChange={e => handleScoreChange(param, e.target.value)}
                            placeholder="—"
                          />
                          {manualPct > 0 && (
                            <div className="audit-ws__param-bar">
                              <div
                                className={`audit-ws__param-bar-fill audit-ws__param-bar-fill--${getScoreBand(manualPct)}`}
                                style={{ width: `${manualPct}%` }}
                              />
                            </div>
                          )}
                        </div>
                        <div className="audit-ws__param-rationale">
                          <label className="audit-ws__input-label">Rationale / Notes</label>
                          <textarea
                            className="audit-ws__rationale-input"
                            rows={2}
                            value={rationales[param] || ''}
                            onChange={e => handleRationaleChange(param, e.target.value)}
                            placeholder="Why this score? (optional)"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Tone Notes */}
              <div className="audit-ws__section-card">
                <div className="audit-ws__section-label">
                  <FaVolumeUp style={{ marginRight: 6 }} /> Tone Analysis Notes
                </div>
                <Textarea
                  rows={3}
                  value={toneNotes}
                  onChange={e => setToneNotes(e.target.value)}
                  placeholder="Observations about agent's tone, pitch, pace, emotional cues..."
                  style={{ width: '100%' }}
                />
              </div>

              {/* Overall Comments */}
              <div className="audit-ws__section-card">
                <div className="audit-ws__section-label">
                  <FaCommentDots style={{ marginRight: 6 }} /> Overall Comments
                </div>
                <Textarea
                  rows={3}
                  value={overallComments}
                  onChange={e => setOverallComments(e.target.value)}
                  placeholder="Summary feedback, coaching notes, action items..."
                  style={{ width: '100%' }}
                />
              </div>

              {/* Actions */}
              {saveError && (
                <div className="audit-ws__save-error" role="alert">
                  {saveError}
                </div>
              )}
              <div className="audit-ws__actions">
                <Button variant="secondary" onClick={onClose} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={handleSave} disabled={saving}>
                  {saving ? <><Spinner className="audit-ws__btn-spin" /> Saving...</> : <><FaSave style={{ marginRight: 6 }} /> Save Audit</>}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
