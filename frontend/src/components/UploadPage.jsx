import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import axios from 'axios';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useNavigate } from 'react-router-dom';
import config from '../utils/envConfig';
import {
  FaCloudUploadAlt,
  FaCheckCircle,
  FaTimesCircle,
  FaFileAlt,
  FaFileAudio,
  FaCalendarAlt,
  FaUser,
  FaArrowRight,
  FaMicrophoneAlt,
  FaBrain,
  FaServer,
  FaLanguage,
  FaClock,
  FaPhoneAlt,
  FaGlobeAmericas,
  FaSpinner,
} from 'react-icons/fa';
import {
  LuFileAudio,
} from 'react-icons/lu';
import { Button, Modal, Spinner } from './ui';
import UploadAgentPicker from './UploadAgentPicker';
import KpiCard from './shared/KpiCard';
import RecentActivityPanel from './shared/RecentActivityPanel';
import { probeAudioChannels, channelLabel, isStereoRecording } from '../utils/probeAudioChannels';
import './reports/reports-page.css';
import './upload-flow.css';
import './upload-page.css';

const MAX_FILE_BYTES = 15 * 1024 * 1024;
const ALLOWED_EXT = /\.(mp3|wav|m4a|ogg|aac|flac|wma)$/i;
const INPUT_ID = 'upload-audio-file-input';

const datePopperContainer = ({ children }) =>
  typeof document !== 'undefined' ? createPortal(children, document.body) : children;

const datePopperModifiers = [
  { name: 'offset', options: { offset: [0, 8] } },
  {
    name: 'preventOverflow',
    options: { rootBoundary: 'viewport', tether: false, altAxis: true, padding: 12 },
  },
  { name: 'flip', options: { fallbackPlacements: ['top-start', 'bottom-end', 'top-end'] } },
];

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(sec) {
  if (!sec || !isFinite(sec)) return null;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Compact elapsed/eta label: "0:42", "3:07", "1h 04m".
function formatElapsed(sec) {
  if (sec == null || !isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
}

function fileExtLabel(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1].toUpperCase() : 'AUDIO';
}

function LiveSpectrum({ bars = 24, className = '' }) {
  return (
    <div className={`upload-spectrum ${className}`} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className="upload-spectrum__bar" style={{ '--i': i, '--h': `${28 + ((i * 17) % 72)}%` }} />
      ))}
    </div>
  );
}

function ProgressRing({ percent, children }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const offset = c - (Math.min(100, Math.max(0, percent)) / 100) * c;
  return (
    <div className="upload-progress-ring" aria-hidden="true">
      <svg viewBox="0 0 120 120">
        <defs>
          <linearGradient id="uploadRingGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="60%" stopColor="var(--accent-2)" />
            <stop offset="100%" stopColor="var(--accent-3)" />
          </linearGradient>
        </defs>
        <circle className="upload-progress-ring__track" cx="60" cy="60" r={r} />
        <circle
          className="upload-progress-ring__value"
          cx="60"
          cy="60"
          r={r}
          strokeDasharray={c}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="upload-progress-ring__center">{children}</div>
    </div>
  );
}

/* Celebratory success animation: confetti burst + drawn checkmark */
function SuccessCelebration() {
  const pieces = Array.from({ length: 14 });
  return (
    <div className="upload-celebrate" aria-hidden="true">
      <div className="upload-celebrate__confetti">
        {pieces.map((_, i) => (
          <span key={i} className="upload-confetti" style={{ '--i': i, '--n': pieces.length }} />
        ))}
      </div>
      <svg className="upload-check" viewBox="0 0 52 52">
        <circle className="upload-check__circle" cx="26" cy="26" r="24" fill="none" />
        <path className="upload-check__mark" fill="none" d="M14 27 l8 8 l16 -18" />
      </svg>
    </div>
  );
}

const PROCESS_STEPS = [
  { key: 'upload', label: 'Upload', icon: FaServer },
  { key: 'transcribe', label: 'Transcribe', icon: FaMicrophoneAlt },
  { key: 'translate', label: 'Translate', icon: FaLanguage },
  { key: 'score', label: 'AI Score', icon: FaBrain },
  { key: 'complete', label: 'Report', icon: FaCheckCircle },
];

const STAGE_TO_INDEX = {
  uploaded: 0,
  upload: 0,
  queued: 0,
  transcribing: 1,
  diarizing: 1,
  translating: 2,
  transcribed: 3,
  scoring: 3,
  enriching: 3,
  complete: 4,
  failed: 0,
};

function resolveDisplayAiStatus({ aiStatus, processStatus, stage, activeIndex, normalized }) {
  const ai = (aiStatus || '').trim();
  if (ai && !/^not started$/i.test(ai)) return ai;

  const ps = (processStatus || '').toLowerCase();
  const st = (stage || '').toLowerCase();
  const norm = (normalized || '').toLowerCase();
  const merged = `${ps} ${st} ${norm}`;

  const engineRunning =
    activeIndex >= 1 ||
    ['transcribing', 'diarizing', 'transcribed', 'scoring'].includes(st) ||
    merged.includes('in progress') ||
    merged.includes('transcrib') ||
    merged.includes('processing') ||
    merged.includes('translating') ||
    merged.includes('scoring') ||
    merged.includes('enriching') ||
    merged.includes('diar');

  if (engineRunning) return 'Started';
  if (merged.includes('pending') || merged.includes('uploaded') || merged.includes('queued')) return 'Waiting';
  return 'Not started';
}

function resolveDisplayLanguage({ originalLanguage, stage, message, description, isFailed, activeIndex }) {
  if (originalLanguage && !/^unknown$/i.test(originalLanguage)) {
    return originalLanguage;
  }

  const text = `${message || ''} ${description || ''}`;
  const explicit = text.match(/\bLanguage detected:\s*(English|Hindi)\b/i)
    || text.match(/\b(English|Hindi)\b(?:\s+transcript|\s+for analysis)?/i);
  if (explicit) {
    const lang = explicit[1] || explicit[0];
    return lang.charAt(0).toUpperCase() + lang.slice(1).toLowerCase();
  }

  const stageKey = (stage || '').toLowerCase();
  if (!isFailed && ['translating', 'scoring', 'transcribed', 'enriching', 'complete'].includes(stageKey)) {
    if (/english/i.test(text)) return 'English';
    if (/hindi/i.test(text)) return 'Hindi';
  }

  if (!isFailed && (activeIndex >= 1 || ['transcribing', 'diarizing'].includes(stageKey))) {
    return 'Detecting…';
  }

  return '—';
}

function deriveProcessingSnapshot({ status, processStatus, aiStatus, stage, progress, message, checkedAt, failureStage, failureReason, subtasks, originalLanguage, hasTranscript }) {
  const normalized = status || 'Uploaded';
  const rawProcess = processStatus || 'Waiting for backend update';
  const rawAi = aiStatus?.trim() || '';
  const merged = `${normalized} ${rawProcess} ${rawAi}`.toLowerCase();

  let activeIndex = 0;
  let percent = 5;
  let title = 'Upload received';
  let description = 'Backend has accepted the audio file and is preparing the processing job.';

  if (merged.includes('fail') || merged.includes('error')) {
    activeIndex = 0;
    percent = 100;
    title = 'Processing failed';
    description = failureReason
      ? `Failed at ${failureStage || 'processing'}: ${failureReason}`
      : (rawProcess || rawAi || 'Backend returned a failure status.');
  } else if (merged.includes('success') || merged.includes('ai process complete')) {
    activeIndex = 4;
    percent = 100;
    title = 'Report ready';
    description = 'AI processing completed successfully. The report is ready to open.';
  } else if (merged.includes('enriching')) {
    activeIndex = 3;
    percent = 88;
    title = 'Enrichment in progress';
    description = 'Analyzing tone, sentiment, and script compliance.';
  } else if (merged.includes('scoring')) {
    activeIndex = 3;
    percent = 72;
    title = 'AI scoring in progress';
    description = 'Scoring call quality on English transcript.';
  } else if (merged.includes('translating')) {
    activeIndex = 2;
    percent = 50;
    title = 'Translating to English';
    description = 'Hindi transcript is being converted to English for analysis.';
  } else if (merged.includes('transcribed')) {
    activeIndex = 3;
    percent = 70;
    title = 'Transcript completed';
    description = 'Transcript saved. Waiting for scoring.';
  } else if (merged.includes('transcrib') || merged.includes('processing') || merged.includes('in progress')) {
    activeIndex = 1;
    percent = 35;
    title = 'Transcribing audio';
    description = 'Converting speech to text with speaker labels.';
  } else if (merged.includes('pending') || merged.includes('uploaded')) {
    activeIndex = 0;
    percent = 8;
    title = 'Queued for processing';
    description = 'File is uploaded. Waiting for the processing worker.';
  }

  const stageKey = (stage || '').toLowerCase();
  if (stageKey) {
    if (typeof STAGE_TO_INDEX[stageKey] === 'number') activeIndex = STAGE_TO_INDEX[stageKey];
    if (typeof progress === 'number') percent = progress;
    if (message) description = message;

    const stageTitles = {
      uploaded: 'Upload received',
      queued: 'Queued for processing',
      transcribing: 'Transcribing audio',
      translating: 'Translating to English',
      transcribed: 'Transcript completed',
      scoring: 'AI scoring in progress',
      enriching: 'Enrichment in progress',
      complete: 'Report ready',
      failed: 'Processing failed',
    };
    title = stageTitles[stageKey] || title;
  }

  const displayAiStatus = resolveDisplayAiStatus({
    aiStatus: rawAi,
    processStatus: rawProcess,
    stage: stageKey,
    activeIndex,
    normalized,
  });

  const displayLanguage = resolveDisplayLanguage({
    originalLanguage,
    stage: stageKey,
    message,
    description,
    isFailed: activeIndex === 0 && /fail/i.test(title),
    activeIndex,
  });

  const taskList = Array.isArray(subtasks) && subtasks.length > 0
    ? subtasks
  : [
      { key: 'upload', label: 'Upload', percent: activeIndex > 0 ? 100 : percent, status: activeIndex > 0 ? 'done' : 'active' },
      { key: 'transcribe', label: 'Transcription', percent: activeIndex > 1 ? 100 : activeIndex === 1 ? percent : 0, status: activeIndex > 1 ? 'done' : activeIndex === 1 ? 'active' : 'pending' },
      { key: 'translate', label: 'Translation', percent: activeIndex > 2 ? 100 : activeIndex === 2 ? percent : 0, status: activeIndex > 2 ? 'done' : activeIndex === 2 ? 'active' : 'pending' },
      { key: 'scoring', label: 'AI Scoring', percent: activeIndex > 3 ? 100 : activeIndex === 3 ? percent : 0, status: activeIndex > 3 ? 'done' : activeIndex === 3 ? 'active' : 'pending' },
      { key: 'complete', label: 'Report', percent: activeIndex >= 4 ? 100 : 0, status: activeIndex >= 4 ? 'done' : 'pending' },
    ];

  return {
    status: normalized,
    stage: stage || 'uploaded',
    processStatus: rawProcess,
    aiStatus: displayAiStatus,
    rawAiStatus: rawAi || 'Not started',
    activeIndex,
    percent,
    title,
    description,
    subtasks: taskList,
    failureStage: failureStage || null,
    failureReason: failureReason || null,
    originalLanguage: displayLanguage !== '—' && displayLanguage !== 'Detecting…' ? displayLanguage : (originalLanguage || null),
    displayLanguage,
    hasTranscript: Boolean(hasTranscript),
    checkedAt: checkedAt
      ? new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

function ConsoleMetric({ icon: Icon, label, value, tone, wide }) {
  return (
    <div
      className={`proc-metric${tone ? ` proc-metric--${tone}` : ''}${wide ? ' proc-metric--wide' : ''}`}
      title={typeof value === 'string' ? value : undefined}
    >
      <div className="proc-metric__icon" aria-hidden="true">
        <Icon />
      </div>
      <div className="proc-metric__text">
        <span className="proc-metric__label">{label}</span>
        <span className="proc-metric__value">{value}</span>
      </div>
    </div>
  );
}

/* Industrial-grade live processing console: file identity, elapsed clock,
   progress ring, accurate per-stage pipeline, and run context. */
function ProcessingStatusModal({ snapshot, meta, elapsedSec = 0 }) {
  const current = snapshot || deriveProcessingSnapshot({});
  const isFailed = current.activeIndex === 0 && /fail/i.test(current.title);
  const isComplete = current.activeIndex >= 4 && current.percent >= 100;
  const phase = isFailed ? 'fail' : isComplete ? 'done' : 'live';

  const stageLabel = PROCESS_STEPS[Math.min(current.activeIndex, PROCESS_STEPS.length - 1)]?.label || 'Processing';
  const engineTone = isFailed ? 'fail'
    : /complete|success|done/i.test(current.aiStatus) ? 'ok'
      : /start|progress|run/i.test(current.aiStatus) ? 'live' : 'wait';
  const language = current.displayLanguage
    || resolveDisplayLanguage({
      originalLanguage: current.originalLanguage,
      stage: current.stage,
      message: current.description,
      description: current.description,
      isFailed,
      activeIndex: current.activeIndex,
    });

  return (
    <div className={`proc-console proc-console--${phase}`}>
      <header className="proc-console__head">
        <div className="proc-console__head-id">
          <span className={`proc-console__dot proc-console__dot--${phase}`} aria-hidden="true" />
          <div className="proc-console__head-text">
            <div className="proc-console__eyebrow">
              {isFailed ? 'Processing failed' : isComplete ? 'Processing complete' : 'Live processing'}
            </div>
            <div className="proc-console__file" title={meta?.displayName || meta?.fileName}>
              <FaFileAudio aria-hidden="true" />
              <span>{meta?.displayName || meta?.fileName || 'Audio file'}</span>
            </div>
          </div>
        </div>
        <div className="proc-console__elapsed" title="Elapsed time">
          <FaClock aria-hidden="true" /> {formatElapsed(elapsedSec)}
        </div>
      </header>

      <div className="proc-console__hero">
        <ProgressRing percent={current.percent}>
          <span className="proc-console__pct">{current.percent}%</span>
          <span className="proc-console__pct-label">{stageLabel}</span>
        </ProgressRing>
        <div className="proc-console__metrics">
          <ConsoleMetric icon={FaServer} label="Stage" value={stageLabel} />
          <ConsoleMetric icon={FaBrain} label="AI engine" value={current.aiStatus} tone={engineTone} />
          <ConsoleMetric icon={FaGlobeAmericas} label="Language" value={language} wide />
        </div>
      </div>

      <p className={`proc-console__message ${isFailed ? 'proc-console__message--fail' : ''}`}>
        {!isFailed && !isComplete && <FaSpinner className="proc-console__spin" aria-hidden="true" />}
        <span>{current.description}</span>
      </p>

      <div className="proc-console__progress">
        <div className="proc-console__progress-head">
          <span>Overall progress</span>
          <strong>{current.percent}%</strong>
        </div>
        <div
          className="proc-console__progress-bar"
          role="progressbar"
          aria-valuenow={current.percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span
            className="proc-console__progress-fill"
            style={{ width: `${Math.min(100, Math.max(0, current.percent))}%` }}
          />
          {[20, 40, 60, 80].map((p) => (
            <i key={p} className="proc-console__progress-tick" style={{ left: `${p}%` }} aria-hidden="true" />
          ))}
        </div>
      </div>

      <footer className="proc-console__foot">
        <div className="proc-console__context">
          {meta?.agent && <span><FaUser aria-hidden="true" /> {meta.agent}</span>}
          {meta?.callType && <span className="proc-console__cap"><FaPhoneAlt aria-hidden="true" /> {meta.callType}</span>}
          {meta?.date && <span><FaCalendarAlt aria-hidden="true" /> {meta.date}</span>}
        </div>
        <span className="proc-console__updated">Updated {current.checkedAt}</span>
      </footer>
    </div>
  );
}

const UploadPage = () => {
  const [audioFile, setAudioFile] = useState(null);
  const [fileAnimKey, setFileAnimKey] = useState(0);
  const fileInputRef = useRef(null);
  const dropWrapRef = useRef(null);
  const [callType, setCallType] = useState('inbound');
  const [selectedDate, setSelectedDate] = useState(null);
  const [dragActive, setDragActive] = useState(false);

  const [agentsList, setAgentsList] = useState([]);
  const [typedAgent, setTypedAgent] = useState('');
  const [agent, setAgent] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentFileName, setCurrentFileName] = useState('');
  const [processingSnapshot, setProcessingSnapshot] = useState(() => deriveProcessingSnapshot({}));
  const [processingMeta, setProcessingMeta] = useState(null);
  const [processingStartedAt, setProcessingStartedAt] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [audioDuration, setAudioDuration] = useState(null);
  const [audioChannels, setAudioChannels] = useState(null);
  const [audioChannelChecking, setAudioChannelChecking] = useState(false);

  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [showUploadedModal, setShowUploadedModal] = useState(false);
  const [showTranscribedModal, setShowTranscribedModal] = useState(false);
  const [hasShownSuccessToast, setHasShownSuccessToast] = useState(false);

  const [showFailureModal, setShowFailureModal] = useState(false);
  const [failureDetail, setFailureDetail] = useState('');
  const [activityRefreshKey, setActivityRefreshKey] = useState(0);

  const navigate = useNavigate();
  const formSectionId = useId();
  const bumpRecentActivity = useCallback(() => setActivityRefreshKey((k) => k + 1), []);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await axios.get(`${config.apiBaseUrl}/api/agents/${callType}`);
        setAgentsList(response.data || []);
      } catch (error) {
        console.error('Error fetching agents:', error.message);
        toast.error('Failed to fetch agents.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
      }
    };
    fetchAgents();
    setTypedAgent('');
    setAgent('');
  }, [callType]);

  useEffect(() => {
    if (!currentFileName) return;

    let interval;

    const isRealSuccess = (status) => status?.toLowerCase() === 'success';
    const isTranscribed = (status) => status?.toLowerCase() === 'transcribed';
    const isUploadedOnly = (status, rawProcessStatus) => {
      if (!status) return false;
      const s = status.toLowerCase();
      const ps = (rawProcessStatus || '').toLowerCase();
      if (ps === 'pending' || ps === 'in progress') return false;
      return s === 'uploaded' || s.includes('stub');
    };
    const isFailedStatus = (status, rawProcessStatus) => {
      if (!status) return false;
      const s = status.toLowerCase();
      const ps = (rawProcessStatus || '').toLowerCase();
      return s === 'fail' || s === 'failed' || s.includes('error') || ps.includes('error') || ps.includes('failed');
    };
    const isInProgressStatus = (status, rawProcessStatus) => {
      if (!status) return false;
      const s = status.toLowerCase();
      const ps = (rawProcessStatus || '').toLowerCase();
      return s === 'in progress' || s === 'processing' || s === 'pending' || s === 'scoring' || s === 'enriching' || s === 'translating'
        || ps === 'pending' || ps === 'in progress' || ps === 'scoring' || ps === 'enriching' || ps === 'translating';
    };

    const pollStatus = async () => {
      try {
        const res = await axios.get(
          `${config.apiBaseUrl}/api/audio-status/${encodeURIComponent(currentFileName)}`
        );
        const { status, processStatus, aiStatus, displayAiStatus, stage, progress, message, checkedAt, failureStage, failureReason, subtasks, originalLanguage, hasTranscript } = res.data;
        setProcessingSnapshot(deriveProcessingSnapshot({
          status,
          processStatus,
          aiStatus: displayAiStatus || aiStatus,
          stage,
          progress,
          message,
          checkedAt,
          failureStage,
          failureReason,
          subtasks,
          originalLanguage,
          hasTranscript,
        }));
        if (!status) return;
        if (isInProgressStatus(status, processStatus)) return;

        if (isRealSuccess(status)) {
          clearInterval(interval);
          setIsProcessing(false);
          bumpRecentActivity();
          if (!hasShownSuccessToast) {
            toast.success('Analysis complete.', { position: 'top-center', autoClose: 3000, theme: 'colored' });
            setHasShownSuccessToast(true);
          }
          setShowSuccessModal(true);
        } else if (isTranscribed(status)) {
          clearInterval(interval);
          setIsProcessing(false);
          bumpRecentActivity();
          if (!hasShownSuccessToast) {
            toast.success('Transcription complete.', { position: 'top-center', autoClose: 4000, theme: 'colored' });
            setHasShownSuccessToast(true);
          }
          setShowTranscribedModal(true);
        } else if (isUploadedOnly(status, processStatus)) {
          clearInterval(interval);
          setIsProcessing(false);
          bumpRecentActivity();
          if (!hasShownSuccessToast) {
            toast.info('File saved. Start AI service to process.', { position: 'top-center', autoClose: 5000, theme: 'dark' });
            setHasShownSuccessToast(true);
          }
          setShowUploadedModal(true);
        } else if (isFailedStatus(status, processStatus)) {
          clearInterval(interval);
          setIsProcessing(false);
          bumpRecentActivity();
          const errorDetail = failureReason
            ? `Failed at ${failureStage || 'processing'}: ${failureReason}`
            : (message || processStatus || aiStatus || status);
          setFailureDetail(errorDetail);
          setShowFailureModal(true);
          toast.error(errorDetail || 'Processing failed.', { position: 'top-center', autoClose: 8000, theme: 'dark' });
        }
      } catch (error) {
        if (error.response?.status === 404) return;
        clearInterval(interval);
        setIsProcessing(false);
        toast.error('Failed to fetch status.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
      }
    };

    pollStatus();
    interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [currentFileName, hasShownSuccessToast, bumpRecentActivity]);

  // Tick the elapsed clock while a job is processing.
  useEffect(() => {
    if (!isProcessing || !processingStartedAt) return undefined;
    setElapsedSec(Math.floor((Date.now() - processingStartedAt) / 1000));
    const id = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - processingStartedAt) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [isProcessing, processingStartedAt]);

  const isAudioFile = (file) => {
    if (file.type?.startsWith('audio/')) return true;
    return ALLOWED_EXT.test(file.name || '');
  };

  const applyFile = useCallback((file) => {
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) {
      toast.error('Max file size is 15 MB.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
      return;
    }
    if (!isAudioFile(file)) {
      toast.error('Select a valid audio file (MP3, WAV, M4A…).', { position: 'top-center', autoClose: 3000, theme: 'dark' });
      return;
    }
    setAudioFile(file);
    setAudioDuration(null);
    setAudioChannels(null);
    setAudioChannelChecking(true);
    setFileAnimKey((k) => k + 1);
    // Probe true audio duration for accurate file metadata.
    try {
      const url = URL.createObjectURL(file);
      const probe = new Audio();
      probe.preload = 'metadata';
      probe.onloadedmetadata = () => { setAudioDuration(probe.duration); URL.revokeObjectURL(url); };
      probe.onerror = () => { URL.revokeObjectURL(url); };
      probe.src = url;
    } catch (_) { /* duration is best-effort */ }

    probeAudioChannels(file)
      .then((channels) => {
        setAudioChannels(channels);
        if (channels != null && channels < 2) {
          toast.warn('Mono audio detected — Agent and Customer cannot be separated accurately.', {
            position: 'top-center',
            autoClose: 6000,
            theme: 'colored',
          });
        } else {
          toast.success(`"${file.name}" ready`, { position: 'top-center', autoClose: 1800, theme: 'colored' });
        }
      })
      .catch(() => setAudioChannels(null))
      .finally(() => setAudioChannelChecking(false));
  }, []);

  const handleFileInputChange = (e) => {
    const file = e.target.files?.[0];
    applyFile(file);
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    applyFile(e.dataTransfer.files?.[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (dropWrapRef.current && !dropWrapRef.current.contains(e.relatedTarget)) {
      setDragActive(false);
    }
  };

  const clearFile = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setAudioFile(null);
    setAudioDuration(null);
    setAudioChannels(null);
    setAudioChannelChecking(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const resetForm = () => {
    setAudioFile(null);
    setAudioDuration(null);
    setAudioChannels(null);
    setAudioChannelChecking(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setCallType('inbound');
    setSelectedDate(null);
    setTypedAgent('');
    setAgent('');
  };

  const handleSubmit = async () => {
    if (!audioFile || !agent || !selectedDate) {
      toast.error('Complete all fields before submitting.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
      return;
    }

    if (audioChannels != null && !isStereoRecording(audioChannels)) {
      toast.warn('Uploading mono audio — customer transcription quality will be limited.', {
        position: 'top-center',
        autoClose: 5000,
        theme: 'colored',
      });
    }

    setIsLoading(true);
    const adjustedDate = new Date(selectedDate.getTime() - selectedDate.getTimezoneOffset() * 60000);
    const formData = new FormData();
    formData.append('audioFile', audioFile);
    formData.append('agent', agent);
    formData.append('callType', callType);
    formData.append('date', adjustedDate.toISOString().split('T')[0]);

    try {
      const response = await axios.post(`${config.apiBaseUrl}/upload-audio`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (response.data.success) {
        toast.success('Upload successful.', { position: 'top-center', autoClose: 2000, theme: 'colored' });
        const uploadedFileName = response.data.audioFileName;
        // Capture run context before the form resets, so the processing
        // console can show accurate file/agent/date details.
        setProcessingMeta({
          displayName: audioFile.name,
          fileName: uploadedFileName || audioFile.name,
          agent,
          callType,
          date: adjustedDate.toISOString().split('T')[0],
          sizeLabel: formatFileSize(audioFile.size),
          durationLabel: formatDuration(audioDuration),
        });
        setProcessingStartedAt(Date.now());
        setElapsedSec(0);
        setProcessingSnapshot(deriveProcessingSnapshot({
          status: 'Uploaded',
          processStatus: 'Uploaded',
          aiStatus: null,
        }));
        resetForm();
        bumpRecentActivity();
        if (uploadedFileName) {
          setCurrentFileName(uploadedFileName);
          setIsProcessing(true);
          setHasShownSuccessToast(false);
        } else {
          const latestAudio = await axios.get(`${config.apiBaseUrl}/api/latest-audio`);
          if (latestAudio.data.success) {
            setCurrentFileName(latestAudio.data.data.AudioFileName);
            setIsProcessing(true);
            setHasShownSuccessToast(false);
          }
        }
      } else {
        toast.error(response.data.message || 'Upload failed.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
      }
    } catch (error) {
      toast.error('Upload failed. Try again.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleAgentSelect = (item) => {
    if (!item) {
      setAgent('');
      setTypedAgent('');
      return;
    }
    setAgent(item.agent_name);
    setTypedAgent(item.agent_name);
  };

  const closeModals = () => {
    setShowSuccessModal(false);
    setShowUploadedModal(false);
    setShowTranscribedModal(false);
    setShowFailureModal(false);
    setFailureDetail('');
    setCurrentFileName('');
    setIsProcessing(false);
    setProcessingMeta(null);
    setProcessingStartedAt(null);
    setElapsedSec(0);
    bumpRecentActivity();
  };

  const formReady = Boolean(audioFile && agent && selectedDate);

  return (
    <div className="app-page reports-page upload-page">
      <div className="upload-page__glow" aria-hidden="true" />

      <div className="upload-page__form-col">
      <section className="reports-section upload-page__intro">
        <div className="reports-section__head">
          <h2>Audio upload</h2>
          <p className="upload-recording-hint">
            Use <strong>stereo dual-channel</strong> recordings (Agent on one channel, Customer on the other).
            Mono files mix both speakers — customer words are often wrong or missing.
          </p>
          <p>Drop your call recording, then add agent and call details.</p>
        </div>
      </section>

      <Modal
        open={isProcessing && !showSuccessModal && !showUploadedModal && !showTranscribedModal && !showFailureModal}
        onClose={() => {}}
        maxWidth="620px"
        flush
        className="upload-process-modal-shell"
      >
        <ProcessingStatusModal snapshot={processingSnapshot} meta={processingMeta} elapsedSec={elapsedSec} />
      </Modal>

      <Modal open={showTranscribedModal} onClose={closeModals}>
        <div className="upload-result-modal upload-result-modal--animate">
          <div className="upload-result-modal__icon upload-result-modal__icon--info"><FaFileAlt /></div>
          <h2>Transcription complete</h2>
          <p>View the transcript on the results page.</p>
          <div className="upload-result-modal__actions">
            <Button variant="primary" onClick={() => navigate(`/results/${currentFileName}`)}>View results</Button>
            <Button variant="secondary" onClick={closeModals}>Close</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showUploadedModal} onClose={closeModals}>
        <div className="upload-result-modal upload-result-modal--animate">
          <div className="upload-result-modal__icon upload-result-modal__icon--info"><FaCloudUploadAlt /></div>
          <h2>File uploaded</h2>
          <p>Start the AI service to begin processing.</p>
          <Button variant="secondary" onClick={closeModals}>Close</Button>
        </div>
      </Modal>

      <Modal open={showSuccessModal} onClose={closeModals}>
        <div className="upload-result-modal upload-result-modal--animate upload-result-modal--celebrate">
          <SuccessCelebration />
          <h2>Analysis complete</h2>
          <p>Your call report is ready.</p>
          <div className="upload-result-modal__actions">
            <Button variant="primary" onClick={() => navigate(`/results/${currentFileName}`)}>View results</Button>
            <Button variant="secondary" onClick={closeModals}>Upload another</Button>
          </div>
        </div>
      </Modal>

      <Modal open={showFailureModal} onClose={closeModals}>
        <div className="upload-result-modal upload-result-modal--animate">
          <div className="upload-result-modal__icon upload-result-modal__icon--fail"><FaTimesCircle /></div>
          <h2>Processing failed</h2>
          <p>{failureDetail || 'Something went wrong. Please try again.'}</p>
          <Button variant="primary" onClick={closeModals}>Try again</Button>
        </div>
      </Modal>

      <section className="report-chart-card report-chart-card--volume upload-panel--reports">
        <div className="report-chart-card__accent" aria-hidden="true" />
        <div className="report-chart-card__orb" aria-hidden="true" />
        <div className="report-chart-card__body upload-panel__body">

        {isLoading && (
          <div className="upload-loading">
            <Spinner /> Uploading to server…
          </div>
        )}

        <div
          ref={dropWrapRef}
          className={[
            'upload-drop-wrap',
            dragActive && 'upload-drop-wrap--active',
            audioFile && 'upload-drop-wrap--has-file',
          ].filter(Boolean).join(' ')}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            id={INPUT_ID}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac,.wma"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            className="upload-dropzone__input"
            tabIndex={-1}
          />

          {!audioFile ? (
            <label htmlFor={INPUT_ID} className="upload-dropzone upload-dropzone--empty upload-dropzone--reports reports-kpi reports-kpi--cyan">
              <span className="reports-kpi__glow" aria-hidden="true" />
              <span className="reports-kpi__icon upload-dropzone__icon-kpi" aria-hidden="true">
                <FaCloudUploadAlt />
              </span>
              <span className="upload-dropzone__copy">
                <span className="reports-kpi__label">Drop audio here</span>
                <span className="reports-kpi__value upload-dropzone__title">Click to browse files</span>
                <span className="reports-kpi__sub">MP3, WAV, M4A · stereo preferred · max 15 MB</span>
              </span>
              <LiveSpectrum bars={20} className={`upload-spectrum--drop ${dragActive ? 'upload-spectrum--drop-active' : ''}`} />
            </label>
          ) : (
            <KpiCard
              key={fileAnimKey}
              className="upload-file-card--enter upload-file-card--kpi"
              accent="emerald"
              label="Audio ready"
              value={audioFile.name}
              icon={LuFileAudio}
            >
              <div className="reports-kpi__sub">
                <span className="upload-file-tag">{fileExtLabel(audioFile.name)}</span>
                {' · '}
                <span>{formatFileSize(audioFile.size)}</span>
                {audioDuration ? ` · ${formatDuration(audioDuration)}` : ''}
                {audioChannelChecking ? ' · Checking channels…' : audioChannels != null ? ` · ${channelLabel(audioChannels)}` : ''}
              </div>
              {!audioChannelChecking && audioChannels != null && !isStereoRecording(audioChannels) && (
                <div className="upload-channel-warning" role="alert">
                  <strong>Mono recording detected.</strong> The system cannot split Agent and Customer speech.
                  Transcripts will label the whole call as one speaker and customer lines will be inaccurate.
                  Re-export from your dialer as <em>stereo</em> (2 channels) for correct results.
                </div>
              )}
              {!audioChannelChecking && audioChannels != null && isStereoRecording(audioChannels) && (
                <div className="upload-channel-ok" role="status">
                  Stereo recording — Agent / Customer separation enabled.
                </div>
              )}
              <LiveSpectrum bars={16} className="upload-spectrum--file" />
              <div className="reports-kpi__actions">
                <label htmlFor={INPUT_ID} className="upload-file-card__change">Change</label>
                <button type="button" className="upload-file-card__remove" onClick={clearFile}>Remove</button>
              </div>
            </KpiCard>
          )}
        </div>

        <div
          id={formSectionId}
          className={`upload-form-block ${audioFile ? 'upload-form-block--visible' : ''}`}
          aria-hidden={!audioFile}
        >
          <div className="upload-form">
            <div className="upload-field upload-field--anim" style={{ '--delay': '0.05s' }}>
              <label className="upload-field__label" htmlFor="call-date">
                <FaCalendarAlt aria-hidden="true" /> Call date
              </label>
              <div className="upload-datepicker-field">
                <FaCalendarAlt className="upload-datepicker-field__icon" aria-hidden="true" />
                <DatePicker
                  id="call-date"
                  selected={selectedDate}
                  onChange={setSelectedDate}
                  dateFormat="yyyy-MM-dd"
                  placeholderText="Select date"
                  className="ui-input upload-datepicker-input"
                  wrapperClassName="upload-datepicker-wrap"
                  calendarClassName="upload-datepicker"
                  popperClassName="upload-datepicker-popper"
                  popperContainer={datePopperContainer}
                  popperPlacement="bottom-start"
                  popperModifiers={datePopperModifiers}
                  showPopperArrow={false}
                  maxDate={new Date()}
                  disabled={!audioFile}
                  autoComplete="off"
                  isClearable={Boolean(selectedDate)}
                />
              </div>
            </div>

            <div className="upload-field upload-field--anim" style={{ '--delay': '0.1s' }}>
              <span className="upload-field__label">Call type</span>
              <div
                className={`upload-segment ${callType === 'outbound' ? 'upload-segment--outbound' : ''}`}
                role="radiogroup"
              >
                <button
                  type="button"
                  className={`upload-segment__btn ${callType === 'inbound' ? 'upload-segment__btn--active' : ''}`}
                  onClick={() => setCallType('inbound')}
                  aria-pressed={callType === 'inbound'}
                  disabled={!audioFile}
                >
                  Inbound
                </button>
                <button
                  type="button"
                  className={`upload-segment__btn ${callType === 'outbound' ? 'upload-segment__btn--active' : ''}`}
                  onClick={() => setCallType('outbound')}
                  aria-pressed={callType === 'outbound'}
                  disabled={!audioFile}
                >
                  Outbound
                </button>
              </div>
            </div>

            <div className="upload-form__full upload-field--anim" style={{ '--delay': '0.15s' }}>
              <UploadAgentPicker
                agents={agentsList}
                value={agent}
                typedValue={typedAgent}
                onTypedChange={setTypedAgent}
                onSelect={handleAgentSelect}
                disabled={!audioFile}
              />
            </div>
          </div>

          <div className="upload-actions upload-field--anim" style={{ '--delay': '0.2s' }}>
            <Button
              variant="primary"
              className={`upload-submit ${formReady ? 'upload-submit--ready' : ''}`}
              onClick={handleSubmit}
              disabled={isLoading || isProcessing || !formReady}
            >
              {isLoading ? 'Uploading…' : (
                <>
                  Submit for analysis
                  <FaArrowRight className="upload-submit__arrow" aria-hidden="true" />
                </>
              )}
            </Button>
            <p className="upload-footnote">
              <FaUser aria-hidden="true" /> Encrypted upload · processed securely on your server
            </p>
          </div>
        </div>

        {!audioFile && (
          <p className="upload-hint-prompt">
            Select an audio file above to unlock call details
          </p>
        )}
        </div>
      </section>
      </div>

      <RecentActivityPanel
        refreshKey={activityRefreshKey}
        className="upload-recent-activity upload-recent-activity--full"
        limit={50}
        pageSize={10}
      />

      <ToastContainer />
    </div>
  );
};

export default UploadPage;
