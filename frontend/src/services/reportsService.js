import { apiGetQuery, apiGetReport, apiPostBlob } from "../utils/apiHelpers";

function qs(params) {
  if (typeof params === "string") return params;
  if (params instanceof URLSearchParams) return params.toString();
  if (!params) return "";
  return new URLSearchParams(params).toString();
}

function reportGet(path, queryParams, label) {
  const queryString = qs(queryParams);
  const url = queryString ? `${path}?${queryString}` : path;
  return apiGetReport(url, undefined, label);
}

export async function getRecentActivity(queryString) {
  return apiGetQuery("/api/recent-activity", queryString, { label: "recent-activity" });
}

export async function getInboundOutboundWeek(queryString) {
  return apiGetQuery("/api/inbound-outbound-week", queryString, { label: "inbound-outbound-week" });
}

export async function getDailyDurationWeek(queryString) {
  return apiGetQuery("/api/daily-duration-inbound-outbound-week", queryString, { label: "daily-duration-week" });
}

export async function getTopScorerAgentsWeek(queryString) {
  return apiGetQuery("/api/top-scorer-agents-week", queryString, { label: "top-scorer-agents-week" });
}

export async function getRealtimeMetrics(queryParams) {
  return reportGet("/api/reports/realtime-metrics", queryParams, "realtime-metrics");
}

export async function getPerformanceComparison(queryParams) {
  return reportGet("/api/reports/performance-comparison", queryParams, "performance-comparison");
}

export async function getMetricsOverview(queryParams) {
  return apiGetQuery("/api/metrics-overview", qs(queryParams), { label: "metrics-overview" });
}

export async function getLanguagePreferences(queryParams) {
  return reportGet("/api/reports/language-preferences", queryParams, "language-preferences");
}

export async function getCallVolumeByTime(queryParams) {
  return reportGet("/api/reports/call-volume-by-time", queryParams, "call-volume-by-time");
}

export async function getCallVolumeTrendsEnhanced(queryParams) {
  return reportGet("/api/reports/call-volume-trends-enhanced", queryParams, "call-volume-trends");
}

export async function getRubricComparison(queryParams) {
  return reportGet("/api/reports/rubric-comparison", queryParams, "rubric-comparison");
}

export async function getToneSentimentSummary(queryParams) {
  return reportGet("/api/reports/tone-sentiment-summary", queryParams, "tone-sentiment");
}

export async function getLeadClassification(queryParams) {
  return reportGet("/api/reports/lead-classification", queryParams, "lead-classification");
}

export async function getQueryTypeDistribution(queryParams) {
  return reportGet("/api/reports/query-type-distribution", queryParams, "query-type-distribution");
}

export async function getEscalationSummary(queryParams) {
  return reportGet("/api/reports/escalation-summary", queryParams, "escalation-summary");
}

export async function getHoldSummary(queryParams) {
  return reportGet("/api/reports/hold-summary", queryParams, "hold-summary");
}

export async function getCallResolutionStatus(queryParams) {
  return reportGet("/api/reports/call-resolution-status", queryParams, "call-resolution-status");
}

export async function getAgentPerformanceMetrics(queryParams) {
  return reportGet("/api/reports/agent-performance-metrics", queryParams, "agent-performance-metrics");
}

export async function getAgentHandlingSummary(queryParams) {
  return reportGet("/api/reports/agent-handling-summary", queryParams, "agent-handling-summary");
}

export async function getAgentWiseAiScoring(queryString) {
  return apiGetQuery("/api/agent-wise-ai-scoring", queryString, { label: "agent-wise-ai-scoring" });
}

export async function getLoanLeads(queryString) {
  return apiGetQuery("/api/reports/loan-leads", queryString, { label: "loan-leads" });
}

export async function exportReportCsv(endpoint, body) {
  return apiPostBlob(endpoint, body, { label: "report-export-csv" });
}
