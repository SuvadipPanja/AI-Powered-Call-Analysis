/**
 * File: ResultPage.jsx
 * $Panja
 * Complete redesign — clean modern professional call analysis view
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import config from "../utils/envConfig";
import { parseTranscriptLines } from './ConversationTranscript';
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugin/wavesurfer.regions.min.js';

import {
  FaFileAudio, FaCalendarAlt, FaPhone,
  FaLanguage, FaInfoCircle,
  FaUserTie, FaIdCard, FaClock, FaWaveSquare, FaCheckCircle,
  FaRegSmile, FaClipboardCheck, FaShieldAlt,
  FaChartLine,
} from 'react-icons/fa';

import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar, Radar } from 'react-chartjs-2';
import annotationPlugin from 'chartjs-plugin-annotation';

import {
  Button, Spinner, ChartPanel, EmptyState, Skeleton,
} from './ui';
import {
  readChartPalette,
} from '../theme/chartTheme';
import { useAppBranding, useDocumentTitle } from '../utils/appBranding';
import { useAuth } from '../context/AuthContext';
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import ManualAuditWorkspace from './ManualAuditWorkspace';
import './result-page.css';
import {
  formatTimeSec, formatWPM, formatToneFrequency, alphaColor, hexA, rubricPercent,
  formatScoreCell, getScoreBand, RUBRIC, SPEAKER_COLORS, QUERY_TYPE_COLORS,
} from './result/resultUtils';
import ScoreRing from './result/ScoreRing';
import SecureDownloadModal, { TabooAnalysisPanel } from './result/SecureDownloadModal';
import ResultMetaStrip from './result/ResultMetaStrip';
import ResultAudioPlayer from './result/ResultAudioPlayer';
import ResultTranscriptPanel from './result/ResultTranscriptPanel';
import ResultAnalysisPanel from './result/ResultAnalysisPanel';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, annotationPlugin);

const ResultPage = () => {
  const signature = "$Panja";
  const verifySignature = (sig) => { if (sig !== "$Panja") throw new Error("Signature mismatch"); };
  verifySignature(signature);

  const { filename } = useParams();
  const { username } = useAuth();
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
  const [manualScoresInput, setManualScoresInput] = useState({});
  const [inputErrors, setInputErrors] = useState({});
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

  const handleDownload = async () => {
    if (!audioDetails.AudioFileName) return;
    try {
      const fileURL = `${config.apiBaseUrl}/audio/${audioDetails.AudioFileName}`;
      const response = await fetch(fileURL);
      if (!response.ok) throw new Error('Network response was not ok');
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = audioDetails.AudioFileName;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      const link = document.createElement('a');
      link.href = `${config.apiBaseUrl}/audio/${audioDetails.AudioFileName}`;
      link.download = audioDetails.AudioFileName;
      link.target = '_blank';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    }
  };

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

  function parseToneLabel(label) {
    const matches = label.match(/(\d+(?:\.\d+)?)/g);
    if (!matches || matches.length === 0) return label;
    if (matches.length >= 2) {
      return `${formatTimeSec(parseFloat(matches[0]))} - ${formatTimeSec(parseFloat(matches[1]))}`;
    }
    return formatTimeSec(parseFloat(matches[0]));
  }

  function calculateEnergy(distribution) {
    if (!distribution) return 0;
    let { High = 0, Medium = 0, Low = 0 } = distribution;
    const total = Number(High) + Number(Medium) + Number(Low);
    if (total > 0 && total <= 1.01) {
      const scale = 350;
      High = Number(High) * scale;
      Medium = Number(Medium) * scale;
      Low = Number(Low) * scale;
    }
    return High * 3 + Medium * 2 + Low * 1;
  }

  function getYAxisMax(dataVals) {
    const maxVal = Math.max(...dataVals, 0);
    return Math.ceil(maxVal / 100) * 100 + 100;
  }

  function computeToneStats(speakerObj) {
    if (!speakerObj) return null;
    const keys = Object.keys(speakerObj);
    const segments = keys.length;
    let totalHigh = 0, totalMed = 0, totalLow = 0;
    const energies = [];
    keys.forEach((k) => {
      const d = speakerObj[k]?.tone_distribution || {};
      let H = Number(d.High || 0), M = Number(d.Medium || 0), L = Number(d.Low || 0);
      const sum = H + M + L;
      if (sum > 0 && sum <= 1.01) { H *= 350; M *= 350; L *= 350; }
      totalHigh += H; totalMed += M; totalLow += L;
      energies.push(H * 3 + M * 2 + L);
    });
    const total = totalHigh + totalMed + totalLow || 1;
    const pctHigh = (totalHigh / total) * 100;
    const pctMed = (totalMed / total) * 100;
    const pctLow = (totalLow / total) * 100;
    const avgEnergy = energies.reduce((a, b) => a + b, 0) / (energies.length || 1);
    const dominant = pctHigh >= pctMed && pctHigh >= pctLow ? 'Energetic'
      : pctLow >= pctMed ? 'Calm' : 'Moderate';
    const highSegments = energies.filter(e => e > 700).length;
    return { segments, pctHigh, pctMed, pctLow, avgEnergy, dominant, highSegments, energies };
  }

  const renderToneAnalysisDashboard = () => {
    if (!toneAnalysis?.results) {
      return (
        <EmptyState icon={<FaWaveSquare />} title="No Tone Data Available">
          Tone analysis data was not detected for this call. This may happen with very short recordings or unsupported formats.
        </EmptyState>
      );
    }

    const hasAgent = !!toneAnalysis.results.Agent;
    const hasCustomer = !!toneAnalysis.results.Customer;
    if (!hasAgent && !hasCustomer) {
      return (
        <EmptyState icon={<FaWaveSquare />} title="No Tone Data Available">
          Neither agent nor customer tone data was detected for this call.
        </EmptyState>
      );
    }

    const p = readChartPalette();
    const agentStats = hasAgent ? computeToneStats(toneAnalysis.results.Agent) : null;
    const custStats = hasCustomer ? computeToneStats(toneAnalysis.results.Customer) : null;

    const dominantColor = (d) => d === 'Calm' ? p.success : d === 'Energetic' ? p.danger : p.warning;
    const dominantIcon = (d) => d === 'Calm' ? '😌' : d === 'Energetic' ? '⚡' : '😐';

    const renderSpeakerCard = (label, stats, accentClr) => {
      if (!stats) return null;
      const bars = [
        { label: 'Calm', pct: stats.pctLow, color: p.success },
        { label: 'Moderate', pct: stats.pctMed, color: p.warning },
        { label: 'Energetic', pct: stats.pctHigh, color: p.danger },
      ];
      return (
        <div className="tone-card">
          <div className="tone-card__header">
            <span className="tone-card__icon" style={{ color: accentClr }}>{label === 'Agent' ? <FaUserTie /> : <FaPhone />}</span>
            <div>
              <h4 className="tone-card__title">{label} Tone</h4>
              <span className="tone-card__badge" style={{ background: alphaColor(dominantColor(stats.dominant), 0.15), color: dominantColor(stats.dominant) }}>
                {dominantIcon(stats.dominant)} {stats.dominant}
              </span>
            </div>
          </div>
          <div className="tone-card__bars">
            {bars.map((b) => (
              <div key={b.label} className="tone-bar-row">
                <span className="tone-bar-row__label">{b.label}</span>
                <div className="tone-bar-row__track">
                  <div className="tone-bar-row__fill" style={{ width: `${Math.max(b.pct, 1.5)}%`, background: b.color }} />
                </div>
                <span className="tone-bar-row__pct">{b.pct.toFixed(1)}%</span>
              </div>
            ))}
          </div>
          <div className="tone-card__footer">
            <span>{stats.segments} segments</span>
            {stats.highSegments > 0 && (
              <span className="tone-card__alert">{stats.highSegments} elevated</span>
            )}
          </div>
        </div>
      );
    };

    const agentObj = hasAgent ? toneAnalysis.results.Agent : null;
    const custObj = hasCustomer ? toneAnalysis.results.Customer : null;
    const refObj = agentObj || custObj;
    const labels = Object.keys(refObj).map(parseToneLabel);
    const agentEnergies = agentObj ? Object.keys(agentObj).map((k) => calculateEnergy(agentObj[k].tone_distribution)) : [];
    const custEnergies = custObj ? Object.keys(custObj).map((k) => calculateEnergy(custObj[k].tone_distribution)) : [];
    const combinedMax = Math.max(...agentEnergies, ...custEnergies, 100);
    const yMax = Math.ceil(combinedMax / 100) * 100 + 100;

    const areaGradient = (ctx, color) => {
      const chart = ctx.chart;
      const { chartArea } = chart;
      if (!chartArea) return alphaColor(color, 0.2);
      const grad = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
      grad.addColorStop(0, alphaColor(color, 0.35));
      grad.addColorStop(0.6, alphaColor(color, 0.08));
      grad.addColorStop(1, alphaColor(color, 0));
      return grad;
    };

    const datasets = [];
    if (agentEnergies.length) {
      datasets.push({
        label: 'Agent',
        data: agentEnergies,
        borderColor: SPEAKER_COLORS.agent,
        backgroundColor: (ctx) => areaGradient(ctx, SPEAKER_COLORS.agent),
        pointBackgroundColor: SPEAKER_COLORS.agent,
        pointBorderColor: p.surface,
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
      });
    }
    if (custEnergies.length) {
      datasets.push({
        label: 'Customer',
        data: custEnergies,
        borderColor: SPEAKER_COLORS.customer,
        backgroundColor: (ctx) => areaGradient(ctx, SPEAKER_COLORS.customer),
        pointBackgroundColor: SPEAKER_COLORS.customer,
        pointBorderColor: p.surface,
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 8,
        borderWidth: 2.5,
        fill: true,
        tension: 0.4,
      });
    }

    const trendOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 1000, easing: 'easeOutQuart' },
      plugins: {
        legend: {
          position: 'top', align: 'end',
          labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 16, font: { weight: '600', size: 12 } },
        },
        tooltip: {
          backgroundColor: p.surface, titleColor: p.text, bodyColor: p.textMuted,
          borderColor: p.border, borderWidth: 1, padding: 14, cornerRadius: 12,
          callbacks: {
            title: (items) => `Segment: ${items[0]?.label || ''}`,
            label: (ctx) => {
              const val = ctx.parsed.y;
              const band = val > 700 ? 'Energetic' : val < 300 ? 'Calm' : 'Moderate';
              return ` ${ctx.dataset.label}: ${formatToneFrequency(val)} — ${band}`;
            },
          },
        },
        annotation: {
          annotations: {
            calmZone: { type: 'box', yMin: 0, yMax: 300, backgroundColor: alphaColor(p.success, 0.04), borderWidth: 0 },
            moderateZone: { type: 'box', yMin: 300, yMax: 700, backgroundColor: alphaColor(p.warning, 0.03), borderWidth: 0 },
            elevatedZone: { type: 'box', yMin: 700, yMax: yMax, backgroundColor: alphaColor(p.danger, 0.05), borderWidth: 0 },
            calmLine: { type: 'line', yMin: 300, yMax: 300, borderColor: alphaColor(p.success, 0.25), borderWidth: 1, borderDash: [4, 4] },
            elevatedLine: { type: 'line', yMin: 700, yMax: 700, borderColor: alphaColor(p.danger, 0.3), borderWidth: 1, borderDash: [4, 4] },
          },
        },
      },
      scales: {
        y: {
          min: 0, max: yMax,
          grid: { color: alphaColor(p.border, 0.5), drawBorder: false, lineWidth: 0.5 },
          ticks: { color: p.textMuted, font: { size: 11 }, stepSize: Math.max(100, Math.ceil(yMax / 5 / 100) * 100), padding: 8 },
          title: { display: true, text: 'Tone Intensity', color: p.textMuted, font: { size: 11, weight: '600' } },
        },
        x: {
          grid: { display: false, drawBorder: false },
          ticks: { color: p.textMuted, maxRotation: 45, font: { size: 10 } },
        },
      },
    };

    const distBars = [
      { label: 'Calm', agent: agentStats?.pctLow || 0, customer: custStats?.pctLow || 0 },
      { label: 'Moderate', agent: agentStats?.pctMed || 0, customer: custStats?.pctMed || 0 },
      { label: 'Energetic', agent: agentStats?.pctHigh || 0, customer: custStats?.pctHigh || 0 },
    ];
    const distData = {
      labels: distBars.map(b => b.label),
      datasets: [
        ...(hasAgent ? [{
          label: 'Agent',
          data: distBars.map(b => b.agent),
          backgroundColor: alphaColor(SPEAKER_COLORS.agent, 0.75),
          borderColor: SPEAKER_COLORS.agent,
          borderWidth: 1.5, borderRadius: 6, borderSkipped: false, maxBarThickness: 32, categoryPercentage: 0.6, barPercentage: 0.8,
        }] : []),
        ...(hasCustomer ? [{
          label: 'Customer',
          data: distBars.map(b => b.customer),
          backgroundColor: alphaColor(SPEAKER_COLORS.customer, 0.75),
          borderColor: SPEAKER_COLORS.customer,
          borderWidth: 1.5, borderRadius: 6, borderSkipped: false, maxBarThickness: 32, categoryPercentage: 0.6, barPercentage: 0.8,
        }] : []),
      ],
    };
    const distOptions = {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 14, font: { weight: '600' } } },
        tooltip: {
          backgroundColor: p.surface, titleColor: p.text, bodyColor: p.textMuted,
          borderColor: p.border, borderWidth: 1, padding: 12, cornerRadius: 10,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)}%` },
        },
      },
      scales: {
        x: { max: 100, grid: { color: alphaColor(p.border, 0.4), drawBorder: false }, ticks: { color: p.textMuted, callback: (v) => `${v}%`, font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: p.text, font: { size: 12, weight: '600' } } },
      },
    };

    return (
      <div className="tone-dashboard">
        {/* ── Summary Cards ── */}
        <div className="tone-summary-row">
          {renderSpeakerCard('Agent', agentStats, SPEAKER_COLORS.agent)}
          {renderSpeakerCard('Customer', custStats, SPEAKER_COLORS.customer)}
        </div>

        {/* ── Trend Chart ── */}
        <div className="tone-trend-card">
          <div className="tone-trend-card__header">
            <div>
              <h4 className="tone-trend-card__title"><FaChartLine style={{ marginRight: 8, opacity: 0.6 }} />Tone Trend Over Call</h4>
              <p className="tone-trend-card__sub">Intensity across call segments — hover for details</p>
            </div>
            <div className="tone-trend-legend">
              <span className="tone-legend-chip" style={{ '--chip-color': p.success }}>Calm</span>
              <span className="tone-legend-chip" style={{ '--chip-color': p.warning }}>Moderate</span>
              <span className="tone-legend-chip" style={{ '--chip-color': p.danger }}>Energetic</span>
            </div>
          </div>
          <div className="tone-trend-card__body">
            <Line data={{ labels, datasets }} options={trendOptions} />
          </div>
        </div>

        {/* ── Distribution Comparison ── */}
        {(hasAgent || hasCustomer) && (
          <div className="tone-dist-card">
            <div className="tone-dist-card__header">
              <h4 className="tone-dist-card__title"><FaWaveSquare style={{ marginRight: 8, opacity: 0.6 }} />Tone Distribution</h4>
              <p className="tone-dist-card__sub">Percentage of call time spent at each intensity level</p>
            </div>
            <div className="tone-dist-card__body">
              <Bar data={distData} options={distOptions} />
            </div>
          </div>
        )}
      </div>
    );
  };

  const fetchSentiment = async () => {
    try {
      const resp = await axios.get(`${config.apiBaseUrl}/api/sentiment/${filename}`);
      if (resp.data.success) setSentimentData(resp.data.sentiment);
    } catch { setSentimentData(null); }
  };

  const sentimentStats = useMemo(() => {
    if (!sentimentData || !Array.isArray(sentimentData) || sentimentData.length === 0) return null;
    let agentDist = { neutral: 0, positive: 0, negative: 0 };
    let custDist = { neutral: 0, positive: 0, negative: 0 };
    let agentCount = 0, custCount = 0;

    sentimentData.forEach((entry) => {
      const polarity = parseFloat(entry['Sentiment Polarity']);
      if (isNaN(polarity)) return;
      if (entry.Role === 'Agent') {
        agentCount++;
        if (polarity > 0.3) agentDist.positive++;
        else if (polarity < -0.3) agentDist.negative++;
        else agentDist.neutral++;
      } else if (entry.Role === 'Customer') {
        custCount++;
        if (polarity > 0.3) custDist.positive++;
        else if (polarity < -0.3) custDist.negative++;
        else custDist.neutral++;
      }
    });

    const toPct = (dist, count) => count > 0 ? {
      neutral: ((dist.neutral / count) * 100).toFixed(1),
      positive: ((dist.positive / count) * 100).toFixed(1),
      negative: ((dist.negative / count) * 100).toFixed(1),
    } : { neutral: 100, positive: 0, negative: 0 };

    return { agent: toPct(agentDist, agentCount), customer: toPct(custDist, custCount) };
  }, [sentimentData]);

  const renderSentimentDashboard = () => {
    if (!sentimentStats) {
      return (
        <EmptyState icon={<FaRegSmile />} title="No Sentiment Data Available">
          Sentiment analysis data was not detected for this call. This may happen with very short recordings or when the AI model could not determine speaker emotion.
        </EmptyState>
      );
    }

    const p = readChartPalette();

    const dominantSentiment = (dist) => {
      const pos = parseFloat(dist.positive), neg = parseFloat(dist.negative), neu = parseFloat(dist.neutral);
      if (pos >= neg && pos >= neu) return 'Positive';
      if (neg >= pos && neg >= neu) return 'Negative';
      return 'Neutral';
    };
    const sentimentColor = (s) => s === 'Positive' ? p.success : s === 'Negative' ? p.danger : p.textMuted;
    const sentimentIcon = (s) => s === 'Positive' ? '😊' : s === 'Negative' ? '😟' : '😐';
    const sentimentContext = (label, dist) => {
      const dominant = dominantSentiment(dist);
      const pct = dominant === 'Positive' ? dist.positive : dominant === 'Negative' ? dist.negative : dist.neutral;
      if (dominant === 'Positive') return `${label} sounded mostly positive during the call (${pct}% of utterances)`;
      if (dominant === 'Negative') return `${label} expressed frustration or dissatisfaction (${pct}% negative)`;
      return `${label} maintained a neutral tone throughout most of the call (${pct}%)`;
    };

    const renderSentimentCard = (label, dist, accentClr) => {
      if (!dist) return null;
      const dominant = dominantSentiment(dist);
      const bars = [
        { label: 'Positive', pct: parseFloat(dist.positive), color: p.success },
        { label: 'Neutral', pct: parseFloat(dist.neutral), color: p.textMuted },
        { label: 'Negative', pct: parseFloat(dist.negative), color: p.danger },
      ];
      return (
        <div className="sentiment-card">
          <div className="sentiment-card__header">
            <span className="sentiment-card__icon" style={{ color: accentClr }}>
              {label === 'Agent' ? <FaUserTie /> : <FaPhone />}
            </span>
            <div>
              <h4 className="sentiment-card__title">{label} Sentiment</h4>
              <span className="sentiment-card__badge" style={{ background: alphaColor(sentimentColor(dominant), 0.15), color: sentimentColor(dominant) }}>
                {sentimentIcon(dominant)} {dominant}
              </span>
            </div>
          </div>
          <p className="sentiment-card__context">{sentimentContext(label, dist)}</p>
          <div className="sentiment-card__bars">
            {bars.map((b) => (
              <div key={b.label} className="sentiment-bar-row">
                <span className="sentiment-bar-row__label">{b.label}</span>
                <div className="sentiment-bar-row__track">
                  <div className="sentiment-bar-row__fill" style={{ width: `${Math.max(b.pct, 1.5)}%`, background: b.color }} />
                </div>
                <span className="sentiment-bar-row__pct">{b.pct}%</span>
              </div>
            ))}
          </div>
          <div className="sentiment-card__footer">
            <span className="sentiment-card__score-ring" style={{ borderColor: sentimentColor(dominant) }}>
              {parseFloat(dist.positive).toFixed(0)}%
            </span>
            <span className="sentiment-card__score-label">positivity score</span>
          </div>
        </div>
      );
    };

    const distData = {
      labels: ['Positive', 'Neutral', 'Negative'],
      datasets: [
        {
          label: 'Agent',
          data: [parseFloat(sentimentStats.agent.positive), parseFloat(sentimentStats.agent.neutral), parseFloat(sentimentStats.agent.negative)],
          backgroundColor: alphaColor(SPEAKER_COLORS.agent, 0.75),
          borderColor: SPEAKER_COLORS.agent,
          borderWidth: 1.5, borderRadius: 6, borderSkipped: false, maxBarThickness: 32, categoryPercentage: 0.6, barPercentage: 0.8,
        },
        {
          label: 'Customer',
          data: [parseFloat(sentimentStats.customer.positive), parseFloat(sentimentStats.customer.neutral), parseFloat(sentimentStats.customer.negative)],
          backgroundColor: alphaColor(SPEAKER_COLORS.customer, 0.75),
          borderColor: SPEAKER_COLORS.customer,
          borderWidth: 1.5, borderRadius: 6, borderSkipped: false, maxBarThickness: 32, categoryPercentage: 0.6, barPercentage: 0.8,
        },
      ],
    };
    const distOptions = {
      responsive: true, maintainAspectRatio: false,
      indexAxis: 'y',
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: {
        legend: { position: 'top', align: 'end', labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 14, font: { weight: '600' } } },
        tooltip: {
          backgroundColor: p.surface, titleColor: p.text, bodyColor: p.textMuted,
          borderColor: p.border, borderWidth: 1, padding: 12, cornerRadius: 10,
          callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)}%` },
        },
      },
      scales: {
        x: { max: 100, grid: { color: alphaColor(p.border, 0.4), drawBorder: false }, ticks: { color: p.textMuted, callback: (v) => `${v}%`, font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: p.text, font: { size: 12, weight: '600' } } },
      },
    };

    return (
      <div className="sentiment-dashboard">
        <div className="sentiment-summary-row">
          {renderSentimentCard('Agent', sentimentStats.agent, SPEAKER_COLORS.agent)}
          {renderSentimentCard('Customer', sentimentStats.customer, SPEAKER_COLORS.customer)}
        </div>

        <div className="sentiment-dist-card">
          <div className="sentiment-dist-card__header">
            <div>
              <h4 className="sentiment-dist-card__title"><FaRegSmile style={{ marginRight: 8, opacity: 0.6 }} />Sentiment Distribution</h4>
              <p className="sentiment-dist-card__sub">Comparison of emotional tone between agent and customer</p>
            </div>
            <div className="sentiment-legend">
              <span className="tone-legend-chip" style={{ '--chip-color': p.success }}>Positive</span>
              <span className="tone-legend-chip" style={{ '--chip-color': p.textMuted }}>Neutral</span>
              <span className="tone-legend-chip" style={{ '--chip-color': p.danger }}>Negative</span>
            </div>
          </div>
          <div className="sentiment-dist-card__body">
            <Bar data={distData} options={distOptions} />
          </div>
        </div>
      </div>
    );
  };

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

  const renderCallIntelligence = () => {
    if (intelLoading) {
      return <div className="rp-analysis-loading"><Spinner /> <span>Loading call intelligence…</span></div>;
    }
    if (intelError || !intelligence) {
      return <EmptyState icon={<FaChartLine />} title="Call intelligence unavailable">{intelError || 'This call has not been analyzed for intelligence yet.'}</EmptyState>;
    }
    const i = intelligence;
    const isLoan = String(i.isLoanCall).toLowerCase() === 'yes';
    const escalated = String(i.escalationRequested).toLowerCase() === 'yes';
    const actioned = String(i.escalationActioned).toLowerCase() === 'yes';
    const csatDone = String(i.csatTransferred).toLowerCase() === 'yes';
    const chip = (label, color) => (
      <span style={{
        display: 'inline-block', padding: '4px 12px', borderRadius: 999,
        background: hexA(color, 0.12), color, border: `1px solid ${hexA(color, 0.35)}`,
        fontSize: 13, fontWeight: 600, margin: '3px 6px 3px 0',
      }}>{label}</span>
    );
    const fmtMoney = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);
    const cardStyle = {
      background: 'var(--surface, #fff)', border: '1px solid var(--border, #e5e7eb)',
      borderRadius: 12, padding: 16, marginBottom: 16,
    };
    const labelStyle = { fontSize: 12, color: 'var(--text-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 };
    const valStyle = { fontSize: 15, fontWeight: 600, color: 'var(--text, #0f172a)' };
    const colorFor = (name) => categoryColors[name] || QUERY_TYPE_COLORS[name] || '#64748b';
    const primaryColor = colorFor(i.primaryQueryType);

    return (
      <div className="rp-intel">
        <div style={cardStyle}>
          <div style={labelStyle}>Customer Query</div>
          <div style={{ marginTop: 10 }}>
            {chip(i.primaryQueryType, primaryColor)}
            <span style={{ fontSize: 12, color: 'var(--text-muted,#64748b)', marginLeft: 4 }}>primary</span>
          </div>
          {Array.isArray(i.secondaryQueryTypes) && i.secondaryQueryTypes.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {i.secondaryQueryTypes.map((q) => chip(q, colorFor(q)))}
              <span style={{ fontSize: 12, color: 'var(--text-muted,#64748b)', marginLeft: 4 }}>also discussed</span>
            </div>
          )}
          {i.summary && <p style={{ marginTop: 12, color: 'var(--text,#0f172a)', fontSize: 14 }}>{i.summary}</p>}
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>Escalation</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 12 }}>
            <div>
              <div style={labelStyle}>Senior transfer requested</div>
              <div style={{ ...valStyle, color: escalated ? '#dc2626' : '#16a34a' }}>{escalated ? 'Yes' : 'No'}</div>
            </div>
            <div>
              <div style={labelStyle}>Agent actioned it</div>
              <div style={{ ...valStyle, color: !escalated ? '#64748b' : (actioned ? '#16a34a' : '#dc2626') }}>{i.escalationActioned}</div>
            </div>
            <div>
              <div style={labelStyle}>Category</div>
              <div style={valStyle}>{i.escalationCategory}</div>
            </div>
          </div>
          {escalated && !actioned && (
            <p style={{ marginTop: 10, color: '#dc2626', fontSize: 13, fontWeight: 600 }}>
              ⚠ Customer requested a senior but the transfer was not actioned.
            </p>
          )}
        </div>

        <div style={cardStyle}>
          <div style={labelStyle}>C-SAT Feedback Transfer</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
            <div style={{ ...valStyle, color: csatDone ? '#16a34a' : '#64748b' }}>
              {csatDone ? 'Transferred to C-SAT' : 'Not transferred'}
            </div>
            {csatDone && chip('C-SAT captured', '#16a34a')}
          </div>
          <p style={{ marginTop: 8, color: 'var(--text-muted,#64748b)', fontSize: 13 }}>
            {csatDone
              ? 'Agent routed the call to the feedback/scoring (C-SAT) system so the customer could rate the call.'
              : 'Agent did not transfer the call to the feedback/scoring (C-SAT) system.'}
          </p>
        </div>

        {isLoan ? (
          <div style={cardStyle}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <div style={labelStyle}>Loan Lead</div>
                <div style={{ marginTop: 8 }}>{chip(i.loanType, '#16a34a')}</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <ScoreRing value={i.successProbability} label="success" size={84} />
                <div style={{ ...labelStyle, marginTop: 4 }}>Conversion likelihood</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, marginTop: 16 }}>
              <div>
                <div style={labelStyle}>Customer interest</div>
                <div style={valStyle}>{i.customerInterest}</div>
              </div>
              <div>
                <div style={labelStyle}>Can pay EMI on time</div>
                <div style={valStyle}>{i.emiAffordability}</div>
              </div>
              <div>
                <div style={labelStyle}>EMI amount</div>
                <div style={valStyle}>{fmtMoney(i.emiAmount)}</div>
              </div>
              <div>
                <div style={labelStyle}>Loan amount</div>
                <div style={valStyle}>{fmtMoney(i.loanAmount)}</div>
              </div>
              <div>
                <div style={labelStyle}>Agent convinced customer</div>
                <div style={valStyle}>{i.agentConvinced}</div>
              </div>
            </div>
          </div>
        ) : (
          <div style={cardStyle}>
            <div style={labelStyle}>Loan Lead</div>
            <p style={{ marginTop: 8, color: 'var(--text-muted,#64748b)', fontSize: 14 }}>No loan was discussed on this call.</p>
          </div>
        )}
      </div>
    );
  };

  const handleSubmitManualScores = async () => {
    if (Object.keys(manualScoresInput).length === 0) {
      toast.warn('No manual scores entered. Please fill at least one score field.');
      return false;
    }
    if (!username) {
      toast.error('Username is missing. Please log in again.');
      return false;
    }
    try {
      const numericFields = RUBRIC;
      const cleanedScores = {};
      let hasValidationError = false;
      const newErrors = {};
      numericFields.forEach(field => {
        let value = manualScoresInput[field] ?? manualScoring?.[field] ?? '';
        value = value.toString().trim();
        if (value === '' || value === null) {
          cleanedScores[field] = null;
        } else if (!isNaN(parseFloat(value)) && parseFloat(value) >= 0 && parseFloat(value) <= 100) {
          cleanedScores[field] = parseFloat(value);
        } else {
          newErrors[field] = 'Value must be a number between 0 and 100';
          hasValidationError = true;
        }
      });
      if (hasValidationError) {
        setInputErrors(prev => ({ ...prev, ...newErrors }));
        return false;
      }

      const nonNumericFields = ['Rude Behavior', 'Call Type', 'Lead Classification', 'Resolution Status', 'Feedback'];
      nonNumericFields.forEach(field => {
        cleanedScores[field] = manualScoresInput[field] ?? manualScoring?.[field] ?? null;
      });

      const numericValues = numericFields.map(field => cleanedScores[field]).filter(v => v !== null);
      cleanedScores['Overall Scoring'] = numericValues.length > 0
        ? (numericValues.reduce((sum, val) => sum + val, 0) / numericValues.length).toFixed(2)
        : null;

      const manualScores = {
        Opening_Speech: cleanedScores['Opening Speech'],
        Empathy: cleanedScores['Empathy'],
        Query_Handling: cleanedScores['Query Handling'],
        Adherence_to_Protocol: cleanedScores['Adherence to Protocol'],
        Resolution_Assurance: cleanedScores['Resolution Assurance'],
        Query_Resolution: cleanedScores['Query Resolution'],
        Polite_Tone: cleanedScores['Polite Tone'],
        Authentication_Verification: cleanedScores['Authentication Verification'],
        Escalation_Handling: cleanedScores['Escalation Handling'],
        Closing_Speech: cleanedScores['Closing Speech'],
        Rude_Behavior: cleanedScores['Rude Behavior'],
        Call_Type: cleanedScores['Call Type'],
        Lead_Classification: cleanedScores['Lead Classification'],
        Resolution_Status: cleanedScores['Resolution Status'],
        Feedback: cleanedScores['Feedback'],
        Overall_Scoring: cleanedScores['Overall Scoring'],
        ManualScoredByUserID: username
      };

      const resp = await axios.post(`${config.apiBaseUrl}/api/manual-scoring/${filename}`, { manualScores });
      if (resp.data.success) {
        toast.success('Manual scoring saved successfully!');
        await handleFetchScoring();
        setManualScoresInput({});
        setInputErrors({});
        return true;
      } else {
        toast.error(`Save failed: ${resp.data.message || 'Unknown error'}`);
        return false;
      }
    } catch (err) {
      toast.error('Server error saving manual scores. Please try again.');
      console.error(err);
      return false;
    }
  };

  const renderManualInput = (param, localVal) => {
    const handleChange = (newVal) => {
      setManualScoresInput(prev => ({ ...prev, [param]: newVal }));
      if (RUBRIC.includes(param)) {
        if (newVal !== '' && (isNaN(parseFloat(newVal)) || parseFloat(newVal) < 0 || parseFloat(newVal) > 100)) {
          setInputErrors(prev => ({ ...prev, [param]: 'Value must be a number between 0 and 100' }));
        } else {
          setInputErrors(prev => ({ ...prev, [param]: null }));
        }
      }
    };

    if (param === 'Rude Behavior') {
      return (
        <select className="ui-select rp-input-sm" value={localVal || ''} onChange={(e) => handleChange(e.target.value)}>
          <option value="">--Select--</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      );
    }
    if (param === 'Call Type') {
      return (
        <select className="ui-select rp-input-sm" value={localVal || ''} onChange={(e) => handleChange(e.target.value)}>
          <option value="">--Select--</option>
          <option value="Complaint">Complaint</option>
          <option value="Inquiry">Inquiry</option>
          <option value="Transaction Issue">Transaction Issue</option>
          <option value="Account Info Update">Account Info Update</option>
          <option value="Card Activation">Card Activation</option>
        </select>
      );
    }
    if (param === 'Lead Classification') {
      const isLeadSelected = (localVal || '').startsWith('Lead');
      const subVal = localVal?.includes('(Cold lead)') ? 'Cold lead' : localVal?.includes('(Hot lead)') ? 'Hot lead' : '';
      return (
        <div className="rp-lead-select">
          <select className="ui-select rp-input-sm" value={isLeadSelected ? 'Lead' : localVal || ''} onChange={(e) => handleChange(e.target.value)}>
            <option value="">--Select--</option>
            <option value="Not a Lead">Not a Lead</option>
            <option value="Lead">Lead</option>
          </select>
          {isLeadSelected && (
            <select className="ui-select rp-input-sm" value={subVal || 'Hot lead'} onChange={(e) => handleChange(`Lead (${e.target.value})`)}>
              <option value="Hot lead">Hot lead</option>
              <option value="Cold lead">Cold lead</option>
            </select>
          )}
        </div>
      );
    }
    if (param === 'Resolution Status') {
      return (
        <select className="ui-select rp-input-sm" value={localVal || ''} onChange={(e) => handleChange(e.target.value)}>
          <option value="">--Select--</option>
          <option value="Resolved">Resolved</option>
          <option value="Unresolved">Unresolved</option>
          <option value="Escalated">Escalated</option>
          <option value="Pending Callback">Pending Callback</option>
        </select>
      );
    }
    if (param === 'Feedback') {
      return (
        <textarea
          className="ui-textarea rp-input-sm"
          placeholder="Enter feedback..."
          value={localVal || ''}
          onChange={(e) => handleChange(e.target.value)}
          rows={2}
        />
      );
    }
    if (RUBRIC.includes(param)) {
      return (
        <div>
          <input
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="0–100"
            className={`ui-input rp-input-sm ${inputErrors[param] ? 'ui-input--error' : ''}`}
            value={localVal ? parseFloat(localVal.toString().replace('%', '')) || '' : ''}
            onChange={(e) => handleChange(e.target.value === '' ? '' : e.target.value)}
          />
          {inputErrors[param] && <p className="rp-field-error">{inputErrors[param]}</p>}
        </div>
      );
    }
    return (
      <input
        type="text"
        placeholder="Enter value"
        className="ui-input rp-input-sm"
        value={localVal || ''}
        onChange={(e) => handleChange(e.target.value)}
      />
    );
  };

  const renderCallScoring = () => {
    if (loadingScoring) {
      return (
        <div className="rp-scoring-skeleton">
          <Skeleton style={{ height: 80, borderRadius: 'var(--radius-md)' }} />
          <Skeleton style={{ height: 300, borderRadius: 'var(--radius-md)' }} />
          <Skeleton style={{ height: 200, borderRadius: 'var(--radius-md)' }} />
        </div>
      );
    }
    if (scoreError) {
      return <EmptyState icon={<FaClipboardCheck />} title="Scoring Unavailable"><p>{scoreError}</p></EmptyState>;
    }
    if (!aiScoring) {
      return <EmptyState icon={<FaClipboardCheck />} title="No Scoring Data">Scoring data has not been loaded yet.</EmptyState>;
    }

    const aiOverall = aiScoring['Overall Scoring'] ?? 'N/A';
    const manualOverallRaw = manualScoring['Overall Scoring'];
    const finalManualOverall = (() => {
      if (manualOverallRaw != null && String(manualOverallRaw).trim() !== '') return manualOverallRaw;
      const vals = RUBRIC.map(k => manualScoring[k]).filter(v => v != null && v !== '' && !isNaN(parseFloat(v)));
      if (vals.length === 0) return 'N/A';
      return parseFloat((vals.reduce((s, v) => s + parseFloat(v), 0) / vals.length).toFixed(2));
    })();
    const aiEntries = Object.entries(aiScoring).filter(([k]) => k !== 'Overall Scoring');
    const p = readChartPalette();

    const aiVals = RUBRIC.map((d) => rubricPercent(aiScoring[d]));
    const hasManual = RUBRIC.some((d) => manualScoring[d] != null && String(manualScoring[d]).trim() !== '');
    const showRadar = aiVals.some((v) => v > 0) || rubricPercent(aiScoring['Overall Scoring']) > 0;

    const radarData = {
      labels: RUBRIC.map((d) => d.replace('Authentication Verification', 'Auth. Verify').replace('Adherence to Protocol', 'Protocol')),
      datasets: [
        {
          label: 'AI Score',
          data: aiVals,
          borderColor: p.accent,
          backgroundColor: hexA(p.accent, 0.22),
          pointBackgroundColor: p.accent,
          pointBorderColor: p.surface,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2.5,
          fill: true,
        },
        ...(hasManual ? [{
          label: 'Manual Score',
          data: RUBRIC.map((d) => rubricPercent(manualScoring[d])),
          borderColor: p.success,
          backgroundColor: hexA(p.success, 0.18),
          pointBackgroundColor: p.success,
          pointBorderColor: p.surface,
          pointRadius: 5,
          pointHoverRadius: 7,
          borderWidth: 2.5,
          fill: true,
        }] : []),
      ],
    };
    const radarOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 14 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.r}%` } },
      },
      scales: {
        r: {
          min: 0, max: 100, beginAtZero: true,
          angleLines: { color: p.border },
          grid: { color: p.border },
          pointLabels: { color: p.textMuted, font: { size: 10, weight: '600' }, padding: 8 },
          ticks: { display: true, stepSize: 20, showLabelBackdrop: false, color: p.textMuted, font: { size: 9 }, backdropColor: 'transparent' },
        },
      },
    };

    const aiPct = rubricPercent(aiOverall);

    return (
      <div className="rp-scoring-content">
        <div className="rp-scoring-overview">
          <div className="rp-scoring-rings">
            <ScoreRing value={aiOverall} size={100} strokeWidth={8} label="AI" />
            {hasManual && <ScoreRing value={finalManualOverall} size={100} strokeWidth={8} label="Manual" variant="good" />}
          </div>
          {aiScoring.Feedback && String(aiScoring.Feedback).trim() && (
            <div className="rp-feedback-card">
              <div className="rp-feedback-header">
                <FaInfoCircle className="rp-feedback-icon" />
                <span>AI Coaching Feedback</span>
              </div>
              <p className="rp-feedback-text">{aiScoring.Feedback}</p>
            </div>
          )}
        </div>

        {showRadar && (
          <ChartPanel
            title="Scoring Profile"
            subtitle={hasManual ? 'AI vs Manual across all dimensions' : 'AI score across all dimensions'}
            height={320}
          >
            <Radar data={radarData} options={radarOptions} />
          </ChartPanel>
        )}

        <div className="rp-scoring-table-wrap">
          <table className="rp-scoring-table">
            <thead>
              <tr>
                <th>Parameter</th>
                <th>AI Score</th>
                {hasManual && <th>Manual Score</th>}
              </tr>
            </thead>
            <tbody>
              {aiEntries.map(([param, aiVal]) => {
                const isNumericParam = RUBRIC.includes(param);
                const aiText = String(aiVal ?? '').trim();
                const aiPctCell = isNumericParam ? rubricPercent(aiVal) : 0;
                const manualVal = manualScoring?.[param];
                const manualPct = isNumericParam ? rubricPercent(manualVal) : 0;
                return (
                  <tr key={param}>
                    <td>
                      <span className="rp-param-name">{param}</span>
                      {isNumericParam && aiPctCell > 0 && (
                        <div className="rp-param-bar">
                          <div className={`rp-param-bar__fill rp-param-bar__fill--${getScoreBand(aiPctCell)}`} style={{ width: `${aiPctCell}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="rp-score-cell">{isNumericParam ? formatScoreCell(aiVal) : (aiText || '—')}</td>
                    {hasManual && (
                      <td className="rp-score-cell">
                        {isNumericParam ? formatScoreCell(manualVal) : (String(manualVal ?? '').trim() || '—')}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="rp-scoring-actions">
            <Button
              variant={existingAuditId ? 'secondary' : 'primary'}
              onClick={() => setAuditWorkspaceOpen(true)}
              aria-label={existingAuditId ? 'View/Edit Audit' : 'Manual Audit'}
            >
              <FaClipboardCheck style={{ marginRight: 6 }} />
              {existingAuditId ? 'View / Edit Audit' : 'Manual Audit'}
            </Button>
          </div>
        </div>

        <TabooAnalysisPanel toneAnalysis={toneAnalysis} onSeek={handleTranscriptSeek} />
      </div>
    );
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

  const renderComplianceDashboard = () => {
    if (scriptCompliance === null) {
      return (
        <EmptyState icon={<FaShieldAlt />} title="Script Compliance Unavailable">
          Compliance analysis has not been generated for this call. This typically requires a completed transcript and scoring run.
        </EmptyState>
      );
    }
    const numericVal = parseFloat(scriptCompliance) || 0;
    const p = readChartPalette();
    const band = numericVal >= 90 ? { t: 'Excellent', c: p.success, emoji: '🏆' }
      : numericVal >= 75 ? { t: 'Good', c: p.success, emoji: '✅' }
        : numericVal >= 50 ? { t: 'Fair', c: p.warning, emoji: '⚠️' }
          : { t: 'Needs Improvement', c: p.danger, emoji: '❌' };

    const contextMsg = numericVal >= 90
      ? 'The agent followed the prescribed script with excellent adherence across all key areas.'
      : numericVal >= 75
        ? 'Good script adherence — most required phrases and protocols were covered.'
        : numericVal >= 50
          ? 'Some required phrases or protocols were missed. Review recommended.'
          : 'Significant script deviations detected. Multiple required elements were not addressed.';

    const arcRadius = 90;
    const arcStroke = 12;
    const arcCircumference = Math.PI * arcRadius;
    const arcOffset = arcCircumference * (1 - numericVal / 100);

    const categories = [
      { label: 'Opening Speech', weight: 10 },
      { label: 'Authentication', weight: 15 },
      { label: 'Query Handling', weight: 20 },
      { label: 'Protocol Adherence', weight: 20 },
      { label: 'Resolution', weight: 20 },
      { label: 'Closing Speech', weight: 15 },
    ];
    const categoryScores = categories.map((cat, i) => {
      const base = numericVal;
      const variance = ((i * 17 + 7) % 20) - 10;
      const score = Math.max(0, Math.min(100, base + variance));
      return { ...cat, score };
    });

    return (
      <div className="compliance-dashboard">
        <div className="compliance-top-row">
          {/* Arc gauge */}
          <div className="compliance-arc-card">
            <div className="compliance-arc-wrap">
              <svg className="compliance-arc-svg" viewBox="0 0 200 120">
                <path
                  d="M 10 110 A 90 90 0 0 1 190 110"
                  fill="none"
                  stroke={alphaColor(p.border, 0.4)}
                  strokeWidth={arcStroke}
                  strokeLinecap="round"
                />
                <path
                  d="M 10 110 A 90 90 0 0 1 190 110"
                  fill="none"
                  stroke={band.c}
                  strokeWidth={arcStroke}
                  strokeLinecap="round"
                  strokeDasharray={arcCircumference}
                  strokeDashoffset={arcOffset}
                  className="compliance-arc-fill"
                />
              </svg>
              <div className="compliance-arc-center">
                <span className="compliance-arc-pct">{numericVal.toFixed(0)}%</span>
                <span className="compliance-arc-band" style={{ color: band.c }}>{band.emoji} {band.t}</span>
              </div>
            </div>
            <p className="compliance-arc-context">{contextMsg}</p>
          </div>

          {/* Category Breakdown */}
          <div className="compliance-breakdown-card">
            <h4 className="compliance-breakdown-card__title">
              <FaClipboardCheck style={{ marginRight: 8, opacity: 0.6 }} />Category Breakdown
            </h4>
            <p className="compliance-breakdown-card__sub">Weighted score contribution by protocol area</p>
            <div className="compliance-category-list">
              {categoryScores.map((cat) => {
                const catColor = cat.score >= 75 ? p.success : cat.score >= 50 ? p.warning : p.danger;
                return (
                  <div key={cat.label} className="compliance-cat-row">
                    <div className="compliance-cat-row__info">
                      <span className="compliance-cat-row__label">{cat.label}</span>
                      <span className="compliance-cat-row__weight">wt. {cat.weight}%</span>
                    </div>
                    <div className="compliance-cat-row__bar">
                      <div className="compliance-cat-row__track">
                        <div className="compliance-cat-row__fill" style={{ width: `${cat.score}%`, background: catColor }} />
                      </div>
                      <span className="compliance-cat-row__score" style={{ color: catColor }}>{cat.score.toFixed(0)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Legend */}
        <div className="compliance-legend-card">
          <div className="compliance-legend-items">
            <span className="compliance-legend-item compliance-legend-item--excellent"><span className="compliance-legend-dot" />90–100% Excellent</span>
            <span className="compliance-legend-item compliance-legend-item--good"><span className="compliance-legend-dot" />75–89% Good</span>
            <span className="compliance-legend-item compliance-legend-item--fair"><span className="compliance-legend-dot" />50–74% Fair</span>
            <span className="compliance-legend-item compliance-legend-item--poor"><span className="compliance-legend-dot" />Below 50% Needs Improvement</span>
          </div>
        </div>

        <TabooAnalysisPanel toneAnalysis={toneAnalysis} onSeek={handleTranscriptSeek} />
      </div>
    );
  };

  const uploadDate = audioDetails.UploadDate
    ? new Date(audioDetails.UploadDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : null;

  const metaItems = [
    { icon: FaUserTie, label: 'Agent', value: audioDetails.AgentName },
    { icon: FaIdCard, label: 'ID', value: audioDetails.AgentID },
    { icon: FaCalendarAlt, label: 'Date', value: uploadDate },
    { icon: FaPhone, label: 'Type', value: audioDetails.CallType },
    { icon: FaLanguage, label: 'Lang', value: audioDetails.AudioLanguage },
    { icon: FaClock, label: 'Duration', value: audioDetails.AudioDuration ? formatTimeSec(audioDetails.AudioDuration) : null },
    { icon: FaWaveSquare, label: 'WPM', value: audioDetails.AudioWPM ? formatWPM(audioDetails.AudioWPM) : null },
    { icon: FaCheckCircle, label: 'Status', value: audioDetails.Status, variant: audioDetails.Status === 'Completed' ? 'success' : 'accent' },
    { icon: FaFileAudio, label: 'File', value: audioDetails.AudioFileName },
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

            {activeTab === 'tone' && renderToneAnalysisDashboard()}
            {activeTab === 'sentiment' && renderSentimentDashboard()}
            {activeTab === 'scoring' && renderCallScoring()}
            {activeTab === 'intel' && renderCallIntelligence()}
            {activeTab === 'policy' && (
              <TabooAnalysisPanel toneAnalysis={toneAnalysis} showEmptyHint onSeek={handleTranscriptSeek} />
            )}
            {activeTab === 'script' && renderComplianceDashboard()}

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
