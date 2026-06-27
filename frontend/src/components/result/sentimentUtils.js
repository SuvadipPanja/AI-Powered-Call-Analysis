export function computeSentimentStats(sentimentData) {
  if (!sentimentData || !Array.isArray(sentimentData) || sentimentData.length === 0) return null;

  let agentDist = { neutral: 0, positive: 0, negative: 0 };
  let custDist = { neutral: 0, positive: 0, negative: 0 };
  let agentCount = 0;
  let custCount = 0;

  sentimentData.forEach((entry) => {
    const polarity = parseFloat(entry['Sentiment Polarity']);
    if (Number.isNaN(polarity)) return;
    if (entry.Role === 'Agent') {
      agentCount += 1;
      if (polarity > 0.3) agentDist.positive += 1;
      else if (polarity < -0.3) agentDist.negative += 1;
      else agentDist.neutral += 1;
    } else if (entry.Role === 'Customer') {
      custCount += 1;
      if (polarity > 0.3) custDist.positive += 1;
      else if (polarity < -0.3) custDist.negative += 1;
      else custDist.neutral += 1;
    }
  });

  const toPct = (dist, count) => (count > 0 ? {
    neutral: ((dist.neutral / count) * 100).toFixed(1),
    positive: ((dist.positive / count) * 100).toFixed(1),
    negative: ((dist.negative / count) * 100).toFixed(1),
  } : { neutral: '100', positive: '0', negative: '0' });

  return { agent: toPct(agentDist, agentCount), customer: toPct(custDist, custCount) };
}
