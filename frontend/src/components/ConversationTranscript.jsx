import React from 'react';
import { FaUser } from 'react-icons/fa';
import UserAvatar from './ui/UserAvatar';

const LINE_RE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*\(([^)]+)\):\s*(.+)$/;

const BOILERPLATE_LINE_RE = /^here is the (translated )?transcript\s*:?\s*$/i;
const META_LINE_RE = /^(okay,? let's|first,? i'll|the user wants|translate only|output plain|rules:|transcript:|note:|\*\*|#{1,3}\s|<\s*think)/i;
const THINK_LINE_RE = /<\s*(?:think|redacted_reasoning)/i;

function isTranscriptBoilerplate(line) {
  return BOILERPLATE_LINE_RE.test(String(line || '').trim());
}

function isTranscriptMetaLine(line) {
  const s = String(line || '').trim();
  if (!s) return true;
  return META_LINE_RE.test(s) || THINK_LINE_RE.test(s);
}

export function parseTranscriptLines(raw) {
  if (!raw || typeof raw !== 'string') return [];

  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isTranscriptBoilerplate(line))
    .filter((line) => !isTranscriptMetaLine(line))
    .map((line, index) => {
      const match = line.match(LINE_RE);
      if (match) {
        const speaker = match[3].trim();
        const lower = speaker.toLowerCase();
        let role = 'other';
        if (lower.includes('agent')) role = 'agent';
        else if (lower.includes('customer') || lower.includes('caller')) role = 'customer';

        return {
          id: `${index}-${match[1]}`,
          startSec: parseFloat(match[1]),
          endSec: parseFloat(match[2]),
          speaker,
          role,
          text: match[4].trim(),
        };
      }

      if (line.toLowerCase().startsWith('agent')) {
        return {
          id: `legacy-${index}`,
          startSec: null,
          endSec: null,
          speaker: 'Agent',
          role: 'agent',
          text: line.replace(/^agent[:\s-]*/i, '').trim(),
        };
      }
      if (line.toLowerCase().startsWith('customer')) {
        return {
          id: `legacy-${index}`,
          startSec: null,
          endSec: null,
          speaker: 'Customer',
          role: 'customer',
          text: line.replace(/^customer[:\s-]*/i, '').trim(),
        };
      }

      return {
        id: `line-${index}`,
        startSec: null,
        endSec: null,
        speaker: 'Call',
        role: 'other',
        text: line,
      };
    });
}

function formatTimestamp(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '';
  const total = Math.floor(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const NO_SPEECH_RE = /^\[No speech detected\]$/i;

const ConversationTranscript = ({ messages, onSeek, agentUsername = '' }) => {
  if (!messages?.length) {
    return (
      <div className="conversation-empty">
        <p>No conversation transcript available.</p>
      </div>
    );
  }

  const visibleMessages = messages.filter(
    (msg) => !NO_SPEECH_RE.test(msg.text) && !isTranscriptBoilerplate(msg.text)
  );

  if (!visibleMessages.length) {
    return (
      <div className="conversation-empty">
        <p>No conversation transcript available.</p>
      </div>
    );
  }

  return (
    <div className="conversation-thread" role="log" aria-label="Call conversation transcript">
      {visibleMessages.map((msg) => {
        const isAgent = msg.role === 'agent';
        const isCustomer = msg.role === 'customer';
        const rowClass = isAgent
          ? 'conversation-row conversation-row--agent'
          : isCustomer
            ? 'conversation-row conversation-row--customer'
            : 'conversation-row conversation-row--other';

        const timeLabel =
          msg.startSec != null
            ? formatTimestamp(msg.startSec)
            : '';

        const handleClick = () => {
          if (onSeek && msg.startSec != null) onSeek(msg.startSec);
        };

        return (
          <div key={msg.id} className={rowClass}>
            {isAgent && (
              <div className="conversation-avatar conversation-avatar--agent" aria-hidden="true">
                {agentUsername ? (
                  <UserAvatar username={agentUsername} size="sm" alt="" />
                ) : (
                  <FaUser />
                )}
              </div>
            )}

            <button
              type="button"
              className={`conversation-bubble conversation-bubble--${msg.role}`}
              onClick={handleClick}
              title={timeLabel ? `Jump to ${timeLabel}` : undefined}
            >
              <div className="conversation-meta">
                <span className="conversation-speaker">{msg.speaker}</span>
                {timeLabel && <span className="conversation-time">{timeLabel}</span>}
              </div>
              <p className="conversation-text">{msg.text}</p>
            </button>

            {isCustomer && (
              <div className="conversation-avatar conversation-avatar--customer" aria-hidden="true">
                <FaUser />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ConversationTranscript;
