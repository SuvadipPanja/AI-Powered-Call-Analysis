import React, { useState, useEffect, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { ToastContainer, toast } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { useNavigate } from 'react-router-dom';
import { getAgentsByCallType } from '../services/agentsService';
import { getAudioStatus, getLatestAudio, uploadAudio } from '../services/uploadService';
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
} from 'react-icons/fa';
import {
  LuFileAudio,
} from 'react-icons/lu';
import { Button, Modal, Spinner } from './ui';
import UploadAgentPicker from './UploadAgentPicker';
import KpiCard from './shared/KpiCard';
import RecentActivityPanel from './shared/RecentActivityPanel';
import { probeAudioChannels, channelLabel, isStereoRecording } from '../utils/probeAudioChannels';
import { deriveStepStates, effectiveActiveIndex, parseDetectedLanguage } from '../utils/processingStepStates';
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
  { key: 'language', label: 'Language', icon: FaGlobeAmericas },
  { key: 'transcribe', label: 'Transcribe', icon: FaMicrophoneAlt },
  { key: 'translate', label: 'Translate', icon: FaLanguage },
  { key: 'score', label: 'AI Score', icon: FaBrain },
  { key: 'tone', label: 'Tone', icon: FaBrain },
  { key: 'compliance', label: 'Compliance', icon: FaFileAlt },
  { key: 'result', label: 'Result', icon: FaCheckCircle },
];

const STAGE_TO_INDEX = {
  uploaded: 0,
  upload: 0,
  queued: 0,
  language: 1,
  language_detection: 1,
  'language-detection': 1,
  detecting: 1,
  detected: 1,
  transcribing: 2,
  diarizing: 2,
  transcription: 2,
  translating: 3,
  translation: 3,
  transcribed: 4,
  scoring: 4,
  score: 4,
  tone: 5,
  tone_analysis: 5,
  'tone-analysis': 5,
  sentiment: 5,
  compliance: 6,
  script_compliance: 6,
  'script-compliance': 6,
  enriching: 6,
  complete: 7,
  result: 7,
  report: 7,
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
    ['language', 'language_detection', 'transcribing', 'diarizing', 'transcribed', 'scoring', 'tone', 'compliance'].includes(st) ||
    merged.includes('in progress') ||
    merged.includes('language') ||
    merged.includes('transcrib') ||
    merged.includes('processing') ||
    merged.includes('translating') ||
    merged.includes('scoring') ||
    merged.includes('tone') ||
    merged.includes('sentiment') ||
    merged.includes('compliance') ||
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
  const parsed = parseDetectedLanguage(text);
  if (parsed) return parsed;

  const stageKey = (stage || '').toLowerCase();
  if (!isFailed && ['translating', 'scoring', 'tone', 'compliance', 'transcribed', 'enriching', 'complete', 'result'].includes(stageKey)) {
    if (/english/i.test(text)) return 'English';
    if (/hindi/i.test(text)) return 'Hindi';
  }

  if (!isFailed && (activeIndex === 1 || (activeIndex >= 2 && !parsed && !originalLanguage))) {
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
  let percent = 0;
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
    activeIndex = 7;
    percent = 100;
    title = 'Report ready';
    description = 'AI processing completed successfully. The report is ready to open.';
  } else if (merged.includes('script compliance') || merged.includes('compliance')) {
    activeIndex = 6;
    percent = 90;
    title = 'Script compliance';
    description = 'Checking mandatory script, disclaimers, and call compliance.';
  } else if (merged.includes('tone') || merged.includes('sentiment')) {
    activeIndex = 5;
    percent = 82;
    title = 'Tone analysis';
    description = 'Measuring tone, sentiment, and customer emotion signals.';
  } else if (merged.includes('enriching')) {
    activeIndex = 6;
    percent = 88;
    title = 'Enrichment in progress';
    description = 'Analyzing tone, sentiment, and script compliance.';
  } else if (merged.includes('scoring')) {
    activeIndex = 4;
    percent = 70;
    title = 'AI scoring in progress';
    description = 'Scoring call quality on English transcript.';
  } else if (merged.includes('translating')) {
    activeIndex = 3;
    percent = 55;
    title = 'Translating to English';
    description = 'Hindi transcript is being converted to English for analysis.';
  } else if (merged.includes('transcribed')) {
    activeIndex = 4;
    percent = 65;
    title = 'Transcript completed';
    description = 'Transcript saved. Waiting for scoring.';
  } else if (
    merged.includes('language detected')
    && (merged.includes('converting speech') || merged.includes('speech to text') || merged.includes('speaker labels'))
  ) {
    activeIndex = 2;
    percent = 35;
    title = 'Transcribing audio';
    description = 'Detected language saved. Converting speech to text with speaker labels.';
  } else if (merged.includes('language detected') || merged.includes('detected language') || merged.includes('language')) {
    activeIndex = 1;
    percent = 25;
    title = 'Language detected';
    description = 'Language detection completed. Preparing transcription.';
  } else if (merged.includes('transcrib') || merged.includes('processing') || merged.includes('in progress')) {
    activeIndex = 2;
    percent = 35;
    title = 'Transcribing audio';
    description = 'Converting speech to text with speaker labels.';
  } else if (merged.includes('pending') || merged.includes('uploaded')) {
    activeIndex = 0;
    percent = 0;
    title = 'Queued for processing';
    description = 'File is uploaded. Waiting for the processing worker.';
  }

  const stageKey = (stage || '').toLowerCase();
  if (stageKey) {
    if (typeof STAGE_TO_INDEX[stageKey] === 'number') activeIndex = STAGE_TO_INDEX[stageKey];
    if (typeof progress === 'number' && progress > 0) percent = progress;
    if (message) description = message;

    const stageTitles = {
      uploaded: 'Upload received',
      queued: 'Queued for processing',
      language: 'Language detection',
      language_detection: 'Language detection',
      'language-detection': 'Language detection',
      detected: 'Language detected',
      transcribing: 'Transcribing audio',
      translating: 'Translating to English',
      transcribed: 'Transcript completed',
      scoring: 'AI scoring in progress',
      tone: 'Tone analysis',
      tone_analysis: 'Tone analysis',
      'tone-analysis': 'Tone analysis',
      compliance: 'Script compliance',
      script_compliance: 'Script compliance',
      'script-compliance': 'Script compliance',
      enriching: 'Enrichment in progress',
      complete: 'Report ready',
      result: 'Report ready',
      report: 'Report ready',
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

  const isFailed = activeIndex === 0 && /fail/i.test(title);
  const resolvedLanguage = displayLanguage !== '—' && displayLanguage !== 'Detecting…'
    ? displayLanguage
    : (parseDetectedLanguage(`${message || ''} ${description || ''}`) || null);
  const stepStates = deriveStepStates({
    activeIndex,
    isFailed,
    message: message || description,
    description,
    detectedLanguage: resolvedLanguage || originalLanguage || displayLanguage,
  });

  // Sequential progress: starts at 0%, advances only as each stage goes live/completes.
  const effIndex = effectiveActiveIndex(stepStates);
  const STEP_PERCENTS = [0, 12, 28, 45, 62, 78, 92, 100];
  const failedNow = merged.includes('fail') || merged.includes('error');
  const completeNow = merged.includes('success') || merged.includes('ai process complete') || activeIndex >= 7;
  if (!failedNow && !completeNow && !(typeof progress === 'number' && progress > 0)) {
    percent = STEP_PERCENTS[Math.min(Math.max(effIndex, 0), STEP_PERCENTS.length - 1)];
  }

  const taskList = Array.isArray(subtasks) && subtasks.length > 0
    ? subtasks
  : [
      { key: 'upload', label: 'Upload', percent: activeIndex > 0 ? 100 : percent, status: activeIndex > 0 ? 'done' : 'active' },
      {
        key: 'language',
        label: 'Language Detection',
        percent: stepStates[1]?.state === 'done' ? 100 : stepStates[1]?.state === 'active' ? percent : 0,
        status: stepStates[1]?.state || 'pending',
      },
      { key: 'transcribe', label: 'Transcription', percent: activeIndex > 2 ? 100 : activeIndex === 2 ? percent : 0, status: activeIndex > 2 ? 'done' : activeIndex === 2 ? 'active' : 'pending' },
      { key: 'translate', label: 'Translation', percent: activeIndex > 3 ? 100 : activeIndex === 3 ? percent : 0, status: activeIndex > 3 ? 'done' : activeIndex === 3 ? 'active' : 'pending' },
      { key: 'scoring', label: 'AI Scoring', percent: activeIndex > 4 ? 100 : activeIndex === 4 ? percent : 0, status: activeIndex > 4 ? 'done' : activeIndex === 4 ? 'active' : 'pending' },
      { key: 'tone', label: 'Tone Analysis', percent: activeIndex > 5 ? 100 : activeIndex === 5 ? percent : 0, status: activeIndex > 5 ? 'done' : activeIndex === 5 ? 'active' : 'pending' },
      { key: 'compliance', label: 'Script Compliance', percent: activeIndex > 6 ? 100 : activeIndex === 6 ? percent : 0, status: activeIndex > 6 ? 'done' : activeIndex === 6 ? 'active' : 'pending' },
      { key: 'result', label: 'Result', percent: activeIndex >= 7 ? 100 : 0, status: activeIndex >= 7 ? 'done' : 'pending' },
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
    stepStates,
    effectiveActiveIndex: effIndex,
    checkedAt: checkedAt
      ? new Date(checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  };
}

/* Design 2 — Orbital Radial. Central ring + 8 stage nodes orbiting around it. */
function OrbitalRadial({ steps, stepStates, percent, centerLabel }) {
  const safePct = Math.min(100, Math.max(0, Math.round(percent)));
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const orbitRadius = 42;

  return (
    <div className="proc-orbit" role="group" aria-label="Processing stages">
      <div className="proc-orbit__ring">
        <svg className="proc-orbit__ring-svg" viewBox="0 0 120 120" aria-hidden="true">
          <defs>
            <linearGradient id="procOrbitGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--success)" />
              <stop offset="100%" stopColor="var(--accent-bright)" />
            </linearGradient>
          </defs>
          <circle className="proc-orbit__ring-track" cx="60" cy="60" r={r} />
          <circle
            className="proc-orbit__ring-value"
            cx="60"
            cy="60"
            r={r}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - safePct / 100)}
          />
        </svg>
        <div className="proc-orbit__center">
          <span className="proc-orbit__pct">{safePct}%</span>
          <span className="proc-orbit__center-label">{centerLabel}</span>
        </div>
      </div>

      {steps.map((step, index) => {
        const angle = ((-90 + index * (360 / steps.length)) * Math.PI) / 180;
        const x = 50 + orbitRadius * Math.cos(angle);
        const y = 50 + orbitRadius * Math.sin(angle);
        const state = stepStates[index]?.state || 'pending';
        const statusLabel = stepStates[index]?.statusLabel || 'Waiting';
        const Icon = step.icon;
        const onLeft = x < 48;
        return (
          <div
            key={step.key}
            className={`proc-orbit__node proc-orbit__node--${state} proc-orbit__node--${onLeft ? 'left' : 'right'}`}
            style={{ left: `${x}%`, top: `${y}%` }}
          >
            <span className="proc-orbit__dot" aria-hidden="true"><Icon /></span>
            <span className="proc-orbit__node-text">
              <span className="proc-orbit__node-label">{step.label}</span>
              <span className="proc-orbit__node-status">{statusLabel}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* Live processing modal — Design 2 (Orbital Radial). */
function ProcessingStatusModal({ snapshot, meta, elapsedSec = 0 }) {
  const current = snapshot || deriveProcessingSnapshot({});
  const isFailed = current.activeIndex === 0 && /fail/i.test(current.title);
  const isComplete = current.activeIndex >= PROCESS_STEPS.length - 1 && current.percent >= 100;
  const phase = isFailed ? 'fail' : isComplete ? 'done' : 'live';

  const language = current.displayLanguage
    || resolveDisplayLanguage({
      originalLanguage: current.originalLanguage,
      stage: current.stage,
      message: current.description,
      description: current.description,
      isFailed,
      activeIndex: current.activeIndex,
    });
  const stepStates = current.stepStates || deriveStepStates({
    activeIndex: current.activeIndex,
    isFailed,
    message: current.description,
    description: current.description,
    detectedLanguage: language !== 'Detecting…' && language !== '—' ? language : current.originalLanguage,
  });
  const centerIndex = typeof current.effectiveActiveIndex === 'number'
    ? current.effectiveActiveIndex
    : Math.min(current.activeIndex, PROCESS_STEPS.length - 1);
  const activeStep = PROCESS_STEPS[Math.min(centerIndex, PROCESS_STEPS.length - 1)] || PROCESS_STEPS[0];

  return (
    <div className={`proc-console proc-console--orbit proc-console--${phase}`}>
      <header className="proc-console__head">
        <div className="proc-console__head-id">
          <span className={`proc-console__dot proc-console__dot--${phase}`} aria-hidden="true" />
          <div className="proc-console__head-text">
            <div className="proc-console__eyebrow">
              {isFailed ? 'Processing failed' : isComplete ? 'Complete' : 'Live processing'}
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

      <OrbitalRadial
        steps={PROCESS_STEPS}
        stepStates={stepStates}
        percent={current.percent}
        centerLabel={activeStep.label}
      />

      <p className={`proc-console__statusline ${isFailed ? 'proc-console__statusline--fail' : ''}`}>
        <span className={`proc-console__statusline-dot proc-console__statusline-dot--${phase}`} aria-hidden="true" />
        <span>{current.description}</span>
      </p>

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
        const data = await getAgentsByCallType(callType);
        setAgentsList(data || []);
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
        const res = await getAudioStatus(currentFileName);
        const { status, processStatus, aiStatus, displayAiStatus, stage, progress, message, checkedAt, failureStage, failureReason, subtasks, originalLanguage, hasTranscript } = res;
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
        if (error.status === 404) return;
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
      const response = await uploadAudio(formData);
      if (response.success) {
        toast.success('Upload successful.', { position: 'top-center', autoClose: 2000, theme: 'colored' });
        const uploadedFileName = response.audioFileName;
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
          const latestAudio = await getLatestAudio();
          if (latestAudio.success) {
            setCurrentFileName(latestAudio.data.AudioFileName);
            setIsProcessing(true);
            setHasShownSuccessToast(false);
          }
        }
      } else {
        toast.error(response.message || 'Upload failed.', { position: 'top-center', autoClose: 3000, theme: 'dark' });
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
        maxWidth="560px"
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
