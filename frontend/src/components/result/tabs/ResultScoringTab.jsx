import { Radar } from 'react-chartjs-2';
import { LuClipboardCheck, LuInfo } from '../../../icons';
import {
  Button,
  ChartPanel,
  EmptyState,
  Skeleton,
} from '../../ui';
import { readChartPalette } from '../../../theme/chartTheme';
import {
  formatScoreCell,
  getScoreBand,
  hexA,
  rubricPercent,
  RUBRIC,
} from '../resultUtils';
import ScoreRing from '../ScoreRing';
import { TabooAnalysisPanel } from '../SecureDownloadModal';

export default function ResultScoringTab({
  loading,
  scoreError,
  aiScoring,
  manualScoring,
  toneAnalysis,
  existingAuditId,
  onOpenAudit,
  onSeek,
}) {
  if (loading) {
    return (
      <div className="rp-scoring-skeleton">
        <Skeleton style={{ height: 80, borderRadius: 'var(--radius-md)' }} />
        <Skeleton style={{ height: 300, borderRadius: 'var(--radius-md)' }} />
        <Skeleton style={{ height: 200, borderRadius: 'var(--radius-md)' }} />
      </div>
    );
  }
  if (scoreError) {
    return (
      <EmptyState icon={<LuClipboardCheck />} title="Scoring Unavailable">
        <p>{scoreError}</p>
      </EmptyState>
    );
  }
  if (!aiScoring) {
    return (
      <EmptyState icon={<LuClipboardCheck />} title="No Scoring Data">
        Scoring data has not been loaded yet.
      </EmptyState>
    );
  }

  const aiOverall = aiScoring['Overall Scoring'] ?? 'N/A';
  const manualOverallRaw = manualScoring['Overall Scoring'];
  const finalManualOverall = (() => {
    if (manualOverallRaw != null && String(manualOverallRaw).trim() !== '') return manualOverallRaw;
    const vals = RUBRIC.map((k) => manualScoring[k]).filter((v) => v != null && v !== '' && !Number.isNaN(parseFloat(v)));
    if (vals.length === 0) return 'N/A';
    return parseFloat((vals.reduce((s, v) => s + parseFloat(v), 0) / vals.length).toFixed(2));
  })();
  const aiEntries = Object.entries(aiScoring).filter(([k]) => k !== 'Overall Scoring');
  const p = readChartPalette();

  const aiVals = RUBRIC.map((d) => rubricPercent(aiScoring[d]));
  const hasManual = RUBRIC.some((d) => manualScoring[d] != null && String(manualScoring[d]).trim() !== '');
  const showRadar = aiVals.some((v) => v > 0) || rubricPercent(aiScoring['Overall Scoring']) > 0;

  const radarData = {
    labels: RUBRIC.map((d) => d.replace('Authentication Verification', 'Auth. Verify').replace('Adherence to Protocol', 'Protocol')),
    datasets: [
      {
        label: 'AI Score',
        data: aiVals,
        borderColor: p.accent,
        backgroundColor: hexA(p.accent, 0.22),
        pointBackgroundColor: p.accent,
        pointBorderColor: p.surface,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2.5,
        fill: true,
      },
      ...(hasManual ? [{
        label: 'Manual Score',
        data: RUBRIC.map((d) => rubricPercent(manualScoring[d])),
        borderColor: p.success,
        backgroundColor: hexA(p.success, 0.18),
        pointBackgroundColor: p.success,
        pointBorderColor: p.surface,
        pointRadius: 5,
        pointHoverRadius: 7,
        borderWidth: 2.5,
        fill: true,
      }] : []),
    ],
  };
  const radarOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'bottom', labels: { color: p.text, usePointStyle: true, boxWidth: 8, padding: 14 } },
      tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.r}%` } },
    },
    scales: {
      r: {
        min: 0,
        max: 100,
        beginAtZero: true,
        angleLines: { color: p.border },
        grid: { color: p.border },
        pointLabels: { color: p.textMuted, font: { size: 10, weight: '600' }, padding: 8 },
        ticks: {
          display: true,
          stepSize: 20,
          showLabelBackdrop: false,
          color: p.textMuted,
          font: { size: 9 },
          backdropColor: 'transparent',
        },
      },
    },
  };

  return (
    <div className="rp-scoring-content">
      <div className="rp-scoring-overview">
        <div className="rp-scoring-rings">
          <ScoreRing value={aiOverall} size={100} strokeWidth={8} label="AI" />
          {hasManual && (
            <ScoreRing value={finalManualOverall} size={100} strokeWidth={8} label="Manual" variant="good" />
          )}
        </div>
        {aiScoring.Feedback && String(aiScoring.Feedback).trim() && (
          <div className="rp-feedback-card">
            <div className="rp-feedback-header">
              <LuInfo className="rp-feedback-icon" />
              <span>AI Coaching Feedback</span>
            </div>
            <p className="rp-feedback-text">{aiScoring.Feedback}</p>
          </div>
        )}
      </div>

      {showRadar && (
        <ChartPanel
          title="Scoring Profile"
          subtitle={hasManual ? 'AI vs Manual across all dimensions' : 'AI score across all dimensions'}
          height={320}
        >
          <Radar data={radarData} options={radarOptions} />
        </ChartPanel>
      )}

      <div className="rp-scoring-table-wrap">
        <table className="rp-scoring-table">
          <thead>
            <tr>
              <th>Parameter</th>
              <th>AI Score</th>
              {hasManual && <th>Manual Score</th>}
            </tr>
          </thead>
          <tbody>
            {aiEntries.map(([param, aiVal]) => {
              const isNumericParam = RUBRIC.includes(param);
              const aiText = String(aiVal ?? '').trim();
              const aiPctCell = isNumericParam ? rubricPercent(aiVal) : 0;
              const manualVal = manualScoring?.[param];
              return (
                <tr key={param}>
                  <td>
                    <span className="rp-param-name">{param}</span>
                    {isNumericParam && aiPctCell > 0 && (
                      <div className="rp-param-bar">
                        <div
                          className={`rp-param-bar__fill rp-param-bar__fill--${getScoreBand(aiPctCell)}`}
                          style={{ width: `${aiPctCell}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="rp-score-cell">{isNumericParam ? formatScoreCell(aiVal) : (aiText || '—')}</td>
                  {hasManual && (
                    <td className="rp-score-cell">
                      {isNumericParam ? formatScoreCell(manualVal) : (String(manualVal ?? '').trim() || '—')}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="rp-scoring-actions">
          <Button
            variant={existingAuditId ? 'secondary' : 'primary'}
            onClick={onOpenAudit}
            aria-label={existingAuditId ? 'View/Edit Audit' : 'Manual Audit'}
          >
            <LuClipboardCheck style={{ marginRight: 6 }} />
            {existingAuditId ? 'View / Edit Audit' : 'Manual Audit'}
          </Button>
        </div>
      </div>

      <TabooAnalysisPanel toneAnalysis={toneAnalysis} onSeek={onSeek} />
    </div>
  );
}
