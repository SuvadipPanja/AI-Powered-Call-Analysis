import apiClient from "./apiClient";
import { apiUrl } from "./apiUrl";

export { apiUrl };

function throwApiError(label, err) {
  const status = err?.response?.status;
  const body = err?.response?.data;
  const msg = body?.message || body?.error;
  const error = new Error(msg || `${label}: HTTP ${status || "network"}`);
  if (status) error.status = status;
  throw error;
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
  try {
    const { data } = await apiClient.get(path, {
      params: params instanceof URLSearchParams ? Object.fromEntries(params) : params,
      signal,
    });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** GET JSON when query string is already built (e.g. dashboard filter qs). */
export async function apiGetQuery(path, queryString = "", { label, signal } = {}) {
  const url = queryString ? `${path}?${queryString}` : path;
  return apiGet(url, { label, signal });
}

/** POST JSON body, return parsed JSON response. */
export async function apiPost(path, body, { label, signal } = {}) {
  try {
    const { data } = await apiClient.post(path, body ?? {}, { signal });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** PUT JSON body. */
export async function apiPut(path, body, { label, signal } = {}) {
  try {
    const { data } = await apiClient.put(path, body ?? {}, { signal });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** PATCH JSON body. */
export async function apiPatch(path, body, { label, signal } = {}) {
  try {
    const { data } = await apiClient.patch(path, body ?? {}, { signal });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** DELETE. */
export async function apiDelete(path, { label, signal } = {}) {
  try {
    const { data } = await apiClient.delete(path, { signal });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** POST multipart/form-data (file uploads). */
export async function apiPostForm(path, formData, { label, signal, onUploadProgress } = {}) {
  try {
    const { data } = await apiClient.post(path, formData, {
      signal,
      onUploadProgress,
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** POST JSON body, return parsed JSON + HTTP status (for admin actions that inspect status). */
export async function apiPostWithStatus(path, body, { label, signal } = {}) {
  try {
    const { data, status } = await apiClient.post(path, body ?? {}, { signal });
    return { ...data, _httpStatus: status };
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** POST JSON body, return response blob (exports). */
export async function apiPostBlob(path, body, { label, signal } = {}) {
  try {
    const { data } = await apiClient.post(path, body ?? {}, {
      signal,
      responseType: "blob",
    });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** GET binary response (exports, blobs). */
export async function apiGetBlob(path, { params, label, signal } = {}) {
  try {
    const { data } = await apiClient.get(path, {
      params: params instanceof URLSearchParams ? Object.fromEntries(params) : params,
      signal,
      responseType: "blob",
    });
    return data;
  } catch (err) {
    throwApiError(label || path, err);
  }
}

/** GET for report endpoints — returns null instead of throwing on failure. */
export async function apiGetReport(path, params, label) {
  try {
    return await apiGet(path, {
      params: params instanceof URLSearchParams ? params : params,
      label: label || path,
    });
  } catch (err) {
    console.error(`[API] ${label || path} failed:`, err.message);
    return null;
  }
}
