import {
  buildColoredDoughnutData,
  buildSentimentSummaryChart,
  buildModernDoughnutData,
} from "../components/reports/reportsChartConfig";
import { chartSeriesColors } from "../theme/chartTheme";
import { parseLoanLeadsResponse } from "./loanLeadsData";

export function mapToneSentimentChart(apiResult) {
  if (!apiResult?.success || !Array.isArray(apiResult.data) || !apiResult.data.length) {
    return null;
  }
  return buildSentimentSummaryChart(apiResult.data);
}

export function mapAgentWiseChart(apiResult) {
  if (!apiResult?.success || !apiResult.agentLabels || !apiResult.agentScores) {
    return null;
  }
  const colors = chartSeriesColors();
  return {
    labels: apiResult.agentLabels,
    datasets: [{
      label: "Agent-Wise AI Scoring",
      data: apiResult.agentScores,
      backgroundColor: apiResult.agentScores.map((_, i) => colors[i % colors.length]),
      borderSkipped: false,
      borderRadius: 10,
      maxBarThickness: 40,
    }],
  };
}

export function mapQueryTypeChart(apiResult) {
  if (!apiResult?.success || !Array.isArray(apiResult.data) || !apiResult.data.length) {
    return null;
  }
  return buildColoredDoughnutData(
    apiResult.data.map((d) => d.label || "Unclassified"),
    apiResult.data.map((d) => d.count),
    apiResult.data.map((d) => d.color),
  );
}

export function mapEscalationTotals(apiResult) {
  if (!apiResult?.success || !apiResult.data?.totals) return null;
  return apiResult.data.totals;
}

export function mapEscalationReport(apiResult) {
  if (!apiResult?.success || !apiResult.data) {
    return { totals: null, donut: null };
  }
  const cats = apiResult.data.byCategory || [];
  return {
    totals: apiResult.data.totals || null,
    donut: cats.length
      ? buildModernDoughnutData(cats.map((c) => c.label), cats.map((c) => c.count))
      : null,
  };
}

export function mapHoldReport(apiResult) {
  if (!apiResult?.success || !apiResult.data?.totals) return null;
  return apiResult.data.totals;
}

export function mapLoanLeadsChart(apiResult) {
  const { totals, donutData } = parseLoanLeadsResponse(apiResult);
  return { totals, donutData };
}

export function mapLeadClassificationChart(apiResult) {
  if (!apiResult?.success || !apiResult.data?.length) return null;
  return buildModernDoughnutData(
    apiResult.data.map((item) => item.label || "Unknown"),
    apiResult.data.map((item) => item.count),
  );
}
