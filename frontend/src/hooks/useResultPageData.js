import { useState, useEffect, useMemo, useCallback } from 'react';
import { getAuditByFileName } from '../services/auditService';
import {
  getAudioDetails,
  getCallIntelligence,
  getCustomScoringDetails,
  getQueryCategories,
  getScriptCompliance,
  getSentiment,
  getSummary,
  getToneAnalysis,
  getTranslateOutput,
} from '../services/resultsService';
import { parseTranscriptLines } from '../components/ConversationTranscript';
import { computeSentimentStats } from '../components/result/sentimentUtils';
import { formatTimeSec, formatWPM } from '../components/result/resultUtils';
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

/**
 * Data fetching and analysis state for the call result page.
 */
export default function useResultPageData(filename) {
  const [audioDetails, setAudioDetails] = useState({});
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [detailsError, setDetailsError] = useState(null);
  const [detailsNotFound, setDetailsNotFound] = useState(false);

  const [transcriptMessages, setTranscriptMessages] = useState([]);
  const [originalTranscription, setOriginalTranscription] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(true);

  const [summary, setSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState(false);

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
  const [existingAuditId, setExistingAuditId] = useState(null);

  const checkExistingAudit = useCallback(async () => {
    try {
      const resp = await getAuditByFileName(filename);
      if (resp.success && resp.audit) {
        setExistingAuditId(resp.audit.AuditID);
      } else {
        setExistingAuditId(null);
      }
    } catch {
      setExistingAuditId(null);
    }
  }, [filename]);

  useEffect(() => {
    const fetchAudioDetails = async () => {
      setDetailsLoading(true);
      setDetailsError(null);
      setDetailsNotFound(false);
      try {
        const response = await getAudioDetails(filename);
        if (response.success && response.audioDetails) {
          setAudioDetails(response.audioDetails);
        } else {
          setAudioDetails({});
          setDetailsNotFound(true);
        }
      } catch (err) {
        setAudioDetails({});
        setDetailsError(err.message || 'Failed to load call details.');
      } finally {
        setDetailsLoading(false);
      }
    };
    fetchAudioDetails();
    checkExistingAudit();
  }, [filename, checkExistingAudit]);

  useEffect(() => {
    const fetchTranscript = async () => {
      setTranscriptLoading(true);
      try {
        const resp = await getTranslateOutput(filename);
        if (resp.success) {
          const rawText = resp.translateOutput || '';
          const originalText = resp.transcribeOutput || '';
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
      setSummaryLoading(true);
      setSummaryError(false);
      try {
        const resp = await getSummary(filename);
        if (resp.success) {
          setSummary(resp.summary?.trim() || null);
        } else {
          setSummary(null);
        }
      } catch {
        setSummaryError(true);
        setSummary(null);
      } finally {
        setSummaryLoading(false);
      }
    };

    fetchTranscript();
    fetchSummary();
  }, [filename]);

  const originalMessages = useMemo(
    () => parseTranscriptLines(originalTranscription),
    [originalTranscription],
  );

  const fetchToneAnalysis = useCallback(async () => {
    try {
      const resp = await getToneAnalysis(filename);
      if (resp.success) setToneAnalysis(resp.toneAnalysis);
    } catch { /* best-effort */ }
  }, [filename]);

  const fetchSentiment = useCallback(async () => {
    try {
      const resp = await getSentiment(filename);
      if (resp.success) setSentimentData(resp.sentiment);
      else setSentimentData(null);
    } catch {
      setSentimentData(null);
    }
  }, [filename]);

  const sentimentStats = useMemo(
    () => computeSentimentStats(sentimentData),
    [sentimentData],
  );

  const fetchScoring = useCallback(async () => {
    setLoadingScoring(true);
    setScoreError(null);
    try {
      const resp = await getCustomScoringDetails(filename);
      if (resp.success) {
        setAiScoring(resp.aiScoring || {});
        setManualScoring(resp.manualScoring || {});
      } else {
        setScoreError(resp.message || 'Scoring data not found.');
      }
    } catch {
      setScoreError('Server error fetching scoring data.');
    } finally {
      setLoadingScoring(false);
    }
  }, [filename]);

  const fetchIntelligence = useCallback(async () => {
    setIntelLoading(true);
    setIntelError(null);
    try {
      const [resp] = await Promise.all([
        getCallIntelligence(filename),
        (async () => {
          try {
            const cats = await getQueryCategories(1);
            if (cats?.success && Array.isArray(cats.categories)) {
              const map = {};
              cats.categories.forEach((c) => {
                if (c.name && c.color) map[c.name] = c.color;
              });
              setCategoryColors(map);
            }
          } catch { /* colours are best-effort */ }
        })(),
      ]);
      if (resp.success && resp.intelligence) {
        setIntelligence(resp.intelligence);
      } else {
        setIntelligence(null);
        setIntelError(resp.message || 'Intelligence not available for this call.');
      }
    } catch (err) {
      setIntelError(err.message || 'Server error fetching call intelligence.');
    } finally {
      setIntelLoading(false);
    }
  }, [filename]);

  const fetchScriptCompliance = useCallback(async () => {
    try {
      const response = await getScriptCompliance(filename);
      if (response.success) {
        setScriptCompliance(response.scriptCompliance);
      } else {
        setScriptCompliance(null);
      }
    } catch {
      setScriptCompliance(null);
    }
  }, [filename]);

  useEffect(() => {
    if (!filename) return;
    fetchScoring();
    fetchScriptCompliance();
    fetchToneAnalysis();
  }, [filename, fetchScoring, fetchScriptCompliance, fetchToneAnalysis]);

  const uploadDate = audioDetails.UploadDate
    ? new Date(audioDetails.UploadDate).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
    : null;

  const metaItems = useMemo(() => [
    { icon: LuUserCog, label: 'Agent', value: audioDetails.AgentName },
    { icon: LuIdCard, label: 'ID', value: audioDetails.AgentID },
    { icon: LuCalendar, label: 'Date', value: uploadDate },
    { icon: LuPhone, label: 'Type', value: audioDetails.CallType },
    { icon: LuGlobe, label: 'Lang', value: audioDetails.AudioLanguage },
    { icon: LuClock, label: 'Duration', value: audioDetails.AudioDuration ? formatTimeSec(audioDetails.AudioDuration) : null },
    { icon: LuAudioLines, label: 'WPM', value: audioDetails.AudioWPM ? formatWPM(audioDetails.AudioWPM) : null },
    { icon: LuCircleCheck, label: 'Status', value: audioDetails.Status, variant: audioDetails.Status === 'Completed' ? 'success' : 'accent' },
    { icon: LuFileAudio, label: 'File', value: audioDetails.AudioFileName },
  ].filter((b) => b.value), [audioDetails, uploadDate]);

  const prefetchForTab = useCallback((key) => {
    if (key === 'tone' && !toneAnalysis) fetchToneAnalysis();
    if (key === 'sentiment' && !sentimentData) fetchSentiment();
    if (key === 'scoring' && !aiScoring) fetchScoring();
    if (key === 'intel' && !intelligence && !intelError) fetchIntelligence();
    if ((key === 'scoring' || key === 'script' || key === 'policy') && !toneAnalysis) fetchToneAnalysis();
    if (key === 'script' && scriptCompliance == null) fetchScriptCompliance();
  }, [
    toneAnalysis, sentimentData, aiScoring, intelligence, intelError, scriptCompliance,
    fetchToneAnalysis, fetchSentiment, fetchScoring, fetchIntelligence, fetchScriptCompliance,
  ]);

  return {
    audioDetails,
    detailsLoading,
    detailsError,
    detailsNotFound,
    transcriptMessages,
    originalMessages,
    transcriptLoading,
    summary,
    summaryLoading,
    summaryError,
    toneAnalysis,
    sentimentData,
    sentimentStats,
    aiScoring,
    manualScoring,
    loadingScoring,
    scoreError,
    scriptCompliance,
    intelligence,
    categoryColors,
    intelLoading,
    intelError,
    existingAuditId,
    metaItems,
    checkExistingAudit,
    fetchScoring,
    prefetchForTab,
  };
}
