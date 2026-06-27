/**
 * File: ResultPage.jsx
 * Call analysis view — data fetching and layout; tab panels in result/tabs/
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import config from "../utils/envConfig";
import { parseTranscriptLines } from './ConversationTranscript';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugin/wavesurfer.regions.min.js';

import {
  LuFileAudio,
  LuCalendar,
  LuPhone,
  LuGlobe,
  LuUserCog,
  LuIdCard,
  LuClock,
  LuAudioLines,
  LuCircleCheck,
} from '../icons';

import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ManualAuditWorkspace from './ManualAuditWorkspace';
import './result-page.css';
import { formatTimeSec, formatWPM } from './result/resultUtils';
import SecureDownloadModal from './result/SecureDownloadModal';
import ResultMetaStrip from './result/ResultMetaStrip';
import ResultAudioPlayer from './result/ResultAudioPlayer';
import ResultTranscriptPanel from './result/ResultTranscriptPanel';
import ResultAnalysisPanel from './result/ResultAnalysisPanel';
import { computeSentimentStats } from './result/sentimentUtils';
import { calculateEnergy } from './result/toneUtils';
import {
  ResultToneTab,
  ResultSentimentTab,
  ResultScoringTab,
  ResultIntelligenceTab,
  ResultComplianceTab,
  ResultPolicyTab,
} from './result/tabs';
import { useAppBranding, useDocumentTitle } from '../utils/appBranding';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, annotationPlugin);

const ResultPage = () => {
  const { filename } = useParams();
  const { appName } = useAppBranding();
  useDocumentTitle('Call Analysis', appName);

  const [audioDetails, setAudioDetails] = useState({});
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [transcriptMessages, setTranscriptMessages] = useState([]);
  const [originalTranscription, setOriginalTranscription] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(true);
  const [summary, setSummary] = useState('Loading...');
  const waveformRef = useRef(null);
  const [waveSurfer, setWaveSurfer] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWaveformReady, setIsWaveformReady] = useState(false);
  const [activeTab, setActiveTab] = useState('scoring');
  const [transcriptTab, setTranscriptTab] = useState('transcript');
  const [toneAnalysis, setToneAnalysis] = useState(null);
  const [sentimentData, setSentimentData] = useState(null);
  const [aiScoring, setAiScoring] = useState(null);
  const [manualScoring, setManualScoring] = useState(null);
  const [loadingScoring, setLoadingScoring] = useState(false);
  const [scoreError, setScoreError] = useState(null);
  const [scriptCompliance, setScriptCompliance] = useState(null);
  const [intelligence, setIntelligence] = useState(null);
  const [categoryColors, setCategoryColors] = useState({});
  const [intelLoading, setIntelLoading] = useState(false);
  const [intelError, setIntelError] = useState(null);
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [secureDownloadOpen, setSecureDownloadOpen] = useState(false);
  const [auditWorkspaceOpen, setAuditWorkspaceOpen] = useState(false);
  const [existingAuditId, setExistingAuditId] = useState(null);

  const checkExistingAudit = async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/audits/${encodeURIComponent(filename)}`);
      if (resp.data.success && resp.data.audit) {
        setExistingAuditId(resp.data.audit.AuditID);
      } else {
        setExistingAuditId(null);
      }
    } catch { setExistingAuditId(null); }
  };

  useEffect(() => {
    const fetchAudioDetails = async () => {
      setDetailsLoading(true);
      try {
        const response = await axios.get(`${config.apiBaseUrl}/api/audio-details/${filename}`);
        if (response.data.success) setAudioDetails(response.data.audioDetails);
      } catch { }
      finally { setDetailsLoading(false); }
    };
    fetchAudioDetails();
    checkExistingAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  useEffect(() => {
    const fetchTranscript = async () => {
      setTranscriptLoading(true);
      try {
        const resp = await axios.get(`${config.apiBaseUrl}/api/translate-output/${filename}`);
        if (resp.data.success) {
          const rawText = resp.data.translateOutput || '';
          const originalText = resp.data.transcribeOutput || '';
          setTranscriptMessages(parseTranscriptLines(rawText));
          setOriginalTranscription(originalText);
        } else {
          setTranscriptMessages([]);
          setOriginalTranscription('');
        }
      } catch {
        setTranscriptMessages([]);
        setOriginalTranscription('');
      } finally {
        setTranscriptLoading(false);
      }
    };
    const fetchSummary = async () => {
      try {
        const resp = await axios.get(`${config.apiBaseUrl}/api/summary/${filename}`);
        if (resp.data.success) setSummary(resp.data.summary || 'No summary available.');
        else setSummary('No summary found.');
      } catch { setSummary('Error loading summary.'); }
    };
    fetchTranscript();
    fetchSummary();
  }, [filename]);

  const handleTranscriptSeek = (seconds) => {
    if (!waveSurfer || seconds == null) return;
    const duration = waveSurfer.getDuration();
    if (!duration) return;
    waveSurfer.seekTo(Math.min(Math.max(seconds / duration, 0), 1));
    waveSurfer.play();
  };

  // Original-language transcription parsed into the same speaker-level shape
  // as the translated conversation, so we can reuse ConversationTranscript.
  const originalMessages = useMemo(
    () => parseTranscriptLines(originalTranscription),
    [originalTranscription]
  );

  useEffect(() => {
    if (!audioDetails.AudioFileName || !waveformRef.current) return;
    const ws = WaveSurfer.create({
      container: waveformRef.current,
      waveColor: 'var(--color-accent)',
      progressColor: 'var(--color-accent-hover)',
      cursorColor: 'var(--color-danger)',
      cursorWidth: 1,
      height: 48,
      responsive: true,
      normalize: true,
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      backend: 'WebAudio',
      fillParent: true,
      scrollParent: false,
      hideScrollbar: true,
      minPxPerSec: 0.1,
      interact: true,
      crossOrigin: 'anonymous',
      plugins: [RegionsPlugin.create({ regions: [], dragSelection: false })],
    });

    ws.on('ready', () => {
      setIsWaveformReady(true);
      const containerWidth = waveformRef.current?.clientWidth || 300;
      const duration = ws.getDuration();
      if (duration > 0) {
        const pixelsPerSecond = containerWidth / duration;
        ws.zoom(pixelsPerSecond / ws.params.minPxPerSec);
      }
    });

    ws.load(`${config.apiBaseUrl}/audio/${audioDetails.AudioFileName}`);
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => setIsPlaying(false));
    setWaveSurfer(ws);
    return () => { ws.destroy(); setWaveSurfer(null); setIsWaveformReady(false); };
  }, [audioDetails.AudioFileName]);

  const handlePlayPause = () => { waveSurfer?.playPause(); };

  useEffect(() => {
    if (!toneAnalysis || !waveSurfer || !isWaveformReady || !waveformRef.current) return;
    try {
      waveSurfer.clearRegions();
      const regions = [];
      const tabooHits = toneAnalysis?.taboo_analysis?.hits || [];
      tabooHits.forEach((hit) => {
        if (hit.start == null || hit.end == null) return;
        regions.push({
          start: hit.start,
          end: Math.max(hit.end, hit.start + 0.3),
          color: hit.role === 'Agent' ? 'rgba(239, 68, 68, 0.22)' : 'rgba(245, 158, 11, 0.18)',
          drag: false,
          resize: false,
        });
      });
      ['Agent', 'Customer'].forEach((speaker) => {
        const speakerData = toneAnalysis?.results[speaker];
        if (!speakerData) return;
        Object.keys(speakerData).forEach((key) => {
          const segment = speakerData[key];
          const energy = calculateEnergy(segment.tone_distribution);
          let regionColor;
          if (energy > 700) {
            regionColor = 'rgba(239, 68, 68, 0.14)';
          } else if (energy > 300) {
            regionColor = 'rgba(245, 158, 11, 0.16)';
          } else {
            return;
          }
          regions.push({
            start: segment.start || parseFloat(key.match(/(\d+\.\d+)/)[0]),
            end: segment.end || parseFloat(key.match(/(\d+\.\d+)$/)[0]),
            color: regionColor,
            drag: false,
            resize: false,
          });
        });
      });
      regions.forEach((region) => { try { waveSurfer.addRegion(region); } catch { } });
    } catch { }
  }, [toneAnalysis, waveSurfer, isWaveformReady]);

  const fetchToneAnalysis = async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/tone-analysis/${filename}`);
      if (resp.data.success) setToneAnalysis(resp.data.toneAnalysis);
    } catch { }
  };

  const fetchSentiment = async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/sentiment/${filename}`);
      if (resp.data.success) setSentimentData(resp.data.sentiment);
    } catch { setSentimentData(null); }
  };

  const sentimentStats = useMemo(
    () => computeSentimentStats(sentimentData),
    [sentimentData]
  );

  const handleFetchScoring = async () => {
    setLoadingScoring(true);
    setScoreError(null);
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/custom-scoring-details/${filename}`);
      if (resp.data.success) {
        setAiScoring(resp.data.aiScoring || {});
        setManualScoring(resp.data.manualScoring || {});
      } else {
        setScoreError(resp.data.message || 'Scoring data not found.');
      }
    } catch {
      setScoreError('Server error fetching scoring data.');
    } finally {
      setLoadingScoring(false);
    }
  };

  const fetchIntelligence = async () => {
    setIntelLoading(true);
    setIntelError(null);
    try {
      const [resp] = await Promise.all([
        axios.get(`${config.apiBaseUrl}/api/call-intelligence/${filename}`),
        (async () => {
          try {
            const cats = await axios.get(`${config.apiBaseUrl}/api/query-categories?active=1`);
            if (cats.data?.success && Array.isArray(cats.data.categories)) {
              const map = {};
              cats.data.categories.forEach((c) => { if (c.name && c.color) map[c.name] = c.color; });
              setCategoryColors(map);
            }
          } catch { /* colours are best-effort */ }
        })(),
      ]);
      if (resp.data.success && resp.data.intelligence) {
        setIntelligence(resp.data.intelligence);
      } else {
        setIntelligence(null);
        setIntelError(resp.data.message || 'Intelligence not available for this call.');
      }
    } catch {
      setIntelError('Server error fetching call intelligence.');
    } finally {
      setIntelLoading(false);
    }
  };

  const handleFetchScriptCompliance = async () => {
    try {
      const response = await axios.get(`${config.apiBaseUrl}/api/script-compliance/${filename}`);
      if (response.data.success) {
        setScriptCompliance(response.data.scriptCompliance);
      } else {
        setScriptCompliance(null);
      }
    } catch {
      setScriptCompliance(null);
    }
  };

  useEffect(() => {
    if (!filename) return;
    handleFetchScoring();
    handleFetchScriptCompliance();
    fetchToneAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename]);

  const uploadDate = audioDetails.UploadDate
    ? new Date(audioDetails.UploadDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const metaItems = [
    { icon: LuUserCog, label: 'Agent', value: audioDetails.AgentName },
    { icon: LuIdCard, label: 'ID', value: audioDetails.AgentID },
    { icon: LuCalendar, label: 'Date', value: uploadDate },
    { icon: LuPhone, label: 'Type', value: audioDetails.CallType },
    { icon: LuGlobe, label: 'Lang', value: audioDetails.AudioLanguage },
    { icon: LuClock, label: 'Duration', value: audioDetails.AudioDuration ? formatTimeSec(audioDetails.AudioDuration) : null },
    { icon: LuAudioLines, label: 'WPM', value: audioDetails.AudioWPM ? formatWPM(audioDetails.AudioWPM) : null },
    { icon: LuCircleCheck, label: 'Status', value: audioDetails.Status, variant: audioDetails.Status === 'Completed' ? 'success' : 'accent' },
    { icon: LuFileAudio, label: 'File', value: audioDetails.AudioFileName },
  ].filter(b => b.value);

  return (
    <div className="app-page reports-page rp app-stagger">
      <ToastContainer position="top-right" autoClose={4000} hideProgressBar={false} newestOnTop closeOnClick pauseOnHover theme="colored" />

      {/* ── Metadata Strip ── */}
      <ResultMetaStrip loading={detailsLoading} items={metaItems} />


      {/* ── Audio Player Strip ── */}
      <ResultAudioPlayer
        waveformRef={waveformRef}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onDownloadClick={(e) => { e.preventDefault(); e.stopPropagation(); setSecureDownloadOpen(true); }}
        duration={audioDetails.AudioDuration}
      />

      {/* ── Main Content: Transcript + Analysis ── */}
      <div className="rp-main">
        {/* Left: Transcript Panel */}
        <ResultTranscriptPanel
          expanded={transcriptExpanded}
          onToggleExpand={() => setTranscriptExpanded(!transcriptExpanded)}
          transcriptTab={transcriptTab}
          onTranscriptTabChange={setTranscriptTab}
          transcriptLoading={transcriptLoading}
          transcriptMessages={transcriptMessages}
          originalMessages={originalMessages}
          summary={summary}
          agentUsername={audioDetails?.AgentName || ''}
          onSeek={handleTranscriptSeek}
        />

        {/* Right: Analysis Panel */}
        <ResultAnalysisPanel
          activeTab={activeTab}
          onTabSelect={(key) => {
            if (key === 'tone' && !toneAnalysis) fetchToneAnalysis();
            if (key === 'sentiment' && !sentimentData) fetchSentiment();
            if (key === 'scoring' && !aiScoring) handleFetchScoring();
            if (key === 'intel' && !intelligence && !intelError) fetchIntelligence();
            if ((key === 'scoring' || key === 'script' || key === 'policy') && !toneAnalysis) fetchToneAnalysis();
            if (key === 'script' && scriptCompliance == null) handleFetchScriptCompliance();
            setActiveTab(key);
          }}
        >

            {activeTab === 'tone' && <ResultToneTab toneAnalysis={toneAnalysis} />}
            {activeTab === 'sentiment' && <ResultSentimentTab sentimentStats={sentimentStats} />}
            {activeTab === 'scoring' && (
              <ResultScoringTab
                loading={loadingScoring}
                scoreError={scoreError}
                aiScoring={aiScoring}
                manualScoring={manualScoring}
                toneAnalysis={toneAnalysis}
                existingAuditId={existingAuditId}
                onOpenAudit={() => setAuditWorkspaceOpen(true)}
                onSeek={handleTranscriptSeek}
              />
            )}
            {activeTab === 'intel' && (
              <ResultIntelligenceTab
                loading={intelLoading}
                error={intelError}
                intelligence={intelligence}
                categoryColors={categoryColors}
              />
            )}
            {activeTab === 'policy' && (
              <ResultPolicyTab toneAnalysis={toneAnalysis} onSeek={handleTranscriptSeek} />
            )}
            {activeTab === 'script' && (
              <ResultComplianceTab
                scriptCompliance={scriptCompliance}
                toneAnalysis={toneAnalysis}
                onSeek={handleTranscriptSeek}
              />
            )}

        </ResultAnalysisPanel>
      </div>

      {/* Metadata footer removed — all details now shown in top boxed grid */}

      {/* ── Secure Download Modal ── */}
      <SecureDownloadModal
        isOpen={secureDownloadOpen}
        onClose={() => setSecureDownloadOpen(false)}
        filename={audioDetails.AudioFileName}
        apiBaseUrl={config.apiBaseUrl}
      />

      {/* ── Manual Audit Workspace ── */}
      <ManualAuditWorkspace
        open={auditWorkspaceOpen}
        onClose={() => setAuditWorkspaceOpen(false)}
        filename={filename}
        audioDetails={audioDetails}
        aiScoring={aiScoring}
        transcriptSnippet={transcriptMessages}
        onAuditSaved={(auditId) => {
          setExistingAuditId(auditId);
          handleFetchScoring();
          checkExistingAudit();
        }}
      />
    </div>
  );
};

export default ResultPage;
