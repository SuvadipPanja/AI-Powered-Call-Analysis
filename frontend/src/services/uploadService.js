import { apiGet, apiGetBlob, apiPost, apiPostForm, apiPostWithStatus, apiPut } from "../utils/apiHelpers";

export async function getAudioStatus(fileName) {
  return apiGet(`/api/audio-status/${encodeURIComponent(fileName)}`, { label: "audio-status" });
}

export async function getLatestAudio() {
  return apiGet("/api/latest-audio", { label: "latest-audio" });
}

export async function uploadAudio(formData, { onUploadProgress, signal } = {}) {
  return apiPostForm("/upload-audio", formData, { label: "upload-audio", onUploadProgress, signal });
}

export async function analyzeAudio(formData) {
  return apiPostForm("/api/analyze", formData, { label: "analyze-audio" });
}

export async function getAutoUploadStatus() {
  return apiGet("/api/admin/auto-upload/status", { label: "auto-upload-status" });
}

export async function getAutoUploadSettings() {
  return apiGet("/api/admin/auto-upload/settings", { label: "auto-upload-settings" });
}

export async function getAutoUploadHistory() {
  return apiGet("/api/admin/auto-upload/history", { label: "auto-upload-history" });
}

export async function saveAutoUploadSettings(settings) {
  return apiPut("/api/admin/auto-upload/settings", settings, { label: "auto-upload-settings-save" });
}

export async function runAutoUpload() {
  return apiPostWithStatus("/api/admin/auto-upload/run", {}, { label: "auto-upload-run" });
}

export async function stopAutoUpload() {
  return apiPostWithStatus("/api/admin/auto-upload/stop", {}, { label: "auto-upload-stop" });
}

export async function resumeAutoUpload(targetFolder) {
  return apiPostWithStatus("/api/admin/auto-upload/resume", { targetFolder }, { label: "auto-upload-resume" });
}

export async function postBriefing(body) {
  return apiPost("/api/upload-briefing", body, { label: "upload-briefing" });
}

export async function postKnowledgeTest(body) {
  return apiPost("/api/upload-knowledge-test", body, { label: "upload-knowledge-test" });
}

export async function uploadBriefing(formData) {
  return apiPostForm("/api/upload-briefing", formData, { label: "upload-briefing" });
}

export async function uploadKnowledgeTest(formData) {
  return apiPostForm("/api/upload-knowledge-test", formData, { label: "upload-knowledge-test" });
}

export async function exportTeamAudits(queryString) {
  return apiGetBlob(`/api/audits/team/export?${queryString}`, { label: "audits-team-export" });
}
