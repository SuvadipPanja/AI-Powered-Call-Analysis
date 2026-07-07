// envConfig.js
// create-react-app loads REACT_APP_* at build time; runtime getters allow same-origin
// API when the UI is served from the frontend nginx container (port 8081).

function resolveApiBaseUrl() {
  const fromEnv = (process.env.REACT_APP_API_BASE_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin;
  }
  return "http://localhost:5000";
}

function resolveWsUrl() {
  const fromEnv = (process.env.REACT_APP_WS_URL || "").trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location?.hostname) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:8080`;
  }
  return "ws://localhost:8080";
}

const config = {
  get apiBaseUrl() {
    return resolveApiBaseUrl();
  },
  logDir: process.env.REACT_APP_LOG_DIR || "./logs",
  env: process.env.REACT_APP_ENV || "development",
  loginBackgroundUrl: process.env.REACT_APP_LOGIN_BACKGROUND_URL || "/images/background.jpg",
  get wsUrl() {
    return resolveWsUrl();
  },
};

export default config;
