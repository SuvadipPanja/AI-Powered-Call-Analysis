/**
 * Single read/write layer for auth session keys in localStorage.
 * AuthContext persists here; apiClient, WebSocket, and session timeout read from here.
 */

export const SESSION_KEYS = {
  isLoggedIn: "isLoggedIn",
  userId: "userId",
  username: "username",
  userType: "userType",
  token: "token",
  sessionToken: "sessionToken",
  logId: "logId",
  loginAlias: "loginAlias",
  isTempLogin: "isTempLogin",
  email: "email",
};

function readKey(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeKey(key, value) {
  try {
    if (value === null || value === undefined || value === "") {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, String(value));
    }
  } catch {
    /* ignore quota / private mode */
  }
}

/** Read the full session snapshot from storage. */
export function readSession() {
  const rawToken = readKey(SESSION_KEYS.token) || "";
  const rawSessionToken = readKey(SESSION_KEYS.sessionToken) || "";
  const token = rawToken || rawSessionToken;
  const sessionToken = rawSessionToken || rawToken;

  return {
    isLoggedIn: readKey(SESSION_KEYS.isLoggedIn) === "true",
    userId: readKey(SESSION_KEYS.userId) || "",
    username: readKey(SESSION_KEYS.username) || "",
    userType: readKey(SESSION_KEYS.userType) || "",
    token,
    sessionToken,
    logId: readKey(SESSION_KEYS.logId) || "",
    loginAlias: readKey(SESSION_KEYS.loginAlias) || "",
    isTempLogin: readKey(SESSION_KEYS.isTempLogin) === "true",
    email: readKey(SESSION_KEYS.email) || "",
  };
}

/** Bearer token for API / WebSocket (token or sessionToken). */
export function getAuthToken() {
  const { token, sessionToken } = readSession();
  return token || sessionToken || "";
}

/** Merge partial session fields into localStorage. */
export function persistSession(patch = {}) {
  if (patch.isLoggedIn !== undefined) {
    writeKey(SESSION_KEYS.isLoggedIn, patch.isLoggedIn ? "true" : "false");
  }
  if (patch.userId !== undefined) writeKey(SESSION_KEYS.userId, patch.userId);
  if (patch.username !== undefined) writeKey(SESSION_KEYS.username, patch.username);
  if (patch.userType !== undefined) writeKey(SESSION_KEYS.userType, patch.userType);
  if (patch.token !== undefined) writeKey(SESSION_KEYS.token, patch.token);
  if (patch.sessionToken !== undefined) writeKey(SESSION_KEYS.sessionToken, patch.sessionToken);
  if (patch.logId !== undefined) writeKey(SESSION_KEYS.logId, patch.logId);
  if (patch.loginAlias !== undefined) writeKey(SESSION_KEYS.loginAlias, patch.loginAlias);
  if (patch.email !== undefined) writeKey(SESSION_KEYS.email, patch.email);
  if (patch.isTempLogin === true) {
    writeKey(SESSION_KEYS.isTempLogin, "true");
  } else if (patch.isTempLogin === false) {
    localStorage.removeItem(SESSION_KEYS.isTempLogin);
  }
}

/** Alias for profile / settings updates (email, username). */
export function patchSession(patch) {
  persistSession(patch);
}

/** Build session payload after standard login API response. */
export function buildLoginSession(data, loginUserId) {
  const sessionUserId = data.userId || loginUserId;
  const token = data.token || data.sessionToken || "";
  return {
    isLoggedIn: true,
    userId: sessionUserId,
    loginAlias: loginUserId,
    username: data.username,
    userType: data.userType,
    token,
    sessionToken: data.sessionToken || token,
    logId: data.logId != null ? String(data.logId) : "",
    isTempLogin: false,
  };
}

/** Build session payload after temp super-admin login. */
export function buildTempLoginSession({ username, userType, logId, sessionToken, userId }) {
  const tok = sessionToken || "";
  return {
    isLoggedIn: true,
    userId: userId || username,
    username,
    userType,
    token: tok,
    sessionToken: tok,
    logId: logId != null ? String(logId) : "",
    isTempLogin: true,
  };
}
