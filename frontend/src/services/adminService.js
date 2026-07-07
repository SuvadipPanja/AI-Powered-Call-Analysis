import { apiDelete, apiGet, apiPost, apiPostForm, apiPut } from "../utils/apiHelpers";

export async function getAdminSettings() {
  return apiGet("/api/admin/settings", { label: "admin-settings" });
}

export async function saveAdminSettings(settings) {
  return apiPut("/api/admin/settings", { settings }, { label: "admin-settings-save" });
}

export async function getBackupHistory() {
  return apiGet("/api/admin/backup-history", { label: "backup-history" });
}

export async function triggerBackup() {
  return apiPost("/api/admin/backup", {}, { label: "admin-backup" });
}

export async function uploadLogo(formData) {
  return apiPostForm("/api/admin/logo", formData, { label: "admin-logo" });
}

export async function listAdminLocations() {
  return apiGet("/api/admin/locations", { label: "admin-locations" });
}

export async function createAdminLocation(locationName) {
  return apiPost("/api/admin/locations", { locationName }, { label: "admin-locations-create" });
}

export async function updateAdminLocation(id, body) {
  return apiPut(`/api/admin/locations/${id}`, body, { label: "admin-locations-update" });
}

export async function deleteAdminLocation(id) {
  return apiDelete(`/api/admin/locations/${id}`, { label: "admin-locations-delete" });
}

export async function getSystemMonitor(metrics) {
  return apiGet("/api/system-monitor", {
    params: { metrics, cache: false, timestamp: Date.now() },
    label: "system-monitor",
  });
}

export async function getBankSettings() {
  return apiGet("/api/admin/bank-settings", { label: "bank-settings" });
}

export async function saveBankSettings(payload) {
  return apiPut("/api/admin/bank-settings", payload, { label: "bank-settings-save" });
}

export async function listQueryCategoriesAdmin() {
  return apiGet("/api/query-categories", { label: "query-categories-admin" });
}

export async function createQueryCategory(payload) {
  return apiPost("/api/query-categories", payload, { label: "query-categories-create" });
}

export async function updateQueryCategory(id, payload) {
  return apiPut(`/api/query-categories/${id}`, payload, { label: "query-categories-update" });
}

export async function deleteQueryCategory(id) {
  return apiDelete(`/api/query-categories/${id}`, { label: "query-categories-delete" });
}
