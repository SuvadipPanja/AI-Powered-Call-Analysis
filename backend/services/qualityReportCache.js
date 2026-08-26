/**
 * Cache key + size guards for the official ICICI HFC quality workbook.
 * Bytes live in Redis / memory via cacheService.getBuffer — never JSON.
 */
const crypto = require("crypto");

const MAX_BUFFER_BYTES = 32 * 1024 * 1024;
const TTL_SEC = parseInt(process.env.QUALITY_REPORT_CACHE_TTL_SEC || "600", 10);
const inflight = new Map();

function fingerprintMaxDate(value) {
  if (value == null || value === "") return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 19);
  return d.toISOString().slice(0, 19);
}

function buildQualityCacheKey({
  role,
  fromDate,
  toDate,
  location,
  tl,
  agent,
  callType,
  callCount,
  maxDate,
  rubricKeys,
}) {
  const raw = [
    "quality-report-v2",
    String(role || ""),
    String(fromDate || ""),
    String(toDate || ""),
    String(location || "All"),
    String(tl || "All"),
    String(agent || "All"),
    String(callType || "All"),
    String(callCount ?? ""),
    fingerprintMaxDate(maxDate),
    String(rubricKeys || ""),
  ].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex");
}

function shouldStoreWorkbook(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length > 0 && buffer.length <= MAX_BUFFER_BYTES;
}

function rubricKeyList(dims) {
  return (Array.isArray(dims) ? dims : [])
    .filter((d) => d && d.enabled !== false)
    .map((d) => d.key || d.label || "")
    .filter(Boolean)
    .join(",");
}

function takeQualityBuild(key) {
  return inflight.get(key) || null;
}

function rememberQualityBuild(key, promise) {
  const tracked = Promise.resolve(promise).finally(() => {
    if (inflight.get(key) === tracked) inflight.delete(key);
  });
  inflight.set(key, tracked);
  return tracked;
}

module.exports = {
  MAX_BUFFER_BYTES,
  TTL_SEC,
  buildQualityCacheKey,
  fingerprintMaxDate,
  shouldStoreWorkbook,
  rubricKeyList,
  takeQualityBuild,
  rememberQualityBuild,
};
