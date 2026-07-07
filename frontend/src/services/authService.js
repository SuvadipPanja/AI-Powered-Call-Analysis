import apiClient from "../utils/apiClient";
import { apiGet, apiPost } from "../utils/apiHelpers";

export async function checkLoginAvailability() {
  return apiGet("/api/check-login-availability", { label: "check-login-availability" });
}

export async function loginSecurity(body) {
  return apiPost("/api/login-security", body, { label: "login-security" });
}

export async function tempSuperAdminLogin(body) {
  return apiPost("/api/temp-super-admin-login", body, { label: "temp-super-admin-login" });
}

export async function getSecurityQuestionType(body) {
  return apiPost("/api/get-security-question-type", body, { label: "get-security-question-type" });
}

export async function resetPassword(body) {
  return apiPost("/api/reset-password", body, { label: "reset-password" });
}

/** Returns session payload; never throws — callers decide logout vs keep session. */
export async function checkSession(userId, token) {
  try {
    const { data, status } = await apiClient.post("/api/check-session", { userId, token });
    return { ...data, _httpStatus: status };
  } catch (err) {
    const status = err?.response?.status ?? 0;
    const data = err?.response?.data ?? { success: false, message: err.message };
    return { ...data, _httpStatus: status };
  }
}

export async function updateSessionInactiveTime(body) {
  return apiPost("/api/update-session-inactive-time", body, { label: "update-session-inactive-time" });
}

/** Admin-configured session policy (idle timeout). Never throws. */
export async function getSessionConfig() {
  try {
    return await apiGet("/api/session-config", { label: "session-config" });
  } catch {
    return { success: false };
  }
}

export async function logoutTrack(body) {
  return apiPost("/api/logout-track", body, { label: "logout-track" });
}

export async function invalidateExistingSessions(body) {
  return apiPost("/api/invalidate-existing-sessions", body, { label: "invalidate-existing-sessions" });
}
