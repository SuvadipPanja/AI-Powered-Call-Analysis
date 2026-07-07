import { apiDelete, apiGet, apiPost, apiPut } from "../utils/apiHelpers";

export async function listRevaKnowledge() {
  return apiGet("/api/reva-knowledge", { label: "reva-knowledge" });
}

export async function createRevaKnowledge(body) {
  return apiPost("/api/reva-knowledge", body, { label: "reva-knowledge-create" });
}

export async function updateRevaKnowledge(id, body) {
  return apiPut(`/api/reva-knowledge/${id}`, body, { label: "reva-knowledge-update" });
}

export async function deleteRevaKnowledge(id) {
  return apiDelete(`/api/reva-knowledge/${id}`, { label: "reva-knowledge-delete" });
}

export async function getRevaKnowledgeOptions() {
  return apiGet("/api/reva-knowledge-options", { label: "reva-knowledge-options" });
}

export async function startAiChat(body) {
  return apiPost("/api/start-ai-chat", body, { label: "start-ai-chat" });
}

export async function updateAiChat(body) {
  return apiPost("/api/update-ai-chat", body, { label: "update-ai-chat" });
}

export async function closeAiChat(body) {
  return apiPost("/api/close-ai-chat", body, { label: "close-ai-chat" });
}

export async function logBankingOption(body) {
  return apiPost("/api/log-banking-option", body, { label: "log-banking-option" });
}

export async function chatWithAi(body) {
  return apiPost("/api/chat-with-ai", body, { label: "chat-with-ai" });
}
