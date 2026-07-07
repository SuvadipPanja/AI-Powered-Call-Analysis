import { apiDelete, apiGet, apiGetBlob, apiPost, apiPostForm, apiPut } from "../utils/apiHelpers";

export async function listUsers() {
  return apiGet("/api/users/list", { label: "users-list" });
}

export async function searchUsers(query) {
  return apiGet("/api/users/search", { params: { q: query }, label: "users-search" });
}

export async function deleteUser(username) {
  return apiDelete(`/api/user/${encodeURIComponent(username)}`, { label: "user-delete" });
}

export async function updateUserEmail(username, email) {
  return apiPut(`/api/user/${encodeURIComponent(username)}/email`, { email }, { label: "user-email" });
}

export async function updateUserPassword(username, newPassword) {
  return apiPut(`/api/user/${encodeURIComponent(username)}/password`, { newPassword }, { label: "user-password" });
}

export async function updateUserSecurityQuestion(username, payload) {
  return apiPut(`/api/user/${encodeURIComponent(username)}/security-question`, payload, { label: "user-security" });
}

export async function updateUserRole(username, role) {
  return apiPut(`/api/user/${encodeURIComponent(username)}/role`, { role }, { label: "user-role" });
}

export async function createUser(body) {
  return apiPost("/api/user", body, { label: "users-create" });
}

export async function getUser(username) {
  return apiGet(`/api/user/${encodeURIComponent(username)}`, { label: "user-get" });
}

export async function changeOwnPassword(username, oldPassword, newPassword) {
  return apiPut(`/api/user/${encodeURIComponent(username)}/password`, { oldPassword, newPassword }, { label: "user-password-self" });
}

export async function uploadProfilePicture(username, formData) {
  return apiPostForm(`/api/user/${encodeURIComponent(username)}/profile-picture`, formData, { label: "user-profile-pic" });
}

export async function fetchProfilePictureBlob(username) {
  return apiGetBlob(`/api/user/${encodeURIComponent(username)}/profile-picture`, { label: "user-profile-pic-blob" });
}
