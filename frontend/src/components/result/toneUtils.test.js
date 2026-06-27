import { parseToneLabel, calculateEnergy, computeToneStats } from './toneUtils';

describe('toneUtils', () => {
  describe('parseToneLabel', () => {
    it('formats a single timestamp label', () => {
      expect(parseToneLabel('Segment at 90 seconds')).toBe('01:30');
    });

    it('formats a range label', () => {
      expect(parseToneLabel('From 30 to 90')).toBe('00:30 - 01:30');
    });

    it('returns original label when no numbers found', () => {
      expect(parseToneLabel('No timestamps')).toBe('No timestamps');
    });
  });

  describe('calculateEnergy', () => {
    it('weights high/medium/low distribution when already scaled', () => {
      expect(calculateEnergy({ High: 10, Medium: 0, Low: 0 })).toBe(30);
      expect(calculateEnergy({ High: 0, Medium: 10, Low: 0 })).toBe(20);
      expect(calculateEnergy({ High: 0, Medium: 0, Low: 10 })).toBe(10);
    });

    it('scales normalized fractions to energy units', () => {
      const energy = calculateEnergy({ High: 0.5, Medium: 0.5, Low: 0 });
      expect(energy).toBe(875);
    });
  });

  describe('computeToneStats', () => {
    it('returns null for empty speaker data', () => {
      expect(computeToneStats(null)).toBeNull();
    });

    it('computes dominant tone and segment counts', () => {
      const stats = computeToneStats({
        seg1: { tone_distribution: { High: 250, Medium: 0, Low: 0 } },
        seg2: { tone_distribution: { High: 240, Medium: 0, Low: 0 } },
      });
      expect(stats.segments).toBe(2);
      expect(stats.dominant).toBe('Energetic');
      expect(stats.highSegments).toBe(2);
    });
  });
});
