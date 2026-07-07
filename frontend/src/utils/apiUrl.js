import config from "./envConfig";

/** Build absolute API URL from a path like `/api/locations`. */
export function apiUrl(path = "") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${config.apiBaseUrl}${normalized}`;
}
