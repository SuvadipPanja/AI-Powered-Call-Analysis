/**
 * File: ResultPage.jsx
 * Call analysis view — hooks for data/audio; tab panels in result/tabs/
 */

import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement,
  Title, Tooltip, Legend, Filler,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

import { LuCircleX } from '../icons';
import ManualAuditWorkspace from './ManualAuditWorkspace';
import './result-page.css';
import SecureDownloadModal from './result/SecureDownloadModal';
import ResultMetaStrip from './result/ResultMetaStrip';
import ResultAudioPlayer from './result/ResultAudioPlayer';
import ResultTranscriptPanel from './result/ResultTranscriptPanel';
import ResultAnalysisPanel from './result/ResultAnalysisPanel';
import {
  ResultToneTab,
  ResultSentimentTab,
  ResultScoringTab,
  ResultIntelligenceTab,
  ResultComplianceTab,
  ResultPolicyTab,
} from './result/tabs';
import { useAppBranding, useDocumentTitle } from '../utils/appBranding';
import { Button, PageError, PageLoading } from './ui';
import useResultPageData from '../hooks/useResultPageData';
import useResultWaveform from '../hooks/useResultWaveform';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, BarElement, ArcElement, Title, Tooltip, Legend, Filler, annotationPlugin);

const ResultPage = () => {
  const { filename } = useParams();
  const navigate = useNavigate();
  const { appName } = useAppBranding();
  useDocumentTitle('Call Analysis', appName);

  const [activeTab, setActiveTab] = useState('scoring');
  const [transcriptTab, setTranscriptTab] = useState('transcript');
  const [transcriptExpanded, setTranscriptExpanded] = useState(false);
  const [secureDownloadOpen, setSecureDownloadOpen] = useState(false);
  const [auditWorkspaceOpen, setAuditWorkspaceOpen] = useState(false);

  const {
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
  } = useResultPageData(filename);

  const {
    waveformRef,
    isPlaying,
    isWaveformReady,
    audioLoadError,
    handlePlayPause,
    handleTranscriptSeek,
  } = useResultWaveform(audioDetails.AudioFileName, toneAnalysis);

  if (detailsLoading) {
    return (
      <div className="app-page reports-page rp app-stagger">
        <PageLoading message="Loading call analysis…" />
      </div>
    );
  }

  if (detailsError || detailsNotFound) {
    return (
      <div className="app-page reports-page rp app-stagger">
        <PageError
          message={detailsError || 'This call could not be found. It may have been removed or the link is invalid.'}
          icon={<LuCircleX aria-hidden />}
          onRetry={detailsError ? () => window.location.reload() : undefined}
          retryLabel="Retry"
        >
          <Button variant="secondary" size="sm" onClick={() => navigate('/')}>
            Back to dashboard
          </Button>
        </PageError>
      </div>
    );
  }

  return (
    <div className="app-page reports-page rp app-stagger">
      <ToastContainer position="top-right" autoClose={4000} hideProgressBar={false} newestOnTop closeOnClick pauseOnHover theme="colored" />

      <ResultMetaStrip loading={detailsLoading} items={metaItems} />

      <ResultAudioPlayer
        waveformRef={waveformRef}
        isPlaying={isPlaying}
        onPlayPause={handlePlayPause}
        onDownloadClick={(e) => { e.preventDefault(); e.stopPropagation(); setSecureDownloadOpen(true); }}
        duration={audioDetails.AudioDuration}
        waveReady={isWaveformReady}
        loadError={audioLoadError}
      />

      <div className="rp-main">
        <ResultTranscriptPanel
          expanded={transcriptExpanded}
          onToggleExpand={() => setTranscriptExpanded(!transcriptExpanded)}
          transcriptTab={transcriptTab}
          onTranscriptTabChange={setTranscriptTab}
          transcriptLoading={transcriptLoading}
          transcriptMessages={transcriptMessages}
          originalMessages={originalMessages}
          summary={summary}
          summaryLoading={summaryLoading}
          summaryError={summaryError}
          agentUsername={audioDetails?.AgentName || ''}
          onSeek={handleTranscriptSeek}
        />

        <ResultAnalysisPanel
          activeTab={activeTab}
          onTabSelect={(key) => {
            prefetchForTab(key);
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

      <SecureDownloadModal
        isOpen={secureDownloadOpen}
        onClose={() => setSecureDownloadOpen(false)}
        filename={audioDetails.AudioFileName}
      />

      <ManualAuditWorkspace
        open={auditWorkspaceOpen}
        onClose={() => setAuditWorkspaceOpen(false)}
        filename={filename}
        audioDetails={audioDetails}
        aiScoring={aiScoring}
        transcriptSnippet={transcriptMessages}
        onAuditSaved={() => {
          checkExistingAudit();
          fetchScoring();
        }}
      />
    </div>
  );
};

export default ResultPage;
