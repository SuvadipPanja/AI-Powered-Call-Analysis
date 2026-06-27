import { Bar } from 'react-chartjs-2';
import { LuPhone, LuSmile, LuUserCog } from '../../../icons';
import { EmptyState } from '../../ui';
import { readChartPalette } from '../../../theme/chartTheme';
import { alphaColor, SPEAKER_COLORS } from '../resultUtils';

function dominantSentiment(dist) {
  const pos = parseFloat(dist.positive);
  const neg = parseFloat(dist.negative);
  const neu = parseFloat(dist.neutral);
  if (pos >= neg && pos >= neu) return 'Positive';
  if (neg >= pos && neg >= neu) return 'Negative';
  return 'Neutral';
}

function SentimentSpeakerCard({ label, dist, accentClr, palette }) {
  if (!dist) return null;

  const dominant = dominantSentiment(dist);
  const sentimentColor = (s) => (s === 'Positive' ? palette.success : s === 'Negative' ? palette.danger : palette.textMuted);
  const sentimentIcon = (s) => (s === 'Positive' ? '😊' : s === 'Negative' ? '😟' : '😐');
  const sentimentContext = () => {
    const pct = dominant === 'Positive' ? dist.positive : dominant === 'Negative' ? dist.negative : dist.neutral;
    if (dominant === 'Positive') return `${label} sounded mostly positive during the call (${pct}% of utterances)`;
    if (dominant === 'Negative') return `${label} expressed frustration or dissatisfaction (${pct}% negative)`;
    return `${label} maintained a neutral tone throughout most of the call (${pct}%)`;
  };
  const bars = [
    { label: 'Positive', pct: parseFloat(dist.positive), color: palette.success },
    { label: 'Neutral', pct: parseFloat(dist.neutral), color: palette.textMuted },
    { label: 'Negative', pct: parseFloat(dist.negative), color: palette.danger },
  ];

  return (
    <div className="sentiment-card">
      <div className="sentiment-card__header">
        <span className="sentiment-card__icon" style={{ color: accentClr }}>
          {label === 'Agent' ? <LuUserCog /> : <LuPhone />}
        </span>
        <div>
          <h4 className="sentiment-card__title">{label} Sentiment</h4>
          <span
            className="sentiment-card__badge"
            style={{
              background: alphaColor(sentimentColor(dominant), 0.15),
              color: sentimentColor(dominant),
            }}
          >
            {sentimentIcon(dominant)} {dominant}
          </span>
        </div>
      </div>
      <p className="sentiment-card__context">{sentimentContext()}</p>
      <div className="sentiment-card__bars">
        {bars.map((b) => (
          <div key={b.label} className="sentiment-bar-row">
            <span className="sentiment-bar-row__label">{b.label}</span>
            <div className="sentiment-bar-row__track">
              <div
                className="sentiment-bar-row__fill"
                style={{ width: `${Math.max(b.pct, 1.5)}%`, background: b.color }}
              />
            </div>
            <span className="sentiment-bar-row__pct">{b.pct}%</span>
          </div>
        ))}
      </div>
      <div className="sentiment-card__footer">
        <span className="sentiment-card__score-ring" style={{ borderColor: sentimentColor(dominant) }}>
          {parseFloat(dist.positive).toFixed(0)}%
        </span>
        <span className="sentiment-card__score-label">positivity score</span>
      </div>
    </div>
  );
}

export default function ResultSentimentTab({ sentimentStats }) {
  if (!sentimentStats) {
    return (
      <EmptyState icon={<LuSmile />} title="No Sentiment Data Available">
        Sentiment analysis data was not detected for this call. This may happen with very short recordings or when the AI model could not determine speaker emotion.
      </EmptyState>
    );
  }

  const p = readChartPalette();
  const distData = {
    labels: ['Positive', 'Neutral', 'Negative'],
    datasets: [
      {
        label: 'Agent',
        data: [
          parseFloat(sentimentStats.agent.positive),
          parseFloat(sentimentStats.agent.neutral),
          parseFloat(sentimentStats.agent.negative),
        ],
        backgroundColor: alphaColor(SPEAKER_COLORS.agent, 0.75),
        borderColor: SPEAKER_COLORS.agent,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 32,
        categoryPercentage: 0.6,
        barPercentage: 0.8,
      },
      {
        label: 'Customer',
        data: [
          parseFloat(sentimentStats.customer.positive),
          parseFloat(sentimentStats.customer.neutral),
          parseFloat(sentimentStats.customer.negative),
        ],
        backgroundColor: alphaColor(SPEAKER_COLORS.customer, 0.75),
        borderColor: SPEAKER_COLORS.customer,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 32,
        categoryPercentage: 0.6,
        barPercentage: 0.8,
      },
    ],
  };
  const distOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    animation: { duration: 900, easing: 'easeOutQuart' },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 14, font: { weight: '600' } } },
      tooltip: {
        backgroundColor: p.surface,
        titleColor: p.text,
        bodyColor: p.textMuted,
        borderColor: p.border,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 10,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.x.toFixed(1)}%` },
      },
    },
    scales: {
      x: { max: 100, grid: { color: alphaColor(p.border, 0.4), drawBorder: false }, ticks: { color: p.textMuted, callback: (v) => `${v}%`, font: { size: 11 } } },
      y: { grid: { display: false }, ticks: { color: p.text, font: { size: 12, weight: '600' } } },
    },
  };

  return (
    <div className="sentiment-dashboard">
      <div className="sentiment-summary-row">
        <SentimentSpeakerCard label="Agent" dist={sentimentStats.agent} accentClr={SPEAKER_COLORS.agent} palette={p} />
        <SentimentSpeakerCard label="Customer" dist={sentimentStats.customer} accentClr={SPEAKER_COLORS.customer} palette={p} />
      </div>

      <div className="sentiment-dist-card">
        <div className="sentiment-dist-card__header">
          <div>
            <h4 className="sentiment-dist-card__title">
              <LuSmile style={{ marginRight: 8, opacity: 0.6 }} />
              Sentiment Distribution
            </h4>
            <p className="sentiment-dist-card__sub">Comparison of emotional tone between agent and customer</p>
          </div>
          <div className="sentiment-legend">
            <span className="tone-legend-chip" style={{ '--chip-color': p.success }}>Positive</span>
            <span className="tone-legend-chip" style={{ '--chip-color': p.textMuted }}>Neutral</span>
            <span className="tone-legend-chip" style={{ '--chip-color': p.danger }}>Negative</span>
          </div>
        </div>
        <div className="sentiment-dist-card__body">
          <Bar data={distData} options={distOptions} />
        </div>
      </div>
    </div>
  );
}
