import { deriveStepStates, effectiveActiveIndex, parseDetectedLanguage } from './processingStepStates';

describe('parseDetectedLanguage', () => {
  it('parses Language detected: Hindi', () => {
    expect(parseDetectedLanguage('Language detected: Hindi. Converting speech.')).toBe('Hindi');
  });
  it('parses Bengali', () => {
    expect(parseDetectedLanguage('Language detected: Bengali. Converting speech.')).toBe('Bengali');
  });
});

describe('deriveStepStates — sequential language → transcribe', () => {
  it('before language detected: language Detecting…, transcribe stays Waiting', () => {
    const states = deriveStepStates({
      activeIndex: 2,
      isFailed: false,
      message: 'Processing in progress.',
      description: 'Processing in progress.',
    });
    expect(states[1]).toMatchObject({ key: 'language', state: 'active', statusLabel: 'Detecting…' });
    expect(states[2]).toMatchObject({ key: 'transcribe', state: 'pending', statusLabel: 'Waiting' });
  });

  it('after language detected: language done shows NAME (green), transcribe goes Live now', () => {
    const message = 'Language detected: Bengali. Converting speech to text with speaker labels.';
    const states = deriveStepStates({
      activeIndex: 2,
      isFailed: false,
      message,
      description: message,
    });
    expect(states[1]).toMatchObject({ key: 'language', state: 'done', statusLabel: 'Bengali' });
    expect(states[2]).toMatchObject({ key: 'transcribe', state: 'active', statusLabel: 'Live now' });
  });

  it('shows language name (done) once past transcription', () => {
    const states = deriveStepStates({
      activeIndex: 3,
      isFailed: false,
      message: 'Translating Hindi transcript to English.',
      description: 'Translating Hindi transcript to English.',
      detectedLanguage: 'Hindi',
    });
    expect(states[1]).toMatchObject({ key: 'language', state: 'done', statusLabel: 'Hindi' });
    expect(states[2]).toMatchObject({ key: 'transcribe', state: 'done' });
  });

  it('language Detecting… while at language stage', () => {
    const states = deriveStepStates({
      activeIndex: 1,
      isFailed: false,
      message: 'Detecting spoken language.',
      description: 'Detecting spoken language.',
    });
    expect(states[1]).toMatchObject({ key: 'language', state: 'active', statusLabel: 'Detecting…' });
    expect(states[2]).toMatchObject({ key: 'transcribe', state: 'pending' });
  });

  it('never uses the word "confirming"', () => {
    const message = 'Language detected: Bengali. Converting speech to text.';
    const states = deriveStepStates({ activeIndex: 2, isFailed: false, message, description: message });
    states.forEach((s) => expect(s.statusLabel.toLowerCase()).not.toContain('confirm'));
  });
});

describe('effectiveActiveIndex', () => {
  it('stays on language (1) while detecting even if backend says transcribe', () => {
    const states = deriveStepStates({
      activeIndex: 2,
      isFailed: false,
      message: 'Processing in progress.',
      description: 'Processing in progress.',
    });
    expect(effectiveActiveIndex(states)).toBe(1);
  });

  it('advances to transcribe (2) once language detected', () => {
    const message = 'Language detected: Bengali. Converting speech to text.';
    const states = deriveStepStates({ activeIndex: 2, isFailed: false, message, description: message });
    expect(effectiveActiveIndex(states)).toBe(2);
  });
});
