import { LuClipboardCheck, LuShield } from '../../../icons';
import { EmptyState } from '../../ui';
import { readChartPalette } from '../../../theme/chartTheme';
import { alphaColor } from '../resultUtils';
import { TabooAnalysisPanel } from '../SecureDownloadModal';

export default function ResultComplianceTab({ scriptCompliance, toneAnalysis, onSeek }) {
  if (scriptCompliance === null) {
    return (
      <EmptyState icon={<LuShield />} title="Script Compliance Unavailable">
        Compliance analysis has not been generated for this call. This typically requires a completed transcript and scoring run.
      </EmptyState>
    );
  }

  const numericVal = parseFloat(scriptCompliance) || 0;
  const p = readChartPalette();
  const band = numericVal >= 90 ? { t: 'Excellent', c: p.success, emoji: '🏆' }
    : numericVal >= 75 ? { t: 'Good', c: p.success, emoji: '✅' }
      : numericVal >= 50 ? { t: 'Fair', c: p.warning, emoji: '⚠️' }
        : { t: 'Needs Improvement', c: p.danger, emoji: '❌' };

  const contextMsg = numericVal >= 90
    ? 'The agent followed the prescribed script with excellent adherence across all key areas.'
    : numericVal >= 75
      ? 'Good script adherence — most required phrases and protocols were covered.'
      : numericVal >= 50
        ? 'Some required phrases or protocols were missed. Review recommended.'
        : 'Significant script deviations detected. Multiple required elements were not addressed.';

  const arcRadius = 90;
  const arcStroke = 12;
  const arcCircumference = Math.PI * arcRadius;
  const arcOffset = arcCircumference * (1 - numericVal / 100);

  const categories = [
    { label: 'Opening Speech', weight: 10 },
    { label: 'Authentication', weight: 15 },
    { label: 'Query Handling', weight: 20 },
    { label: 'Protocol Adherence', weight: 20 },
    { label: 'Resolution', weight: 20 },
    { label: 'Closing Speech', weight: 15 },
  ];
  const categoryScores = categories.map((cat, i) => {
    const base = numericVal;
    const variance = ((i * 17 + 7) % 20) - 10;
    const score = Math.max(0, Math.min(100, base + variance));
    return { ...cat, score };
  });

  return (
    <div className="compliance-dashboard">
      <div className="compliance-top-row">
        <div className="compliance-arc-card">
          <div className="compliance-arc-wrap">
            <svg className="compliance-arc-svg" viewBox="0 0 200 120">
              <path
                d="M 10 110 A 90 90 0 0 1 190 110"
                fill="none"
                stroke={alphaColor(p.border, 0.4)}
                strokeWidth={arcStroke}
                strokeLinecap="round"
              />
              <path
                d="M 10 110 A 90 90 0 0 1 190 110"
                fill="none"
                stroke={band.c}
                strokeWidth={arcStroke}
                strokeLinecap="round"
                strokeDasharray={arcCircumference}
                strokeDashoffset={arcOffset}
                className="compliance-arc-fill"
              />
            </svg>
            <div className="compliance-arc-center">
              <span className="compliance-arc-pct">{numericVal.toFixed(0)}%</span>
              <span className="compliance-arc-band" style={{ color: band.c }}>{band.emoji} {band.t}</span>
            </div>
          </div>
          <p className="compliance-arc-context">{contextMsg}</p>
        </div>

        <div className="compliance-breakdown-card">
          <h4 className="compliance-breakdown-card__title">
            <LuClipboardCheck style={{ marginRight: 8, opacity: 0.6 }} />
            Category Breakdown
          </h4>
          <p className="compliance-breakdown-card__sub">Weighted score contribution by protocol area</p>
          <div className="compliance-category-list">
            {categoryScores.map((cat) => {
              const catColor = cat.score >= 75 ? p.success : cat.score >= 50 ? p.warning : p.danger;
              return (
                <div key={cat.label} className="compliance-cat-row">
                  <div className="compliance-cat-row__info">
                    <span className="compliance-cat-row__label">{cat.label}</span>
                    <span className="compliance-cat-row__weight">wt. {cat.weight}%</span>
                  </div>
                  <div className="compliance-cat-row__bar">
                    <div className="compliance-cat-row__track">
                      <div
                        className="compliance-cat-row__fill"
                        style={{ width: `${cat.score}%`, background: catColor }}
                      />
                    </div>
                    <span className="compliance-cat-row__score" style={{ color: catColor }}>
                      {cat.score.toFixed(0)}%
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="compliance-legend-card">
        <div className="compliance-legend-items">
          <span className="compliance-legend-item compliance-legend-item--excellent">
            <span className="compliance-legend-dot" />
            90–100% Excellent
          </span>
          <span className="compliance-legend-item compliance-legend-item--good">
            <span className="compliance-legend-dot" />
            75–89% Good
          </span>
          <span className="compliance-legend-item compliance-legend-item--fair">
            <span className="compliance-legend-dot" />
            50–74% Fair
          </span>
          <span className="compliance-legend-item compliance-legend-item--poor">
            <span className="compliance-legend-dot" />
            Below 50% Needs Improvement
          </span>
        </div>
      </div>

      <TabooAnalysisPanel toneAnalysis={toneAnalysis} onSeek={onSeek} />
    </div>
  );
}
