import { apiGet, apiPost } from "../utils/apiHelpers";

export async function getLicenseStatus() {
  return apiGet("/api/license-status", { label: "license-status" });
}

export async function verifyLicense() {
  return apiPost("/api/verify-license", {}, { label: "verify-license" });
}

export async function getLicenseHistory(username) {
  return apiGet("/api/license-history", {
    params: { username: username || "" },
    label: "license-history",
  });
}

export async function uploadLicense(username, licenseKey) {
  return apiPost("/api/upload-license", { username, licenseKey }, { label: "upload-license" });
}

export async function getLicenseDetails(username, licenseKey) {
  return apiPost("/api/license-details", { username, licenseKey }, { label: "license-details" });
}
