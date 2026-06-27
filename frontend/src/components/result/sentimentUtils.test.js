import { computeSentimentStats } from './sentimentUtils';

describe('sentimentUtils', () => {
  it('returns null for empty input', () => {
    expect(computeSentimentStats(null)).toBeNull();
    expect(computeSentimentStats([])).toBeNull();
  });

  it('computes agent and customer sentiment percentages', () => {
    const stats = computeSentimentStats([
      { Role: 'Agent', 'Sentiment Polarity': '0.8' },
      { Role: 'Agent', 'Sentiment Polarity': '-0.5' },
      { Role: 'Customer', 'Sentiment Polarity': '0.0' },
      { Role: 'Customer', 'Sentiment Polarity': '0.4' },
    ]);

    expect(stats.agent.positive).toBe('50.0');
    expect(stats.agent.negative).toBe('50.0');
    expect(stats.customer.neutral).toBe('50.0');
    expect(stats.customer.positive).toBe('50.0');
  });

  it('ignores entries with invalid polarity', () => {
    const stats = computeSentimentStats([
      { Role: 'Agent', 'Sentiment Polarity': 'not-a-number' },
      { Role: 'Agent', 'Sentiment Polarity': '0.5' },
    ]);
    expect(stats.agent.positive).toBe('100.0');
  });
});
