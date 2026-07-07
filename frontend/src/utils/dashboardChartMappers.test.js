import {
  mapToneSentimentChart,
  mapAgentWiseChart,
  mapQueryTypeChart,
  mapEscalationTotals,
  mapLoanLeadsChart,
} from "./dashboardChartMappers";
import {
  formatKpiDelta,
  computeKpiComparison,
  buildKpiStats,
} from "./dashboardKpiUtils";

describe("dashboardChartMappers", () => {
  it("mapToneSentimentChart returns null for empty data", () => {
    expect(mapToneSentimentChart({ success: true, data: [] })).toBeNull();
  });

  it("mapAgentWiseChart builds bar chart datasets", () => {
    const chart = mapAgentWiseChart({
      success: true,
      agentLabels: ["A", "B"],
      agentScores: [0.8, 0.6],
    });
    expect(chart.labels).toEqual(["A", "B"]);
    expect(chart.datasets[0].data).toEqual([0.8, 0.6]);
  });

  it("mapQueryTypeChart maps colored donut", () => {
    const chart = mapQueryTypeChart({
      success: true,
      data: [{ label: "Billing", count: 3, color: "#111" }],
    });
    expect(chart.labels).toEqual(["Billing"]);
    expect(chart.datasets[0].data).toEqual([3]);
  });

  it("mapEscalationTotals extracts totals", () => {
    expect(mapEscalationTotals({
      success: true,
      data: { totals: { escalated: 2 } },
    })).toEqual({ escalated: 2 });
  });

  it("mapLoanLeadsChart parses loan leads payload", () => {
    const out = mapLoanLeadsChart({
      success: true,
      data: {
        totals: { loanCalls: 5 },
        byLoanType: [{ label: "Home", count: 2 }],
      },
    });
    expect(out.totals.loanCalls).toBe(5);
    expect(out.donutData.labels).toContain("Home");
  });
});

describe("dashboardKpiUtils", () => {
  it("formatKpiDelta adds sign", () => {
    expect(formatKpiDelta(12.34)).toBe("+12.3%");
    expect(formatKpiDelta(-2)).toBe("-2%");
  });

  it("computeKpiComparison calculates growth", () => {
    const cmp = computeKpiComparison(
      { totalCallsProcessed: 110, successCount: 55, failedCount: 5, avgAiScoring: 0.8, avgManualScoring: 0.7, aht: 200 },
      { totalCallsProcessed: 100, successCount: 50, failedCount: 10, avgAiScoring: 0.7, avgManualScoring: 0.6, aht: 180 },
    );
    expect(cmp.totalCallsGrowth).toBe(10);
    expect(cmp.avgAiGrowth).toBeCloseTo(10);
  });

  it("buildKpiStats scales scores to percent", () => {
    const stats = buildKpiStats({
      totalCallsProcessed: 10,
      successCount: 8,
      failedCount: 2,
      avgAiScoring: 0.85,
      avgManualScoring: 0.75,
      aht: 120,
    });
    expect(stats.avgAiScore).toBe(85);
    expect(stats.successRate).toBe("80.0");
  });
});
