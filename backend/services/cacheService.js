/**
 * TTL cache — Redis when available, otherwise in-process Map (Sprint 3.4).
 */
const NodeCache = require("node-cache");
const { getRedis } = require("./redisClient");

const memory = new NodeCache({
  stdTTL: parseInt(process.env.REPORT_CACHE_TTL_SEC || "60", 10),
  checkperiod: 120,
  useClones: false,
});

const PREFIX = "sp:cache:";

async function get(key) {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      /* fall through */
    }
  }
  return memory.get(key) ?? null;
}

async function set(key, value, ttlSec) {
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0
    ? ttlSec
    : parseInt(process.env.REPORT_CACHE_TTL_SEC || "60", 10);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(PREFIX + key, JSON.stringify(value), { EX: ttl });
      return;
    } catch {
      /* fall through */
    }
  }
  memory.set(key, value, ttl);
}

async function del(key) {
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(PREFIX + key);
    } catch {
      /* ignore */
    }
  }
  memory.del(key);
}

module.exports = { get, set, del };
