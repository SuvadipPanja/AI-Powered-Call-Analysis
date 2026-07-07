import { apiGet } from "../utils/apiHelpers";

export async function getAudioDetails(fileName) {
  return apiGet(`/api/audio-details/${encodeURIComponent(fileName)}`, { label: "audio-details" });
}

export async function getTranslateOutput(fileName) {
  return apiGet(`/api/translate-output/${encodeURIComponent(fileName)}`, { label: "translate-output" });
}

export async function getSummary(fileName) {
  return apiGet(`/api/summary/${encodeURIComponent(fileName)}`, { label: "summary" });
}

export async function getToneAnalysis(fileName) {
  return apiGet(`/api/tone-analysis/${encodeURIComponent(fileName)}`, { label: "tone-analysis" });
}

export async function getSentiment(fileName) {
  return apiGet(`/api/sentiment/${encodeURIComponent(fileName)}`, { label: "sentiment" });
}

export async function getCustomScoringDetails(fileName) {
  return apiGet(`/api/custom-scoring-details/${encodeURIComponent(fileName)}`, { label: "custom-scoring" });
}

export async function getCallIntelligence(fileName) {
  return apiGet(`/api/call-intelligence/${encodeURIComponent(fileName)}`, { label: "call-intelligence" });
}

export async function getQueryCategories(active = 1) {
  return apiGet("/api/query-categories", { params: { active }, label: "query-categories" });
}

export async function getScriptCompliance(fileName) {
  return apiGet(`/api/script-compliance/${encodeURIComponent(fileName)}`, { label: "script-compliance" });
}

export async function getAuditForResult(fileName) {
  return apiGet(`/api/audits/${encodeURIComponent(fileName)}`, { label: "result-audit" });
}
