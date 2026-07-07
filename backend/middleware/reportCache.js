/**
 * Cache GET responses for heavy report/dashboard queries (Sprint 3.4).
 */
const crypto = require("crypto");
const cacheService = require("../services/cacheService");

const DEFAULT_TTL_SEC = parseInt(process.env.REPORT_CACHE_TTL_SEC || "60", 10);

const CACHEABLE_PREFIXES = [
  "/metrics-overview",
  "/reports/",
  "/tone-analysis-7days",
  "/dashboard/",
];

function shouldCache(req) {
  if (req.method !== "GET") return false;
  const path = req.path || "";
  return CACHEABLE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function buildCacheKey(req) {
  const scope = req.reportScope?.cacheKey || req.user?.username || "anon";
  const role = req.user?.accountType || "unknown";
  const qs = req.originalUrl.includes("?")
    ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
    : "";
  const raw = `${req.path}|${scope}|${role}|${qs}`;
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function createReportCacheMiddleware({ ttlSec = DEFAULT_TTL_SEC } = {}) {
  return async function reportCache(req, res, next) {
    if (!shouldCache(req)) return next();

    const key = buildCacheKey(req);
    try {
      const cached = await cacheService.get(key);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        return res.status(200).json(cached);
      }
    } catch {
      /* proceed without cache */
    }

    res.setHeader("X-Cache", "MISS");
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 200 && body && body.success !== false) {
        cacheService.set(key, body, ttlSec).catch(() => {});
      }
      return originalJson(body);
    };
    return next();
  };
}

module.exports = { createReportCacheMiddleware, shouldCache, buildCacheKey };
