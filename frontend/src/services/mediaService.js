import { apiPostBlob } from "../utils/apiHelpers";
import { getAuthToken } from "../utils/authSession";
import { apiUrl } from "../utils/apiUrl";

/**
 * Fetch a call recording with the session token and return a blob URL for WaveSurfer.
 * Caller must revoke the URL when done: URL.revokeObjectURL(url).
 */
export async function createAuthenticatedAudioBlobUrl(filename) {
  const name = String(filename || "").trim();
  if (!name) {
    throw new Error("Missing audio filename.");
  }

  const token = getAuthToken();
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const safeName = encodeURIComponent(name);
  const response = await fetch(apiUrl(`/api/audio/stream/${safeName}`), { headers });
  const contentType = response.headers.get("content-type") || "";

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    if (contentType.includes("application/json")) {
      try {
        const body = await response.json();
        detail = body.message || detail;
      } catch { /* ignore */ }
    }
    throw new Error(`Audio load failed (${detail})`);
  }

  if (contentType.includes("application/json")) {
    try {
      const body = await response.json();
      throw new Error(body.message || "Audio file not found on server.");
    } catch (err) {
      if (err.message && !err.message.includes("JSON")) throw err;
      throw new Error("Audio file not found on server.");
    }
  }

  const blob = await response.blob();
  if (!blob || blob.size === 0) {
    throw new Error("Audio file is empty or unavailable.");
  }
  return URL.createObjectURL(blob);
}

/** POST secure audio download — returns zip blob. */
export async function downloadSecureAudio(filename, password) {
  return apiPostBlob("/api/download-secure-audio", { filename, password }, {
    label: "download-secure-audio",
  });
}
