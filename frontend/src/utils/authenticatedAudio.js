import config from "./envConfig";

function getToken() {
  return localStorage.getItem("token") || localStorage.getItem("sessionToken") || "";
}

/**
 * Fetch a call recording with the session token and return a blob URL for WaveSurfer.
 * Caller must revoke the URL when done: URL.revokeObjectURL(url).
 */
export async function createAuthenticatedAudioBlobUrl(filename) {
  const safeName = encodeURIComponent(String(filename || "").trim());
  if (!safeName) {
    throw new Error("Missing audio filename.");
  }

  const token = getToken();
  const headers = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${config.apiBaseUrl}/api/audio/stream/${safeName}`, { headers });
  if (!response.ok) {
    throw new Error(`Audio load failed (${response.status})`);
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}
