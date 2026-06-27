import { FaExpand, FaCompress, FaFileAudio, FaLanguage } from 'react-icons/fa';
import { Spinner, EmptyState } from '../ui';
import ConversationTranscript from '../ConversationTranscript';

export default function ResultTranscriptPanel({
  expanded,
  onToggleExpand,
  transcriptTab,
  onTranscriptTabChange,
  transcriptLoading,
  transcriptMessages,
  originalMessages,
  summary,
  agentUsername,
  onSeek,
}) {
  return (
    <section className={`rp-transcript-panel ${expanded ? 'rp-transcript-panel--expanded' : ''}`}>
      <div className="rp-transcript-panel__header">
        <div className="rp-transcript-panel__tabs">
          {['transcript', 'original', 'summary'].map((tab) => (
            <button
              key={tab}
              type="button"
              className={`rp-transcript-panel__tab ${transcriptTab === tab ? 'is-active' : ''}`}
              onClick={() => onTranscriptTabChange(tab)}
            >
              {tab === 'transcript' ? 'Transcript' : tab === 'original' ? 'Original' : 'Summary'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="rp-transcript-panel__expand"
          onClick={onToggleExpand}
          aria-label={expanded ? 'Collapse' : 'Expand'}
        >
          {expanded ? <FaCompress /> : <FaExpand />}
        </button>
      </div>
      <div className="rp-transcript-panel__body">
        {transcriptTab === 'transcript' && (
          transcriptLoading ? (
            <div className="rp-center"><Spinner /></div>
          ) : transcriptMessages.length === 0 ? (
            <EmptyState icon={<FaFileAudio />} title="No Transcript">Transcript data is not available for this recording.</EmptyState>
          ) : (
            <ConversationTranscript messages={transcriptMessages} onSeek={onSeek} agentUsername={agentUsername} />
          )
        )}

        {transcriptTab === 'original' && (
          transcriptLoading ? (
            <div className="rp-center"><Spinner /></div>
          ) : originalMessages.length === 0 ? (
            <EmptyState icon={<FaLanguage />} title="No Original Transcription">
              Original-language transcription is not available for this recording.
            </EmptyState>
          ) : (
            <ConversationTranscript messages={originalMessages} onSeek={onSeek} agentUsername={agentUsername} />
          )
        )}

        {transcriptTab === 'summary' && (
          <div className="rp-summary">
            <p>{summary}</p>
          </div>
        )}
      </div>
    </section>
  );
}
