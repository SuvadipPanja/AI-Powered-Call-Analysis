/**
 * TTL cache — Redis when available, otherwise in-process Map (Sprint 3.4).
 */
const NodeCache = require("node-cache");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { getRedis } = require("./redisClient");

const memory = new NodeCache({
  stdTTL: parseInt(process.env.REPORT_CACHE_TTL_SEC || "60", 10),
  checkperiod: 120,
  useClones: false,
});

const PREFIX = "sp:cache:";
/** Base64 payload — node-redis GET returns a string; raw binary was never read back as a Buffer. */
const BIN_PREFIX = "sp:cache:b64:";
const FILE_DIR = process.env.QUALITY_CACHE_DIR
  || path.join(os.tmpdir(), "sp-quality-cache");

function encodeCacheBuffer(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString("base64") : "";
}

function decodeCacheBuffer(raw) {
  if (!raw) return null;
  if (Buffer.isBuffer(raw)) return raw.length ? raw : null;
  if (typeof raw === "string") {
    const buf = Buffer.from(raw, "base64");
    return buf.length ? buf : null;
  }
  return null;
}

function fileCachePaths(key) {
  const safe = String(key).replace(/[^a-fA-F0-9_-]/g, "").slice(0, 80) || "unknown";
  return {
    data: path.join(FILE_DIR, `${safe}.bin`),
    exp: path.join(FILE_DIR, `${safe}.exp`),
  };
}

function readFileCache(key) {
  try {
    const files = fileCachePaths(key);
    const exp = Number(fs.readFileSync(files.exp, "utf8"));
    if (!Number.isFinite(exp) || Date.now() > exp) return null;
    const buf = fs.readFileSync(files.data);
    return buf && buf.length ? buf : null;
  } catch {
    return null;
  }
}

function writeFileCache(key, buffer, ttlSec) {
  try {
    fs.mkdirSync(FILE_DIR, { recursive: true });
    const files = fileCachePaths(key);
    fs.writeFileSync(files.data, buffer);
    fs.writeFileSync(files.exp, String(Date.now() + ttlSec * 1000));
  } catch {
    /* disk cache is optional */
  }
}

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

async function getBuffer(key) {
  const local = memory.get(`bin:${key}`);
  if (local && local.length) {
    return Buffer.isBuffer(local) ? local : Buffer.from(local);
  }

  const fromDisk = readFileCache(key);
  if (fromDisk && fromDisk.length) {
    memory.set(`bin:${key}`, fromDisk);
    return fromDisk;
  }

  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(BIN_PREFIX + key);
      const buf = decodeCacheBuffer(raw);
      if (buf && buf.length) {
        memory.set(`bin:${key}`, buf);
        return buf;
      }
    } catch {
      /* memory miss */
    }
  }
  return null;
}

async function setBuffer(key, buffer, ttlSec) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) return;
  const ttl = Number.isFinite(ttlSec) && ttlSec > 0
    ? ttlSec
    : parseInt(process.env.REPORT_CACHE_TTL_SEC || "60", 10);

  memory.set(`bin:${key}`, buffer, ttl);
  writeFileCache(key, buffer, ttl);

  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(BIN_PREFIX + key, encodeCacheBuffer(buffer), { EX: ttl });
    } catch {
      /* process memory already holds the workbook */
    }
  }
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

module.exports = { get, set, del, getBuffer, setBuffer, encodeCacheBuffer, decodeCacheBuffer, _memory: memory };
