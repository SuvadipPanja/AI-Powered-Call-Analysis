import { apiGet, apiPost } from "../utils/apiHelpers";

export async function getTeamAuditSummary() {
  return apiGet("/api/audits/team/summary", { label: "audits-team-summary" });
}

export async function getTeamAuditList(queryString) {
  return apiGet(`/api/audits/team/list?${queryString}`, { label: "audits-team-list" });
}

export async function getAuditByFileName(fileName) {
  return apiGet(`/api/audits/${encodeURIComponent(fileName)}`, { label: "audit-detail" });
}

export async function getAuditQueue(username, { agentName, fromDate, toDate } = {}) {
  const params = {};
  if (agentName) params.agentName = agentName;
  if (fromDate) params.fromDate = fromDate;
  if (toDate) params.toDate = toDate;
  return apiGet(`/api/audit-queue/${encodeURIComponent(username)}`, { params, label: "audit-queue" });
}

export async function saveAudit(body) {
  return apiPost("/api/audits", body, { label: "audit-save" });
}
