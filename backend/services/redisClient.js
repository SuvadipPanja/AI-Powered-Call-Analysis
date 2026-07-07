/**
 * Redis client (Sprint 3). Uses REDIS_URL when set; degrades gracefully if unavailable.
 */
const { createClient } = require("redis");

let client = null;
let ready = false;
let connectPromise = null;

function getRedisUrl() {
  return String(process.env.REDIS_URL || "").trim();
}

async function initRedis() {
  const url = getRedisUrl();
  if (!url) {
    console.log("[INFO] REDIS_URL not set — using in-memory cache and rate limits.");
    return false;
  }
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      client = createClient({ url });
      client.on("error", (err) => {
        console.warn("[WARN] Redis error:", err.message);
        ready = false;
      });
      client.on("reconnecting", () => {
        console.log("[INFO] Redis reconnecting…");
      });
      await client.connect();
      ready = true;
      console.log("[INFO] Redis connected:", url.replace(/:[^:@/]+@/, ":***@"));
      return true;
    } catch (err) {
      console.warn("[WARN] Redis unavailable — falling back to in-memory:", err.message);
      client = null;
      ready = false;
      return false;
    }
  })();

  return connectPromise;
}

function isRedisReady() {
  return ready && client?.isOpen;
}

function getRedis() {
  return isRedisReady() ? client : null;
}

async function closeRedis() {
  if (client?.isOpen) {
    await client.quit().catch(() => {});
  }
  client = null;
  ready = false;
  connectPromise = null;
}

module.exports = { initRedis, isRedisReady, getRedis, closeRedis, getRedisUrl };
