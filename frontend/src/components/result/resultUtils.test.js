import {
  parseToSeconds,
  formatTimeSec,
  formatWPM,
  formatToneFrequency,
  rubricPercent,
  formatScoreCell,
  getScoreBand,
  generateStrongPassword,
} from './resultUtils';

describe('resultUtils', () => {
  describe('parseToSeconds', () => {
    it('parses numeric seconds', () => {
      expect(parseToSeconds(42)).toBe(42);
      expect(parseToSeconds('90')).toBe(90);
    });

    it('parses mm:ss and hh:mm:ss', () => {
      expect(parseToSeconds('1:30')).toBe(90);
      expect(parseToSeconds('1:02:03')).toBe(3723);
    });

    it('returns NaN for invalid values', () => {
      expect(Number.isNaN(parseToSeconds(''))).toBe(true);
      expect(Number.isNaN(parseToSeconds(null))).toBe(true);
    });
  });

  describe('formatTimeSec', () => {
    it('formats sub-hour durations as mm:ss', () => {
      expect(formatTimeSec(90)).toBe('01:30');
    });

    it('formats hour-long durations as hh:mm:ss', () => {
      expect(formatTimeSec(3723)).toBe('01:02:03');
    });
  });

  describe('formatWPM', () => {
    it('returns N/A for invalid input', () => {
      expect(formatWPM(NaN)).toBe('N/A');
    });

    it('rounds valid WPM', () => {
      expect(formatWPM(123.7)).toBe('124');
    });
  });

  describe('formatToneFrequency', () => {
    it('chooses Hz, kHz, or MHz scale', () => {
      expect(formatToneFrequency(250)).toBe('250 Hz');
      expect(formatToneFrequency(2500)).toBe('2.5 kHz');
      expect(formatToneFrequency(2500000)).toBe('2.5 MHz');
    });
  });

  describe('rubricPercent and formatScoreCell', () => {
    it('scales 0–10 rubric scores to percent', () => {
      expect(rubricPercent(8)).toBe(80);
      expect(rubricPercent('85%')).toBe(85);
    });

    it('formats empty scores as em dash', () => {
      expect(formatScoreCell(null)).toBe('—');
      expect(formatScoreCell(8)).toBe('80%');
    });
  });

  describe('getScoreBand', () => {
    it('maps percent to band names', () => {
      expect(getScoreBand(85)).toBe('excellent');
      expect(getScoreBand(65)).toBe('good');
      expect(getScoreBand(45)).toBe('fair');
      expect(getScoreBand(10)).toBe('poor');
      expect(getScoreBand(0)).toBe('');
    });
  });

  describe('generateStrongPassword', () => {
    it('meets minimum length and character-class requirements', () => {
      const pwd = generateStrongPassword(16);
      expect(pwd).toHaveLength(16);
      expect(pwd).toMatch(/[A-Z]/);
      expect(pwd).toMatch(/[a-z]/);
      expect(pwd).toMatch(/[0-9]/);
      expect(pwd).toMatch(/[!@#$%&*_+\-=?]/);
    });
  });
});
