import apiClient from "./apiClient";

/** @type {Map<string, { url: string, loading: boolean, promise: Promise<string> | null }>} */
const entries = new Map();

/** @type {Set<(username: string) => void>} */
const listeners = new Set();

function notify(username) {
  listeners.forEach((fn) => {
    try {
      fn(username);
    } catch (_) {
      /* ignore */
    }
  });
}

export function getProfilePictureUrl(username) {
  if (!username) return "";
  return entries.get(username)?.url || "";
}

export function subscribeProfilePicture(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function invalidateProfilePicture(username) {
  if (username) {
    const entry = entries.get(username);
    if (entry?.url) URL.revokeObjectURL(entry.url);
    entries.delete(username);
    notify(username);
    return;
  }
  entries.forEach((entry) => {
    if (entry.url) URL.revokeObjectURL(entry.url);
  });
  entries.clear();
  notify("");
}

export function loadProfilePicture(username) {
  if (!username) return Promise.resolve("");

  const existing = entries.get(username);
  if (existing?.url) return Promise.resolve(existing.url);
  if (existing?.promise) return existing.promise;

  const entry = existing || { url: "", loading: true, promise: null };
  entries.set(username, entry);

  entry.promise = apiClient
    .get(`/api/user/${encodeURIComponent(username)}/profile-picture`, {
      responseType: "blob",
    })
    .then((res) => {
      if (!res.data || res.data.size === 0) {
        entry.url = "";
        return "";
      }
      if (entry.url) URL.revokeObjectURL(entry.url);
      entry.url = URL.createObjectURL(res.data);
      return entry.url;
    })
    .catch(() => {
      entry.url = "";
      return "";
    })
    .finally(() => {
      entry.loading = false;
      entry.promise = null;
      notify(username);
    });

  return entry.promise;
}

if (typeof window !== "undefined") {
  window.addEventListener("profile-pic-updated", (event) => {
    invalidateProfilePicture(event?.detail?.username || "");
  });
}
