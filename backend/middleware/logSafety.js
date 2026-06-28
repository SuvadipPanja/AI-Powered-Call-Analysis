/**
 * Log redaction helpers — never write tokens, passwords, or security answers to disk/WS.
 */

const SENSITIVE_KEYS = new Set([
  "password",
  "newpassword",
  "oldpassword",
  "confirmpassword",
  "passwordhash",
  "password_hash",
  "token",
  "sessiontoken",
  "x-session-token",
  "refreshtoken",
  "secretkey",
  "licensekey",
  "questionanswer",
  "securityquestionanswer",
  "securityanswer",
  "authorization",
  "cookie",
  "set-cookie",
  "orchestrator_secret",
  "callback_secret",
  "service_token",
  "upload_service_token",
  "license_secret_key",
  "jwt_secret",
  "session_secret",
  "db_password",
  "sa_password",
  "mssql_sa_password",
  "apikey",
  "api_key",
  "openai_api_key",
]);

const SENSITIVE_URL_RE =
  /\/api\/(login|login-security|reset-password|temp-super-admin-login|user\/.*\/password|get-security-question-type|verify-license|upload-license|refresh-session)/i;

const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;
const JWT_LIKE_RE = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function redactSensitive(value) {
  if (value == null) return value;
  if (typeof value === "string") {
    return value.replace(BEARER_RE, "Bearer [REDACTED]").replace(JWT_LIKE_RE, "[REDACTED_TOKEN]");
  }
  if (Array.isArray(value)) return value.map(redactSensitive);
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEYS.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else {
      out[k] = redactSensitive(v);
    }
  }
  return out;
}

function sanitizeLogPayload(data) {
  if (data == null) return data;
  if (typeof data === "string") {
    if (data.length > 4000) {
      return `${redactSensitive(data.slice(0, 4000))}…[truncated]`;
    }
    return redactSensitive(data);
  }
  try {
    const parsed = typeof data === "object" ? data : JSON.parse(String(data));
    return JSON.stringify(redactSensitive(parsed));
  } catch {
    return redactSensitive(String(data).slice(0, 4000));
  }
}

function isSensitiveUrl(url = "") {
  return SENSITIVE_URL_RE.test(url);
}

function shouldBroadcastLogsToWebSocket() {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") return false;
  return String(process.env.WS_LOG_BROADCAST || "false").toLowerCase() === "true";
}

function sanitizeLogMessage(message) {
  return String(message)
    .replace(BEARER_RE, "Bearer [REDACTED]")
    .replace(JWT_LIKE_RE, "[REDACTED_TOKEN]");
}

module.exports = {
  SENSITIVE_KEYS,
  SENSITIVE_URL_RE,
  redactSensitive,
  sanitizeLogPayload,
  sanitizeLogMessage,
  isSensitiveUrl,
  shouldBroadcastLogsToWebSocket,
};
