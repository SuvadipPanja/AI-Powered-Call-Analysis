/**
 * Global API rate limiter (Sprint 2). Login/upload keep their own stricter limiters.
 * Sprint 3: Redis-backed counters when REDIS_URL is available.
 *
 * Designed for 500+ concurrent agents:
 *  - Counters are keyed PER AUTHENTICATED USER (hash of the session token), so one
 *    user can never consume another user's budget, regardless of shared NAT IPs.
 *  - Anonymous traffic is keyed by client IP (IPv6-safe).
 *  - Cheap, high-frequency polling/session endpoints are exempt so normal app
 *    activity (upload-status polling, recent-activity reloads, session heartbeats)
 *    never trips the limiter. These remain protected by auth + their own logic.
 *  - The per-user budget is generous and env-tunable (API_RATE_LIMIT_MAX).
 */
const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { createRedisRateLimitStore } = require("../services/rateLimitStore");

// Paths are mount-relative (the limiter is mounted at "/api", so "/license-status"
// here matches a request to "/api/license-status").
const GLOBAL_SKIP_PATHS = new Set([
  "/system-monitor/health",
  "/verify-license",
  "/license-status",
  "/public/branding",
  "/branding/logo",
  // High-frequency, low-cost, auth-protected polls used by every logged-in page.
  // Exempting them keeps the global budget for "real" work and prevents the
  // "Too many requests" banner during normal usage.
  "/check-session",
  "/verify-session",
  "/update-session-inactive-time",
  "/recent-activity",
]);

// Prefix matches for parameterised / family routes that poll frequently.
const GLOBAL_SKIP_PREFIXES = ["/audio-status", "/internal/"];

/** Stable per-client key: hashed session token for users, IP for anonymous. */
function clientKey(req) {
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      // Full-token hash → collision-free per-user bucket, with no token material
      // ending up in Redis keys or logs.
      return "u:" + crypto.createHash("sha256").update(token).digest("hex").slice(0, 32);
    }
  }
  // Anonymous: key by IP. ipKeyGenerator normalises IPv6 (and silences the v7
  // validation warning about custom IP key generators).
  const ip = req.ip || "anonymous";
  if (typeof rateLimit.ipKeyGenerator === "function") {
    try {
      return "ip:" + rateLimit.ipKeyGenerator(ip);
    } catch {
      /* fall through */
    }
  }
  return "ip:" + ip;
}

function createGlobalApiLimiter() {
  const max = parseInt(process.env.API_RATE_LIMIT_MAX || "1000", 10);
  const windowMs = parseInt(process.env.API_RATE_LIMIT_WINDOW_MS || "60000", 10);

  return rateLimit({
    windowMs,
    max: Number.isFinite(max) && max > 0 ? max : 1000,
    message: { success: false, message: "Too many requests. Please slow down." },
    standardHeaders: true,
    legacyHeaders: false,
    store: createRedisRateLimitStore(windowMs),
    skip: (req) => {
      if (req.method === "OPTIONS") return true;
      if (GLOBAL_SKIP_PATHS.has(req.path)) return true;
      if (GLOBAL_SKIP_PREFIXES.some((p) => req.path.startsWith(p))) return true;
      return false;
    },
    keyGenerator: clientKey,
  });
}

module.exports = { createGlobalApiLimiter };
