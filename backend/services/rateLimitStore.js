/**
 * Redis-backed store for express-rate-limit (Sprint 3.2).
 * Falls back to in-memory counters when Redis is unavailable.
 */
const { getRedis } = require("./redisClient");

const PREFIX = "sp:rl:";
const memory = new Map();

function memoryIncrement(key, windowMs) {
  const now = Date.now();
  let entry = memory.get(key);
  if (!entry || entry.resetTime <= now) {
    entry = { totalHits: 0, resetTime: now + windowMs };
    memory.set(key, entry);
  }
  entry.totalHits += 1;
  return { totalHits: entry.totalHits, resetTime: new Date(entry.resetTime) };
}

function createRedisRateLimitStore(windowMs) {
  const windowSec = Math.max(1, Math.ceil(windowMs / 1000));

  return {
    init() {},
    async increment(key) {
      const redis = getRedis();
      if (!redis) {
        return memoryIncrement(key, windowMs);
      }
      try {
        const redisKey = PREFIX + key;
        const totalHits = await redis.incr(redisKey);
        if (totalHits === 1) {
          await redis.expire(redisKey, windowSec);
        }
        const ttl = await redis.ttl(redisKey);
        const resetTime = new Date(Date.now() + Math.max(ttl, 0) * 1000);
        return { totalHits, resetTime };
      } catch {
        return memoryIncrement(key, windowMs);
      }
    },
    async decrement(key) {
      const redis = getRedis();
      if (!redis) {
        const entry = memory.get(key);
        if (entry && entry.totalHits > 0) entry.totalHits -= 1;
        return;
      }
      try {
        await redis.decr(PREFIX + key);
      } catch {
        /* ignore */
      }
    },
    async resetKey(key) {
      memory.delete(key);
      const redis = getRedis();
      if (redis) {
        try {
          await redis.del(PREFIX + key);
        } catch {
          /* ignore */
        }
      }
    },
  };
}

module.exports = { createRedisRateLimitStore };
