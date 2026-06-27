import config from "./envConfig";

/** Build absolute API URL from a path like `/api/locations`. */
export function apiUrl(path = "") {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${config.apiBaseUrl}${normalized}`;
}

/** Parse JSON from a fetch Response; throws on HTTP or non-JSON body. */
export async function parseApiJson(response, label = "API") {
  if (!response.ok) {
    throw new Error(`${label}: HTTP ${response.status}`);
  }
  const contentType = response.headers.get("content-type");
  if (!contentType || !contentType.includes("application/json")) {
    throw new Error(`${label}: response is not JSON`);
  }
  return response.json();
}

/**
 * Parse JSON for report/dashboard calls that tolerate failure (returns null + logs).
 * Matches legacy ReportDetails parseReportResponse behaviour.
 */
export async function parseReportResponse(response, label = "API") {
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.error(`[API] ${label} failed: HTTP ${response.status}`, body);
    return null;
  }
  return response.json();
}

/** GET JSON — path is `/api/...`; params is a plain object or URLSearchParams. */
export async function apiGet(path, { params, label, signal } = {}) {
  let url = apiUrl(path);
  if (params) {
    const qs = params instanceof URLSearchParams
      ? params.toString()
      : new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  const response = await fetch(url, { signal });
  return parseApiJson(response, label || path);
}

/** GET JSON when query string is already built (e.g. dashboard filter qs). */
export async function apiGetQuery(path, queryString = "", { label, signal } = {}) {
  const url = queryString ? `${apiUrl(path)}?${queryString}` : apiUrl(path);
  const response = await fetch(url, { signal });
  return parseApiJson(response, label || path);
}

/** POST JSON body, return parsed JSON response. */
export async function apiPost(path, body, { label, signal } = {}) {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
    signal,
  });
  return parseApiJson(response, label || path);
}

/** GET for report endpoints — returns null instead of throwing on failure. */
export async function apiGetReport(path, params, label) {
  let url = apiUrl(path);
  if (params) {
    const qs = params instanceof URLSearchParams
      ? params.toString()
      : new URLSearchParams(params).toString();
    if (qs) url += `?${qs}`;
  }
  return parseReportResponse(await fetch(url), label || path);
}
