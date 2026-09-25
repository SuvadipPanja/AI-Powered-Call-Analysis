const AI_COLOR = "#0f766e";
const MANUAL_COLOR = "#d97706";

function toScore(value) {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 10) / 10;
}

function callLabel(count, verb) {
  return `${count} call${count === 1 ? "" : "s"} ${verb}`;
}

/** Score-shaped view of auditCoverage: the plotted value is the average score,
 *  the caption is how many calls that average came from. */
export function buildAuditCoverageBreakdown(coverage, tokens = {}) {
  const missing = coverage == null || typeof coverage !== "object";
  if (missing) {
    return { rows: [], total: 0, hasData: false, missing: true, gap: null };
  }

  const aiOnly = Number(coverage.aiOnly) || 0;
  const manualReviewed = Number(coverage.manualReviewed) || 0;
  const total = aiOnly + manualReviewed;
  const avgAi = toScore(coverage.avgAi);
  const avgManual = toScore(coverage.avgManual);
  const hasData = total > 0 && avgAi != null;
  if (!hasData) {
    return { rows: [], total, hasData: false, missing: false, gap: null };
  }

  const rows = [
    {
      key: "ai",
      name: "AI score",
      score: avgAi,
      count: total,
      countLabel: callLabel(total, "scored"),
      color: AI_COLOR,
      drilldownToken: tokens.allScored || tokens.aiOnly || null,
    },
    {
      key: "manual",
      name: "Manual score",
      score: avgManual,
      count: manualReviewed,
      countLabel: manualReviewed > 0 ? callLabel(manualReviewed, "audited") : "Not audited yet",
      color: MANUAL_COLOR,
      drilldownToken: manualReviewed > 0 ? tokens.manualReviewed || null : null,
    },
  ];

  const gap = avgManual != null ? Math.round((avgAi - avgManual) * 10) / 10 : null;

  return { rows, total, hasData: true, missing: false, gap };
}
