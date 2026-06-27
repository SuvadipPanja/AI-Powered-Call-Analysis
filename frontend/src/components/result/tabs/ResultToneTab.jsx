import { Line, Bar } from 'react-chartjs-2';
import {
  LuAudioLines,
  LuChartLine,
  LuPhone,
  LuUserCog,
} from '../../../icons';
import { EmptyState } from '../../ui';
import { readChartPalette } from '../../../theme/chartTheme';
import {
  alphaColor,
  formatToneFrequency,
  SPEAKER_COLORS,
} from '../resultUtils';
import {
  calculateEnergy,
  computeToneStats,
  parseToneLabel,
} from '../toneUtils';

function ToneSpeakerCard({ label, stats, accentClr, palette }) {
  if (!stats) return null;

  const dominantColor = (d) => (d === 'Calm' ? palette.success : d === 'Energetic' ? palette.danger : palette.warning);
  const dominantIcon = (d) => (d === 'Calm' ? '😌' : d === 'Energetic' ? '⚡' : '😐');
  const bars = [
    { label: 'Calm', pct: stats.pctLow, color: palette.success },
    { label: 'Moderate', pct: stats.pctMed, color: palette.warning },
    { label: 'Energetic', pct: stats.pctHigh, color: palette.danger },
  ];

  return (
    <div className="tone-card">
      <div className="tone-card__header">
        <span className="tone-card__icon" style={{ color: accentClr }}>
          {label === 'Agent' ? <LuUserCog /> : <LuPhone />}
        </span>
        <div>
          <h4 className="tone-card__title">{label} Tone</h4>
          <span
            className="tone-card__badge"
            style={{
              background: alphaColor(dominantColor(stats.dominant), 0.15),
              color: dominantColor(stats.dominant),
            }}
          >
            {dominantIcon(stats.dominant)} {stats.dominant}
          </span>
        </div>
      </div>
      <div className="tone-card__bars">
        {bars.map((b) => (
          <div key={b.label} className="tone-bar-row">
            <span className="tone-bar-row__label">{b.label}</span>
            <div className="tone-bar-row__track">
              <div
                className="tone-bar-row__fill"
                style={{ width: `${Math.max(b.pct, 1.5)}%`, background: b.color }}
              />
            </div>
            <span className="tone-bar-row__pct">{b.pct.toFixed(1)}%</span>
          </div>
        ))}
      </div>
      <div className="tone-card__footer">
        <span>{stats.segments} segments</span>
        {stats.highSegments > 0 && (
          <span className="tone-card__alert">{stats.highSegments} elevated</span>
        )}
      </div>
    </div>
  );
}

export default function ResultToneTab({ toneAnalysis }) {
  if (!toneAnalysis?.results) {
    return (
      <EmptyState icon={<LuAudioLines />} title="No Tone Data Available">
        Tone analysis data was not detected for this call. This may happen with very short recordings or unsupported formats.
      </EmptyState>
    );
  }

  const hasAgent = !!toneAnalysis.results.Agent;
  const hasCustomer = !!toneAnalysis.results.Customer;
  if (!hasAgent && !hasCustomer) {
    return (
      <EmptyState icon={<LuAudioLines />} title="No Tone Data Available">
        Neither agent nor customer tone data was detected for this call.
      </EmptyState>
    );
  }

  const p = readChartPalette();
  const agentStats = hasAgent ? computeToneStats(toneAnalysis.results.Agent) : null;
  const custStats = hasCustomer ? computeToneStats(toneAnalysis.results.Customer) : null;

  const agentObj = hasAgent ? toneAnalysis.results.Agent : null;
  const custObj = hasCustomer ? toneAnalysis.results.Customer : null;
  const refObj = agentObj || custObj;
  const labels = Object.keys(refObj).map(parseToneLabel);
  const agentEnergies = agentObj
    ? Object.keys(agentObj).map((k) => calculateEnergy(agentObj[k].tone_distribution))
    : [];
  const custEnergies = custObj
    ? Object.keys(custObj).map((k) => calculateEnergy(custObj[k].tone_distribution))
    : [];
  const combinedMax = Math.max(...agentEnergies, ...custEnergies, 100);
  const yMax = Math.ceil(combinedMax / 100) * 100 + 100;

  const areaGradient = (ctx, color) => {
    const chart = ctx.chart;
    const { chartArea } = chart;
    if (!chartArea) return alphaColor(color, 0.2);
    const grad = chart.ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
    grad.addColorStop(0, alphaColor(color, 0.35));
    grad.addColorStop(0.6, alphaColor(color, 0.08));
    grad.addColorStop(1, alphaColor(color, 0));
    return grad;
  };

  const datasets = [];
  if (agentEnergies.length) {
    datasets.push({
      label: 'Agent',
      data: agentEnergies,
      borderColor: SPEAKER_COLORS.agent,
      backgroundColor: (ctx) => areaGradient(ctx, SPEAKER_COLORS.agent),
      pointBackgroundColor: SPEAKER_COLORS.agent,
      pointBorderColor: p.surface,
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 8,
      borderWidth: 2.5,
      fill: true,
      tension: 0.4,
    });
  }
  if (custEnergies.length) {
    datasets.push({
      label: 'Customer',
      data: custEnergies,
      borderColor: SPEAKER_COLORS.customer,
      backgroundColor: (ctx) => areaGradient(ctx, SPEAKER_COLORS.customer),
      pointBackgroundColor: SPEAKER_COLORS.customer,
      pointBorderColor: p.surface,
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 8,
      borderWidth: 2.5,
      fill: true,
      tension: 0.4,
    });
  }

  const trendOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    animation: { duration: 1000, easing: 'easeOutQuart' },
    plugins: {
      legend: {
        position: 'top',
        align: 'end',
        labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 16, font: { weight: '600', size: 12 } },
      },
      tooltip: {
        backgroundColor: p.surface,
        titleColor: p.text,
        bodyColor: p.textMuted,
        borderColor: p.border,
        borderWidth: 1,
        padding: 14,
        cornerRadius: 12,
        callbacks: {
          title: (items) => `Segment: ${items[0]?.label || ''}`,
          label: (ctx) => {
            const val = ctx.parsed.y;
            const band = val > 700 ? 'Energetic' : val < 300 ? 'Calm' : 'Moderate';
            return ` ${ctx.dataset.label}: ${formatToneFrequency(val)} — ${band}`;
          },
        },
      },
      annotation: {
        annotations: {
          calmZone: { type: 'box', yMin: 0, yMax: 300, backgroundColor: alphaColor(p.success, 0.04), borderWidth: 0 },
          moderateZone: { type: 'box', yMin: 300, yMax: 700, backgroundColor: alphaColor(p.warning, 0.03), borderWidth: 0 },
          elevatedZone: { type: 'box', yMin: 700, yMax: yMax, backgroundColor: alphaColor(p.danger, 0.05), borderWidth: 0 },
          calmLine: { type: 'line', yMin: 300, yMax: 300, borderColor: alphaColor(p.success, 0.25), borderWidth: 1, borderDash: [4, 4] },
          elevatedLine: { type: 'line', yMin: 700, yMax: 700, borderColor: alphaColor(p.danger, 0.3), borderWidth: 1, borderDash: [4, 4] },
        },
      },
    },
    scales: {
      y: {
        min: 0,
        max: yMax,
        grid: { color: alphaColor(p.border, 0.5), drawBorder: false, lineWidth: 0.5 },
        ticks: {
          color: p.textMuted,
          font: { size: 11 },
          stepSize: Math.max(100, Math.ceil(yMax / 5 / 100) * 100),
          padding: 8,
        },
        title: { display: true, text: 'Tone Intensity', color: p.textMuted, font: { size: 11, weight: '600' } },
      },
      x: {
        grid: { display: false, drawBorder: false },
        ticks: { color: p.textMuted, maxRotation: 45, font: { size: 10 } },
      },
    },
  };

  const distBars = [
    { label: 'Calm', agent: agentStats?.pctLow || 0, customer: custStats?.pctLow || 0 },
    { label: 'Moderate', agent: agentStats?.pctMed || 0, customer: custStats?.pctMed || 0 },
    { label: 'Energetic', agent: agentStats?.pctHigh || 0, customer: custStats?.pctHigh || 0 },
  ];
  const distData = {
    labels: distBars.map((b) => b.label),
    datasets: [
      ...(hasAgent ? [{
        label: 'Agent',
        data: distBars.map((b) => b.agent),
        backgroundColor: alphaColor(SPEAKER_COLORS.agent, 0.75),
        borderColor: SPEAKER_COLORS.agent,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 32,
        categoryPercentage: 0.6,
        barPercentage: 0.8,
      }] : []),
      ...(hasCustomer ? [{
        label: 'Customer',
        data: distBars.map((b) => b.customer),
        backgroundColor: alphaColor(SPEAKER_COLORS.customer, 0.75),
        borderColor: SPEAKER_COLORS.customer,
        borderWidth: 1.5,
        borderRadius: 6,
        borderSkipped: false,
        maxBarThickness: 32,
        categoryPercentage: 0.6,
        barPercentage: 0.8,
      }] : []),
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
    <div className="tone-dashboard">
      <div className="tone-summary-row">
        <ToneSpeakerCard label="Agent" stats={agentStats} accentClr={SPEAKER_COLORS.agent} palette={p} />
        <ToneSpeakerCard label="Customer" stats={custStats} accentClr={SPEAKER_COLORS.customer} palette={p} />
      </div>

      <div className="tone-trend-card">
        <div className="tone-trend-card__header">
          <div>
            <h4 className="tone-trend-card__title">
              <LuChartLine style={{ marginRight: 8, opacity: 0.6 }} />
              Tone Trend Over Call
            </h4>
            <p className="tone-trend-card__sub">Intensity across call segments — hover for details</p>
          </div>
          <div className="tone-trend-legend">
            <span className="tone-legend-chip" style={{ '--chip-color': p.success }}>Calm</span>
            <span className="tone-legend-chip" style={{ '--chip-color': p.warning }}>Moderate</span>
            <span className="tone-legend-chip" style={{ '--chip-color': p.danger }}>Energetic</span>
          </div>
        </div>
        <div className="tone-trend-card__body">
          <Line data={{ labels, datasets }} options={trendOptions} />
        </div>
      </div>

      {(hasAgent || hasCustomer) && (
        <div className="tone-dist-card">
          <div className="tone-dist-card__header">
            <h4 className="tone-dist-card__title">
              <LuAudioLines style={{ marginRight: 8, opacity: 0.6 }} />
              Tone Distribution
            </h4>
            <p className="tone-dist-card__sub">Percentage of call time spent at each intensity level</p>
          </div>
          <div className="tone-dist-card__body">
            <Bar data={distData} options={distOptions} />
          </div>
        </div>
      )}
    </div>
  );
}
