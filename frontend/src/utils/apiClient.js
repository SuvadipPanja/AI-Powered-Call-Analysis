import axios from "axios";
import config from "./envConfig";
import { clearAuthStorage } from "./uiPreferences";

/**
 * Central API client + global auth wiring.
 *
 * `apiClient` is an axios instance with the API base URL and an automatic
 * Authorization header. `installAuthInterceptors()` additionally patches the
 * default axios instance and the global `fetch` so that every existing direct
 * call in the app carries the session token without per-call changes. A 401
 * response clears the session and redirects to login.
 */

const getToken = () =>
  localStorage.getItem("token") || localStorage.getItem("sessionToken") || "";

const apiClient = axios.create({ baseURL: config.apiBaseUrl });

// Session/bootstrap endpoints may return 401 without requiring a global logout sweep.
const AUTH_401_EXEMPT_PATHS = [
  "/api/check-session",
  "/api/verify-session",
  "/api/login",
  "/api/login-security",
  "/api/logout-track",
];

function shouldForceLogoutOn401(url = "") {
  const normalized = String(url);
  return !AUTH_401_EXEMPT_PATHS.some((path) => normalized.includes(path));
}

let handling401 = false;
function handleUnauthorized(url = "") {
  if (!shouldForceLogoutOn401(url)) return;
  if (handling401) return;
  handling401 = true;
  try {
    clearAuthStorage();
  } catch (_) {
    /* ignore */
  }
  if (!window.location.pathname.startsWith("/login")) {
    window.location.assign("/login");
  }
}

apiClient.interceptors.request.use((cfg) => {
  const token = getToken();
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});
apiClient.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err?.response?.status === 401) {
      handleUnauthorized(err?.config?.url || "");
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
    if (resp.status === 401 && isApi) handleUnauthorized(url);
    return resp;
  };
}

export default apiClient;

export { apiUrl, apiGet, apiGetQuery, apiPost, parseApiJson, parseReportResponse } from "./apiHelpers";
