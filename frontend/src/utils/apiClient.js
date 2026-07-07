import axios from "axios";
import config from "./envConfig";
import { clearAuthStorage } from "./uiPreferences";
import { getAuthToken, readSession } from "./authSession";

/**
 * Central API client + global auth wiring.
 *
 * `apiClient` is an axios instance with the API base URL and an automatic
 * Authorization header. `installAuthInterceptors()` additionally patches the
 * default axios instance and the global `fetch` so that every existing direct
 * call in the app carries the session token without per-call changes. A 401
 * response clears the session and redirects to login.
 */

const getToken = () => getAuthToken();

const apiClient = axios.create();

// Session/bootstrap endpoints may return 401 without requiring a global logout sweep.
const AUTH_401_EXEMPT_PATHS = [
  "/api/check-session",
  "/api/verify-session",
  "/api/login-security",
  "/api/logout-track",
];

function shouldForceLogoutOn401(url = "") {
  const normalized = String(url);
  return !AUTH_401_EXEMPT_PATHS.some((path) => normalized.includes(path));
}

let handling401 = false;
let authInterceptorReady = false;

/** Called by AuthProvider after session restore — avoids 401 storms logging out mid-bootstrap. */
export function setAuthInterceptorReady(ready = true) {
  authInterceptorReady = Boolean(ready);
}

export function isAuthInterceptorReady() {
  return authInterceptorReady;
}

async function confirmSessionDead() {
  const { userId, token, sessionToken } = readSession();
  const authToken = token || sessionToken;
  if (!userId || !authToken) return true;
  try {
    const response = await fetch(`${config.apiBaseUrl}/api/check-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, token: authToken }),
    });
    if (response.status >= 500) return false;
    const data = await response.json();
    return !data.success;
  } catch {
    return false;
  }
}

async function handleUnauthorized(url = "") {
  if (!authInterceptorReady) return;
  if (!shouldForceLogoutOn401(url)) return;
  if (handling401) return;
  handling401 = true;
  try {
    const dead = await confirmSessionDead();
    if (!dead) {
      handling401 = false;
      return;
    }
    clearAuthStorage();
    if (!window.location.pathname.startsWith("/login")) {
      window.location.assign("/login");
    }
  } catch {
    handling401 = false;
  }
}

function notifyGraceReadOnly(responseBody, url = "") {
  const code = responseBody?.code;
  if (code !== "LICENSE_GRACE_READ_ONLY") return;
  window.dispatchEvent(new CustomEvent("license-grace-blocked", {
    detail: {
      message: responseBody?.message || "License expired — the system is in read-only grace mode.",
      url,
    },
  }));
}

async function handleGraceReadOnlyResponse(response, url = "") {
  if (response?.status !== 423) return false;
  try {
    const body = await response.clone().json();
    notifyGraceReadOnly(body, url);
  } catch {
    notifyGraceReadOnly({ code: "LICENSE_GRACE_READ_ONLY" }, url);
  }
  return true;
}

apiClient.interceptors.request.use((cfg) => {
  cfg.baseURL = config.apiBaseUrl;
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      handleUnauthorized(err?.config?.url || "");
    } else if (err?.response?.status === 423) {
      notifyGraceReadOnly(err?.response?.data, err?.config?.url || "");
    }
    return Promise.reject(err);
  }
);

let installed = false;

/** Wire token attachment + 401 handling onto global axios and fetch. */
export function installAuthInterceptors() {
  if (installed) return;
  installed = true;

  // Global axios (used by most components directly).
  axios.interceptors.request.use((cfg) => {
    if (!cfg.baseURL) cfg.baseURL = config.apiBaseUrl;
    const token = getToken();
    if (token && !cfg.headers?.Authorization) {
      cfg.headers = cfg.headers || {};
      cfg.headers.Authorization = `Bearer ${token}`;
    }
    return cfg;
  });
  axios.interceptors.response.use(
    (r) => r,
    (err) => {
      if (err?.response?.status === 401) {
        handleUnauthorized(err?.config?.url || "");
      } else if (err?.response?.status === 423) {
        notifyGraceReadOnly(err?.response?.data, err?.config?.url || "");
      }
      return Promise.reject(err);
    }
  );

  // Global fetch interceptor for authenticated API requests.
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const token = getToken();
    const url = typeof input === "string" ? input : input?.url || "";
    const isApi = url.includes("/api/") || url.startsWith(config.apiBaseUrl);
    if (token && isApi) {
      const headers = new Headers(init.headers || (typeof input !== "string" ? input.headers : undefined) || {});
      if (!headers.has("Authorization")) headers.set("Authorization", `Bearer ${token}`);
      init = { ...init, headers };
    }
    const resp = await nativeFetch(input, init);
    if (resp.status === 401 && isApi && authInterceptorReady) handleUnauthorized(url);
    if (resp.status === 423 && isApi) await handleGraceReadOnlyResponse(resp, url);
    return resp;
  };
}

export default apiClient;
