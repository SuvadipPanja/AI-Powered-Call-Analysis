export const PROCESS_STEP_KEYS = [
  'upload',
  'language',
  'transcribe',
  'translate',
  'score',
  'tone',
  'compliance',
  'result',
];

const DEFAULT_STATUS_LABELS = {
  done: 'Done',
  active: 'Live now',
  pending: 'Waiting',
  fail: 'Failed',
};

export function parseDetectedLanguage(text) {
  const merged = `${text || ''}`;
  const explicit = merged.match(/\bLanguage detected:\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i)
    || merged.match(/\bdetected language[:\s]+([A-Za-z]+(?:\s+[A-Za-z]+)?)\b/i)
    || merged.match(/\b(English|Hindi|Tamil|Telugu|Marathi|Bengali|Gujarati|Kannada|Malayalam|Punjabi|Urdu)\b/i);
  if (!explicit) return null;
  const raw = (explicit[1] || explicit[0] || '').trim();
  if (!raw || /^unknown$/i.test(raw)) return null;
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function cleanLanguage(detectedLanguage) {
  if (!detectedLanguage) return null;
  if (detectedLanguage === 'Detecting…' || detectedLanguage === '—') return null;
  return detectedLanguage;
}

/**
 * Sequential step states for the live processing orbit.
 * - Language: "Detecting…" until a language is parsed, then turns green and shows the language NAME.
 * - Transcribe: stays "Waiting" until the language is detected, then becomes "Live now".
 *   (No overlap — language must finish before transcription is shown as running.)
 */
export function deriveStepStates({ activeIndex, isFailed, message, description, detectedLanguage }) {
  const lang = cleanLanguage(detectedLanguage)
    || parseDetectedLanguage(`${message || ''} ${description || ''}`);
  const hasLanguage = Boolean(lang) || activeIndex >= 3;

  return PROCESS_STEP_KEYS.map((key, index) => {
    let state = 'pending';

    if (isFailed && index === activeIndex) {
      state = 'fail';
    } else if (key === 'language') {
      if (activeIndex < 1) state = 'pending';
      else if (hasLanguage) state = 'done';
      else state = 'active';
    } else if (index === 2) {
      // transcribe — gated behind language detection
      if (activeIndex < 2 || !hasLanguage) state = 'pending';
      else if (activeIndex === 2) state = 'active';
      else state = 'done';
    } else if (index < activeIndex) {
      state = 'done';
    } else if (index === activeIndex) {
      state = 'active';
    }

    let statusLabel;
    if (key === 'language') {
      statusLabel = state === 'pending' ? 'Waiting'
        : state === 'active' ? 'Detecting…'
          : state === 'fail' ? 'Failed'
            : (lang || 'Detected');
    } else {
      statusLabel = DEFAULT_STATUS_LABELS[state];
    }

    return { key, state, statusLabel, detectedLanguage: lang };
  });
}

/** First step that is live (or failed); used to drive % and center label sequentially. */
export function effectiveActiveIndex(stepStates) {
  const idx = stepStates.findIndex((s) => s.state === 'active' || s.state === 'fail');
  if (idx >= 0) return idx;
  return stepStates.every((s) => s.state === 'done') ? stepStates.length - 1 : 0;
}
