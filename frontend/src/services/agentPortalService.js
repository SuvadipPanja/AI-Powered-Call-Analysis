import { apiGet, apiPost } from "../utils/apiHelpers";

export async function getAgentDashboard(username) {
  return apiGet("/api/agent/dashboard", { params: { username }, label: "agent-dashboard" });
}

export async function getAgentProfile(username) {
  return apiGet("/api/agent-profile", { params: { username }, label: "agent-profile" });
}

export async function getBriefingTodayLatest(agentUsername) {
  return apiGet("/api/briefing/today-latest", { params: { agentUsername }, label: "briefing-today" });
}

export async function getKnowledgeTestLatest(agentUsername) {
  return apiGet("/api/knowledge-test-latest", { params: { agentUsername }, label: "knowledge-test-latest" });
}

export async function getKnowledgeTestResultToday(username) {
  return apiGet("/api/knowledge-test-result-today", { params: { username }, label: "knowledge-test-result" });
}

export async function submitKnowledgeTest(body) {
  return apiPost("/api/submit-knowledge-test", body, { label: "submit-knowledge-test" });
}

export async function getTeamAgents(username) {
  return apiGet(`/api/team-agents/${encodeURIComponent(username)}`, { label: "team-agents" });
}
