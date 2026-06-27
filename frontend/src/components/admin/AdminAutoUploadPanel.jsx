/**
 * Admin Auto Upload panel — Super Admin configuration and run history.
 * Matches the integrated AutoUploadService backend (DD_MM_YYYY folder convention).
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LuFolderOpen, LuPlay, LuSave, LuRefreshCw, LuClock, LuTriangleAlert,
  LuCheck, LuUpload, LuSquare, LuPause,
} from 'react-icons/lu';
import config from '../../utils/envConfig';
import { Button, Input, Label, Badge, Spinner, EmptyState } from '../ui';

const CRON_PRESETS = [
  { value: '1 0 * * *', label: 'Daily at 00:01 AM' },
  { value: '0 1 * * *', label: 'Daily at 01:00 AM' },
  { value: '0 2 * * *', label: 'Daily at 02:00 AM' },
  { value: '30 6 * * *', label: 'Daily at 06:30 AM' },
  { value: '0 */6 * * *', label: 'Every 6 hours' },
  { value: 'custom', label: 'Custom expression' },
];

const DEFAULT_SETTINGS = {
  audioParentPath: '',
  metadataParentPath: '',
  dateMode: 'relative',
  offsetDays: 1,
  specificDate: '',
  enabled: false,
  cronSchedule: '0 1 * * *',
};

function friendlyHttpError(text, status, fallbackMessage) {
  const trimmed = (text || '').trim();
  if (!trimmed) return `${fallbackMessage} (HTTP ${status})`;
  if (/^Cannot (GET|POST|PUT|DELETE|PATCH) /i.test(trimmed)) {
    return `${fallbackMessage}: API endpoint not found (HTTP ${status}). Restart the backend server if Stop/Resume was recently added.`;
  }
  if (/^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed)) {
    return `${fallbackMessage} (HTTP ${status}). The server returned an HTML error page instead of JSON.`;
  }
  return trimmed.length > 180 ? `${fallbackMessage} (HTTP ${status})` : trimmed;
}

async function readApiResponse(res, fallbackMessage) {
  const text = await res.text();
  if (!text) {
    if (!res.ok) throw new Error(`${fallbackMessage} (HTTP ${res.status})`);
    return { data: {}, res };
  }
  try {
    return { data: JSON.parse(text), res };
  } catch {
    throw new Error(friendlyHttpError(text, res.status, fallbackMessage));
  }
}

function isTerminalRunStatus(status) {
  return ['completed', 'completed_with_errors', 'failed', 'stopped', 'idle'].includes(status);
}

function getTargetDateStr(settings) {
  if (settings.dateMode === 'specific' && settings.specificDate) {
    const [y, m, d] = settings.specificDate.split('-');
    return `${d}_${m}_${y}`;
  }
  const offset = Math.max(1, parseInt(settings.offsetDays, 10) || 1);
  const dt = new Date();
  dt.setDate(dt.getDate() - offset);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yyyy = dt.getFullYear();
  return `${dd}_${mm}_${yyyy}`;
}

export default function AdminAutoUploadPanel({ onNotice }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [original, setOriginal] = useState(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runInProgress, setRunInProgress] = useState(false);
  const [cronPreset, setCronPreset] = useState('0 1 * * *');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [liveStatus, setLiveStatus] = useState(null);
  const [stoppedRuns, setStoppedRuns] = useState([]);
  const pollRef = useRef(null);

  const isDirty = JSON.stringify(settings) !== JSON.stringify(original);
  const isLiveRunActive = running || resuming || runInProgress || liveStatus?.status === 'running';
  const canStopRun = runInProgress || running || resuming || liveStatus?.status === 'running';
  const showLivePanel = isLiveRunActive && liveStatus?.status !== 'completed'
    && liveStatus?.status !== 'completed_with_errors'
    && liveStatus?.status !== 'failed'
    && liveStatus?.status !== 'stopped';
  const showStoppedPanel = !isLiveRunActive && (
    liveStatus?.status === 'stopped' || stoppedRuns.length > 0
  );
  const currentTargetFolder = getTargetDateStr(settings);
  const stoppedForCurrentFolder = stoppedRuns.find((r) => r.targetFolder === currentTargetFolder);
  const canResumeCurrent = Boolean(stoppedForCurrentFolder) && !isLiveRunActive;

  const fetchRunStatus = useCallback(async () => {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/status`);
      const data = await res.json();
      if (data.success) {
        setLiveStatus(data.status || null);
        setStoppedRuns(data.stoppedRuns || data.status?.stoppedRuns || []);
        if (typeof data.runInProgress === 'boolean') {
          setRunInProgress(data.runInProgress);
        } else if (isTerminalRunStatus(data.status?.status)) {
          setRunInProgress(false);
        }
      }
    } catch {
      /* polling errors are non-fatal */
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/settings`);
      const data = await res.json();
      if (data.success) {
        const s = { ...DEFAULT_SETTINGS, ...data.settings };
        setSettings(s);
        setOriginal(s);
        setRunInProgress(Boolean(data.runInProgress));
        const preset = CRON_PRESETS.find((p) => p.value === s.cronSchedule);
        setCronPreset(preset ? preset.value : 'custom');
      } else {
        onNotice?.(data.message || 'Failed to load auto-upload settings', 'error');
      }
    } catch {
      onNotice?.('Failed to load auto-upload settings', 'error');
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/history`);
      const data = await res.json();
      if (data.success) {
        setHistory(data.runs || []);
        setLastRun((data.runs || [])[0] || null);
      }
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
    fetchHistory();
    fetchRunStatus();
  }, [fetchSettings, fetchHistory, fetchRunStatus]);

  useEffect(() => {
    if (!isLiveRunActive) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return undefined;
    }

    fetchRunStatus();
    pollRef.current = setInterval(fetchRunStatus, 1500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [isLiveRunActive, fetchRunStatus]);

  useEffect(() => {
    if (!showStoppedPanel) return undefined;
    fetchRunStatus();
    const id = setInterval(fetchRunStatus, 5000);
    return () => clearInterval(id);
  }, [showStoppedPanel, fetchRunStatus]);

  const update = (key, value) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleCronPreset = (value) => {
    setCronPreset(value);
    if (value !== 'custom') update('cronSchedule', value);
  };

  const saveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        const s = { ...DEFAULT_SETTINGS, ...data.settings };
        setSettings(s);
        setOriginal(s);
        onNotice?.('Auto-upload settings saved');
      } else {
        onNotice?.(data.message || 'Failed to save settings', 'error');
      }
    } catch {
      onNotice?.('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const applyRunResult = (r) => {
    setLastRun(r);
    setLiveStatus((prev) => ({
      ...(prev || {}),
      status: r.status || 'completed',
      targetFolder: r.dateFolder || prev?.targetFolder,
      targetDate: r.dateFolder || prev?.targetDate,
      counts: {
        total: r.totalFiles ?? prev?.counts?.total ?? 0,
        pending: 0,
        succeeded: r.succeeded ?? 0,
        skipped: r.skipped ?? 0,
        failed: r.failed ?? 0,
      },
      durationSeconds: r.durationSeconds ?? prev?.durationSeconds,
      errors: r.errors || prev?.errors || [],
      completedAt: r.completedAt || prev?.completedAt,
      stoppedAt: r.status === 'stopped' ? (r.completedAt || prev?.stoppedAt) : prev?.stoppedAt,
      resumeFromIndex: r.status === 'stopped' ? (prev?.resumeFromIndex ?? null) : null,
      canResume: r.status === 'stopped',
    }));
    fetchHistory();
  };

  const runNow = async () => {
    if (stoppedForCurrentFolder) {
      const ok = window.confirm(
        `Folder ${currentTargetFolder} has a stopped run (file ${(stoppedForCurrentFolder.resumeFromIndex ?? 0) + 1} of ${stoppedForCurrentFolder.total ?? '?'}). `
        + 'Run now will start fresh for this folder. Use Resume to continue where you left off.\n\nStart fresh anyway?'
      );
      if (!ok) return;
    }

    setRunning(true);
    setRunInProgress(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const { data } = await readApiResponse(res, 'Run failed');
      if (!res.ok || !data.success) {
        onNotice?.(data.message || `Run failed (HTTP ${res.status})`, 'error');
        setRunInProgress(false);
        return;
      }
      if (res.status === 202 || !data.result) {
        onNotice?.(data.message || 'Auto-upload run started');
        return;
      }
      const r = data.result || {};
      if (r.status === 'stopped') {
        onNotice?.(`Run stopped at file ${(r.processed ?? 0) + 1} of ${r.totalFiles ?? '?'}`);
      } else {
        onNotice?.(
          `Run complete — ${r.succeeded ?? 0} succeeded, ${r.failed ?? 0} failed, ${r.skipped ?? 0} skipped`
        );
      }
      applyRunResult(r);
      setRunInProgress(false);
    } catch (err) {
      onNotice?.(err.message || 'Run failed', 'error');
      setRunInProgress(false);
    } finally {
      setRunning(false);
      fetchRunStatus();
    }
  };

  const stopRun = async () => {
    if (!window.confirm('Stop the current auto-upload run? Progress is saved and you can resume later.')) {
      return;
    }
    setStopping(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const { data } = await readApiResponse(res, 'Failed to stop run');
      if (!res.ok || !data.success) {
        onNotice?.(data.message || `Could not stop run (HTTP ${res.status})`, 'error');
        if (res.status === 409) setRunInProgress(false);
        return;
      }
      onNotice?.(data.message || 'Stop requested — waiting for run to halt…');
    } catch (err) {
      onNotice?.(err.message || 'Failed to stop run', 'error');
    } finally {
      setStopping(false);
      fetchRunStatus();
    }
  };

  const resumeRun = async (targetFolder) => {
    const folder = targetFolder || currentTargetFolder;
    setResuming(true);
    setRunInProgress(true);
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/admin/auto-upload/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFolder: folder }),
      });
      const { data } = await readApiResponse(res, 'Resume failed');
      if (!res.ok || !data.success) {
        onNotice?.(data.message || `Resume failed (HTTP ${res.status})`, 'error');
        setRunInProgress(false);
        return;
      }
      if (res.status === 202 || !data.result) {
        onNotice?.(data.message || `Resume started for folder ${folder}`);
        return;
      }
      const r = data.result || {};
      if (r.status === 'stopped') {
        onNotice?.(`Resume stopped for folder ${folder}`);
      } else {
        onNotice?.(
          `Resume complete — ${r.succeeded ?? 0} succeeded, ${r.failed ?? 0} failed, ${r.skipped ?? 0} skipped`
        );
      }
      applyRunResult(r);
      setRunInProgress(false);
    } catch (err) {
      onNotice?.(err.message || 'Resume failed', 'error');
      setRunInProgress(false);
    } finally {
      setResuming(false);
      fetchRunStatus();
    }
  };

  const statusVariant = (status) => {
    if (!status) return 'default';
    if (status === 'completed') return 'success';
    if (status === 'completed_with_errors') return 'warning';
    if (status === 'running') return 'accent';
    if (status === 'stopped') return 'warning';
    return 'danger';
  };

  const parseRunErrors = (run) => {
    const raw = run?.errors ?? run?.Errors;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return typeof raw === 'string' && raw ? [{ type: 'failed', reason: raw }] : [];
    }
  };

  const formatRunReason = (item) => {
    if (!item) return '';
    if (typeof item === 'string') return item;
    const reason = item.reason || item.message || '';
    const map = {
      already_uploaded: 'Already uploaded (duplicate)',
      already_processed: 'Already processed (CSV status set)',
      agent_not_found: 'Agent not in active list',
      file_not_found: 'Audio file not found on disk',
      Success: 'Processed successfully',
    };
    return map[reason] || reason || 'Unknown';
  };

  const liveCounts = liveStatus?.counts || {};
  const liveProgress = liveStatus?.total
    ? Math.round(((liveStatus.currentIndex || 0) / liveStatus.total) * 100)
    : 0;
  const completedLiveItems = (liveStatus?.items || []).filter(
    (item) => item.status !== 'pending' && item.status !== 'processing'
  );
  const liveLogItems = completedLiveItems.slice(-20).reverse();

  const itemStatusLabel = (status) => {
    if (status === 'succeeded') return 'OK';
    if (status === 'skipped') return 'Skipped';
    if (status === 'failed') return 'Failed';
    if (status === 'processing') return 'Processing';
    return 'Pending';
  };

  const itemStatusClass = (status) => {
    if (status === 'succeeded') return 'succeeded';
    if (status === 'skipped') return 'skipped';
    if (status === 'failed') return 'failed';
    return 'pending';
  };

  if (loading) {
    return <div className="admin-settings__loading"><Spinner /></div>;
  }

  return (
    <div className="admin-auto-upload">
      <section className="admin-settings__panel">
        <header className="admin-settings__panel-head">
          <div>
            <h3><LuUpload size={18} /> Auto Upload</h3>
            <p>
              Automatically process audio files and metadata CSV from date sub-folders
              (e.g. <code>DD_MM_YYYY</code>). Matches the legacy AutoUpload workflow.
            </p>
          </div>
          {runInProgress && <Badge variant="accent">Run in progress</Badge>}
        </header>

        <div className="mgmt-form-grid admin-auto-upload__form">
          <div className="mgmt-field--full">
            <Label>Audio parent folder</Label>
            <Input
              value={settings.audioParentPath}
              onChange={(e) => update('audioParentPath', e.target.value)}
              placeholder="E:\Recordings\audio"
            />
            <p className="admin-settings__field-hint">
              Server path to the audio parent folder. Date sub-folders inside (e.g. <code>08_06_2025</code> or <code>08-06-2025</code>).
            </p>
          </div>

          <div className="mgmt-field--full">
            <Label>Metadata parent folder</Label>
            <Input
              value={settings.metadataParentPath}
              onChange={(e) => update('metadataParentPath', e.target.value)}
              placeholder="E:\Recordings\metadata"
            />
            <p className="admin-settings__field-hint">
              Contains date sub-folders or top-level <code>metadata_DD_MM_YYYY.csv</code> files.
            </p>
          </div>

          <div className="mgmt-field--full admin-auto-upload__date-mode">
            <Label>Date to process</Label>
            <div className="admin-auto-upload__radio-row">
              <label>
                <input
                  type="radio"
                  name="dateMode"
                  checked={settings.dateMode === 'relative'}
                  onChange={() => update('dateMode', 'relative')}
                />
                Relative (today &minus; N days)
              </label>
              <label>
                <input
                  type="radio"
                  name="dateMode"
                  checked={settings.dateMode === 'specific'}
                  onChange={() => update('dateMode', 'specific')}
                />
                Specific date
              </label>
            </div>
          </div>

          {settings.dateMode === 'relative' ? (
            <div>
              <Label>Offset days (N)</Label>
              <Input
                type="number"
                min={1}
                max={365}
                value={settings.offsetDays}
                onChange={(e) => update('offsetDays', parseInt(e.target.value, 10) || 1)}
              />
              <p className="admin-settings__field-hint">1 = yesterday, 2 = two days ago, etc.</p>
            </div>
          ) : (
            <div>
              <Label>Specific date</Label>
              <Input
                type="date"
                value={settings.specificDate || ''}
                onChange={(e) => update('specificDate', e.target.value)}
              />
            </div>
          )}

          <div className="mgmt-field--full admin-auto-upload__toggle-row">
            <label className="admin-auto-upload__toggle">
              <input
                type="checkbox"
                checked={Boolean(settings.enabled)}
                onChange={(e) => update('enabled', e.target.checked)}
              />
              <span>Enable scheduled auto-upload</span>
            </label>
          </div>

          <div className="mgmt-field--full">
            <Label>Schedule (cron)</Label>
            <select
              className="ui-input admin-auto-upload__select"
              value={cronPreset}
              onChange={(e) => handleCronPreset(e.target.value)}
            >
              {CRON_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
            {cronPreset === 'custom' && (
              <Input
                value={settings.cronSchedule}
                onChange={(e) => update('cronSchedule', e.target.value)}
                placeholder="0 1 * * *"
                style={{ marginTop: '0.5rem' }}
              />
            )}
            <p className="admin-settings__field-hint">Timezone: Asia/Kolkata (IST). Default: daily at 01:00 AM.</p>
          </div>

          <div className="admin-settings__panel-actions admin-auto-upload__actions">
            {isDirty && (
              <span className="admin-settings__unsaved"><LuTriangleAlert size={14} /> Unsaved changes</span>
            )}
            <Button variant="secondary" onClick={() => setSettings({ ...original })} disabled={!isDirty || saving || isLiveRunActive}>
              <LuRefreshCw size={14} /> Reset
            </Button>
            <Button variant="primary" onClick={saveSettings} disabled={saving || !isDirty || isLiveRunActive}>
              {saving ? <LuRefreshCw className="spin-icon" size={14} /> : <LuSave size={14} />}
              Save settings
            </Button>
            {canResumeCurrent && (
              <Button
                variant="success"
                className="admin-auto-upload__btn--resume"
                onClick={() => resumeRun(currentTargetFolder)}
                disabled={resuming || isLiveRunActive || !settings.audioParentPath || !settings.metadataParentPath}
              >
                {resuming ? <LuRefreshCw className="spin-icon" size={14} /> : <LuPlay size={14} />}
                {resuming ? 'Resuming\u2026' : `Resume ${currentTargetFolder}`}
              </Button>
            )}
            {isLiveRunActive && (
              <Button
                variant="danger"
                onClick={stopRun}
                disabled={stopping || !canStopRun}
              >
                {stopping ? <LuRefreshCw className="spin-icon" size={14} /> : <LuSquare size={14} />}
                {stopping ? 'Stopping\u2026' : 'Stop'}
              </Button>
            )}
            <Button
              variant="primary"
              onClick={runNow}
              disabled={running || resuming || isLiveRunActive || !settings.audioParentPath || !settings.metadataParentPath}
            >
              {running ? <LuRefreshCw className="spin-icon" size={14} /> : <LuPlay size={14} />}
              {running ? 'Running\u2026' : 'Run now'}
            </Button>
          </div>

          {stoppedRuns.length > 0 && (
            <div className="admin-auto-upload__stopped-chips">
              <span className="admin-auto-upload__stopped-label">Stopped runs:</span>
              {stoppedRuns.map((run) => (
                <span key={run.targetFolder} className="admin-auto-upload__stopped-chip">
                  <code>{run.targetFolder}</code>
                  <span className="admin-license__muted">
                    {' '}· file {(run.resumeFromIndex ?? 0) + 1} of {run.total ?? '?'}
                  </span>
                  {run.targetFolder !== currentTargetFolder && (
                    <Button
                      variant="success"
                      size="sm"
                      className="admin-auto-upload__btn--resume"
                      onClick={() => resumeRun(run.targetFolder)}
                      disabled={isLiveRunActive || resuming}
                    >
                      <LuPlay size={12} /> Resume
                    </Button>
                  )}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {showLivePanel && (
        <section className="admin-settings__panel admin-auto-upload__live">
          <header className="admin-settings__panel-head">
            <div>
              <h3><LuRefreshCw className="spin-icon" size={18} /> Live run status</h3>
              <p>
                {liveStatus?.targetFolder || liveStatus?.targetDate ? (
                  <>Processing folder <code>{liveStatus.targetFolder || liveStatus.targetDate}</code></>
                ) : (
                  <>Starting auto-upload run…</>
                )}
                {liveStatus?.metadataFile ? (
                  <> · <span className="admin-license__muted">{liveStatus.metadataFile}</span></>
                ) : null}
              </p>
            </div>
            <div className="admin-auto-upload__live-head-actions">
              <Badge variant="accent">Running</Badge>
              <Button
                variant="danger"
                size="sm"
                onClick={stopRun}
                disabled={stopping || !canStopRun}
              >
                {stopping ? <LuRefreshCw className="spin-icon" size={13} /> : <LuSquare size={13} />}
                {stopping ? 'Stopping\u2026' : 'Stop'}
              </Button>
            </div>
          </header>

          {!liveStatus || liveStatus.status === 'idle' ? (
            <div className="admin-settings__loading"><Spinner /></div>
          ) : (
            <>
          <div className="admin-auto-upload__progress-wrap">
            <div className="admin-auto-upload__progress-meta">
              <span>{liveStatus.currentIndex || 0} / {liveStatus.total || liveCounts.total || 0}</span>
              <span>{liveProgress}%</span>
            </div>
            <div className="admin-auto-upload__progress-track">
              <div
                className="admin-auto-upload__progress-bar"
                style={{ width: `${liveProgress}%` }}
              />
            </div>
          </div>

          <div className="admin-auto-upload__count-chips">
            <span className="admin-auto-upload__chip">Total {liveCounts.total ?? 0}</span>
            <span className="admin-auto-upload__chip admin-auto-upload__chip--pending">Pending {liveCounts.pending ?? 0}</span>
            <span className="admin-auto-upload__chip admin-auto-upload__chip--ok">OK {liveCounts.succeeded ?? 0}</span>
            <span className="admin-auto-upload__chip admin-auto-upload__chip--skip">Skipped {liveCounts.skipped ?? 0}</span>
            <span className="admin-auto-upload__chip admin-auto-upload__chip--fail">Failed {liveCounts.failed ?? 0}</span>
          </div>

          {liveStatus.currentFile && (
            <div className="admin-auto-upload__current-call">
              <div className="admin-auto-upload__current-call-head">
                <strong>Current call</strong>
                <Badge variant="accent">{liveStatus.currentFile.stage || '—'}</Badge>
              </div>
              <div className="admin-auto-upload__current-call-body">
                <code>{liveStatus.currentFile.audio_name || '—'}</code>
                {liveStatus.currentFile.employee_name ? (
                  <span className="admin-license__muted"> · {liveStatus.currentFile.employee_name}</span>
                ) : null}
              </div>
              {liveStatus.currentFile.message ? (
                <p className="admin-auto-upload__current-call-msg">{liveStatus.currentFile.message}</p>
              ) : null}
            </div>
          )}

          {liveLogItems.length > 0 && (
            <div className="admin-auto-upload__live-log">
              <p className="admin-auto-upload__run-details-title">Recent files</p>
              <ul className="admin-auto-upload__run-details-list">
                {liveLogItems.map((item, idx) => (
                  <li
                    key={`${item.file}-${idx}`}
                    className={`admin-auto-upload__run-detail admin-auto-upload__run-detail--${itemStatusClass(item.status)}`}
                  >
                    <span className="admin-auto-upload__live-log-status">{itemStatusLabel(item.status)}</span>
                    <code>{item.file || '—'}</code>
                    {item.agent ? <span> · {item.agent}</span> : null}
                    {item.stage && item.stage !== 'Done' ? <span> · {item.stage}</span> : null}
                    {item.reason ? <span> — {formatRunReason(item)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
            </>
          )}
        </section>
      )}

      {showStoppedPanel && (
        <section className="admin-settings__panel admin-auto-upload__stopped">
          <header className="admin-settings__panel-head">
            <div>
              <h3><LuPause size={18} /> Run stopped</h3>
              <p>
                {liveStatus?.status === 'stopped' && liveStatus?.targetFolder ? (
                  <>
                    Stopped at file {liveStatus.resumeFromIndex != null ? liveStatus.resumeFromIndex + 1 : liveStatus.currentIndex || '?'}
                    {' '}of {liveStatus.total || liveStatus.counts?.total || '?'}
                    {' '}in folder <code>{liveStatus.targetFolder}</code>
                  </>
                ) : (
                  <>One or more folders have paused auto-upload runs. Use Resume to continue.</>
                )}
              </p>
            </div>
            <Badge variant="warning">Stopped</Badge>
          </header>

          {(liveStatus?.status === 'stopped' || stoppedForCurrentFolder) && (
            <div className="admin-auto-upload__stopped-actions">
              <Button
                variant="success"
                className="admin-auto-upload__btn--resume"
                onClick={() => resumeRun(liveStatus?.targetFolder || currentTargetFolder)}
                disabled={resuming || isLiveRunActive}
              >
                {resuming ? <LuRefreshCw className="spin-icon" size={14} /> : <LuPlay size={14} />}
                Resume {liveStatus?.targetFolder || currentTargetFolder}
              </Button>
              <p className="admin-settings__field-hint">
                Change the date offset above and click Run now to process a different folder, then resume this one later.
              </p>
            </div>
          )}

          {liveLogItems.length > 0 && liveStatus?.status === 'stopped' && (
            <div className="admin-auto-upload__live-log">
              <p className="admin-auto-upload__run-details-title">Files processed before stop</p>
              <ul className="admin-auto-upload__run-details-list">
                {liveLogItems.map((item, idx) => (
                  <li
                    key={`${item.file}-${idx}`}
                    className={`admin-auto-upload__run-detail admin-auto-upload__run-detail--${itemStatusClass(item.status)}`}
                  >
                    <span className="admin-auto-upload__live-log-status">{itemStatusLabel(item.status)}</span>
                    <code>{item.file || '—'}</code>
                    {item.agent ? <span> · {item.agent}</span> : null}
                    {item.reason ? <span> — {formatRunReason(item)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {lastRun && !showLivePanel && !showStoppedPanel && (
        <section className="admin-settings__panel admin-auto-upload__status">
          <header className="admin-settings__panel-head">
            <div>
              <h3><LuCheck size={18} /> Last run</h3>
            </div>
            <Badge variant={statusVariant(lastRun.status || lastRun.Status)}>
              {lastRun.status || lastRun.Status || '\u2014'}
            </Badge>
          </header>
          <div className="admin-auto-upload__kpi-grid">
            <div className="admin-auto-upload__kpi">
              <span className="admin-auto-upload__kpi-label">Target folder</span>
              <strong>{lastRun.dateFolder || lastRun.DateFolder || '\u2014'}</strong>
            </div>
            <div className="admin-auto-upload__kpi">
              <span className="admin-auto-upload__kpi-label">Total</span>
              <strong>{lastRun.totalFiles ?? lastRun.TotalFiles ?? '\u2014'}</strong>
            </div>
            <div className="admin-auto-upload__kpi">
              <span className="admin-auto-upload__kpi-label">Succeeded</span>
              <strong>{lastRun.succeeded ?? lastRun.Succeeded ?? '\u2014'}</strong>
            </div>
            <div className="admin-auto-upload__kpi">
              <span className="admin-auto-upload__kpi-label">Skipped</span>
              <strong>{lastRun.skipped ?? lastRun.Skipped ?? '\u2014'}</strong>
            </div>
            <div className="admin-auto-upload__kpi">
              <span className="admin-auto-upload__kpi-label">Failed</span>
              <strong>{lastRun.failed ?? lastRun.Failed ?? '\u2014'}</strong>
            </div>
            <div className="admin-auto-upload__kpi">
              <span className="admin-auto-upload__kpi-label">Duration</span>
              <strong>{lastRun.durationSeconds ?? lastRun.DurationSeconds ?? '\u2014'}s</strong>
            </div>
          </div>
          {parseRunErrors(lastRun).length > 0 && (
            <div className="admin-auto-upload__run-details">
              <p className="admin-auto-upload__run-details-title">File details</p>
              <ul className="admin-auto-upload__run-details-list">
                {parseRunErrors(lastRun).map((item, idx) => (
                  <li
                    key={`${item.file || idx}-${item.type}`}
                    className={`admin-auto-upload__run-detail admin-auto-upload__run-detail--${item.type || 'failed'}`}
                  >
                    <code>{item.file || '—'}</code>
                    {item.agent ? <span> · {item.agent}</span> : null}
                    <span> — {formatRunReason(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="admin-settings__panel">
        <header className="admin-settings__panel-head">
          <div>
            <h3><LuClock size={18} /> Run history</h3>
            <p>Recent auto-upload runs with per-run file counts.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchHistory}>
            <LuRefreshCw size={13} /> Refresh
          </Button>
        </header>
        {historyLoading ? (
          <div className="admin-settings__loading"><Spinner /></div>
        ) : history.length === 0 ? (
          <EmptyState icon={<LuFolderOpen size={32} />} title="No runs yet">
            <p className="admin-settings__empty">Save settings and click Run now to start.</p>
          </EmptyState>
        ) : (
          <div className="mgmt-table-wrap">
            <table className="ui-table">
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Status</th>
                  <th>Folder</th>
                  <th>Total</th>
                  <th>OK</th>
                  <th>Skip</th>
                  <th>Fail</th>
                  <th>Duration</th>
                  <th>Trigger</th>
                </tr>
              </thead>
              <tbody>
                {history.map((run, idx) => (
                  <tr key={run.RunID || idx}>
                    <td className="admin-license__muted">
                      {run.StartedAt ? new Date(run.StartedAt).toLocaleString() : '\u2014'}
                    </td>
                    <td><Badge variant={statusVariant(run.Status)}>{run.Status}</Badge></td>
                    <td><code>{run.DateFolder || '\u2014'}</code></td>
                    <td>{run.TotalFiles ?? 0}</td>
                    <td>{run.Succeeded ?? 0}</td>
                    <td>{run.Skipped ?? 0}</td>
                    <td>{run.Failed ?? 0}</td>
                    <td className="admin-license__muted">{run.DurationSeconds ?? 0}s</td>
                    <td className="admin-license__muted">{run.TriggeredBy || '\u2014'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
