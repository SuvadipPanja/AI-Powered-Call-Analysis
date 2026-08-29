const AI_ONLY_COLOR = "#0f766e";
const MANUAL_COLOR = "#d97706";

export function buildAuditCoverageBreakdown(coverage, tokens = {}) {
  const missing = coverage == null || typeof coverage !== "object";
  if (missing) {
    return { rows: [], total: 0, hasData: false, missing: true, insight: undefined };
  }

  const aiOnly = Number(coverage.aiOnly) || 0;
  const manualReviewed = Number(coverage.manualReviewed) || 0;
  const total = aiOnly + manualReviewed;
  const hasData = total > 0;
  if (!hasData) {
    return { rows: [], total: 0, hasData: false, missing: false, insight: undefined };
  }

  const rows = [
    {
      name: "AI scored only",
      count: aiOnly,
      color: AI_ONLY_COLOR,
      percent: Math.round((aiOnly / total) * 100),
      drilldownToken: tokens.aiOnly || null,
    },
    {
      name: "Manually audited",
      count: manualReviewed,
      color: MANUAL_COLOR,
      percent: Math.round((manualReviewed / total) * 100),
      drilldownToken: tokens.manualReviewed || null,
    },
  ];

  const hasAvgs = coverage.avgAi != null && coverage.avgManual != null;
  const insight = hasAvgs
    ? `Avg AI ${coverage.avgAi} · Avg manual ${coverage.avgManual} on audited calls`
    : undefined;

  return { rows, total, hasData, missing: false, insight };
}
