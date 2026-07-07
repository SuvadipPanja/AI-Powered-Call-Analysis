import { apiDelete, apiGet, apiPost, apiPut } from "../utils/apiHelpers";

export async function listAgents() {
  return apiGet("/api/agents", { label: "agents" });
}

export async function searchAgents(query) {
  return apiGet("/api/agents/search", { params: { q: query }, label: "agents-search" });
}

export async function createAgent(body) {
  return apiPost("/api/agents", body, { label: "agents-create" });
}

export async function updateAgent(agentId, body) {
  return apiPut(`/api/agents/${encodeURIComponent(agentId)}`, body, { label: "agents-update" });
}

export async function deactivateAgent(agentId) {
  return apiPut(`/api/agents/${encodeURIComponent(agentId)}/deactivate`, {}, { label: "agents-deactivate" });
}

export async function deleteAgent(agentId) {
  return apiDelete(`/api/agents/${encodeURIComponent(agentId)}`, { label: "agents-delete" });
}

export async function getAgentsByCallType(callType) {
  return apiGet(`/api/agents/${callType}`, { label: "agents-by-type" });
}
