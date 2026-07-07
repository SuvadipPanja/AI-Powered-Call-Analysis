/** Format KPI delta for display (+12.5%, +3 pts, etc.). */
export function formatKpiDelta(value, suffix = "%") {
  const n = Number(value) || 0;
  const sign = n > 0 ? "+" : "";
  return `${sign}${Math.round(n * 10) / 10}${suffix}`;
}

function pctChange(current, previous) {
  if (current === 0 && previous === 0) return 0;
  return previous !== 0 ? ((current - previous) / previous) * 100 : (current > 0 ? 100 : 0);
}

function scorePts(current, previous) {
  return (current - previous) * 100;
}

/** Period-over-period comparison for dashboard KPI strip. */
export function computeKpiComparison(current, previous) {
  return {
    totalCallsGrowth: pctChange(current.totalCallsProcessed, previous.totalCallsProcessed),
    successGrowth: pctChange(current.successCount, previous.successCount),
    failedGrowth: -pctChange(current.failedCount, previous.failedCount),
    avgAiGrowth: scorePts(current.avgAiScoring, previous.avgAiScoring),
    avgManualGrowth: scorePts(current.avgManualScoring, previous.avgManualScoring),
    ahtGrowth: pctChange(current.aht, previous.aht),
  };
}

export function buildKpiStats({
  totalCallsProcessed,
  successCount,
  failedCount,
  avgAiScoring,
  avgManualScoring,
  aht,
}) {
  const successRate = totalCallsProcessed > 0
    ? ((successCount / totalCallsProcessed) * 100).toFixed(1)
    : "0.0";
  return {
    totalCalls: totalCallsProcessed,
    successCount,
    failedCount,
    avgAiScore: avgAiScoring * 100,
    avgManualScore: avgManualScoring * 100,
    aht,
    successRate,
  };
}
