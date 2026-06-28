/*****************************************************
 * File: server.js
 * Purpose: Node.js + Express server for AI-powered call analysis
 * Enhanced: Complete API endpoints preserved and reorganized,
 *           robust logging with daily log rotation and unique
 *           API call IDs, and full WebSocket integration for
 *           real-time log broadcast and chat handling.
 * Author: Suvadip Panja
 * Creation Date: May 23, 2025
 * Modified Date: June 05, 2025
 * Compliance: ISO 27001 (Secure configuration management)
 *****************************************************/

/* ===================== 1) Required Dependencies ===================== */
// Load environment variables and required Node.js modules
require('dotenv').config(); // Loads variables from .env file
// Sprint 6: hydrate secrets from Docker secret files BEFORE any module reads
// them (auth.js / dbConnection.js read process.env at require-time). File-sourced
// secrets are never visible via `docker inspect` or /proc/1/environ.
const { hydrateSecrets } = require("./config/secrets");
const __secretsFromFiles = hydrateSecrets();
const express = require("express");
const bodyParser = require("body-parser");
const sql = require("./sqlClient");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const http = require("http");
const WebSocket = require("ws");
const si = require('systeminformation');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit'); // For rate limiting
const validator = require('validator'); // For input sanitization
const crypto = require("crypto");
const os = require("os");
const { spawn } = require("child_process");
const jwt = require('jsonwebtoken');
const cache = require('memory-cache');
const NodeCache = require('node-cache');

// Import custom project modules
const uploadHandler = require("./uploadHandler");
const agentRoutes = require("./agentController");
const { createAutoUploadRouter } = require("./routes/autoUploadRoutes");
const { createAuditRouter } = require("./routes/auditRoutes");
const {
  createBankSettingsRouter,
  createBankSettingsInternalRouter,
} = require("./routes/bankSettingsRoutes");
const { createQueryCategoryRouter } = require("./routes/queryCategoryRoutes");
const { createSessionRouter } = require("./routes/sessionRoutes");
const reportHelpers = require("./services/reportHelpers");
const { createReportRouter } = require("./routes/reportRoutes");
const { createMiscRouter } = require("./routes/miscRoutes");
const autoUploadService = require("./services/autoUploadService");
const { logCallEvent, ensureSchema: ensureCallProcessingLogSchema } = require("./services/callProcessingLog");
const { runDatabaseMigrations } = require("./services/dbMigrate");
const { fetchUserForLogin, getLoginIdForSession, resolveSessionUserId } = require("./authHelper");
const { resolveAgentIdentity, assertSelfOrElevated, resolveBriefingOwnerUsernames } = require("./agentHelper");
const { assertSessionOwnership } = require("./middleware/sessionProof");
const { requireSuperAdmin } = require("./middleware/rbac");
const {
  redactSensitive,
  sanitizeLogPayload,
  sanitizeLogMessage,
  isSensitiveUrl,
  shouldBroadcastLogsToWebSocket,
} = require("./middleware/logSafety");
const { createGlobalApiLimiter } = require("./middleware/rateLimit");
const { createReportScopeMiddleware } = require("./middleware/reportScope");
const { createReportCacheMiddleware } = require("./middleware/reportCache");
const { initRedis } = require("./services/redisClient");
const { startUploadWorker } = require("./services/uploadQueue");
const { resolveProjectPath, isMissingDbObjectError } = require("./projectPaths");

// Get the host MAC address from environment variable
const hostMac = process.env.HOST_MAC;

if (hostMac) {
  console.log("🔐 Host MAC Address received from environment:", hostMac);
} else {
  console.warn("⚠️ HOST_MAC not set in environment. Backend may not be fully configured.");
}

const SECURITY_ANSWER_SALT_ROUNDS = 10;

function normalizeSecurityAnswer(answer) {
  return String(answer || "").trim().toLowerCase();
}

function isBcryptHash(value) {
  return /^\$2[aby]\$\d{2}\$/.test(String(value || ""));
}

async function hashSecurityAnswer(answer) {
  return bcrypt.hash(normalizeSecurityAnswer(answer), SECURITY_ANSWER_SALT_ROUNDS);
}

async function verifySecurityAnswer(plainAnswer, storedValue) {
  const normalized = normalizeSecurityAnswer(plainAnswer);
  const stored = String(storedValue || "");
  if (!stored) return { match: false, needsMigration: false };
  if (isBcryptHash(stored)) {
    return { match: await bcrypt.compare(normalized, stored), needsMigration: false };
  }
  const match = stored.toLowerCase() === normalized;
  return { match, needsMigration: match };
}

async function checkSecurityAnswer(pool, user, plainAnswer) {
  const { match, needsMigration } = await verifySecurityAnswer(plainAnswer, user.SecurityQuestionAnswer);
  if (!match) return false;
  if (needsMigration) {
    const hashed = await hashSecurityAnswer(plainAnswer);
    await pool.request()
      .input("answer", sql.NVarChar, hashed)
      .input("username", sql.NVarChar, user.Username)
      .query("UPDATE dbo.Users SET SecurityQuestionAnswer = @answer WHERE LOWER(Username) = LOWER(@username)");
  }
  return true;
}

/* ===================== 2) Global Variables ===================== */
function getISTTimeString() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

/** Convert tone_distribution proportions (0–1) to legacy frame counts for charts. */
function normalizeToneDistribution(dist) {
  if (!dist) return { High: 0, Medium: 0, Low: 0 };
  let high = Number(dist.High ?? 0);
  let medium = Number(dist.Medium ?? 0);
  let low = Number(dist.Low ?? 0);
  const total = high + medium + low;
  if (total > 0 && total <= 1.01) {
    const scale = 350;
    high *= scale;
    medium *= scale;
    low *= scale;
  }
  return { High: high, Medium: medium, Low: low };
}

function normalizeToneResults(results) {
  if (!results || typeof results !== "object") return results;
  for (const role of ["Agent", "Customer"]) {
    const segments = results[role];
    if (!segments || typeof segments !== "object") continue;
    for (const key of Object.keys(segments)) {
      const seg = segments[key];
      if (seg?.tone_distribution) {
        seg.tone_distribution = normalizeToneDistribution(seg.tone_distribution);
      }
    }
  }
  return results;
}

/** Map DB rows to UI status — Success only for real AI, not MVP stub or upload-only. */

// Override console.log globally to use IST
const originalConsoleLog = console.log;
console.log = (...args) => {
  originalConsoleLog(`[${getISTTimeString()}]`, ...args);
};

// Define global variables used throughout the application
const PORT = parseInt(process.env.PORT); // Server port from .env
let websocketServer = null; // WebSocket server instance
global.licensePayload = null; // Cache for license payload
global.secretKey = process.env.LICENSE_SECRET_KEY; // License secret key
global.isLicenseExpired = true; // Fail closed until startup validation succeeds
global.licenseState = "expired"; // 'active' | 'grace' | 'expired'

// Sprint 4 — license tamper-resistance helpers (opt-in; backward compatible).
const licenseSecurity = require("./services/licenseSecurity");
const { logLicenseEvent } = require("./services/licenseAudit");
const recordLicenseEvent = (evt) => logLicenseEvent(sql, connectToDatabase, evt);

/* ===================== 3) Database Configuration & Helpers ===================== */
// Database configuration and connection helpers (moved here to fix initialization error)
const config = {
  server: process.env.DB_SERVER, // Database server
  port: parseInt(process.env.DB_PORT), // Database port
  database: process.env.DB_DATABASE, // Database name
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // Encryption setting
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true', // Trust server certificate
  },
  // Production connection pool tuning. mssql caches a single global pool for
  // this config, so every sql.connect(config) call reuses these limits.
  pool: {
    max: parseInt(process.env.DB_POOL_MAX || '20', 10),
    min: parseInt(process.env.DB_POOL_MIN || '2', 10),
    idleTimeoutMillis: parseInt(process.env.DB_POOL_IDLE_MS || '30000', 10),
  },
  requestTimeout: parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '30000', 10),
};

if (process.env.DB_USE_WINDOWS_AUTH === 'true') {
  config.options.trustedConnection = true;
} else {
  config.user = process.env.DB_USER;
  config.password = process.env.DB_PASSWORD;
}

// Connect to SQL Server (alternative connection method)
const sqlConnect = async () => {
  try {
    return await sql.connect(config);
  } catch (error) {
    console.error("Database connection error:", error);
    throw error;
  }
};

// Primary database connection function
const connectToDatabase = async () => {
  try {
    return await sql.connect(config);
  } catch (error) {
    console.error("Database connection error:", error);
    throw error;
  }
};

/** Ensure Locations + AppSettings tables exist (auto-bootstrap if migration not run). */
let adminSchemaEnsured = false;
async function ensureAdminSchema() {
  if (adminSchemaEnsured) return;
  const pool = await connectToDatabase();
  await pool.request().query(`
    IF OBJECT_ID('dbo.Locations', 'U') IS NULL
    CREATE TABLE dbo.Locations (
      LocationID   INT IDENTITY(1,1) PRIMARY KEY,
      LocationName NVARCHAR(200) NOT NULL UNIQUE,
      IsActive     BIT NOT NULL DEFAULT 1,
      CreatedAt    DATETIME NOT NULL DEFAULT GETDATE(),
      UpdatedAt    DATETIME NULL
    );
  `);
  await pool.request().query(`
    IF OBJECT_ID('dbo.AppSettings', 'U') IS NULL
    BEGIN
      CREATE TABLE dbo.AppSettings (
        SettingID    INT IDENTITY(1,1) PRIMARY KEY,
        SettingKey   NVARCHAR(100) NOT NULL UNIQUE,
        SettingValue NVARCHAR(MAX) NULL,
        UpdatedAt    DATETIME NOT NULL DEFAULT GETDATE(),
        UpdatedBy    NVARCHAR(100) NULL
      );
      INSERT INTO dbo.AppSettings (SettingKey, SettingValue) VALUES
        ('app_name', 'AI-Powered Call Analysis'),
        ('app_logo_url', ''),
        ('backup_path', '');
    END
  `);
  try {
    await pool.request().query(`
      INSERT INTO dbo.Locations (LocationName)
      SELECT DISTINCT LTRIM(RTRIM(agent_location))
      FROM dbo.Agents
      WHERE agent_location IS NOT NULL AND LTRIM(RTRIM(agent_location)) <> ''
        AND LTRIM(RTRIM(agent_location)) NOT IN (SELECT LocationName FROM dbo.Locations);
    `);
  } catch (_) { /* Agents table may be empty */ }
  adminSchemaEnsured = true;
}

/* ===================== 4) Robust Logging System ===================== */
// Setup for robust logging with daily rotation and WebSocket broadcasting
const logDir = resolveProjectPath(process.env.DETAILS_LOG_DIR || '/app/logs/details');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
  console.log("[INFO] Log directory initialized at", logDir);
}

// Get log file path for the current day (YYYY-MM-DD.log)
function getLogFilePath() {
  const date = new Date();
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

  const istDate = formatter.format(date); // Safe call to format(date)
  return path.join(logDir, `${istDate}.log`);
}


// Write log message to the current day's log file (scrubs tokens/secrets).
function writeLog(message) {
  const logFilePath = getLogFilePath();
  const safeMessage = sanitizeLogMessage(message);
  fs.appendFile(logFilePath, safeMessage + "\n", (err) => {
    if (err) {
      console.error("Error writing log:", err);
    }
  });
}

reportHelpers.initReportHelpers({ writeLog, getISTTimeString });
const {
  normalizeDisplayStatus,
  buildAudioProgressPayload,
  buildProcessingSubtasks,
  resolveDisplayAiStatus,
  PROCESS_STAGE_LABELS,
  extractFailureDetails,
  mapScoringFields,
  isTerminalProcessingStatus,
  isActiveProcessingStatus,
  markStaleProcessingAsFailed,
} = reportHelpers;

// Counter for unique API call IDs
let logCounter = 0;

// Middleware to log API requests and responses
function robustLogger(req, res, next) {
  logCounter++;
  const uniqueId = logCounter;
  const startTime = new Date();
  const caller = req.user?.username || req.body?.userId || "Unknown";
  const sensitive = isSensitiveUrl(req.originalUrl);

  const originalSend = res.send;
  res.send = function (data) {
    originalSend.apply(res, arguments);
    const endTime = new Date();
    const duration = endTime - startTime;
    const logData = {
      id: uniqueId,
      timestamp: startTime.toISOString(),
      method: req.method,
      url: req.originalUrl,
      user: caller,
      requestBody: sensitive ? "[REDACTED]" : redactSensitive(req.body),
      responseStatus: res.statusCode,
      responseData: sensitive ? "[REDACTED]" : sanitizeLogPayload(data),
      duration: duration + "ms",
    };
    const logMessage = JSON.stringify(logData);
    writeLog(logMessage);

    if (websocketServer && !sensitive && shouldBroadcastLogsToWebSocket()) {
      websocketServer.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(logMessage);
        }
      });
    }
  };
  next();
}

/* ===================== 5) License Management Helpers ===================== */
// Helper functions for license validation
function getServerMacAddress() {
  // First, check if HOST_MAC environment variable is set and use it as primary source
  if (hostMac && hostMac.trim() !== "") {
    console.log("Using HOST_MAC from environment variable:", hostMac);
    return hostMac.toUpperCase();
  }

  // Fallback to system network interfaces if HOST_MAC is not available
  console.log("HOST_MAC not found in environment, retrieving from system interfaces");
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (!details.internal && details.mac !== "00:00:00:00:00:00") {
        return details.mac.toUpperCase();
      }
    }
  }
  throw new Error("No valid MAC address found from system interfaces and HOST_MAC environment variable is not set.");
}

function getServerMacAddresses() {
  const macAddresses = [];

  // First, check if HOST_MAC environment variable is set and use it as primary source
  if (hostMac && hostMac.trim() !== "") {
    console.log("Using HOST_MAC from environment variable:", hostMac);
    macAddresses.push(hostMac.toUpperCase());
    return macAddresses;
  }

  // Fallback to system network interfaces if HOST_MAC is not available
  console.log("HOST_MAC not found in environment, retrieving from system interfaces");
  const interfaces = os.networkInterfaces();

  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (!details.internal && details.mac !== "00:00:00:00:00:00") {
        macAddresses.push(details.mac.toUpperCase());
      }
    }
  }

  if (macAddresses.length === 0) {
    throw new Error("No valid MAC addresses found from system interfaces and HOST_MAC environment variable is not set.");
  }

  return macAddresses;
}

const { decodeLicense: decodeAesLicense } = require("./services/licenseCodec");

async function decodeLicense(licenseKey, secretKey) {
  try {
    const sig = licenseSecurity.assertSignedLicenseOrThrow(licenseKey);
    const payload = decodeAesLicense(sig.inner, secretKey);
    console.log("License decoded successfully");
    return payload;
  } catch (error) {
    console.error(`[${getISTTimeString()}] Decryption error: ${error.message}`);
    throw new Error("Invalid or tampered license key: " + error.message);
  }
}

/** Mark runtime license state invalid — keeps licenseGuard locked down. */
function markLicenseInvalid(reason, { event = "LICENSE_VALIDATED" } = {}) {
  global.licenseState = "expired";
  global.isLicenseExpired = true;
  global.licensePayload = null;
  const detail = String(reason || "License validation failed");
  writeLog(`[${getISTTimeString()}] ${detail}`);
  console.log(`License validation failed: ${detail}`);
  recordLicenseEvent({
    event,
    outcome: "failure",
    detail,
    fingerprint: licenseSecurity.getHardwareFingerprint(),
  });
  broadcastLicenseState(detail);
}

/* ===================== Sprint 5: v3 (Ed25519) license support ===================== */
const licenseV3 = require("./services/licenseV3");
const hardwareId = require("./services/hardwareId");
const timeGuard = require("./services/timeGuard");

/** Sprint 8 — push current license state to all live sessions (best-effort). */
function broadcastLicenseState(reason) {
  try {
    if (typeof global.wsBroadcastLicense === "function") {
      global.wsBroadcastLicense({
        state: global.licenseState || (global.isLicenseExpired ? "expired" : "active"),
        isExpired: Boolean(global.isLicenseExpired),
        reason: reason || null,
        at: new Date().toISOString(),
      });
    }
  } catch {
    /* never throw from broadcast */
  }
}

/** Normalize a verified v3 payload into the shape downstream code expects. */
function normalizeV3Payload(p) {
  return {
    ...p,
    signature: "$Panja", // compatibility marker for legacy checks
    users: p?.limits?.maxConcurrentUsers ?? 0,
    startDate: p.notBefore,
    endDate: p.notAfter,
    macAddress: Array.isArray(p?.hardware?.allowedMacs) ? p.hardware.allowedMacs[0] : undefined,
    appId: p.issuerKeyId,
    licenseVersion: 3,
    limits: p.limits || {},
    ai: p.ai || {},
  };
}

/**
 * Verify + evaluate a v3 token string against this server.
 * @returns {{ ok:boolean, reason?:string, payload?:object, evaluation?:object }}
 */
function validateV3License(raw) {
  const ver = licenseV3.verifyV3(raw);
  if (!ver.ok) return { ok: false, reason: ver.reason || "v3 signature invalid" };
  const evaluation = licenseV3.evaluateV3(ver.payload);
  return { ok: true, payload: ver.payload, evaluation };
}

/**
 * Make `licenseKey` the single active license row. Deletes ALL other rows so
 * the table holds exactly the current license (no History pile-up, and a
 * restart can never resurrect a superseded key). Works for v2 and v3 keys.
 */
async function upsertActiveLicense(pool, licenseKey, endDateIso, uploadedBy) {
  // Remove every other license so only the current one remains.
  await pool
    .request()
    .input("k", sql.NVarChar, licenseKey)
    .query("DELETE FROM Licenses WHERE LicenseKey <> @k");

  const exists = await pool
    .request()
    .input("k", sql.NVarChar, licenseKey)
    .query("SELECT COUNT(*) AS c FROM Licenses WHERE LicenseKey = @k");
  if ((exists.recordset[0]?.c || 0) > 0) {
    await pool
      .request()
      .input("k", sql.NVarChar, licenseKey)
      .input("e", sql.Date, new Date(endDateIso))
      .query("UPDATE Licenses SET IsActive = 1, EndDate = @e, UpdatedAt = GETDATE() WHERE LicenseKey = @k");
  } else {
    await pool
      .request()
      .input("k", sql.NVarChar, licenseKey)
      .input("u", sql.NVarChar, uploadedBy)
      .input("e", sql.Date, new Date(endDateIso))
      .query(
        "INSERT INTO Licenses (LicenseKey, UploadedBy, CreatedAt, IsActive, EndDate) VALUES (@k, @u, GETDATE(), 1, @e)"
      );
  }
}

/**
 * Apply a validated v3 license to runtime globals + DB. Sets fail-closed state
 * on any problem. Returns { state, warning } on success-ish (active|grace).
 */
async function applyV3License(pool, licenseKey, { uploadedBy, persistFile = false } = {}) {
  const v = validateV3License(licenseKey);
  if (!v.ok) {
    markLicenseInvalid(`v3: ${v.reason}`);
    return { state: "invalid", reason: v.reason };
  }
  const ev = v.evaluation;
  if (ev.state === "invalid") {
    markLicenseInvalid(`v3: ${ev.reason}`);
    return { state: "invalid", reason: ev.reason };
  }
  if (ev.state === "expired") {
    markLicenseInvalid("v3 license expired (grace exhausted)", { event: "LICENSE_EXPIRED" });
    return { state: "expired", reason: "expired" };
  }

  await upsertActiveLicense(pool, licenseKey, v.payload.notAfter, uploadedBy || "System");

  if (persistFile) {
    // Best-effort: persist token to file so restarts reload it. The DB row is
    // the source of truth for the running process, so a write failure (e.g.
    // read-only mount) must NOT fail the upload after the DB is updated.
    const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH || "./license/license.lic");
    try {
      const licenseDir = path.dirname(licenseFilePath);
      if (!fs.existsSync(licenseDir)) fs.mkdirSync(licenseDir, { recursive: true });
      fs.writeFileSync(licenseFilePath, licenseKey);
      writeLog(`[${getISTTimeString()}] v3 license written to file: ${licenseFilePath}`);
    } catch (writeErr) {
      writeLog(`[${getISTTimeString()}] WARN: could not persist v3 license file (${writeErr.message}). DB row is active; restart-persistence may be affected if the license dir is read-only.`);
    }
  }

  global.isLicenseExpired = ev.state !== "active";
  global.licenseState = ev.state;
  global.licensePayload = normalizeV3Payload(v.payload);

  const warning =
    ev.state === "grace"
      ? `License expired — read-only grace mode (${ev.graceRemaining} day(s) remaining).`
      : ev.daysUntilExpiry <= 6
        ? "License expires soon (within 6 days)."
        : null;

  writeLog(`[${getISTTimeString()}] v3 license validated (${ev.state})${warning ? " - " + warning : ""}`);
  console.log("License extracted successfully and payload parameters match");
  recordLicenseEvent({
    event: ev.state === "grace" ? "LICENSE_GRACE" : "LICENSE_VALIDATED",
    outcome: ev.state === "grace" ? "warning" : "success",
    detail: `v3 ${v.payload.customer || ""}; users=${v.payload?.limits?.maxConcurrentUsers}; ${warning || `${ev.daysUntilExpiry}d remaining`}`,
    actor: uploadedBy,
    fingerprint: hardwareId.getServerFingerprint() || licenseSecurity.getHardwareFingerprint(),
  });
  broadcastLicenseState(warning || `active (${ev.daysUntilExpiry}d remaining)`);
  return { state: ev.state, warning };
}

/* ===================== 6) License Management Initialization ===================== */
// Load and validate license on server startup
const loadLicenseOnStartup = async () => {
  const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH);
  const secretKey = process.env.LICENSE_SECRET_KEY;

  try {
    const licenseDir = path.dirname(licenseFilePath);
    if (!fs.existsSync(licenseDir)) {
      fs.mkdirSync(licenseDir, { recursive: true });
      writeLog(`[${getISTTimeString()}] Created license directory: ${licenseDir}`);
    }

    const pool = await connectToDatabase();

    // Source of truth = the active license row in the DB. The license FILE is
    // only a bootstrap seed used when the DB has no active license yet (fresh
    // install / file-drop deploy). This prevents a stale file from resurrecting
    // a superseded license on restart after an admin upload.
    let licenseKey = null;
    let source = "db";
    const active = await pool
      .request()
      .query("SELECT TOP 1 LicenseKey FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC");
    if (active.recordset.length && active.recordset[0].LicenseKey) {
      licenseKey = String(active.recordset[0].LicenseKey).trim();
    } else if (fs.existsSync(licenseFilePath)) {
      licenseKey = fs.readFileSync(licenseFilePath, "utf8").trim();
      source = "file";
    }

    if (!licenseKey) {
      markLicenseInvalid("No license found (DB or file)");
      return;
    }
    writeLog(`[${getISTTimeString()}] License source on startup: ${source}`);

    // Sprint 5: v3 (Ed25519) licenses are self-contained and verified with the
    // vendor public key only. applyV3License also re-syncs the file + cleans DB.
    if (licenseV3.isV3Token(licenseKey)) {
      await applyV3License(pool, licenseKey, { uploadedBy: `System (Startup:${source})`, persistFile: true });
      return;
    }

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      markLicenseInvalid("Invalid embedded signature");
      return;
    }

    // Sprint 4: hardware binding accepts legacy MAC and/or new fingerprint.
    const hw = licenseSecurity.verifyHardwareBinding(payload);
    if (!hw.ok) {
      markLicenseInvalid(hw.reason || "Hardware binding failed");
      return;
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      markLicenseInvalid(`License not yet valid until ${startDate.toISOString()}`);
      return;
    }

    // Sprint 4: grace window — expired licenses within grace boot read-only
    // instead of hard-failing, so reporting stays available during renewal.
    const verdict = licenseSecurity.evaluateExpiry(endDate, now);
    if (verdict.state === "expired") {
      markLicenseInvalid(
        `License expired ${verdict.daysOverdue} day(s) ago (grace exhausted)`,
        { event: "LICENSE_EXPIRED" }
      );
      return;
    }

    await upsertActiveLicense(pool, licenseKey, payload.endDate, `System (Startup:${source})`);

    // Keep the seed file in sync with the active license (best-effort).
    try {
      fs.writeFileSync(licenseFilePath, licenseKey);
    } catch (writeErr) {
      writeLog(`[${getISTTimeString()}] WARN: could not sync license file (${writeErr.message}).`);
    }

    global.isLicenseExpired = verdict.state !== "active";
    global.licenseState = verdict.state;
    global.licensePayload = payload;

    let warning = null;
    if (verdict.state === "grace") {
      warning = `License expired — read-only grace mode (${verdict.graceRemaining} day(s) remaining).`;
    } else {
      const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
      warning = endDate <= sixDaysFromNow ? "License expires soon (within 6 days)." : null;
    }

    writeLog(`[${getISTTimeString()}] License validated successfully${warning ? " - " + warning : ""}`);
    console.log("License extracted successfully and payload parameters match");
    recordLicenseEvent({
      event: verdict.state === "grace" ? "LICENSE_GRACE" : "LICENSE_VALIDATED",
      outcome: verdict.state === "grace" ? "warning" : "success",
      detail: warning || `Valid; ${verdict.daysUntilExpiry} day(s) remaining`,
      fingerprint: licenseSecurity.getHardwareFingerprint(),
    });
  } catch (error) {
    markLicenseInvalid(error.message);
  }
};

// Sprint 4: optional startup integrity check (opt-in via LICENSE_INTEGRITY_CHECK).
function runStartupIntegrityCheck() {
  if (String(process.env.LICENSE_INTEGRITY_CHECK || "false").toLowerCase() !== "true") return;
  const manifestPath =
    process.env.LICENSE_INTEGRITY_MANIFEST || path.join(__dirname, "integrity-manifest.json");
  const result = licenseSecurity.verifyIntegrity(__dirname, manifestPath, { requireManifest: true });
  if (!result.ok) {
    const detail = `Integrity check failed. Mismatched: [${result.mismatches.join(", ")}] Missing: [${result.missing.join(", ")}]`;
    writeLog(`[${getISTTimeString()}] ${detail}`);
    console.error(detail);
    recordLicenseEvent({ event: "INTEGRITY_CHECK", outcome: "failure", detail });
    if (String(process.env.LICENSE_INTEGRITY_ENFORCE || "false").toLowerCase() === "true") {
      console.error("Refusing to start: integrity enforcement is enabled.");
      process.exit(1);
    }
  } else {
    console.log("[integrity] Startup integrity check passed.");
  }
}

// Sprint 8 — time-tampering guard. Locks the license if the wall clock rolls
// back below the persisted high-water-mark (clock tamper / VM snapshot revert).
async function runTimeGuard(label = "startup") {
  if (!timeGuard.guardEnabled()) return;
  try {
    const pool = await connectToDatabase();
    const result = await timeGuard.checkAndAdvance(pool, sql, new Date());
    if (!result.ok) {
      writeLog(`[${getISTTimeString()}] TIME TAMPER (${label}): ${result.reason}`);
      console.error(`License locked — ${result.reason}`);
      recordLicenseEvent({ event: "TIME_TAMPER", outcome: "failure", detail: result.reason });
      // Fail closed regardless of license validity.
      global.licenseState = "expired";
      global.isLicenseExpired = true;
      global.licensePayload = null;
      broadcastLicenseState(`Time tampering detected (${result.driftMinutes} min rollback)`);
    }
  } catch (err) {
    writeLog(`[${getISTTimeString()}] Time guard error (${label}): ${err.message}`);
  }
}

// Initialize license on startup
(async () => {
  runStartupIntegrityCheck();
  await loadLicenseOnStartup();
  await runTimeGuard("startup");
  // Periodic re-check so a mid-run clock rollback is caught without a restart.
  const intervalMin = parseInt(process.env.LICENSE_TIME_GUARD_INTERVAL_MIN || "15", 10);
  if (timeGuard.guardEnabled() && intervalMin > 0) {
    setInterval(() => { runTimeGuard("interval"); }, intervalMin * 60 * 1000).unref?.();
  }
})();

/* ===================== 7) Express App & Middleware Setup ===================== */
const app = express();

// Create HTTP server
const server = http.createServer(app);

const helmet = require("helmet");
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS allowlist: comma-separated origins in CORS_ORIGIN (no wildcard).
// Dev: http://localhost:3000  |  Prod: https://your-domain.com (see .env.example).
const corsAllowlist = String(process.env.CORS_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

if (process.env.NODE_ENV === "production" && corsAllowlist.length === 0) {
  console.error("[FATAL] CORS_ORIGIN must be set to a comma-separated allowlist in production.");
  process.exit(1);
}

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin / tools (no Origin header).
    if (!origin) {
      return callback(null, true);
    }
    if (process.env.NODE_ENV === "production" && corsAllowlist.length === 0) {
      return callback(new Error("CORS is not configured"));
    }
    if (corsAllowlist.length === 0 || corsAllowlist.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Session-Token', 'X-Callback-Secret']
}));

app.use(robustLogger);

/* ===================== 7.5) Authentication gate ===================== */
const { authGate } = require("./middleware/auth");
const { createLicenseGuard } = require("./middleware/licenseGuard");
app.use("/api", authGate(sqlConnect, sql));
app.use("/api", createLicenseGuard());
app.use("/api", createGlobalApiLimiter());
app.use("/api", createReportScopeMiddleware(sqlConnect));
app.use("/api", createReportCacheMiddleware());

/* ===================== 8) File Storage & Upload Setup ===================== */
const uploadDirectory = process.env.AUDIO_UPLOAD_DIR;
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
  console.log("[INFO] Upload directory initialized.");
}
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDirectory); },
  filename: (req, file, cb) => { cb(null, Date.now() + "-" + file.originalname); }
});

// Audio upload validation: cap size and restrict to known audio container types
// to prevent arbitrary/executable file uploads.
const MAX_AUDIO_UPLOAD_BYTES = 200 * 1024 * 1024; // 200 MB
const ALLOWED_AUDIO_EXTENSIONS = new Set([
  ".wav", ".mp3", ".m4a", ".ogg", ".oga", ".flac", ".aac",
  ".wma", ".opus", ".amr", ".mp4", ".weba", ".webm",
]);
function audioFileFilter(_req, file, cb) {
  const ext = (path.extname(file.originalname) || "").toLowerCase();
  const mime = String(file.mimetype || "").toLowerCase();
  const extOk = ALLOWED_AUDIO_EXTENSIONS.has(ext);
  // Many recorders send audio/* or a generic octet-stream for .wav files.
  const mimeOk =
    mime.startsWith("audio/") ||
    mime === "application/octet-stream" ||
    mime === "video/mp4" ||
    mime === "video/webm";
  if (extOk && mimeOk) return cb(null, true);
  return cb(new Error("Invalid file type. Allowed audio formats: wav, mp3, m4a, ogg, flac, aac, wma, opus, amr."));
}
const uploadAudio = multer({
  storage: audioStorage,
  limits: { fileSize: MAX_AUDIO_UPLOAD_BYTES },
  fileFilter: audioFileFilter,
});

// Runs multer for the audio upload and converts validation/size errors into
// clean 400 responses instead of a generic 500.
function handleAudioUpload(req, res, next) {
  uploadAudio.single("audioFile")(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE"
        ? "Audio file is too large (max 200 MB)."
        : (err.message || "Invalid audio upload.");
      return res.status(400).json({ success: false, message });
    }
    return next();
  });
}

// Resolve a writable storage directory from env (absolute or relative to this file).
function resolveStorageDir(envValue, defaultRelativeDir) {
  const raw = (envValue || "").trim();
  const dir = raw
    ? (path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(__dirname, raw))
    : path.resolve(__dirname, defaultRelativeDir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findProfilePictureFile(username) {
  if (!username) return null;
  const fileExts = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".avif"];
  const uname = String(username).trim();
  const unameLower = uname.toLowerCase();

  for (const ext of fileExts) {
    const exact = path.join(profilePicsDir, `${uname}${ext}`);
    if (fs.existsSync(exact)) return exact;
  }

  try {
    const files = fs.readdirSync(profilePicsDir);
    for (const file of files) {
      const ext = path.extname(file);
      if (!fileExts.includes(ext.toLowerCase())) continue;
      const base = file.slice(0, -ext.length);
      if (base.includes("_")) continue; // archived copy from a prior upload
      if (base.toLowerCase() === unameLower) {
        return path.join(profilePicsDir, file);
      }
    }
  } catch {
    return null;
  }
  return null;
}

// In section 8) File Storage & Upload Setup
const profilePicsDir = resolveStorageDir(
  process.env.PROFILE_PICS_DIR,
  "assets/profile_pictures",
);
try {
  const probe = path.join(profilePicsDir, ".write_probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  console.log(`[INFO] Profile pictures directory (persistent): ${profilePicsDir}`);
} catch (err) {
  console.error(
    `[WARN] Profile pictures directory is not writable (${profilePicsDir}): ${err.message}`,
  );
}
const storageProfilePic = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, profilePicsDir); },
  filename: (req, file, cb) => {
    const username = req.params.username;
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, `${username}${ext}`); // New file saved as username.ext
  }
});
const uploadProfilePic = multer({
  storage: storageProfilePic,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|gif|webp)$/i.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG, GIF, or WEBP profile images are allowed."));
    }
  },
});

const brandingDir = resolveStorageDir(process.env.BRANDING_DIR, "uploads/branding");
const storageAppLogo = multer.diskStorage({
  destination: (_req, _file, cb) => { cb(null, brandingDir); },
  filename: (_req, file, cb) => {
    const ext = (path.extname(file.originalname) || ".png").toLowerCase();
    try {
      const existing = fs.readdirSync(brandingDir).filter((f) => f.startsWith("app-logo"));
      for (const old of existing) {
        fs.unlinkSync(path.join(brandingDir, old));
      }
    } catch (_) { /* ignore cleanup errors */ }
    cb(null, `app-logo${ext}`);
  },
});
const uploadAppLogo = multer({
  storage: storageAppLogo,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|jpg|gif|webp|svg\+xml)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error("Only PNG, JPG, GIF, WEBP, or SVG images are allowed."));
  },
});

function resolveBrandingLogoFile() {
  try {
    const files = fs.readdirSync(brandingDir).filter((f) => f.startsWith("app-logo"));
    return files.length ? path.join(brandingDir, files[0]) : null;
  } catch {
    return null;
  }
}

function publicLogoUrl(req) {
  if (resolveBrandingLogoFile()) {
    return `${req.protocol}://${req.get("host")}/api/branding/logo`;
  }
  return "";
}

/* ===================== 9) Mounting Other router ===================== */
app.use("/api", agentRoutes);

/* ===================== 10) API Endpoints ===================== */
/* 10.1 License Management APIs */
// APIs for managing licenses, including validation, upload, and deletion
/**
 * API 10.1.01 - POST /api/verify-license
 * Verifies an active license key against system parameters
 */
app.post("/api/verify-license", async (req, res) => {
  // The license secret is held server-side only (LICENSE_SECRET_KEY). The client
  // no longer supplies it; we validate the installed license using the env secret.
  const secretKey = global.secretKey;
  if (!secretKey) {
    writeLog(`[${getISTTimeString()}] License validation failed: LICENSE_SECRET_KEY not configured on server`);
    return res.status(500).json({ success: false, message: "License is not configured on the server." });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT TOP 1 LicenseKey, EndDate FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC");
    if (!result.recordset.length) {
      writeLog(`[${getISTTimeString()}] License validation failed: No active license found`);
      return res.status(404).json({ success: false, message: "No active license found." });
    }

    const licenseKey = result.recordset[0].LicenseKey;
    const endDate = new Date(result.recordset[0].EndDate);
    const now = new Date();

    // Sprint 5: v3 (Ed25519) verification path.
    if (licenseV3.isV3Token(licenseKey)) {
      const r = await applyV3License(pool, licenseKey, { uploadedBy: "System" });
      if (r.state === "invalid") {
        return res.status(401).json({ success: false, message: r.reason || "Invalid license." });
      }
      if (r.state === "expired") {
        return res.status(403).json({ success: false, message: "License expired." });
      }
      return res.status(200).json({ success: true, warning: r.warning || null, licenseState: r.state });
    }

    // Sprint 4: grace-aware expiry. Fully expired (grace exhausted) is rejected;
    // within grace it validates with a read-only warning.
    const verdict = licenseSecurity.evaluateExpiry(endDate, now);
    if (verdict.state === "expired") {
      writeLog(`[${getISTTimeString()}] License validation failed: License expired on ${endDate.toISOString()}`);
      console.log(`License validation failed: License expired on ${endDate.toISOString()}`);
      global.isLicenseExpired = true;
      global.licenseState = "expired";
      recordLicenseEvent({ event: "LICENSE_EXPIRED", outcome: "failure", detail: `Expired ${verdict.daysOverdue}d ago` });
      return res.status(403).json({ success: false, message: `License expired on ${endDate.toLocaleDateString()}.` });
    }

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License validation failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      recordLicenseEvent({ event: "LICENSE_VALIDATED", outcome: "failure", detail: "Invalid signature" });
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    const hw = licenseSecurity.verifyHardwareBinding(payload);
    if (!hw.ok) {
      writeLog(`[${getISTTimeString()}] License validation failed: ${hw.reason}`);
      console.log(`License validation failed: ${hw.reason}`);
      recordLicenseEvent({ event: "LICENSE_VALIDATED", outcome: "failure", detail: hw.reason });
      return res.status(401).json({ success: false, message: hw.reason });
    }

    const startDate = new Date(payload.startDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License validation failed: License not yet valid until ${startDate.toISOString()}`);
      console.log(`License validation failed: License not yet valid until ${startDate.toISOString()}`);
      return res.status(401).json({ success: false, message: "License is not yet valid." });
    }

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    global.isLicenseExpired = verdict.state !== "active";
    global.licenseState = verdict.state;
    global.licensePayload = payload;

    let warning;
    if (verdict.state === "grace") {
      warning = `License expired — read-only grace mode (${verdict.graceRemaining} day(s) remaining).`;
    } else {
      const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
      warning = endDate <= sixDaysFromNow ? "License expires soon (within 6 days)." : null;
    }

    writeLog(`[${getISTTimeString()}] License validated successfully${warning ? " - " + warning : ""}`);
    console.log("License extracted successfully and payload parameters match");
    recordLicenseEvent({
      event: verdict.state === "grace" ? "LICENSE_GRACE" : "LICENSE_VALIDATED",
      outcome: verdict.state === "grace" ? "warning" : "success",
      detail: warning || `Valid; ${verdict.daysUntilExpiry} day(s) remaining`,
    });
    return res.status(200).json({ success: true, warning, licenseState: verdict.state });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License validation error: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    return res.status(500).json({ success: false, message: "Server error during license validation: " + error.message });
  }
});

/**
 * API 10.2.02 - GET /api/license-status
 * Retrieves the status of the active license
 */
app.get("/api/license-status", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const licenseResult = await pool.request()
      .query("SELECT TOP 1 EndDate FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC");

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License status check failed: No active license found`);
      return res.status(404).json({ success: false, message: "No active license found." });
    }

    const endDate = new Date(licenseResult.recordset[0].EndDate);
    const now = new Date();
    const daysUntilExpiration = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));

    // Sprint 4: grace-aware status. isExpired stays true only when fully expired
    // (grace exhausted), preserving existing client behaviour.
    const verdict = licenseSecurity.evaluateExpiry(endDate, now);
    const isExpired = verdict.state === "expired";
    if (isExpired) {
      writeLog(`[${getISTTimeString()}] License status: Expired on ${endDate.toISOString()}`);
    } else if (verdict.state === "grace") {
      writeLog(`[${getISTTimeString()}] License status: Read-only grace (${verdict.graceRemaining} day(s) remaining)`);
    } else if (daysUntilExpiration <= 7) {
      writeLog(`[${getISTTimeString()}] License status: Nearing expiration (${daysUntilExpiration} days remaining)`);
    }

    return res.status(200).json({
      success: true,
      isExpired,
      licenseState: verdict.state,
      graceRemaining: verdict.graceRemaining,
      daysUntilExpiration,
      endDate: endDate.toISOString()
    });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License status check error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error checking license status: " + error.message });
  }
});

/**
 * API 10.4.03 - POST /api/upload-license
 * Uploads a new license key (Super Admin only)
 */
app.post("/api/upload-license", requireSuperAdmin, async (req, res) => {
  const { licenseKey } = req.body;
  const username = req.user.username;

  if (!licenseKey) {
    writeLog(`[${getISTTimeString()}] License upload failed: Missing licenseKey`);
    return res.status(400).json({ success: false, message: "License key is required." });
  }

  try {
    const pool = await connectToDatabase();

    // Sprint 5: v3 (Ed25519) upload path — no symmetric secret needed.
    if (licenseV3.isV3Token(licenseKey)) {
      const r = await applyV3License(pool, licenseKey, { uploadedBy: username, persistFile: true });
      if (r.state === "invalid") {
        recordLicenseEvent({ event: "LICENSE_UPLOAD", outcome: "failure", detail: r.reason, actor: username });
        return res.status(401).json({ success: false, message: r.reason || "Invalid license." });
      }
      if (r.state === "expired") {
        recordLicenseEvent({ event: "LICENSE_UPLOAD", outcome: "failure", detail: "expired", actor: username });
        return res.status(401).json({ success: false, message: "New license is expired." });
      }
      recordLicenseEvent({ event: "LICENSE_UPLOAD", outcome: "success", detail: "v3 license installed", actor: username });
      return res.status(200).json({ success: true, message: "License uploaded successfully.", licenseState: r.state });
    }

    // License secret is server-side only (LICENSE_SECRET_KEY); never supplied by the client.
    const secretKey = global.secretKey;
    if (!secretKey) {
      writeLog(`[${getISTTimeString()}] License upload failed: LICENSE_SECRET_KEY not configured on server`);
      return res.status(500).json({ success: false, message: "License is not configured on the server." });
    }

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License upload failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature in new license." });
    }

    const hw = licenseSecurity.verifyHardwareBinding(payload);
    if (!hw.ok) {
      writeLog(`[${getISTTimeString()}] License upload failed: ${hw.reason}`);
      console.log(`License validation failed: ${hw.reason}`);
      recordLicenseEvent({ event: "LICENSE_UPLOAD", outcome: "failure", detail: hw.reason, actor: username });
      return res.status(401).json({ success: false, message: hw.reason });
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License upload failed: License not yet valid until ${startDate.toISOString()}`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return res.status(401).json({ success: false, message: "New license is not yet valid." });
    }
    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License upload failed: License expired on ${endDate.toISOString()}`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      return res.status(401).json({ success: false, message: "New license is expired." });
    }

    // Make this the single active license (removes all old rows).
    await upsertActiveLicense(pool, licenseKey, payload.endDate, username);

    // Best-effort file sync — DB is the source of truth, so a write failure
    // (e.g. read-only mount) must not fail the upload after the DB is updated.
    const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH || "./license/license.lic");
    try {
      const licenseDir = path.dirname(licenseFilePath);
      if (!fs.existsSync(licenseDir)) {
        fs.mkdirSync(licenseDir, { recursive: true });
        writeLog(`[${getISTTimeString()}] Created license directory: ${licenseDir}`);
      }
      fs.writeFileSync(licenseFilePath, licenseKey);
      writeLog(`[${getISTTimeString()}] License key written to file: ${licenseFilePath}`);
    } catch (fileError) {
      writeLog(`[${getISTTimeString()}] WARN: could not persist license file (${fileError.message}). DB row is active.`);
    }

    global.licensePayload = payload;
    global.isLicenseExpired = false;
    global.licenseState = "active";

    writeLog(`[${getISTTimeString()}] License uploaded successfully by ${username}`);
    console.log("License extracted successfully and payload parameters match");
    recordLicenseEvent({ event: "LICENSE_UPLOAD", outcome: "success", detail: `New license installed; ends ${payload.endDate}`, actor: username });
    return res.status(200).json({ success: true, message: "License uploaded successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License upload error for user ${username}: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    recordLicenseEvent({ event: "LICENSE_UPLOAD", outcome: "failure", detail: error.message, actor: username });
    return res.status(500).json({ success: false, message: "Server error during license upload: " + error.message });
  }
});

/**
 * API 10.6.04 - POST /api/delete-license
 * Deletes a license (Super Admin only)
 */
app.post("/api/delete-license", requireSuperAdmin, async (req, res) => {
  const { licenseKey } = req.body;
  const username = req.user.username;

  if (!licenseKey) {
    writeLog(`[${getISTTimeString()}] License deletion failed: Missing licenseKey`);
    return res.status(400).json({ success: false, message: "License key is required." });
  }

  try {
    const pool = await connectToDatabase();
    const licenseResult = await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`SELECT IsActive FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License deletion failed: License ${licenseKey} not found`);
      return res.status(404).json({ success: false, message: "License not found." });
    }

    const isActive = licenseResult.recordset[0].IsActive;

    await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`DELETE FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (isActive) {
      const licenseFilePath = path.resolve(process.env.LICENSE_FILE_PATH || "./license/license.lic");
      try {
        if (fs.existsSync(licenseFilePath)) {
          fs.writeFileSync(licenseFilePath, '');
          writeLog(`[${getISTTimeString()}] Cleared license file: ${licenseFilePath}`);
        }
      } catch (fileError) {
        writeLog(`[${getISTTimeString()}] Failed to clear license file ${licenseFilePath}: ${fileError.message}`);
        return res.status(500).json({ success: false, message: `Failed to clear license file: ${fileError.message}` });
      }

      global.licensePayload = null;
      global.isLicenseExpired = true;
      global.licenseState = "expired";
      recordLicenseEvent({
        event: "LICENSE_DELETED",
        outcome: "warning",
        detail: `Active license removed by ${username}`,
        actor: username,
      });
      writeLog(`[${getISTTimeString()}] Reset global license state after deleting active license ${licenseKey}`);
    }

    writeLog(`[${getISTTimeString()}] License ${licenseKey} deleted successfully by ${username}`);
    return res.status(200).json({ success: true, message: "License deleted successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License deletion error for user ${username}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during license deletion: " + error.message });
  }
});

/**
 * API 10.7.05 - POST /api/license-details
 * Retrieves details of a specific license (Super Admin only)
 */
app.post("/api/license-details", requireSuperAdmin, async (req, res) => {
  const { licenseKey } = req.body;
  const username = req.user.username;

  if (!licenseKey) {
    writeLog(`[${getISTTimeString()}] License details fetch failed: Missing licenseKey`);
    return res.status(400).json({ success: false, message: "License key is required." });
  }

  try {
    const pool = await connectToDatabase();
    const licenseResult = await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`SELECT LicenseKey, EndDate, IsActive FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License not found`);
      return res.status(404).json({ success: false, message: "License not found." });
    }

    const license = licenseResult.recordset[0];

    // Sprint 5: v3 details (verified with public key; no MAC/secret needed).
    if (licenseV3.isV3Token(licenseKey)) {
      const ver = licenseV3.verifyV3(licenseKey);
      if (!ver.ok) {
        return res.status(401).json({ success: false, message: ver.reason || "Invalid signature." });
      }
      const p = ver.payload;
      const licenseDetails = {
        licenseKey: license.LicenseKey,
        startDate: p.notBefore,
        endDate: p.notAfter,
        users: p?.limits?.maxConcurrentUsers ?? 0,
        macAddress: Array.isArray(p?.hardware?.allowedMacs) ? p.hardware.allowedMacs.join(", ") : (p?.hardware?.serverFingerprint ? `fp:${String(p.hardware.serverFingerprint).slice(0, 16)}…` : "—"),
        applicationId: p.issuerKeyId || "v3",
        isActive: license.IsActive,
        signature: "$Panja",
      };
      writeLog(`[${getISTTimeString()}] v3 license details fetched by ${username}`);
      return res.status(200).json({ success: true, license: licenseDetails });
    }

    const payload = await decodeLicense(licenseKey, global.secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return res.status(500).json({ success: false, message: macError.message });
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: MAC mismatch`);
      console.log("License validation failed: MAC address mismatch");
      return res.status(401).json({ success: false, message: "Invalid MAC address." });
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License not yet valid until ${startDate.toISOString()}`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return res.status(401).json({ success: false, message: "License is not yet valid." });
    }
    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License expired on ${endDate.toISOString()}`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      return res.status(401).json({ success: false, message: "License is expired." });
    }

    const licenseDetails = {
      licenseKey: license.LicenseKey,
      startDate: payload.startDate,
      endDate: payload.endDate,
      users: payload.users,
      macAddress: payload.macAddress,
      applicationId: payload.appId,
      isActive: license.IsActive,
      signature: payload.signature,
    };

    writeLog(`[${getISTTimeString()}] License details fetched successfully by ${username}`);
    console.log("License extracted successfully and payload parameters match");
    return res.status(200).json({ success: true, license: licenseDetails });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License details fetch error for user ${username}: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    return res.status(500).json({ success: false, message: "Server error fetching license details: " + error.message });
  }
});

/**
 * API 10.8.06 - GET /api/license-history
 * Retrieves license upload history for a user (Super Admin only)
 */
app.get('/api/license-history', requireSuperAdmin, async (req, res) => {
  const username = req.user.username;

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query('SELECT * FROM Licenses ORDER BY CreatedAt DESC');

    writeLog(`[${getISTTimeString()}] License History: Fetched for ${username}, Count: ${result.recordset.length}`);
    res.status(200).json({ success: true, licenses: result.recordset });
  } catch (err) {
    writeLog(`[${getISTTimeString()}] License History: Error for ${username}: ${err.message}`);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
});

/* 10.2 User Management APIs */
// APIs for user registration, authentication, and profile management
/**
 * API 10.9.07 - POST /register
 * Registers a new user
 */
// SECURITY: This legacy endpoint stored plaintext passwords and had no auth.
// It has been disabled. User creation now goes through the authenticated,
// bcrypt-hashed POST /api/user route (Create User page).
app.post("/register", (req, res) => {
  writeLog(`[${getISTTimeString()}] Rejected call to deprecated /register endpoint`);
  return res.status(410).json({
    success: false,
    message: "This endpoint has been removed. Use the Create User page (POST /api/user).",
  });
});

/**
 * API 10.10.08 - POST /api/login (REMOVED — Sprint 2)
 * Legacy password-only login without security question. Use /api/login-security.
 */
app.post("/api/login", (req, res) => {
  writeLog(`[${getISTTimeString()}] Rejected call to deprecated /api/login`);
  return res.status(410).json({
    success: false,
    message: "This endpoint has been removed. Use POST /api/login-security.",
  });
});

/**
 * API 10.11.09 - POST /api/login-security
 * Authenticates a user with security question verification
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { success: false, message: "Too many login attempts. Please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Password reset is sensitive; cap attempts harder than login.
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many password reset attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Uploads are expensive; rate-limit per window.
const uploadLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  message: { success: false, message: "Too many uploads. Please slow down." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/login-security", loginLimiter, async (req, res) => {
  const { userId, password, questionType, questionAnswer } = req.body;
  if (!userId || !password || !questionType || !questionAnswer) {
    writeLog(`[${getISTTimeString()}] Login failed: Missing fields for UserID ${userId}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }
  try {
    const pool = await sqlConnect();
    const user = await fetchUserForLogin(pool, userId);
    if (!user) {
      writeLog(`[${getISTTimeString()}] Login failed: User ${userId} not found`);
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      writeLog(`[${getISTTimeString()}] Login failed: Invalid password for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }
    if (!user.SecurityQuestionType || !user.SecurityQuestionAnswer
        || user.SecurityQuestionType !== questionType) {
      writeLog(`[${getISTTimeString()}] Login failed: Security question mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }
    const answerOk = await checkSecurityAnswer(pool, user, questionAnswer);
    if (!answerOk) {
      writeLog(`[${getISTTimeString()}] Login failed: Security answer mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }
    const username = user.Username;
    const sessionUserId = getLoginIdForSession(user);
    const userType = user.AccountType || "Agent";
    const insertLog = await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .input("LoginTime", sql.DateTime, new Date())
      .query(`
        INSERT INTO UserSessionLog (UserID, Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@UserID, @Username, @UserType, @LoginTime);
      `);
    const logId = insertLog.recordset[0].LogID;
    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, sessionToken)
      .query(`
        INSERT INTO ActiveSessions (UserID, Username, LogID, LoginTime, IsActive, Token)
        VALUES (@UserID, @Username, @LogID, @LoginTime, 1, @Token);
      `);
    writeLog(`[${getISTTimeString()}] Login successful for UserID ${sessionUserId}, Username: ${username}, LogID: ${logId}`);
    return res.status(200).json({
      success: true,
      userId: sessionUserId,
      username,
      userType,
      logId,
      token: sessionToken,
    });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/login-security: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Login error for UserID ${userId}: ${error.message}`);
    if (error.message.includes("connect") || error.message.includes("timeout")) {
      return res.status(503).json({ success: false, message: "Unable to connect to the server. Please check your network." });
    }
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
});

/**
 * API 10.68.660 - POST /api/logout-track
 * Tracks user logout and marks session as inactive
 */
app.post("/api/logout-track", async (req, res) => {
  const { userId, logId, token } = req.body;
  if (!userId || !logId || !token) {
    console.log(`[${getISTTimeString()}] Missing fields in /api/logout-track: ${JSON.stringify({ userId, logId, token })}`);
    return res.status(400).json({ success: false, message: "UserID, LogID, and token are required." });
  }
  try {
    const pool = await sqlConnect();
    console.log(`[${getISTTimeString()}] Attempting to logout UserID: ${userId}, LogID: ${logId}`);
    const logoutTime = new Date();
    const result = await pool.request()
      .input("UserID", sql.NVarChar, userId)
      .input("LogID", sql.Int, logId)
      .input("Token", sql.NVarChar, token)
      .query(`
        UPDATE ActiveSessions
        SET IsActive = 0
        WHERE UserID = @UserID 
          AND LogID = @LogID 
          AND Token = @Token;
      `);
    await pool.request()
      .input("LogID", sql.Int, logId)
      .input("LogoutTime", sql.DateTime, logoutTime)
      .query(`
        UPDATE UserSessionLog
        SET LogoutTime = @LogoutTime
        WHERE LogID = @LogID AND LogoutTime IS NULL;
      `);
    if (result.rowsAffected[0] === 0) {
      console.warn(`[${getISTTimeString()}] No session found or already inactive for UserID: ${userId}, LogID: ${logId}`);
      // Verify if the session exists and update if necessary
      const verifyResult = await pool.request()
        .input("UserID", sql.NVarChar, userId)
        .input("LogID", sql.Int, logId)
        .input("Token", sql.NVarChar, token)
        .query(`
          SELECT IsActive FROM ActiveSessions 
          WHERE UserID = @UserID AND LogID = @LogID AND Token = @Token
        `);
      if (verifyResult.recordset.length > 0) {
        if (verifyResult.recordset[0].IsActive === 0) {
          console.log(`[${getISTTimeString()}] Session already marked inactive for UserID: ${userId}, LogID: ${logId}`);
          return res.status(200).json({ success: true, message: "Session already inactive." });
        } else {
          console.warn(`[${getISTTimeString()}] Session found but not updated, forcing update for UserID: ${userId}, LogID: ${logId}`);
          await pool.request()
            .input("UserID", sql.NVarChar, userId)
            .input("LogID", sql.Int, logId)
            .input("Token", sql.NVarChar, token)
            .query(`
              UPDATE ActiveSessions
              SET IsActive = 0
              WHERE UserID = @UserID 
                AND LogID = @LogID 
                AND Token = @Token;
            `);
          return res.status(200).json({ success: true, message: "Logout forced successfully." });
        }
      }
      return res.status(404).json({ success: false, message: "No session found to logout." });
    }
    console.log(`[${getISTTimeString()}] Logout successful for UserID: ${userId}, LogID: ${logId}`);
    return res.status(200).json({ success: true, message: "Logout successful." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/logout-track: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Logout error for UserID ${userId}, LogID ${logId}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during logout." });
  }
});

/**
 * API 10.72.701 - GET /api/user/:username
 * Retrieves user details
 */
app.get("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  try {
    if (!assertSelfOrElevated(req, username)) {
      return res.status(403).json({ success: false, message: "You can only view your own profile." });
    }
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`
        SELECT U.Username, U.Email, U.AccountType,
               U.SecurityQuestionType,
               U.CreatedBy, U.CreationDate,
               (SELECT MAX(LoginTime) FROM dbo.UserSessionLog WHERE Username = U.Username) AS LastLoginTime
        FROM dbo.Users AS U
        WHERE LOWER(U.Username) = LOWER(@username)
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const userRow = result.recordset[0];
    return res.status(200).json({
      success: true,
      user: {
        Username: userRow.Username || "",
        Email: userRow.Email || "Not Provided",
        AccountType: userRow.AccountType || "Standard",
        SecurityQuestionType: userRow.SecurityQuestionType || "Not Set",
        CreatedBy: userRow.CreatedBy || "N/A",
        CreationDate: userRow.CreationDate || null,
        LastLoginTime: userRow.LastLoginTime || null
      }
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.75.732 - PUT /api/user/:username/security-question
 * Updates a user's security question
 */
app.put("/api/user/:username/security-question", async (req, res) => {
  const { username } = req.params;
  const { question, answer } = req.body;
  if (!question || !answer) {
    return res.status(400).json({ success: false, message: "Security question and answer are required." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "You can only update your own security question." });
  }
  try {
    const pool = await connectToDatabase();
    const userCheck = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const hashedAnswer = await hashSecurityAnswer(answer);
    await pool.request()
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, hashedAnswer)
      .input("username", sql.NVarChar, username)
      .query(`
        UPDATE dbo.Users
        SET SecurityQuestionType = @question,
            SecurityQuestionAnswer = @answer
        WHERE LOWER(Username) = LOWER(@username)
      `);
    return res.status(200).json({ success: true, message: "Security question updated successfully." });
  } catch (error) {
    console.error("Error updating security question:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.80.783 - PUT /api/user/:username/email
 * Updates a user's email
 */
app.put("/api/user/:username/email", async (req, res) => {
  const { username } = req.params;
  const { email } = req.body;
  if (!email) {
    return res.status(400).send({ success: false, message: "Email is required." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).send({ success: false, message: "You can only update your own email." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("newEmail", sql.NVarChar, email)
      .input("username", sql.NVarChar, username)
      .query("UPDATE Users SET Email = @newEmail WHERE Username = @username");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).send({ success: false, message: "User not found." });
    }
    return res.status(200).send({ success: true, message: "Email updated successfully." });
  } catch (error) {
    console.error("Update email error:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.16.14 - PUT /api/user/:username/password
 * Updates a user's password
 */
app.put("/api/user/:username/password", async (req, res) => {
  const { username } = req.params;
  const { oldPassword, newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).send({ success: false, message: "New password is required." });
  }
  if (newPassword.length < 8) {
    return res.status(400).send({ success: false, message: "New password must be at least 8 characters long." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).send({ success: false, message: "You can only change your own password." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username, Password FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");

    if (userResult.recordset.length === 0) {
      return res.status(404).send({ success: false, message: "User not found." });
    }

    const userRow = userResult.recordset[0];
    if (oldPassword) {
      const passwordMatch = await bcrypt.compare(oldPassword, userRow.Password);
      if (!passwordMatch) {
        return res.status(401).send({ success: false, message: "Current password is incorrect." });
      }
    } else if (req.user?.accountType === "Agent") {
      return res.status(400).send({ success: false, message: "Current password is required." });
    }

    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

    await pool.request()
      .input("newPassword", sql.NVarChar, newPasswordHash)
      .input("username", sql.NVarChar, username)
      .query("UPDATE dbo.Users SET Password = @newPassword WHERE LOWER(Username) = LOWER(@username)");

    return res.status(200).send({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in PUT /api/user/${username}/password: ${error.message}`);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.16.14.1 - API - GET /api/user/:userId
 * Fetches user details by UserID for handleTempLogin
 */
app.get("/api/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const pool = await sqlConnect();
    const result = await pool.request()
      .input("userId", sql.NVarChar, userId)
      .query(`SELECT Username, AccountType FROM dbo.Users WHERE UserID = @userId`);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    return res.status(200).json({ success: true, user: result.recordset[0] });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching user data:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});


/**
 * API 10.9.07 - POST /api/user
 * Purpose: Registers a new user with hashed password and security question.
 * Compliance: ISO 27001 (Secure user registration)
 */
app.post("/api/user", async (req, res) => {
  const { userId, username, password, email, userType, SecurityQuestionType, SecurityQuestionAnswer, createdBy } = req.body;
  const loginId = String(userId || "").trim();
  const creator = String(createdBy || req.user?.username || "").trim();
  const validRoles = ["Super Admin", "Admin", "Manager", "Team Leader", "Auditor", "Agent", "IT"];
  if (!loginId || !username || !password || !email || !userType || !SecurityQuestionType || !SecurityQuestionAnswer || !creator) {
    writeLog(`[${getISTTimeString()}] User registration failed: Missing required fields for login ID ${loginId || 'N/A'}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }
  if (!validRoles.includes(userType)) {
    return res.status(400).json({ success: false, message: `Invalid user type. Must be one of: ${validRoles.join(", ")}` });
  }
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can create users."))) return;
    const pool = await connectToDatabase();
    const userCheck = await pool.request()
      .input("loginId", sql.NVarChar, loginId)
      .query(`
        SELECT UserID FROM dbo.Users
        WHERE LoginAlias = @loginId COLLATE SQL_Latin1_General_CP1_CI_AS
      `);
    if (userCheck.recordset.length > 0) {
      writeLog(`[${getISTTimeString()}] User registration failed: Login ID ${loginId} already exists`);
      return res.status(400).json({ success: false, message: "UserID already exists." });
    }
    const usernameCheck = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE Username = @username");
    if (usernameCheck.recordset.length > 0) {
      writeLog(`[${getISTTimeString()}] User registration failed: Username ${username} already exists`);
      return res.status(400).json({ success: false, message: "Username already exists." });
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    const securityAnswerHash = await hashSecurityAnswer(SecurityQuestionAnswer);

    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, passwordHash)
      .input("email", sql.NVarChar, email)
      .input("userType", sql.NVarChar, userType)
      .input("securityQuestionType", sql.NVarChar, SecurityQuestionType)
      .input("securityQuestionAnswer", sql.NVarChar, securityAnswerHash)
      .input("createdBy", sql.NVarChar, creator)
      .input("creationDate", sql.DateTime, new Date())
      .input("loginAlias", sql.NVarChar, loginId)
      .query(`
        INSERT INTO Users (Username, Password, Email, AccountType, SecurityQuestionType, SecurityQuestionAnswer, CreatedBy, CreationDate, LoginAlias)
        VALUES (@username, @password, @email, @userType, @securityQuestionType, @securityQuestionAnswer, @createdBy, @creationDate, @loginAlias)
      `);
    writeLog(`[${getISTTimeString()}] User registered successfully: LoginAlias ${loginId}, Username ${username}`);
    res.status(201).json({ success: true, message: "User registered successfully." });
  } catch (error) {
    console.error("Registration error:", error);
    writeLog(`[${getISTTimeString()}] Registration error for login ID ${loginId || 'N/A'}: ${error.message}`);
    res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.070 - POST /api/reset-password
 * Resets a user's password with security question verification
 */
app.post("/api/reset-password", passwordResetLimiter, async (req, res) => {
  const { username, email, securityQuestion, securityAnswer, newPassword } = req.body;

  if (!username || !email || !securityQuestion || !securityAnswer || !newPassword) {
    console.log("Missing fields in /api/reset-password: ${JSON.stringify({ username, email, securityQuestion, securityAnswer })}");
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  const sanitizedUsername = username.trim();
  const sanitizedEmail = email.trim();
  const sanitizedQuestion = securityQuestion.trim();
  const sanitizedAnswer = securityAnswer.trim();
  const sanitizedPassword = newPassword.trim();

  if (sanitizedPassword.length < 8) {
    console.log("Password too short for user: ${sanitizedUsername}");
    return res.status(400).json({ success: false, message: "New password must be at least 8 characters long." });
  }

  try {
    console.log("Password reset attempt for user: ${sanitizedUsername}");

    const pool = await connectToDatabase();

    const userResult = await pool.request()
      .input("username", sql.NVarChar, sanitizedUsername)
      .input("email", sql.NVarChar, sanitizedEmail)
      .input("securityQuestion", sql.NVarChar, sanitizedQuestion)
      .query(`
        SELECT * FROM dbo.Users 
        WHERE Username = @username 
        AND Email = @email 
        AND SecurityQuestionType = @securityQuestion
      `);

    if (userResult.recordset.length === 0) {
      console.log("No matching user found for: ${sanitizedUsername}, email: ${sanitizedEmail}");
      return res.status(404).json({ 
        success: false, 
        message: "No user found with the provided details or incorrect security answer." 
      });
    }

    const userRow = userResult.recordset[0];
    const answerOk = await checkSecurityAnswer(pool, userRow, sanitizedAnswer);
    if (!answerOk) {
      console.log("Incorrect security answer for user: ${sanitizedUsername}");
      return res.status(404).json({
        success: false,
        message: "No user found with the provided details or incorrect security answer.",
      });
    }

    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(sanitizedPassword, saltRounds);

    await pool.request()
      .input("newPassword", sql.NVarChar, hashedNewPassword)
      .input("username", sql.NVarChar, sanitizedUsername)
      .query("UPDATE dbo.Users SET Password = @newPassword WHERE Username = @username");

    writeLog(`Password reset for user: ${sanitizedUsername} at ${getISTTimeString()}`);

    console.log("Password reset successful for user: ${sanitizedUsername}");

    return res.status(200).json({ success: true, message: "Password reset successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Reset password error: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during password reset." });
  }
});

/**
 * API 10.9.071 - POST /api/get-username
 * Retrieves username by email and government ID
 */
app.post("/api/get-username", async (req, res) => {
  const { email, govID } = req.body;
  if (!email || !govID) {
    return res.status(400).send({ success: false, message: "Email and Government ID are required." });
  }
  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("email", sql.NVarChar, email)
      .input("govID", sql.NVarChar, govID)
      .query("SELECT Username FROM Users WHERE Email = @email AND GovID = @govID");
    if (userResult.recordset.length === 0) {
      return res.status(404).send({ success: false, message: "No user found with the provided details." });
    }
    const username = userResult.recordset[0].Username;
    return res.status(200).send({ success: true, username });
  } catch (error) {
    console.error("Fetch username error:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.072 - POST /api/get-security-question-type
 * Fetches security question type by username
 */
app.post("/api/get-security-question-type", async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }

  const sanitizedUsername = username.trim();

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, sanitizedUsername)
      .query("SELECT SecurityQuestionType FROM dbo.Users WHERE Username = @username");

    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const securityQuestionType = result.recordset[0].SecurityQuestionType;
    if (!securityQuestionType) {
      return res.status(404).json({ success: false, message: "Security question not set for this user." });
    }

    return res.status(200).json({ success: true, securityQuestionType });
  } catch (error) {
    console.error("Error fetching security question:", error);
    return res.status(500).json({ success: false, message: "Server error fetching security question." });
  }
});

/**
 * API 10.12.90 - POST /api/temp-super-admin-login
 * Authenticates a Super Admin with security question verification for emergency login
 */
app.post("/api/temp-super-admin-login", loginLimiter, async (req, res) => {
  const { userId, password, questionType, questionAnswer } = req.body;
  if (!userId || !password || !questionType || !questionAnswer) {
    writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Missing fields for UserID ${userId}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  try {
    const pool = await sqlConnect();
    console.log(`[${getISTTimeString()}] Checking temp Super Admin login for UserID: ${userId}`);
    const user = await fetchUserForLogin(pool, userId);

    if (!user) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: User ${userId} not found`);
      return res.status(401).json({ success: false, message: "Invalid UserID or credentials." });
    }
    console.log(`[${getISTTimeString()}] Verifying password for UserID: ${userId}`);
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Invalid password for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid UserID or password." });
    }

    console.log(`[${getISTTimeString()}] Verifying security question for UserID: ${userId}, Question: ${questionType}, Answer: ${questionAnswer}`);
    if (!user.SecurityQuestionType || !user.SecurityQuestionAnswer
        || user.SecurityQuestionType !== questionType) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Security question mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }
    const answerOk = await checkSecurityAnswer(pool, user, questionAnswer);
    if (!answerOk) {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: Security answer mismatch for UserID ${userId}`);
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }

    if (user.AccountType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] Temp Super Admin login failed: User ${userId} is not a Super Admin`);
      return res.status(403).json({ success: false, message: "Only Super Admins can use emergency login." });
    }

    const username = user.Username;
    const sessionUserId = getLoginIdForSession(user);
    const userType = user.AccountType;
    const insertLog = await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .input("LoginTime", sql.DateTime, new Date())
      .query(`
        INSERT INTO UserSessionLog (UserID, Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@UserID, @Username, @UserType, @LoginTime);
      `);
    const logId = insertLog.recordset[0].LogID;
    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("UserID", sql.NVarChar, sessionUserId)
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, sessionToken)
      .query(`
        INSERT INTO ActiveSessions (UserID, Username, LogID, LoginTime, IsActive, Token)
        VALUES (@UserID, @Username, @LogID, @LoginTime, 1, @Token);
      `);

    writeLog(`[${getISTTimeString()}] Temp Super Admin login successful for UserID ${sessionUserId}, Username: ${username}, LogID: ${logId}`);
    return res.status(200).json({ success: true, username, userType, logId, sessionToken });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/temp-super-admin-login: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Temp Super Admin login error for UserID ${userId}: ${error.message}`);
    if (error.message.includes('connect') || error.message.includes('timeout')) {
      return res.status(503).json({ success: false, message: "Unable to connect to the server. Please check your network." });
    }
    return res.status(500).json({ success: false, message: "Server error during login." });
  }
});

/**
 * API 10.1.01 - GET /api/users/list
 * Purpose: Retrieves a list of all users.
 * Compliance: ISO 27001 (Secure data retrieval)
 */
app.get('/api/users/list', async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can list users."))) return;
    const pool = await sql.connect(config);
    const result = await pool.request()
      .query(`
        SELECT 
          UserID,
          Username,
          Email,
          AccountType,
          SecurityQuestionType,
          CreatedBy,
          CreationDate
        FROM dbo.Users
        ORDER BY CreationDate DESC
      `);

    if (result.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] No users found`);
      return res.status(404).json({ success: false, message: 'No users found.' });
    }

    writeLog(`[${getISTTimeString()}] Successfully fetched ${result.recordset.length} users`);
    return res.status(200).json({ success: true, users: result.recordset });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error fetching users: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Server error fetching users: ' + error.message });
  }
});

/**
 * API 10.9.075 - GET /api/users/search
 * Searches users by username
 */
app.get("/api/users/search", async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can search users."))) return;
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, message: "Query parameter 'q' is required." });
    }

    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('query', `%${q}%`)
      .query(`
        SELECT 
          UserID,
          Username,
          Email,
          AccountType,
          SecurityQuestionType,
          CreatedBy,
          CreationDate
        FROM dbo.Users
        WHERE Username LIKE @query
        ORDER BY Username
      `);
    return res.status(200).json({ success: true, users: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in GET /api/users/search: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.076 - DELETE /api/user/:username
 * Deletes a user
 */
app.delete("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can delete users."))) return;
    const pool = await connectToDatabase();
    const checkResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    if (!checkResult.recordset.length) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    await pool.request()
      .input("username", sql.NVarChar, username)
      .query("DELETE FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    return res.status(200).json({ success: true, message: `User '${username}' deleted successfully.` });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).json({ success: false, message: "Server error while deleting user." });
  }
});

/* 10.3 Session Management APIs */
/**
 * API 10.25.23 - POST /api/verify-session
 * Verifies an active user session
 */
app.post("/api/verify-session", async (req, res) => {
  const { username, token } = req.body;
  if (!username || !token) {
    return res.status(400).json({ success: false, message: "Username and token are required." });
  }

  try {
    const pool = await connectToDatabase();
    const sessionResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("token", sql.NVarChar, token)
      .query("SELECT * FROM ActiveSessions WHERE Username = @username AND Token = @token AND IsActive = 1");

    if (sessionResult.recordset.length === 0) {
      return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }

    return res.status(200).json({ success: true, message: "Session verified." });
  } catch (error) {
    return res.status(500).json({ success: false, message: "Server error verifying session." });
  }
});

/**
 * API 10.26.24 - POST /api/refresh-session
 * Refreshes a Super Admin's session
 */
app.post("/api/refresh-session", async (req, res) => {
  const { username, currentToken } = req.body;
  if (!username || !currentToken) {
    writeLog(`[${getISTTimeString()}] Refresh session failed: Missing username or currentToken`);
    return res.status(400).json({ success: false, message: "Username and current token are required." });
  }

  try {
    const pool = await connectToDatabase();

    const sessionResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("token", sql.NVarChar, currentToken)
      .query("SELECT LogID FROM ActiveSessions WHERE Username = @username AND Token = @token AND IsActive = 1");

    if (sessionResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] Refresh session failed: Invalid or expired session for ${username}`);
      return res.status(401).json({ success: false, message: "Invalid or expired session." });
    }

    const logId = sessionResult.recordset[0].LogID;

    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("token", sql.NVarChar, currentToken)
      .query("UPDATE ActiveSessions SET IsActive = 0 WHERE Username = @username AND Token = @token AND IsActive = 1");

    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0 || userResult.recordset[0].AccountType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] Refresh session failed: User ${username} is not a Super Admin`);
      return res.status(403).json({ success: false, message: "Only Super Admins can refresh sessions." });
    }

    const newInsertLog = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, "Super Admin")
      .query(`
        INSERT INTO UserSessionLog (Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@Username, @UserType, GETDATE());
      `);
    const newLogId = newInsertLog.recordset[0].LogID;

    const newSessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, newLogId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, newSessionToken)
      .query(`
        INSERT INTO ActiveSessions (Username, LogID, LoginTime, IsActive, Token)
        VALUES (@Username, @LogID, @LoginTime, 1, @Token);
      `);

    writeLog(`[${getISTTimeString()}] Session refreshed for ${username}: Old LogID ${logId}, New LogID ${newLogId}`);
    return res.status(200).json({ success: true, sessionToken: newSessionToken });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Refresh session error for ${username}: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error refreshing session." });
  }
});

/**
 * API 10.27.25 - POST /api/invalidate-session
 * Invalidates a user session
 */
app.post("/api/invalidate-session", async (req, res) => {
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });
  req.on('end', async () => {
    try {
      const { username, token } = JSON.parse(body);
      if (!username || !token) {
        writeLog(`[${getISTTimeString()}] Invalidate session failed: Missing username or token`);
        return res.status(400).json({ success: false, message: "Username and token are required." });
      }

      const pool = await connectToDatabase();
      const result = await pool.request()
        .input("username", sql.NVarChar, username)
        .input("token", sql.NVarChar, token)
        .query("UPDATE ActiveSessions SET IsActive = 0 WHERE Username = @username AND Token = @token AND IsActive = 1");

      if (result.rowsAffected[0] === 0) {
        writeLog(`[${getISTTimeString()}] Invalidate session failed: No active session found for ${username}`);
        return res.status(404).json({ success: false, message: "No active session found." });
      }

      writeLog(`[${getISTTimeString()}] Session invalidated for ${username}`);
      return res.status(200).json({ success: true, message: "Session invalidated." });
    } catch (error) {
      writeLog(`[${getISTTimeString()}] Invalidate session error: ${error.message}`);
      return res.status(500).json({ success: false, message: "Server error invalidating session." });
    }
  });
});

/* Session Cleanup Job */
// Periodically clears stale sessions older than 24 hours
setInterval(async () => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query(`
        UPDATE ActiveSessions
        SET IsActive = 0
        WHERE LoginTime < DATEADD(HOUR, -24, GETDATE());
      `);
    if (result.rowsAffected[0] > 0) {
      writeLog(`[${getISTTimeString()}] Cleared ${result.rowsAffected[0]} stale sessions older than 24 hours.`);
    }
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error clearing stale sessions: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Error clearing stale sessions: ${error.message}`);
  }
}, 60 * 60 * 1000); // Run every hour

/* Stale audio processing cleanup — mark >1h in-progress calls as failed */
setInterval(async () => {
  try {
    const pool = await connectToDatabase();
    const marked = await markStaleProcessingAsFailed(pool);
    if (marked > 0) {
      writeLog(`[${getISTTimeString()}] Marked ${marked} stale audio job(s) as failed (>1 hour).`);
    }
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error marking stale audio jobs: ${error.message}`);
    writeLog(`[${getISTTimeString()}] Error marking stale audio jobs: ${error.message}`);
  }
}, 10 * 60 * 1000);

/* 10.4 Audio Processing APIs */
// APIs for handling audio file uploads and processing

/**
 * POST /api/internal/transcription-callback
 * Cloud GPU callback when Jarvis orchestrator cannot reach SQL Server (DB_ENABLED=false).
 */
/**
 * GET /api/internal/ai-entitlement
 * Sprint 9 — lets the AI-MVP orchestrator confirm the license permits AI work
 * and which modules are enabled. Auth: SERVICE_TOKEN or CALLBACK_SECRET.
 */
app.get("/api/internal/ai-entitlement", (req, res) => {
  const serviceToken = process.env.SERVICE_TOKEN || process.env.UPLOAD_SERVICE_TOKEN;
  const callbackSecret = process.env.CALLBACK_SECRET;
  const authHeader = req.headers.authorization || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const provided = bearer || req.headers["x-service-token"] || req.headers["x-callback-secret"];
  const allowed = (serviceToken && provided === serviceToken) || (callbackSecret && provided === callbackSecret);
  if (!allowed) {
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }
  const { entitlementSnapshot } = require("./services/aiEntitlement");
  const snap = entitlementSnapshot();
  return res.status(200).json({ success: true, ...snap });
});

app.post("/api/internal/transcription-callback", async (req, res) => {
  const expectedSecret = process.env.CALLBACK_SECRET;
  const providedSecret = req.headers["x-callback-secret"];

  if (!expectedSecret || providedSecret !== expectedSecret) {
    writeLog(`[${getISTTimeString()}] Transcription callback rejected: invalid secret`);
    return res.status(401).json({ success: false, message: "Unauthorized" });
  }

  const {
    audioFile,
    type,
    processStatus,
    stage,
    progress,
    message,
    language,
    transcript,
    translateOutput,
    duration,
    diarizationStatus,
    scoringRaw,
    scores,
    summary,
    sentiment,
    scriptCompliance,
    toneAnalysis,
    processingSeconds,
    error,
  } = req.body || {};

  if (!audioFile) {
    return res.status(400).json({ success: false, message: "Missing audioFile" });
  }

  try {
    const pool = await connectToDatabase();

    if (type === "status" || type === "failed") {
      const reqStage = (stage || "").trim();
      const reqProgress = typeof progress === "number" ? progress : null;
      const reqMessage = (message || "").trim();
      const reqLanguage = (language || "").trim();

      if (reqStage && reqProgress != null && reqMessage) {
        await pool.request()
          .input("status", sql.NVarChar, processStatus)
          .input("stage", sql.NVarChar, reqStage.slice(0, 50))
          .input("pct", sql.Int, Math.max(0, Math.min(100, reqProgress)))
          .input("msg", sql.NVarChar, reqMessage.slice(0, 500))
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AudioUploads
            SET ProcessStatus = @status,
                ProcessStage = @stage,
                ProcessProgress = @pct,
                ProcessMessage = @msg
            WHERE AudioFileName = @fileName
          `);
      } else {
        await pool.request()
          .input("status", sql.NVarChar, processStatus)
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AudioUploads
            SET ProcessStatus = @status
            WHERE AudioFileName = @fileName
          `);
      }

      if (reqLanguage) {
        const countResult = await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");
        const exists = countResult.recordset[0].cnt > 0;
        if (exists) {
          await pool.request()
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .input("fileName", sql.NVarChar, audioFile)
            .query(`
              UPDATE AI_Processing_Result
              SET OriginalLanguage = @language, AudioLanguage = @language
              WHERE AudioFileName = @fileName
            `);
        } else {
          await pool.request()
            .input("fileName", sql.NVarChar, audioFile)
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .query(`
              INSERT INTO AI_Processing_Result (
                AudioFileName, OriginalLanguage, AudioLanguage, Status, Timestamp
              )
              VALUES (@fileName, @language, @language, 'Processing', GETDATE())
            `);
        }
      }

      if (type === "status") {
        await logCallEvent(pool, {
          audioFile,
          stage: stage || "status",
          message: message || processStatus || "Processing update",
          level: "INFO",
        });
      }

      if (type === "failed") {
        await logCallEvent(pool, {
          audioFile,
          stage: stage || "failed",
          message: message || processStatus || "Processing failed",
          level: "ERROR",
          detail: error ? String(error) : (message || null),
        });
      }
    }

    if (type === "language") {
      const reqLanguage = (language || "").trim();
      if (reqLanguage) {
        const countResult = await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");
        const exists = countResult.recordset[0].cnt > 0;
        if (exists) {
          await pool.request()
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .input("fileName", sql.NVarChar, audioFile)
            .query(`
              UPDATE AI_Processing_Result
              SET OriginalLanguage = @language, AudioLanguage = @language
              WHERE AudioFileName = @fileName
            `);
        } else {
          await pool.request()
            .input("fileName", sql.NVarChar, audioFile)
            .input("language", sql.NVarChar, reqLanguage.slice(0, 50))
            .query(`
              INSERT INTO AI_Processing_Result (
                AudioFileName, OriginalLanguage, AudioLanguage, Status, Timestamp
              )
              VALUES (@fileName, @language, @language, 'Processing', GETDATE())
            `);
        }
      }
    }

    if (type === "result") {
      const countResult = await pool.request()
        .input("fileName", sql.NVarChar, audioFile)
        .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");
      const exists = countResult.recordset[0].cnt > 0;

      if (exists) {
        await pool.request()
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AI_Processing_Result
            SET TranscribeOutput = @transcript, TranslateOutput = @transcript,
                AudioLanguage = @language, OriginalLanguage = @language,
                AudioDuration = @duration,
                AudioDiarization = @diarization, AIScoring = NULL,
                Sentiment = NULL, Status = 'Transcribed', Timestamp = GETDATE()
            WHERE AudioFileName = @fileName
          `);
      } else {
        await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .query(`
            INSERT INTO AI_Processing_Result (
              AudioFileName, TranscribeOutput, TranslateOutput,
              AudioLanguage, AudioDuration, AudioDiarization,
              Status, Timestamp
            )
            VALUES (
              @fileName, @transcript, @transcript,
              @language, @duration, @diarization,
              'Transcribed', GETDATE()
            )
          `);
      }

      await pool.request()
        .input("status", sql.NVarChar, processStatus || "Transcribed")
        .input("fileName", sql.NVarChar, audioFile)
        .query(`
          UPDATE AudioUploads
          SET ProcessStatus = @status
          WHERE AudioFileName = @fileName
        `);

      await logCallEvent(pool, {
        audioFile,
        stage: "transcription",
        message: "Transcription result stored",
        level: "INFO",
      });
    }

    if (type === "scoring") {
      const englishText = translateOutput || transcript || "";
      const scoringJson = scoringRaw || (scores ? JSON.stringify(scores) : null);
      const sentimentJson = sentiment ? JSON.stringify(sentiment) : null;
      const toneJson = toneAnalysis ? JSON.stringify(toneAnalysis) : null;
      const wpm = computeWPM(englishText, duration);
      const procTime = processingSeconds != null ? `${Math.round(processingSeconds)}s` : null;

      const countResult = await pool.request()
        .input("fileName", sql.NVarChar, audioFile)
        .query("SELECT COUNT(*) AS cnt FROM AI_Processing_Result WHERE AudioFileName = @fileName");

      if (countResult.recordset[0].cnt > 0) {
        await pool.request()
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("translateOutput", sql.NVarChar(sql.MAX), englishText)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .input("scoring", sql.NVarChar(sql.MAX), scoringJson)
          .input("sentimentJ", sql.NVarChar(sql.MAX), sentimentJson)
          .input("toneJ", sql.NVarChar(sql.MAX), toneJson)
          .input("compliance", sql.NVarChar, scriptCompliance || null)
          .input("fileName", sql.NVarChar, audioFile)
          .query(`
            UPDATE AI_Processing_Result
            SET TranscribeOutput = @transcript, TranslateOutput = @translateOutput,
                AudioLanguage = @language, OriginalLanguage = @language, AudioDuration = @duration,
                AudioDiarization = @diarization, AIScoring = @scoring,
                Sentiment = @sentimentJ, ToneAnalysis = @toneJ,
                ScriptCompliance = @compliance,
                Status = 'Success', Timestamp = GETDATE()
            WHERE AudioFileName = @fileName
          `);
      } else {
        await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .input("transcript", sql.NVarChar(sql.MAX), transcript)
          .input("translateOutput", sql.NVarChar(sql.MAX), englishText)
          .input("language", sql.NVarChar, language)
          .input("duration", sql.NVarChar, duration)
          .input("diarization", sql.NVarChar, diarizationStatus || "Unknown")
          .input("scoring", sql.NVarChar(sql.MAX), scoringJson)
          .input("sentimentJ", sql.NVarChar(sql.MAX), sentimentJson)
          .input("toneJ", sql.NVarChar(sql.MAX), toneJson)
          .input("compliance", sql.NVarChar, scriptCompliance || null)
          .query(`
            INSERT INTO AI_Processing_Result (
              AudioFileName, TranscribeOutput, TranslateOutput,
              AudioLanguage, AudioDuration, AudioDiarization,
              AIScoring, Sentiment, ToneAnalysis, ScriptCompliance,
              Status, Timestamp
            )
            VALUES (
              @fileName, @transcript, @translateOutput,
              @language, @duration, @diarization,
              @scoring, @sentimentJ, @toneJ, @compliance,
              'Success', GETDATE()
            )
          `);
      }

      try {
        const caaCheck = await pool.request()
          .input("fileName", sql.NVarChar, audioFile)
          .query("SELECT UploadID FROM Consolidated_Audio_Analysis WHERE AudioFileName = @fileName");
        if (caaCheck.recordset.length > 0) {
          // Phase 2d intelligence fields (sent merged into `scores` by the orchestrator).
          const s = scores || {};
          const numOrNull = (v) => (v == null || v === "" || isNaN(parseFloat(v)) ? null : parseFloat(v));
          let secondaryJson = "[]";
          try {
            const sec = Array.isArray(s.Secondary_Query_Types) ? s.Secondary_Query_Types : [];
            secondaryJson = JSON.stringify(sec);
          } catch (_) { secondaryJson = "[]"; }

          await pool.request()
            .input("translateOutput", sql.NVarChar(sql.MAX), englishText)
            .input("toneJ", sql.NVarChar(sql.MAX), toneJson)
            .input("sentimentJ", sql.NVarChar(sql.MAX), sentimentJson)
            .input("compliance", sql.NVarChar, scriptCompliance || null)
            .input("summaryText", sql.NVarChar(sql.MAX), summary || null)
            .input("language", sql.NVarChar, language)
            .input("duration", sql.NVarChar, duration)
            .input("wpm", sql.Float, wpm)
            .input("procTime", sql.NVarChar, procTime)
            .input("primaryQuery", sql.NVarChar, (s.Primary_Query_Type || "Other/General Info").toString().slice(0, 100))
            .input("secondaryQuery", sql.NVarChar(sql.MAX), secondaryJson)
            .input("escRequested", sql.NVarChar, (s.Escalation_Requested || "No").toString().slice(0, 10))
            .input("escActioned", sql.NVarChar, (s.Escalation_Actioned || "N/A").toString().slice(0, 10))
            .input("escCategory", sql.NVarChar, (s.Escalation_Category || "None").toString().slice(0, 50))
            .input("csatTransferred", sql.NVarChar, (s.CSAT_Transferred || "No").toString().slice(0, 10))
            .input("isLoan", sql.NVarChar, (s.Loan_Is_Loan_Call || "No").toString().slice(0, 10))
            .input("loanType", sql.NVarChar, (s.Loan_Type || "None").toString().slice(0, 50))
            .input("loanInterest", sql.NVarChar, (s.Loan_Interest || "None").toString().slice(0, 20))
            .input("emiAfford", sql.NVarChar, (s.EMI_Affordability || "Not Discussed").toString().slice(0, 20))
            .input("emiAmount", sql.Float, numOrNull(s.EMI_Amount))
            .input("loanAmount", sql.Float, numOrNull(s.Loan_Amount))
            .input("agentConvinced", sql.NVarChar, (s.Agent_Convinced || "N/A").toString().slice(0, 20))
            .input("successProb", sql.Float, numOrNull(s.Loan_Success_Probability) || 0)
            .input("intelSummary", sql.NVarChar(sql.MAX), (s.Intelligence_Summary || "").toString().slice(0, 4000))
            .input("intelBlob", sql.NVarChar(sql.MAX), JSON.stringify({
              Primary_Query_Type: s.Primary_Query_Type, Secondary_Query_Types: s.Secondary_Query_Types,
              Escalation_Requested: s.Escalation_Requested, Escalation_Actioned: s.Escalation_Actioned,
              Escalation_Category: s.Escalation_Category, CSAT_Transferred: s.CSAT_Transferred,
              Loan_Is_Loan_Call: s.Loan_Is_Loan_Call,
              Loan_Type: s.Loan_Type, Loan_Interest: s.Loan_Interest, EMI_Affordability: s.EMI_Affordability,
              EMI_Amount: s.EMI_Amount, Loan_Amount: s.Loan_Amount, Agent_Convinced: s.Agent_Convinced,
              Loan_Success_Probability: s.Loan_Success_Probability, Intelligence_Summary: s.Intelligence_Summary,
            }))
            .input("fileName", sql.NVarChar, audioFile)
            .query(`
              UPDATE Consolidated_Audio_Analysis
              SET TranslateOutput = @translateOutput, ToneAnalysis = @toneJ,
                  Sentiment = @sentimentJ, ScriptCompliance = @compliance,
                  AI_Summary = @summaryText, AudioLanguage = @language,
                  AudioDuration = @duration, AudioWPM = @wpm,
                  TotalDurationOfAIProcessing = @procTime, Status = 'Success',
                  AI_Primary_Query_Type = @primaryQuery,
                  AI_Secondary_Query_Types = @secondaryQuery,
                  AI_Escalation_Requested = @escRequested,
                  AI_Escalation_Actioned = @escActioned,
                  AI_Escalation_Category = @escCategory,
                  AI_CSAT_Transferred = @csatTransferred,
                  AI_Loan_Is_Loan_Call = @isLoan,
                  AI_Loan_Type = @loanType,
                  AI_Loan_Interest = @loanInterest,
                  AI_EMI_Affordability = @emiAfford,
                  AI_EMI_Amount = @emiAmount,
                  AI_Loan_Amount = @loanAmount,
                  AI_Agent_Convinced = @agentConvinced,
                  AI_Loan_Success_Probability = @successProb,
                  AI_Intelligence_Summary = @intelSummary,
                  AI_Call_Intelligence = @intelBlob
              WHERE AudioFileName = @fileName
            `);
        }
      } catch (_) { }

      await pool.request()
        .input("status", sql.NVarChar, processStatus || "AI Process Complete")
        .input("fileName", sql.NVarChar, audioFile)
        .query(`
          UPDATE AudioUploads SET ProcessStatus = @status WHERE AudioFileName = @fileName
        `);

      await logCallEvent(pool, {
        audioFile,
        stage: "scoring",
        message: "Scoring result stored",
        level: "INFO",
      });
    }

    writeLog(
      `[${getISTTimeString()}] Transcription callback OK: ${audioFile} (${type})` +
      (error ? ` error=${String(error).slice(0, 120)}` : "")
    );
    return res.status(200).json({ success: true });
  } catch (err) {
    writeLog(`[${getISTTimeString()}] Transcription callback failed for ${audioFile}: ${err.message}`);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/**
 * API 10.28.26 - POST /upload-audio
 * Uploads an audio file for analysis
 */
app.post("/upload-audio", authGate(sqlConnect, sql), uploadLimiter, handleAudioUpload, (req, res) => {
  uploadHandler.handleFileUpload(req, res, config);
});

async function ensureAudioUploadProgressColumns(pool) {
  const statements = [
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessStage')
      ALTER TABLE dbo.AudioUploads ADD ProcessStage NVARCHAR(50) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessProgress')
      ALTER TABLE dbo.AudioUploads ADD ProcessProgress INT NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AudioUploads' AND COLUMN_NAME = 'ProcessMessage')
      ALTER TABLE dbo.AudioUploads ADD ProcessMessage NVARCHAR(500) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'ASREngine')
      ALTER TABLE dbo.AI_Processing_Result ADD ASREngine NVARCHAR(200) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'ScoringModel')
      ALTER TABLE dbo.AI_Processing_Result ADD ScoringModel NVARCHAR(100) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'TranslationModel')
      ALTER TABLE dbo.AI_Processing_Result ADD TranslationModel NVARCHAR(100) NULL;`,
    `IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'dbo' AND TABLE_NAME = 'AI_Processing_Result' AND COLUMN_NAME = 'OriginalLanguage')
      ALTER TABLE dbo.AI_Processing_Result ADD OriginalLanguage NVARCHAR(50) NULL;`,
  ];
  for (const sqlText of statements) {
    await pool.request().query(sqlText);
  }
}

/**
 * API 10.29.27 - GET /api/audio-status/:audioFileName
 * Retrieves the processing status of an audio file
 */
app.get('/api/audio-status/:audioFileName', async (req, res) => {
  const audioFileName = decodeURIComponent(req.params.audioFileName);
  try {
    const pool = await connectToDatabase();
    await ensureAudioUploadProgressColumns(pool);
    await markStaleProcessingAsFailed(pool, audioFileName);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT
          AU.ProcessStatus,
          AU.ProcessStage,
          AU.ProcessProgress,
          AU.ProcessMessage,
          APR.Status AS AIStatus,
          APR.TranscribeOutput,
          COALESCE(APR.OriginalLanguage, APR.AudioLanguage) AS OriginalLanguage
        FROM AudioUploads AU
        LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.AudioFileName = @audioFileName
      `);
    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: "Audio file not found." });
    }
    const row = result.recordset[0];
    const status = normalizeDisplayStatus(
      row.ProcessStatus,
      row.AIStatus,
      row.TranscribeOutput
    );
    const progress = buildAudioProgressPayload(
      row.ProcessStatus,
      row.AIStatus,
      status,
      row.ProcessStage,
      row.ProcessProgress,
      row.ProcessMessage
    );
    const displayAiStatus = resolveDisplayAiStatus(
      row.ProcessStatus,
      row.AIStatus,
      progress.stage,
      status
    );
    const { failureStage, failureReason } = extractFailureDetails(row.ProcessStatus);
    const includeTranslate = !row.OriginalLanguage
      || !/english/i.test(row.OriginalLanguage || "");
    const subtasks = buildProcessingSubtasks(progress.stage, progress.progress, includeTranslate);

    return res.status(200).json({
      success: true,
      status,
      processStatus: row.ProcessStatus,
      aiStatus: row.AIStatus || null,
      displayAiStatus,
      stage: progress.stage,
      progress: progress.progress,
      message: failureReason || progress.message,
      subtasks,
      failureStage,
      failureReason,
      originalLanguage: row.OriginalLanguage || null,
      hasTranscript: Boolean(row.TranscribeOutput),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error fetching audio status:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.30.28 - GET /api/latest-audio
 * Retrieves details of the most recently uploaded audio file
 */
app.get('/api/latest-audio', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT TOP 1 AudioFileName, UploadID, ProcessStatus 
      FROM AudioUploads 
      ORDER BY UploadDate DESC
    `;
    const result = await pool.request().query(query);
    if (result.recordset.length > 0) {
      return res.status(200).send({ success: true, data: result.recordset[0] });
    } else {
      return res.status(404).send({ success: false, message: "No audio files found." });
    }
  } catch (error) {
    console.error("Error fetching latest audio:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * Parse duration value to total seconds.
 * Accepts "HH:MM:SS", "MM:SS", or plain numeric seconds.
 */
function parseHHMMSSToSeconds(hhmmss) {
  if (hhmmss == null || hhmmss === '') return 0;
  const str = String(hhmmss).trim();
  if (!isNaN(str) && str !== '') return Math.max(0, parseFloat(str));
  const parts = str.split(':').map(Number);
  if (parts.some(isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

/**
 * Strip Qwen3 / vLLM thinking blocks from LLM-generated transcript text.
 */
function stripLlmThinking(text) {
  if (!text) return '';
  return String(text)
    .replace(/<\s*(?:think|redacted_reasoning|reasoning)\s*>[\s\S]*?<\s*\/\s*(?:think|redacted_reasoning|reasoning)\s*>/gi, '')
    .replace(/<\s*(?:think|redacted_reasoning|reasoning)\s*>[\s\S]*$/gi, '')
    .trim();
}

/**
 * Count words in a diarized transcript, stripping timestamp/speaker prefixes and LLM meta.
 */
function countTranscriptWords(text) {
  if (!text) return 0;
  let cleaned = stripLlmThinking(text);
  const diarizedLines = cleaned
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:/.test(l));
  if (diarizedLines.length > 0) {
    cleaned = diarizedLines.join('\n');
  }
  cleaned = cleaned.replace(/^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]*\)\s*:\s*/gm, '');
  return cleaned.split(/\s+/).filter(Boolean).length;
}

/**
 * Compute WPM from transcript text and duration string.
 */
function computeWPM(transcript, durationStr) {
  const totalSec = parseHHMMSSToSeconds(durationStr);
  if (totalSec <= 0) return null;
  const words = countTranscriptWords(transcript);
  if (words <= 0) return null;
  return Math.round((words / (totalSec / 60.0)) * 100) / 100;
}

/**
 * API 10.31.29 - GET /api/audio-details/:audioFileName
 * Retrieves details of a specific audio file
 */
app.get('/api/audio-details/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);

    let consolidatedRow = null;
    try {
      const result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT AudioFileName, CallType, AgentName, AgentID, AgentSupervisor, AgentManager, AgentAuditor,
                 UploadDate, Status, AudioLanguage, AudioDuration, TotalDurationOfAIProcessing,
                 AudioWPM, AgentLocation, TranslateOutput
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @filename
        `);
      if (result.recordset.length > 0) {
        consolidatedRow = result.recordset[0];
      }
    } catch (consolidatedErr) {
      if (!String(consolidatedErr.message).includes("Consolidated_Audio_Analysis")) {
        throw consolidatedErr;
      }
    }

    if (consolidatedRow) {
      if (consolidatedRow.AudioWPM == null) {
        let transcript = consolidatedRow.TranslateOutput;
        let duration = consolidatedRow.AudioDuration;

        if (!transcript || !duration) {
          try {
            const aprResult = await pool.request()
              .input('fn', sql.NVarChar, filename)
              .query(`
                SELECT COALESCE(NULLIF(TranslateOutput, ''), TranscribeOutput) AS TranslateOutput,
                       AudioDuration
                FROM AI_Processing_Result
                WHERE AudioFileName = @fn
              `);
            if (aprResult.recordset.length > 0) {
              if (!transcript) transcript = aprResult.recordset[0].TranslateOutput;
              if (!duration) duration = aprResult.recordset[0].AudioDuration;
            }
          } catch (_) { /* AI_Processing_Result might not exist */ }
        }

        if (transcript && duration) {
          consolidatedRow.AudioWPM = computeWPM(transcript, duration);
          if (consolidatedRow.AudioWPM != null) {
            pool.request()
              .input('wpm', sql.Float, consolidatedRow.AudioWPM)
              .input('fn', sql.NVarChar, filename)
              .query('UPDATE Consolidated_Audio_Analysis SET AudioWPM = @wpm WHERE AudioFileName = @fn')
              .catch(() => {});
          }
        }
      }
      delete consolidatedRow.TranslateOutput;
      return res.status(200).json({ success: true, audioDetails: consolidatedRow });
    }

    const fallback = await pool.request()
      .input('filename', sql.NVarChar, filename)
      .query(`
        SELECT
          AU.AudioFileName,
          AU.CallType,
          AU.SelectedAgent AS AgentName,
          NULL AS AgentID,
          NULL AS AgentSupervisor,
          NULL AS AgentManager,
          NULL AS AgentAuditor,
          AU.UploadDate,
          COALESCE(APR.Status, AU.ProcessStatus) AS Status,
          COALESCE(APR.AudioLanguage, 'Unknown') AS AudioLanguage,
          COALESCE(APR.AudioDuration, '00:00:00') AS AudioDuration,
          NULL AS TotalDurationOfAIProcessing,
          NULL AS AudioWPM,
          NULL AS AgentLocation,
          APR.TranslateOutput
        FROM AudioUploads AU
        LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.AudioFileName = @filename
      `);
    if (fallback.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Audio file not found.' });
    }
    const row = fallback.recordset[0];
    if (row.AudioWPM == null && row.AudioDuration && row.TranslateOutput) {
      row.AudioWPM = computeWPM(row.TranslateOutput, row.AudioDuration);
    }
    if (row.AudioWPM == null && row.AudioDuration) {
      try {
        const trResult = await pool.request()
          .input('fn', sql.NVarChar, filename)
          .query(`
            SELECT COALESCE(NULLIF(TranslateOutput, ''), TranscribeOutput) AS TranslateOutput
            FROM AI_Processing_Result
            WHERE AudioFileName = @fn
          `);
        if (trResult.recordset.length > 0 && trResult.recordset[0].TranslateOutput) {
          row.AudioWPM = computeWPM(trResult.recordset[0].TranslateOutput, row.AudioDuration);
        }
      } catch (_) { }
    }
    delete row.TranslateOutput;
    res.status(200).json({ success: true, audioDetails: row });
  } catch (error) {
    console.error('Error fetching audio details:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * POST /api/backfill-wpm
 * Backfills AudioWPM for Consolidated_Audio_Analysis rows where it is NULL.
 */
app.post('/api/backfill-wpm', async (req, res) => {
  try {
    const pool = await sqlConnect();
    let updated = 0;

    const rows = await pool.request().query(`
      SELECT CAA.AudioFileName, CAA.AudioDuration,
             COALESCE(NULLIF(CAA.TranslateOutput, ''),
                      NULLIF(APR.TranslateOutput, ''),
                      APR.TranscribeOutput) AS TranslateText
      FROM Consolidated_Audio_Analysis CAA
      LEFT JOIN AI_Processing_Result APR ON CAA.AudioFileName = APR.AudioFileName
      WHERE CAA.AudioWPM IS NULL
        AND CAA.AudioDuration IS NOT NULL
        AND (CAA.TranslateOutput IS NOT NULL OR APR.TranslateOutput IS NOT NULL
             OR APR.TranscribeOutput IS NOT NULL)
    `);

    for (const row of rows.recordset) {
      const wpm = computeWPM(row.TranslateText, row.AudioDuration);
      if (wpm != null) {
        await pool.request()
          .input('wpm', sql.Float, wpm)
          .input('fn', sql.NVarChar, row.AudioFileName)
          .query('UPDATE Consolidated_Audio_Analysis SET AudioWPM = @wpm WHERE AudioFileName = @fn');
        updated++;
      }
    }

    res.status(200).json({ success: true, message: `Backfilled WPM for ${updated} records.`, updated });
  } catch (error) {
    console.error('Error backfilling WPM:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});

/**
 * API 10.32.30 - GET /api/audio/stream/:filename
 * Serves an audio file (authenticated via /api auth gate).
 */
app.get("/api/audio/stream/:filename", (req, res) => {
  const safeName = path.basename(String(req.params.filename || ""));
  if (!safeName || safeName !== req.params.filename) {
    return res.status(400).json({ success: false, message: "Invalid audio filename." });
  }
  const audioFilePath = path.join(uploadDirectory, safeName);
  const resolvedUploadDir = path.resolve(uploadDirectory);
  const resolvedFilePath = path.resolve(audioFilePath);
  if (!resolvedFilePath.startsWith(resolvedUploadDir + path.sep) && resolvedFilePath !== resolvedUploadDir) {
    return res.status(400).json({ success: false, message: "Invalid audio path." });
  }
  if (fs.existsSync(resolvedFilePath)) {
    return res.sendFile(resolvedFilePath);
  }
  return res.status(404).json({ success: false, message: "Audio file not found." });
});

/**
 * Legacy unauthenticated audio route — disabled for security.
 */
app.get("/audio/:filename", (_req, res) => {
  return res.status(401).json({
    success: false,
    message: "Authentication required. Use GET /api/audio/stream/:filename with a valid session token.",
  });
});

/**
 * API - POST /api/download-secure-audio
 * Creates a password-protected ZIP containing the audio file and metadata.csv,
 * then streams it back as a download. Requires authenticated session.
 */
app.post("/api/download-secure-audio", async (req, res) => {
  // archiver v8 broke the plugin API; resolve archiver v7 bundled with archiver-zip-encrypted
  const archiverPath = require.resolve("archiver", { paths: [require.resolve("archiver-zip-encrypted")] });
  const archiver = require(archiverPath);
  const ZipEncrypted = require("archiver-zip-encrypted");
  archiver.registerFormat("zip-encrypted", ZipEncrypted);
  const { stringify } = require("csv-stringify/sync");

  const { filename, password } = req.body || {};
  if (!filename || typeof filename !== "string") {
    return res.status(400).json({ success: false, message: "Filename is required." });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
  }

  const safeFilename = path.basename(filename);
  const audioFilePath = path.join(uploadDirectory, safeFilename);
  if (!fs.existsSync(audioFilePath)) {
    return res.status(404).json({ success: false, message: "Audio file not found on server." });
  }

  try {
    const pool = await sqlConnect();

    let meta = {};
    try {
      const result = await pool.request()
        .input("fn", sql.NVarChar, safeFilename)
        .query(`
          SELECT AudioFileName, CallType, AgentName, AgentID, AgentSupervisor, AgentManager,
                 UploadDate, Status, AudioLanguage, AudioDuration, TotalDurationOfAIProcessing,
                 AudioWPM, AgentLocation, AI_Overall_Scoring, Manual_Overall_Scoring,
                 AI_Script_Compliance
          FROM Consolidated_Audio_Analysis
          WHERE AudioFileName = @fn
        `);
      if (result.recordset.length > 0) meta = result.recordset[0];
    } catch (consolidatedErr) {
      if (!isMissingDbObjectError(consolidatedErr)) throw consolidatedErr;
    }

    if (!meta.AudioFileName) {
      try {
        const fb = await pool.request()
          .input("fn", sql.NVarChar, safeFilename)
          .query(`
            SELECT AU.AudioFileName, AU.CallType, AU.SelectedAgent AS AgentName,
                   AU.UploadDate, COALESCE(APR.Status, AU.ProcessStatus) AS Status,
                   COALESCE(APR.AudioLanguage, 'Unknown') AS AudioLanguage,
                   COALESCE(APR.AudioDuration, '00:00:00') AS AudioDuration
            FROM AudioUploads AU
            LEFT JOIN AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
            WHERE AU.AudioFileName = @fn
          `);
        if (fb.recordset.length > 0) meta = fb.recordset[0];
      } catch (_) { /* table may not exist */ }
    }

    const csvRows = [{
      FileName: meta.AudioFileName || safeFilename,
      UploadDate: meta.UploadDate ? new Date(meta.UploadDate).toISOString() : "",
      AgentName: meta.AgentName || "",
      AgentID: meta.AgentID || "",
      AgentSupervisor: meta.AgentSupervisor || "",
      AgentManager: meta.AgentManager || "",
      CallType: meta.CallType || "",
      Language: meta.AudioLanguage || "",
      Duration: meta.AudioDuration || "",
      SpeechRateWPM: meta.AudioWPM != null ? String(meta.AudioWPM) : "",
      AIScore: meta.AI_Overall_Scoring != null ? String(meta.AI_Overall_Scoring) : "",
      ManualScore: meta.Manual_Overall_Scoring != null ? String(meta.Manual_Overall_Scoring) : "",
      Compliance: meta.AI_Script_Compliance != null ? String(meta.AI_Script_Compliance) : "",
      Status: meta.Status || "",
      AgentLocation: meta.AgentLocation || "",
      AIProcessingDuration: meta.TotalDurationOfAIProcessing || "",
      ExportedAt: new Date().toISOString(),
      ExportedBy: req.user ? req.user.username : "unknown",
    }];
    const csvContent = stringify(csvRows, { header: true });

    const zipName = safeFilename.replace(/\.[^.]+$/, "") + "_secure.zip";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${zipName}"`);

    const archive = archiver.create("zip-encrypted", {
      zlib: { level: 9 },
      encryptionMethod: "aes256",
      password: password,
    });

    archive.on("error", (err) => {
      console.error("[download-secure-audio] Archiver error:", err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, message: "ZIP creation failed." });
      }
    });

    archive.pipe(res);
    archive.file(audioFilePath, { name: safeFilename });
    archive.append(Buffer.from(csvContent, "utf-8"), { name: "metadata.csv" });
    await archive.finalize();
  } catch (error) {
    console.error("[download-secure-audio] Server error:", error.message, error.stack);
    if (!res.headersSent) {
      const detail = error.message || "Unknown error";
      res.status(500).json({ success: false, message: `Secure download failed: ${detail}` });
    }
  }
});

/**
 * API 10.33.31 - GET /api/translate-output/:audioFileName
 * Retrieves original + translated transcription for an audio file.
 *
 * Schema note: the original-language transcription (TranscribeOutput) and the
 * OriginalLanguage live ONLY in AI_Processing_Result. Consolidated_Audio_Analysis
 * holds just TranslateOutput + AudioLanguage. AI_Processing_Result is a superset
 * (every consolidated row has a matching APR row), so we drive from APR and LEFT
 * JOIN CAA to prefer the consolidated translation when present.
 */
app.get('/api/translate-output/:filename', async (req, res) => {
  try {
    const pool = await sqlConnect();
    const filename = decodeURIComponent(req.params.filename);

    try {
      const result = await pool.request()
        .input('filename', sql.NVarChar, filename)
        .query(`
          SELECT
            COALESCE(NULLIF(CAA.TranslateOutput, ''), APR.TranslateOutput, '') AS TranslateOutput,
            COALESCE(APR.TranscribeOutput, '') AS TranscribeOutput,
            COALESCE(NULLIF(APR.OriginalLanguage, ''), NULLIF(APR.AudioLanguage, ''), 'Hindi') AS OriginalLanguage
          FROM AI_Processing_Result APR
          LEFT JOIN Consolidated_Audio_Analysis CAA ON CAA.AudioFileName = APR.AudioFileName
          WHERE APR.AudioFileName = @filename
        `);
      if (result.recordset.length > 0) {
        const row = result.recordset[0];
        return res.status(200).json({
          success: true,
          transcribeOutput: row.TranscribeOutput || '',
          translateOutput: row.TranslateOutput || '',
          originalLanguage: row.OriginalLanguage || 'Hindi',
        });
      }
    } catch (aprErr) {
      if (!String(aprErr.message).includes("AI_Processing_Result")) {
        throw aprErr;
      }
    }

    // Last-resort fallback: consolidated table only (translation, no original).
    const fallback = await pool.request()
      .input('filename', sql.NVarChar, filename)
      .query(`
        SELECT TranslateOutput, AudioLanguage
        FROM Consolidated_Audio_Analysis
        WHERE AudioFileName = @filename
      `);
    if (fallback.recordset.length === 0) {
      return res.status(404).json({ success: false, message: 'Transcription not found.' });
    }
    const row = fallback.recordset[0];
    res.status(200).json({
      success: true,
      transcribeOutput: '',
      translateOutput: row.TranslateOutput || '',
      originalLanguage: row.AudioLanguage || 'Hindi',
    });
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
});


/* 10.7 Agent Dashboard APIs */
/**
 * API 10.55.53 - GET /api/agent-profile
 * Retrieves an agent's profile information
 */
app.get("/api/agent-profile", async (req, res) => {
  const username = req.query.username || req.user?.username;
  if (!username) {
    return res.status(400).json({ success: false, message: "Missing 'username' query param." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, username);
    if (!identity) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const userResult = await pool.request()
      .input("username", sql.NVarChar, identity.loginUsername)
      .query(`SELECT Username, Email, AccountType FROM dbo.Users WHERE Username = @username`);
    const userRow = userResult.recordset[0] || { Username: identity.loginUsername, Email: identity.agentEmail };
    let agentRow = null;
    if (identity.hasAgentRecord) {
      const agentResult = await pool.request()
        .input("agentName", sql.NVarChar, identity.agentName)
        .query(`
          SELECT agent_id, agent_name, agent_email, agent_mobile,
                 agent_type, agent_creation_date, agent_location,
                 supervisor, manager, auditor, notes
          FROM dbo.Agents
          WHERE agent_name = @agentName
        `);
      agentRow = agentResult.recordset[0] || null;
    }
    return res.status(200).json({
      success: true,
      user: userRow,
      agent: agentRow,
      identity,
    });
  } catch (error) {
    console.error("Error in /api/agent-profile:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.56.54 - GET /api/agent-stats
 * Retrieves an agent's performance statistics
 */
app.get("/api/agent-stats", async (req, res) => {
  const { agentName } = req.query;
  if (!agentName) {
    return res.status(400).json({ success: false, message: "Missing 'agentName' query param." });
  }
  try {
    const pool = await connectToDatabase();
    const inboundQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT AVG(APR.AIScoring) AS inboundScore
        FROM dbo.AudioUploads AU
        JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.SelectedAgent = @agentName AND AU.CallType = 'inbound' AND APR.AIScoring IS NOT NULL
      `);
    const inboundScore = inboundQ.recordset[0].inboundScore || 0;
    const outboundQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT AVG(APR.AIScoring) AS outboundScore
        FROM dbo.AudioUploads AU
        JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.SelectedAgent = @agentName AND AU.CallType = 'outbound' AND APR.AIScoring IS NOT NULL
      `);
    const outboundScore = outboundQ.recordset[0].outboundScore || 0;
    const calls1DayQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT COUNT(*) AS calls1Day
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName AND UploadDate >= DATEADD(DAY, -1, GETDATE())
      `);
    const calls1Day = calls1DayQ.recordset[0].calls1Day;
    const calls7DaysQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT COUNT(*) AS calls7Days
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName AND UploadDate >= DATEADD(DAY, -7, GETDATE())
      `);
    const calls7Days = calls7DaysQ.recordset[0].calls7Days;
    const calls30DaysQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT COUNT(*) AS calls30Days
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName AND UploadDate >= DATEADD(DAY, -30, GETDATE())
      `);
    const calls30Days = calls30DaysQ.recordset[0].calls30Days;
    const monthlyScoreQ = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT AVG(APR.AIScoring) AS monthlyScore
        FROM dbo.AudioUploads AU
        JOIN dbo.AI_Processing_Result APR ON AU.AudioFileName = APR.AudioFileName
        WHERE AU.SelectedAgent = @agentName AND AU.UploadDate >= DATEADD(DAY, -30, GETDATE()) AND APR.AIScoring IS NOT NULL
      `);
    const monthlyScore = monthlyScoreQ.recordset[0].monthlyScore || 0;
    return res.status(200).json({
      success: true,
      inboundScore: parseFloat(inboundScore.toFixed(2)),
      outboundScore: parseFloat(outboundScore.toFixed(2)),
      calls1Day,
      calls7Days,
      calls30Days,
      monthlyScore: parseFloat(monthlyScore.toFixed(2))
    });
  } catch (error) {
    console.error("Error in /api/agent-stats:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.57.55 - GET /api/agent-calls
 * Retrieves an agent's call history
 */
app.get("/api/agent-calls", async (req, res) => {
  const { agentName } = req.query;
  if (!agentName) {
    return res.status(400).json({ success: false, message: "Missing 'agentName' query param." });
  }
  try {
    const pool = await connectToDatabase();
    const callsResult = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT UploadID, UploadDate, AudioFileName, CallType, ProcessStatus
        FROM dbo.AudioUploads
        WHERE SelectedAgent = @agentName
        ORDER BY UploadDate DESC
      `);
    return res.status(200).json({ success: true, calls: callsResult.recordset });
  } catch (error) {
    console.error("Error in /api/agent-calls:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.58.56 - GET /api/agent/dashboard
 * Retrieves detailed dashboard data for an agent
 */
app.get("/api/agent/dashboard", async (req, res) => {
  const requestedUser = req.query.username || req.user?.username;
  if (!requestedUser) {
    return res.status(400).json({ success: false, message: "Missing 'username' query param." });
  }
  if (!assertSelfOrElevated(req, requestedUser)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, requestedUser);
    if (!identity) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    const agentName = identity.agentName;
    const todayStr = new Date().toISOString().split("T")[0];

    const lastDayQuery = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT MAX(CallDate) AS LastWorkingDay, COUNT(*) AS TotalCallsAllTime
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER(@agentName);
      `);
    const lastDayRow = lastDayQuery.recordset[0] || {};
    const lastWorkingDay = lastDayRow.LastWorkingDay || null;
    const totalCallsAllTime = lastDayRow.TotalCallsAllTime || 0;

    let totalCallsLastDay = 0;
    let ahtMinutesForLastDay = 0;
    let lowestScoringFeedbackLastDay = null;

    if (lastWorkingDay) {
      const dateOnly = lastWorkingDay.toISOString().split("T")[0];
      const ahtRes = await pool.request()
        .input("agentName", sql.NVarChar, agentName)
        .input("dateOnly", sql.VarChar, dateOnly)
        .query(`
          SELECT COUNT(*) AS CallCountLastDay,
                 AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) AS AvgSec
          FROM dbo.AI_Details_Scoring
          WHERE LOWER(AgentName) = LOWER(@agentName)
            AND CONVERT(VARCHAR(10), CallDate, 120) = @dateOnly;
        `);
      const ahtRow = ahtRes.recordset[0] || {};
      totalCallsLastDay = ahtRow.CallCountLastDay || 0;
      const avgSec = ahtRow.AvgSec || 0;
      ahtMinutesForLastDay = Math.round(avgSec / 60);

      const feedbackRes = await pool.request()
        .input("agentName", sql.NVarChar, agentName)
        .input("dateOnly", sql.VarChar, dateOnly)
        .query(`
          SELECT TOP 1 Feedback
          FROM dbo.AI_Details_Scoring
          WHERE LOWER(AgentName) = LOWER(@agentName)
            AND Feedback IS NOT NULL AND LTRIM(RTRIM(Feedback)) <> ''
            AND CONVERT(VARCHAR(10), CallDate, 120) = @dateOnly
          ORDER BY TRY_CAST(Overall_Scoring AS DECIMAL(10,2)) ASC;
        `);
      if (feedbackRes.recordset.length > 0) {
        lowestScoringFeedbackLastDay = feedbackRes.recordset[0].Feedback;
      }
    }

    const todayRes = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .input("todayStr", sql.VarChar, todayStr)
      .query(`
        SELECT COUNT(*) AS callsToday,
               AVG(TRY_CAST(Overall_Scoring AS DECIMAL(10,2))) AS avgScoreToday
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER(@agentName)
          AND CONVERT(VARCHAR(10), CallDate, 120) = @todayStr;
      `);
    const todayRow = todayRes.recordset[0] || {};
    const callsToday = todayRow.callsToday || 0;
    const avgScoreToday = todayRow.avgScoreToday
      ? parseFloat(Number(todayRow.avgScoreToday).toFixed(1))
      : null;

    const scoringRes = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT FORMAT(CallDate, 'yyyy-MM-dd') AS dateStr,
               AVG(TRY_CAST(Overall_Scoring AS DECIMAL(10,2))) AS avgScore
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER(@agentName)
        GROUP BY FORMAT(CallDate, 'yyyy-MM-dd')
        ORDER BY dateStr;
      `);
    const overallScoring = scoringRes.recordset.map((r) => ({
      dateStr: r.dateStr,
      avgScore: r.avgScore || 0,
    }));

    const kpiRes = await pool.request()
      .input("agentName", sql.NVarChar, agentName)
      .query(`
        SELECT 'Empathy' AS name, AVG(TRY_CAST(Empathy AS DECIMAL(10,2))) AS value
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName)
        UNION ALL
        SELECT 'Adherence', AVG(TRY_CAST(Adherence_to_Protocol AS DECIMAL(10,2)))
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName)
        UNION ALL
        SELECT 'QueryHandling', AVG(TRY_CAST(Query_Handling AS DECIMAL(10,2)))
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName)
        UNION ALL
        SELECT 'Resolution', AVG(TRY_CAST(Resolution_Assurance AS DECIMAL(10,2)))
        FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER(@agentName);
      `);
    const kpiMetrics = kpiRes.recordset
      .filter((r) => r.value != null)
      .map((r) => ({
        name: r.name,
        value: parseFloat(Number(r.value).toFixed(1)),
      }));

    let csat = { transferred: 0, total: 0 };
    try {
      const csatRes = await pool.request()
        .input("agentName", sql.NVarChar, agentName)
        .query(`
          SELECT
            SUM(CASE WHEN LOWER(LTRIM(RTRIM(AI_CSAT_Transferred))) = 'yes' THEN 1 ELSE 0 END) AS transferred,
            COUNT(*) AS total
          FROM dbo.Consolidated_Audio_Analysis
          WHERE Status = 'Success' AND LOWER(AgentName) = LOWER(@agentName);
        `);
      const csatRow = csatRes.recordset[0] || {};
      csat = { transferred: csatRow.transferred || 0, total: csatRow.total || 0 };
    } catch (csatErr) {
      if (!isMissingDbObjectError(csatErr)) throw csatErr;
    }

    const buildAgentRecentCallsQuery = ({ withCallAudits = true } = {}) => {
      const auditJoin = withCallAudits
        ? " LEFT JOIN dbo.CallAudits CA ON CA.AudioFileName = ADS.AudioFileName"
        : "";
      const manualScoreExpr = withCallAudits
        ? "COALESCE(TRY_CAST(CA.OverallManualScore AS DECIMAL(10,2)), 0)"
        : "CAST(0 AS DECIMAL(10,2))";
      const hasAuditExpr = withCallAudits
        ? "CASE WHEN CA.AuditID IS NOT NULL THEN 1 ELSE 0 END"
        : "0";
      const auditorNameExpr = withCallAudits
        ? "CA.AuditorUsername"
        : "CAST(NULL AS NVARCHAR(100))";
      return `
        SELECT TOP 8
          ADS.CallDate,
          DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, ADS.AudioDuration)) AS durationSec,
          TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) AS overallScoring,
          ADS.Call_Type,
          ADS.Feedback,
          AU.UploadID AS callId,
          ${manualScoreExpr} AS manualScore,
          ${hasAuditExpr} AS hasManualAudit,
          ${auditorNameExpr} AS auditorName
        FROM dbo.AI_Details_Scoring ADS
        LEFT JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
        ${auditJoin}
        WHERE LOWER(ADS.AgentName) = LOWER(@agentName)
        ORDER BY ADS.CallDate DESC;
      `;
    };

    const recentCallsRequest = pool.request().input("agentName", sql.NVarChar, agentName);
    let recentCallsRes;
    try {
      recentCallsRes = await recentCallsRequest.query(buildAgentRecentCallsQuery({ withCallAudits: true }));
    } catch (auditErr) {
      if (!isMissingDbObjectError(auditErr)) throw auditErr;
      recentCallsRes = await recentCallsRequest.query(buildAgentRecentCallsQuery({ withCallAudits: false }));
    }
    const callHistory = recentCallsRes.recordset.map((row) => ({
      callDateTime: row.CallDate,
      durationSec: row.durationSec || 0,
      overallScoring: row.overallScoring || 0,
      callType: row.Call_Type || "N/A",
      feedback: row.Feedback || "",
      callId: row.callId ?? null,
      manualScore: row.manualScore != null ? parseFloat(Number(row.manualScore).toFixed(1)) : null,
      hasManualAudit: row.hasManualAudit === 1 || row.hasManualAudit === true,
      auditorName: row.auditorName || null,
    }));

    return res.status(200).json({
      success: true,
      identity,
      lastWorkingDay,
      totalCallsAllTime,
      totalCallsLastDay,
      callsToday,
      avgScoreToday,
      ahtMinutesForLastDay,
      overallScoring,
      kpiMetrics,
      csat,
      lowestScoringFeedback: lowestScoringFeedbackLastDay,
      callHistory,
    });
  } catch (err) {
    console.error("Error fetching agent dashboard data:", err);
    return res.status(500).json({ success: false, message: "Server error fetching agent dashboard data." });
  }
});

/* 10.8 Briefing APIs */
/**
 * API 10.59.57 - POST /api/upload-briefing
 * Uploads a briefing for a user
 */
app.post('/api/upload-briefing', async (req, res) => {
  const { username, content, teamLeaderUsername } = req.body;
  const uploader = req.user?.username || username;
  if (!uploader || !content) {
    return res.status(400).json({ success: false, message: "Username and content are required." });
  }
  try {
    const pool = await connectToDatabase();
    const ownerUsernames = await resolveBriefingOwnerUsernames(
      pool,
      uploader,
      teamLeaderUsername
    );
    if (ownerUsernames.length === 0) {
      return res.status(400).json({ success: false, message: "Unable to resolve team leader for briefing." });
    }

    for (const owner of ownerUsernames) {
      await pool.request()
        .input('username', sql.NVarChar, owner)
        .input('content', sql.NVarChar(sql.MAX), content)
        .query(`
          INSERT INTO dbo.briefing (username, upload_date, upload_time, briefing_content, created_at)
          VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @content, GETDATE())
        `);
    }
    res.status(200).json({ success: true, message: "Briefing uploaded successfully." });
  } catch (error) {
    console.error("Error uploading briefing:", error);
    res.status(500).json({ success: false, message: "Error uploading briefing." });
  }
});

/**
 * API 10.60.58 - GET /api/briefing/today-latest
 * Retrieves the latest briefing for an agent's supervisor
 */
app.get("/api/briefing/today-latest", async (req, res) => {
  const agentUsername = req.query.agentUsername || req.user?.username;
  if (!agentUsername) {
    return res.status(400).json({ success: false, message: "Missing 'agentUsername' query param." });
  }
  if (!assertSelfOrElevated(req, agentUsername)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, agentUsername);
    if (!identity) {
      return res.status(200).json({ success: true, briefing: "No briefing available.", empty: true });
    }

    let supervisor = identity.supervisor;
    if (!supervisor) {
      return res.status(200).json({
        success: true,
        briefing: "No supervisor assigned — briefing will appear here once your team lead publishes one.",
        empty: true,
      });
    }

    const result = await pool.request()
      .input("supervisor", sql.NVarChar, supervisor)
      .query(`
        SELECT TOP 1 briefing_content
        FROM dbo.briefing
        WHERE LOWER(username) = LOWER(@supervisor)
          AND CAST(upload_date AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY created_at DESC
      `);

    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, briefing: "No briefing available for today.", empty: true });
    }
    return res.status(200).json({
      success: true,
      briefing: result.recordset[0].briefing_content || "No briefing available.",
      empty: !result.recordset[0].briefing_content,
    });
  } catch (error) {
    console.error("Error fetching latest briefing:", error);
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({
        success: true,
        briefing: "Briefing is not configured yet. Contact your team lead.",
        empty: true,
      });
    }
    return res.status(500).json({ success: false, message: "Server error fetching briefing." });
  }
});

/* 10.9 Knowledge Test APIs */
/**
 * API 10.61.59 - POST /api/upload-knowledge-test
 * Uploads knowledge test questions
 */
app.post("/api/upload-knowledge-test", async (req, res) => {
  const { username, questions, createdAt } = req.body;
  if (!username || !questions || !Array.isArray(questions) || questions.length < 1) {
    return res.status(400).json({ success: false, message: "Username and at least one question are required." });
  }
  const invalid = questions.some(
    (q) => !q?.question?.trim() || !Array.isArray(q.options) || q.options.some((o) => !String(o || "").trim()) || !q?.correctAnswer?.trim()
  );
  if (invalid) {
    return res.status(400).json({ success: false, message: "Each question must include text, four options, and a correct answer." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("questions", sql.NVarChar(sql.MAX), JSON.stringify(questions))
      .input("createdAt", sql.DateTime, new Date(createdAt))
      .query(`
        INSERT INTO dbo.KnowledgeTestQuestions (TeamLeaderUsername, UploadDate, UploadTime, CreatedAt, Questions)
        VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @createdAt, @questions)
      `);
    return res.status(200).json({ success: true, message: "Knowledge Test questions uploaded successfully." });
  } catch (error) {
    console.error("Error uploading Knowledge Test questions:", error);
    return res.status(500).json({ success: false, message: "Server error uploading Knowledge Test questions." });
  }
});

/**
 * API 10.62.60 - GET /api/knowledge-test-latest
 * Retrieves the latest knowledge test questions for an agent's supervisor
 */
app.get("/api/knowledge-test-latest", async (req, res) => {
  const agentUsername = req.query.agentUsername || req.user?.username;
  if (!agentUsername) {
    return res.status(400).json({ success: false, message: "Missing 'agentUsername' query param." });
  }
  if (!assertSelfOrElevated(req, agentUsername)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }

  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, agentUsername);
    if (!identity) {
      return res.status(200).json({ success: true, questions: [] });
    }

    const supervisor = identity.supervisor;
    if (!supervisor) {
      return res.status(200).json({ success: true, questions: [] });
    }

    const result = await pool.request()
      .input("supervisor", sql.NVarChar, supervisor)
      .query(`
        SELECT TOP 1 Questions
        FROM dbo.KnowledgeTestQuestions
        WHERE LOWER(TeamLeaderUsername) = LOWER(@supervisor)
          AND CreatedAt <= GETDATE()
        ORDER BY CreatedAt DESC
      `);
    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, questions: [] });
    }
    let questions;
    try {
      questions = JSON.parse(result.recordset[0].Questions);
    } catch (error) {
      console.error("Error parsing Knowledge Test questions JSON:", error);
      return res.status(500).json({ success: false, message: "Error parsing Knowledge Test questions." });
    }
    return res.status(200).json({ success: true, questions });
  } catch (error) {
    console.error("Error fetching Knowledge Test questions:", error);
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, questions: [] });
    }
    return res.status(500).json({ success: false, message: "Server error fetching Knowledge Test questions." });
  }
});

/**
 * API 10.63.61 - POST /api/submit-knowledge-test
 * Submits knowledge test answers
 */
app.post("/api/submit-knowledge-test", async (req, res) => {
  const { username, answers, createdAt } = req.body;
  if (!username || !answers || !Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: "Username and answers are required." });
  }
  try {
    const pool = await sql.connect(config);
    const latestQuestionsResult = await pool.request()
      .query(`
        SELECT TOP 1 Questions
        FROM dbo.KnowledgeTestQuestions
        WHERE CreatedAt <= GETDATE()
        ORDER BY CreatedAt DESC
      `);
    if (latestQuestionsResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No Knowledge Test questions found." });
    }
    let questions;
    try {
      questions = JSON.parse(latestQuestionsResult.recordset[0].Questions);
    } catch (error) {
      console.error("Error parsing Knowledge Test questions JSON:", error);
      return res.status(500).json({ success: false, message: "Error parsing Knowledge Test questions." });
    }
    let correctAnswers = 0;
    answers.forEach((answer, index) => {
      if (answer.selectedAnswer === questions[index].correctAnswer) {
        correctAnswers++;
      }
    });
    const wrongAnswers = answers.length - correctAnswers;
    const totalScore = correctAnswers;
    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("answers", sql.NVarChar(sql.MAX), JSON.stringify(answers))
      .input("correctAnswers", sql.Int, correctAnswers)
      .input("wrongAnswers", sql.Int, wrongAnswers)
      .input("totalScore", sql.Int, totalScore)
      .input("createdAt", sql.DateTime, new Date(createdAt))
      .query(`
        INSERT INTO dbo.KnowledgeTestResults (Username, TestDate, TestTime, Answers, CorrectAnswers, WrongAnswers, TotalScore, CreatedAt)
        VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @answers, @correctAnswers, @wrongAnswers, @totalScore, @createdAt)
      `);
    return res.status(200).json({
      success: true,
      message: "Knowledge Test submitted successfully.",
      correctAnswers,
      wrongAnswers,
      totalScore
    });
  } catch (error) {
    console.error("Error submitting Knowledge Test answers:", error);
    return res.status(500).json({ success: false, message: "Server error submitting Knowledge Test answers." });
  }
});

/**
 * API 10.63.62 - GET /api/knowledge-test-result-today
 * Retrieves the knowledge test result for the current day for a specific agent
 */
app.get("/api/knowledge-test-result-today", async (req, res) => {
  const username = req.query.username || req.user?.username;
  if (!username) {
    return res.status(400).json({ success: false, message: "Username is required." });
  }
  if (!assertSelfOrElevated(req, username)) {
    return res.status(403).json({ success: false, message: "Access denied." });
  }
  try {
    const pool = await connectToDatabase();
    const identity = await resolveAgentIdentity(pool, username);
    const lookupName = identity?.loginUsername || username;
    const result = await pool.request()
      .input("username", sql.NVarChar, lookupName)
      .query(`
        SELECT TOP 1 *
        FROM dbo.KnowledgeTestResults
        WHERE LOWER(Username) = LOWER(@username)
          AND CAST(TestDate AS DATE) = CAST(GETDATE() AS DATE)
        ORDER BY CreatedAt DESC
      `);
    if (result.recordset.length > 0) {
      const { Answers, CorrectAnswers, WrongAnswers, TotalScore } = result.recordset[0];
      return res.status(200).json({
        success: true,
        hasSubmitted: true,
        correctAnswers: CorrectAnswers,
        wrongAnswers: WrongAnswers,
        totalScore: TotalScore,
        answers: JSON.parse(Answers),
      });
    }
    return res.status(200).json({ success: true, hasSubmitted: false });
  } catch (error) {
    console.error("Error fetching knowledge test result:", error);
    return res.status(500).json({ success: false, message: "Server error fetching knowledge test result." });
  }
});


/**
 * API 10.92.91 - GET /api/system-monitor/health
 * Health check endpoint for monitoring system
 */
app.get('/api/system-monitor/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    cache: {
      keys: systemCache.keys().length,
      stats: systemCache.getStats()
    }
  });
});

// Graceful shutdown handler for system monitor cache
process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing system monitor cache...');
  systemCache.close();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing system monitor cache...');
  systemCache.close();
});

/* 10.11 AI Chat APIs */ 
 /* API 10.11.1 - POST /api/chat-with-ai
 * Interacts with an AI chat system via a Python script
 */
app.post("/api/chat-with-ai", async (req, res) => {
  const { message } = req.body;
  if (!message) {
    console.error("[API] /api/chat-with-ai: Message is required.");
    return res.status(400).json({ success: false, message: "Message is required." });
  }

  console.log(`[API] /api/chat-with-ai: Received message: "${message}"`);

  try {
    const pythonProcess = spawn("python", ["./ai_chat_llama3.py"]);

    pythonProcess.stdin.write(JSON.stringify({ message }));
    pythonProcess.stdin.end();

    let outputData = "";
    let errorData = "";

    pythonProcess.stdout.on("data", (data) => {
      outputData += data.toString();
      console.log(`[API] /api/chat-with-ai: Python stdout: ${data.toString()}`);
    });

    pythonProcess.stderr.on("data", (data) => {
      errorData += data.toString();
      console.error(`[API] /api/chat-with-ai: Python stderr: ${data.toString()}`);
    });

    pythonProcess.on("close", (code) => {
      console.log(`[API] /api/chat-with-ai: Python process exited with code ${code}`);
      if (code !== 0) {
        console.error("[API] /api/chat-with-ai: Python script failed:", errorData);
        return res.status(500).json({ success: false, message: "Error processing AI chat request.", error: errorData });
      }

      try {
        const result = JSON.parse(outputData);
        if (result.error) {
          console.error("[API] /api/chat-with-ai: Python script returned an error:", result.error);
          return res.status(500).json({ success: false, message: result.error });
        }
        console.log(`[API] /api/chat-with-ai: AI response: "${result.response}"`);
        return res.status(200).json({
          success: true,
          response: result.response,
          escalate: result.escalate || false,
        });
      } catch (error) {
        console.error("[API] /api/chat-with-ai: Error parsing AI response:", error);
        return res.status(500).json({ success: false, message: "Error parsing AI response.", error: error.toString() });
      }
    });
  } catch (error) {
    console.error("[API] /api/chat-with-ai: Server error:", error);
    return res.status(500).json({ success: false, message: "Server error during AI chat.", error: error.toString() });
  }
});

/**
 * API 10.65.63 - POST /api/start-ai-chat
 * Starts an AI chat session and logs it
 */
app.post("/api/start-ai-chat", async (req, res) => {
  const { username, entireChat, startTime, isClosed } = req.body;
  if (!username || !startTime) {
    return res.status(400).json({ success: false, message: "Missing username or startTime." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("agentUsername", sql.NVarChar(100), username)
      .input("entireChat", sql.NVarChar(sql.MAX), entireChat || "")
      .input("startTime", sql.DateTime, new Date(startTime))
      .input("isClosed", sql.Bit, isClosed ? 1 : 0)
      .query(`
        INSERT INTO [dbo].[ChatWith_AI_Log] (AgentUsername, EntireChat, StartTime, IsClosed)
        OUTPUT INSERTED.LogID
        VALUES (@agentUsername, @entireChat, @startTime, @isClosed)
      `);
    const logId = result.recordset[0].LogID;
    return res.status(200).json({ success: true, logId });
  } catch (error) {
    console.error("[API] /api/start-ai-chat: Error starting AI chat log:", error);
    return res.status(500).json({ success: false, message: "Error starting AI chat log." });
  }
});

/**
 * API 10.66.64 - POST /api/update-ai-chat
 * Updates an AI chat log
 */
app.post("/api/update-ai-chat", async (req, res) => {
  const { logId, entireChat } = req.body;
  if (!logId || !entireChat) {
    return res.status(400).json({ success: false, message: "Missing logId or entireChat." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("logId", sql.Int, logId)
      .input("entireChat", sql.NVarChar(sql.MAX), entireChat)
      .query(`
        UPDATE [dbo].[ChatWith_AI_Log]
        SET EntireChat = @entireChat
        WHERE LogID = @logId
      `);
    return res.status(200).json({ success: true, message: "AI chat log updated successfully." });
  } catch (error) {
    console.error("[API] /api/update-ai-chat: Error updating AI chat log:", error);
    return res.status(500).json({ success: false, message: "Error updating AI chat log." });
  }
});

/**
 * API 10.67.65 - POST /api/close-ai-chat
 * Closes an AI chat session and logs it
 */
app.post("/api/close-ai-chat", async (req, res) => {
  const { logId, entireChat, endTime, isClosed } = req.body;
  if (!logId || !entireChat || !endTime) {
    return res.status(400).json({ success: false, message: "Missing logId, entireChat, or endTime." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("logId", sql.Int, logId)
      .input("entireChat", sql.NVarChar(sql.MAX), entireChat)
      .input("endTime", sql.DateTime, new Date(endTime))
      .input("isClosed", sql.Bit, isClosed ? 1 : 0)
      .query(`
        UPDATE [dbo].[ChatWith_AI_Log]
        SET EntireChat = @entireChat, EndTime = @endTime, IsClosed = @isClosed
        WHERE LogID = @logId
      `);
    return res.status(200).json({ success: true, message: "AI chat log closed successfully." });
  } catch (error) {
    console.error("[API] /api/close-ai-chat: Error closing AI chat log:", error);
    return res.status(500).json({ success: false, message: "Error closing AI chat log." });
  }
});

/* 10.12 Team Management APIs */
/**
 * API 10.68.66 - GET /api/team-agents/:username
 * Retrieves agents under a team leader
 */
app.get("/api/team-agents/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const pool = await connectToDatabase();
    const userRow = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT TOP 1 AccountType FROM dbo.Users WHERE LOWER(username) = LOWER(@username)`);
    const accountType = userRow.recordset[0]?.AccountType || "";
    const broadAccess = ["Super Admin", "Admin"].includes(accountType);

    const result = await pool.request()
      .input("teamLeaderUsername", sql.NVarChar, username)
      .input("broadAccess", sql.Bit, broadAccess ? 1 : 0)
      .query(`
        SELECT 
          A.agent_name AS name, 
          COALESCE(AVG(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2))), 0) AS avgScore,
          COUNT(ADS.AudioFileName) AS calls,
          COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, ADS.AudioDuration))) / 60.0, 2), 0) AS aht
        FROM dbo.Agents A
        LEFT JOIN dbo.AI_Details_Scoring ADS
          ON A.agent_name = ADS.AgentName
          AND ADS.UploadDate >= DATEADD(DAY, -7, GETDATE())
        WHERE (@broadAccess = 1 OR LOWER(A.supervisor) = LOWER(@teamLeaderUsername))
        GROUP BY A.agent_name
        ORDER BY A.agent_name
      `);
    return res.status(200).json({ success: true, agents: result.recordset, scope: broadAccess ? "all" : "team" });
  } catch (error) {
    console.error("Error fetching team agents:", error);
    return res.status(500).json({ success: false, message: "Server error fetching team agents." });
  }
});

/**
 * API 10.69.67 - GET /api/audit-queue/:username
 * Retrieves audit queue for a team leader
 */
function buildAuditQueueQuery({ withCallAudits = true } = {}) {
  const auditJoin = withCallAudits
    ? " LEFT JOIN dbo.CallAudits CA ON CA.AudioFileName = ADS.AudioFileName"
    : "";
  const manualScoreExpr = withCallAudits
    ? "COALESCE(TRY_CAST(CA.OverallManualScore AS DECIMAL(10,2)), 0)"
    : "CAST(0 AS DECIMAL(10,2))";
  const hasAuditExpr = withCallAudits
    ? "CASE WHEN CA.AuditID IS NOT NULL THEN 1 ELSE 0 END"
    : "0";
  const auditorNameExpr = withCallAudits
    ? "CA.AuditorUsername"
    : "CAST(NULL AS NVARCHAR(100))";

  return `
      SELECT 
        ADS.AudioFileName AS fileName,
        AU.UploadID AS callId,
        A.agent_name AS agentName,
        AU.CallType AS callType,
        COALESCE(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)), 0) AS score,
        ${manualScoreExpr} AS manualScoring,
        ${hasAuditExpr} AS hasManualAudit,
        ${auditorNameExpr} AS auditorName,
        FORMAT(ADS.CallDate, 'yyyy-MM-dd') AS callDate
      FROM dbo.Agents A
      JOIN dbo.AI_Details_Scoring ADS ON A.agent_name = ADS.AgentName
      JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
      ${auditJoin}
      WHERE (@broadAccess = 1 OR LOWER(A.supervisor) = LOWER(@teamLeaderUsername))
        AND CAST(ADS.UploadDate AS DATE) >= COALESCE(CAST(@fromDate AS DATE), DATEADD(DAY, -7, GETDATE()))
        AND CAST(ADS.UploadDate AS DATE) <= COALESCE(CAST(@toDate AS DATE), GETDATE())
        AND (
          (ADS.Rude_Behavior IS NOT NULL AND ADS.Rude_Behavior != '')
          OR TRY_CAST(ADS.Adherence_to_Protocol AS DECIMAL(10,2)) < 5
          OR TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) < 80
        )
    `;
}

app.get("/api/audit-queue/:username", async (req, res) => {
  const { username } = req.params;
  const { agentName, fromDate, toDate } = req.query;

  try {
    const pool = await connectToDatabase();
    const userRow = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT TOP 1 AccountType FROM dbo.Users WHERE LOWER(username) = LOWER(@username)`);
    const accountType = userRow.recordset[0]?.AccountType || "";
    const broadAccess = ["Super Admin", "Admin"].includes(accountType);

    let query = buildAuditQueueQuery({ withCallAudits: true });

    if (agentName) {
      query += ` AND LOWER(A.agent_name) = LOWER(@agentName)`;
    }

    query += ` ORDER BY ADS.Overall_Scoring ASC`;

    const request = pool.request()
      .input("teamLeaderUsername", sql.NVarChar, username)
      .input("broadAccess", sql.Bit, broadAccess ? 1 : 0)
      .input("fromDate", sql.Date, fromDate || null)
      .input("toDate", sql.Date, toDate || null);

    if (agentName) {
      request.input("agentName", sql.NVarChar, agentName);
    }

    let result;
    try {
      result = await request.query(query);
    } catch (auditErr) {
      if (!isMissingDbObjectError(auditErr)) throw auditErr;
      query = buildAuditQueueQuery({ withCallAudits: false });
      if (agentName) {
        query += ` AND LOWER(A.agent_name) = LOWER(@agentName)`;
      }
      query += ` ORDER BY ADS.Overall_Scoring ASC`;
      result = await request.query(query);
    }

    return res.status(200).json({ success: true, auditQueue: result.recordset });
  } catch (error) {
    console.error("Error fetching audit queue:", error);
    return res.status(500).json({ success: false, message: "Server error fetching audit queue." });
  }
});

/**
 * API 10.70.68 - GET /api/team-leaders
 * Retrieves list of team leaders, optionally filtered by location
 */
app.get("/api/team-leaders", async (req, res) => {
  const { location } = req.query;
  try {
    const pool = await connectToDatabase();
    let query = "SELECT DISTINCT supervisor AS Username FROM [dbo].[Agents] WHERE supervisor IS NOT NULL";
    const params = {};

    if (location && location !== "All") {
      query += " AND TRIM(LOWER(agent_location)) = TRIM(LOWER(@location))";
      params.location = location;
    }

    query += " ORDER BY supervisor";

    const request = pool.request();
    if (location && location !== "All") {
      request.input("location", sql.NVarChar, location);
    }

    const result = await request.query(query);
    return res.status(200).json({ success: true, teamLeaders: result.recordset.map(row => row.Username) });
  } catch (error) {
    console.error("Error in GET /api/team-leaders:", error);
    return res.status(500).json({ success: false, message: "Server error fetching team leaders." });
  }
});

/**
 * API 10.71.69 - GET /api/locations
 * Retrieves active locations from the managed Locations table (Admin Settings).
 * Falls back to distinct agent_location from Agents table if Locations table doesn't exist yet.
 */
app.get("/api/locations", async (req, res) => {
  try {
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    try {
      const result = await pool.request()
        .query("SELECT LocationName FROM dbo.Locations WHERE IsActive = 1 ORDER BY LocationName");
      return res.status(200).json({ success: true, locations: result.recordset.map(row => row.LocationName) });
    } catch {
      const fallback = await pool.request()
        .query("SELECT DISTINCT agent_location AS LocationName FROM [dbo].[Agents] WHERE agent_location IS NOT NULL AND agent_location <> '' ORDER BY agent_location");
      return res.status(200).json({ success: true, locations: fallback.recordset.map(row => row.LocationName) });
    }
  } catch (error) {
    console.error("Error in GET /api/locations:", error);
    return res.status(500).json({ success: false, message: "Server error fetching locations." });
  }
});

/* 10.13 Call Search APIs */
/**
 * API 10.72.70 - GET /api/search-calls
 * Searches calls by caller ID, agent ID, or agent name
 */
app.get("/api/search-calls", async (req, res) => {
  const { callerId, agentId, agentName } = req.query;

  if (!callerId && !agentId && !agentName) {
    return res.status(400).json({ success: false, message: "At least one search parameter (callerId, agentId, or agentName) is required." });
  }

  try {
    const pool = await sqlConnect();
    let query = `
      SELECT 
        APR.AudioFileName AS FileName,
        FORMAT(APR.Timestamp, 'yyyy-MM-dd') AS UploadDate,
        APR.Status,
        FORMAT(APR.Timestamp, 'yyyy-MM-dd') AS ProcessDate,
        ADS.AgentName,
        ADS.AudioDuration,
        ADS.AudioLanguage,
        AgentTable.agent_id AS AgentID,
        AgentTable.agent_location AS Location,
        ADS.Overall_Scoring
      FROM AI_Processing_Result APR
      LEFT JOIN AI_Details_Scoring ADS
        ON APR.AudioFileName = ADS.AudioFileName
      LEFT JOIN [dbo].[Agents] AgentTable
        ON LOWER(ADS.AgentName) = LOWER(AgentTable.agent_name)
      WHERE 1=1
    `;

    const conditions = [];
    const request = pool.request();

    if (callerId) {
      conditions.push(`APR.AudioFileName LIKE @callerId`);
      request.input("callerId", sql.NVarChar, `%${callerId}%`);
    }
    if (agentId) {
      conditions.push(`AgentTable.agent_id LIKE @agentId`);
      request.input("agentId", sql.NVarChar, `%${agentId}%`);
    }
    if (agentName) {
      conditions.push(`ADS.AgentName LIKE @agentName`);
      request.input("agentName", sql.NVarChar, `%${agentName}%`);
    }

    if (conditions.length > 0) {
      query += ` AND ${conditions.join(" AND ")}`;
    }

    query += ` ORDER BY APR.Timestamp DESC;`;

    const result = await request.query(query);
    return res.status(200).json({ success: true, data: result.recordset });
  } catch (error) {
    console.error("Error searching calls:", error);
    return res.status(500).json({ success: false, message: "Server error searching calls." });
  }
});

/**
 * API 10.73.71 - GET /api/most-recent-call-date
 * Retrieves the most recent call date
 */
app.get("/api/most-recent-call-date", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT MAX(CallDate) AS MostRecentDate FROM [AI_Details_Scoring]");
    const mostRecentDate = result.recordset[0].MostRecentDate;
    if (!mostRecentDate) {
      return res.status(404).json({ success: false, message: "No call data available." });
    }
    return res.status(200).json({ success: true, mostRecentDate: mostRecentDate.toISOString().split("T")[0] });
  } catch (error) {
    console.error("Error in /api/most-recent-call-date:", error);
    return res.status(500).json({ success: false, message: "Server error fetching most recent call date: " + error.message });
  }
});

/**
 * API 10.74.72 - GET /api/earliest-call-date
 * Retrieves the earliest call date
 */
app.get("/api/earliest-call-date", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT MIN(CallDate) AS EarliestDate FROM [AI_Details_Scoring]");
    const earliestDate = result.recordset[0].EarliestDate;
    if (!earliestDate) {
      return res.status(404).json({ success: false, message: "No call data available." });
    }
    return res.status(200).json({ success: true, earliestDate: earliestDate.toISOString().split("T")[0] });
  } catch (error) {
    console.error("Error in /api/earliest-call-date:", error);
    return res.status(500).json({ success: false, message: "Server error fetching earliest call date: " + error.message });
  }
});

/* 10.14 Knowledge Base APIs */
/**
 * API 10.75.73 - GET /api/reva-knowledge-options
 * Retrieves categorized knowledge entries
 */
app.get("/api/reva-knowledge-options", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT Category, Question, Answer, ModifiedAt
      FROM RevaKnowledgeBase
      WHERE Category IS NOT NULL
      ORDER BY Category, Question
    `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No categorized knowledge entries found in RevaKnowledgeBase." });
    }
    const groupedEntries = result.recordset.reduce((acc, row) => {
      const category = row.Category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        question: row.Question,
        answer: row.Answer,
        modifiedAt: row.ModifiedAt
      });
      return acc;
    }, {});
    return res.status(200).json({ success: true, categories: groupedEntries });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, categories: {} });
    }
    console.error("[API] /api/reva-knowledge-options: Error fetching knowledge entries from RevaKnowledgeBase:", error);
    writeLog(`Error in /api/reva-knowledge-options: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching knowledge entries from RevaKnowledgeBase." });
  }
});

/**
 * API 10.76.74 - GET /api/reva-knowledge
 * Retrieves knowledge entries for Team Leaders
 */
app.get("/api/reva-knowledge", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT ID, Category, Question, Answer, UpdatedBy, CreatedBy, ModifiedBy, CreatedAt, ModifiedAt
      FROM RevaKnowledgeBase
      WHERE Category IS NOT NULL
      ORDER BY Category, CreatedAt DESC
    `);
    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, categories: {} });
    }
    const groupedEntries = result.recordset.reduce((acc, row) => {
      const category = row.Category;
      if (!acc[category]) {
        acc[category] = [];
      }
      acc[category].push({
        ID: row.ID,
        question: row.Question,
        answer: row.Answer,
        modifiedBy: row.ModifiedBy,
        modifiedAt: row.ModifiedAt,
      });
      return acc;
    }, {});
    return res.status(200).json({ success: true, categories: groupedEntries });
  } catch (error) {
    if (isMissingDbObjectError(error)) {
      return res.status(200).json({ success: true, categories: {} });
    }
    console.error("Error fetching Reva Knowledge entries for Team Leader:", error);
    writeLog(`Error in /api/reva-knowledge GET: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching Reva Knowledge entries for Team Leader." });
  }
});

/**
 * API 10.77.75 - POST /api/reva-knowledge
 * Adds a new knowledge entry
 */
app.post("/api/reva-knowledge", async (req, res) => {
  const { question, answer, category, username } = req.body;
  if (!question || !answer || !category || !username) {
    return res.status(400).json({ success: false, message: "Missing required fields: question, answer, category, and username are required." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, answer)
      .input("category", sql.NVarChar, category)
      .input("username", sql.NVarChar, username)
      .input("timestamp", sql.DateTime, new Date())
      .query(`
        INSERT INTO RevaKnowledgeBase (Question, Answer, Category, UpdatedBy, CreatedBy, ModifiedBy, CreatedAt, ModifiedAt)
        VALUES (@question, @answer, @category, @username, @username, @username, @timestamp, @timestamp);
        SELECT SCOPE_IDENTITY() AS ID;
      `);
    const id = result.recordset[0].ID;
    return res.status(201).json({ success: true, message: "Knowledge entry added successfully.", id });
  } catch (error) {
    console.error("Error adding Reva Knowledge entry:", error);
    writeLog(`Error in /api/reva-knowledge POST: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error adding Reva Knowledge entry." });
  }
});

/**
 * API 10.78.76 - PUT /api/reva-knowledge/:id
 * Updates an existing knowledge entry
 */
app.put("/api/reva-knowledge/:id", async (req, res) => {
  const { id } = req.params;
  const question = req.body.question || req.body.Question;
  const answer = req.body.answer || req.body.Answer;
  const category = req.body.category || req.body.Category;
  const username = req.body.username || req.body.Username;
  if (!question || !answer || !category || !username) {
    return res.status(400).json({ success: false, message: "Missing required fields: question, answer, category, and username are required." });
  }
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, answer)
      .input("category", sql.NVarChar, category)
      .input("username", sql.NVarChar, username)
      .input("timestamp", sql.DateTime, new Date())
      .query(`
        UPDATE RevaKnowledgeBase
        SET Question = @question,
            Answer = @answer,
            Category = @category,
            UpdatedBy = @username,
            ModifiedBy = @username,
            ModifiedAt = @timestamp
        WHERE ID = @id
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Knowledge entry not found." });
    }
    return res.status(200).json({ success: true, message: "Knowledge entry updated successfully." });
  } catch (error) {
    console.error("Error updating Reva Knowledge entry:", error);
    writeLog(`Error in /api/reva-knowledge/:id PUT: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error updating Reva Knowledge entry." });
  }
});

/**
 * API 10.79.77 - DELETE /api/reva-knowledge/:id
 * Deletes a knowledge entry
 */
app.delete("/api/reva-knowledge/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.Int, id)
      .query(`
        DELETE FROM RevaKnowledgeBase
        WHERE ID = @id
      `);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Knowledge entry not found." });
    }
    return res.status(200).json({ success: true, message: "Knowledge entry deleted successfully." });
  } catch (error) {
    console.error("Error deleting Reva Knowledge entry:", error);
    writeLog(`Error in /api/reva-knowledge/:id DELETE: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error deleting Reva Knowledge entry." });
  }
});

/* 10.15 Agent Controller APIs */
// APIs for managing agents, mounted via agentRoutes and defined here
/**
 * API 10.80.78 - GET /api/agents
 * Fetches all active agents
 */
app.get("/api/agents", async (req, res) => {
  logAgentAction("Fetching all active agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .query(`
        SELECT *
        FROM Agents
        WHERE is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    const recordset = result.recordset.map(agent => ({
      ...agent,
      agent_type: agent.agent_type || null
    }));

    logAgentAction("Successfully fetched all active agents.");
    return res.status(200).json(recordset);
  } catch (error) {
    logAgentAction(`Error fetching all agents: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch agents" });
  }
});

/**
 * API 10.81.79 - GET /api/agents/inbound
 * Fetches inbound agents
 */
app.get("/api/agents/inbound", async (req, res) => {
  logAgentAction("Fetching inbound agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("type", sql.NVarChar, "Inbound")
      .query(`
        SELECT * FROM Agents
        WHERE agent_type = @type
          AND is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAgentAction(`Error fetching inbound: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch inbound agents" });
  }
});

/**
 * API 10.82.80 - GET /api/agents/outbound
 * Fetches outbound agents
 */
app.get("/api/agents/outbound", async (req, res) => {
  logAgentAction("Fetching outbound agents...");
  try {
    const pool = await connectToDatabase();
    const result = await pool
      .request()
      .input("type", sql.NVarChar, "Outbound")
      .query(`
        SELECT * FROM Agents
        WHERE agent_type = @type
          AND is_active = 1
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAgentAction(`Error fetching outbound: ${error.message}`);
    return res.status(500).json({ error: "Failed to fetch outbound agents" });
  }
});

/**
 * API 10.83.81 - POST /api/agents
 * Creates a new agent
 */
app.post("/api/agents", async (req, res) => {
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to create agents."))) return;
  logAgentAction("Creating a new agent...");
  const {
    name,
    agentId,
    email,
    mobile,
    supervisor,
    type,
    manager,
    auditor,
    notes,
    agent_location
  } = req.body;

  if (!name?.trim() || !agentId?.trim() || !supervisor?.trim() || !type?.trim()) {
    return res.status(400).json({ error: "Name, Agent ID, Type, and Supervisor are required." });
  }

  const cleanEmail = (email || "").trim() || null;
  const cleanMobile = (mobile || "").trim() || null;

  try {
    const pool = await connectToDatabase();

    const dup = await pool.request()
      .input("agent_id", sql.NVarChar, agentId.trim())
      .input("agent_name", sql.NVarChar, name.trim())
      .query(`
        SELECT TOP 1 agent_id, agent_name FROM Agents
        WHERE agent_id = @agent_id OR LOWER(agent_name) = LOWER(@agent_name)
      `);
    if (dup.recordset.length > 0) {
      return res.status(409).json({ error: "An agent with this ID or name already exists." });
    }

    await pool.request()
      .input("agent_id", sql.NVarChar, agentId.trim())
      .input("agent_name", sql.NVarChar, name.trim())
      .input("agent_email", sql.NVarChar, cleanEmail)
      .input("agent_mobile", sql.NVarChar, cleanMobile)
      .input("supervisor", sql.NVarChar, supervisor)
      .input("agent_type", sql.NVarChar, type)
      .input("manager", sql.NVarChar, manager || null)
      .input("auditor", sql.NVarChar, auditor || null)
      .input("notes", sql.NVarChar, notes || null)
      .input("agent_location", sql.NVarChar, agent_location || null)
      .query(`
        INSERT INTO Agents (
          agent_id,
          agent_name,
          agent_email,
          agent_mobile,
          supervisor,
          agent_type,
          manager,
          auditor,
          notes,
          agent_location,
          is_active,
          deactivated_date,
          agent_creation_date
        )
        VALUES (
          @agent_id,
          @agent_name,
          @agent_email,
          @agent_mobile,
          @supervisor,
          @agent_type,
          @manager,
          @auditor,
          @notes,
          @agent_location,
          1,
          NULL,
          GETDATE()
        );
      `);

    logAgentAction("New agent created successfully.");
    return res.status(201).json({ message: "Agent created successfully" });
  } catch (err) {
    logAgentAction(`Error creating agent: ${err.message}`);
    return res.status(500).json({ error: "Failed to create agent" });
  }
});

/**
 * API 10.84.82 - PUT /api/agents/:id
 * Updates an existing agent
 */
app.put("/api/agents/:id", async (req, res) => {
  const { id } = req.params;
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to update agents."))) return;
  logAgentAction(`Updating agent with ID = ${id} ...`);

  const {
    agent_name,
    agent_email,
    agent_mobile,
    supervisor,
    agent_type,
    manager,
    auditor,
    notes,
    agent_location
  } = req.body;

  if (!agent_name || !agent_email || !agent_mobile || !supervisor || !agent_type) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)
      .input("agent_name", sql.NVarChar, agent_name)
      .input("agent_email", sql.NVarChar, agent_email)
      .input("agent_mobile", sql.NVarChar, agent_mobile)
      .input("supervisor", sql.NVarChar, supervisor)
      .input("agent_type", sql.NVarChar, agent_type)
      .input("manager", sql.NVarChar, manager || null)
      .input("auditor", sql.NVarChar, auditor || null)
      .input("notes", sql.NVarChar, notes || null)
      .input("agent_location", sql.NVarChar, agent_location || null)
      .query(`
        UPDATE Agents
        SET
          agent_name = @agent_name,
          agent_email = @agent_email,
          agent_mobile = @agent_mobile,
          supervisor = @supervisor,
          agent_type = @agent_type,
          manager = @manager,
          auditor = @auditor,
          notes = @notes,
          agent_location = @agent_location
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAgentAction(`Agent ${id} updated successfully.`);
      return res.status(200).json({ message: "Agent updated successfully" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (err) {
    logAgentAction(`Error updating agent ${id}: ${err.message}`);
    return res.status(500).json({ error: "Failed to update agent" });
  }
});

/**
 * API 10.85.83 - DELETE /api/agents/:id
 * Hard deletes an agent by ID
 */
app.delete("/api/agents/:id", async (req, res) => {
  const { id } = req.params;
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to delete agents."))) return;
  logAgentAction(`Hard deleting agent ID = ${id} ...`);
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)
      .query(`
        DELETE FROM Agents
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAgentAction(`Agent ${id} deleted successfully.`);
      return res.status(200).json({ message: "Agent deleted successfully" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (error) {
    logAgentAction(`Error deleting agent: ${error.message}`);
    return res.status(500).json({ error: "Failed to delete agent" });
  }
});

/**
 * API 10.86.84 - GET /api/agents/search
 * Searches active agents by name or ID
 */
app.get("/api/agents/search", async (req, res) => {
  logAgentAction("Searching agents...");
  const { q } = req.query;
  if (!q) {
    return res.status(400).json({ error: "Missing search parameter: 'q'" });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("searchTerm", sql.NVarChar, `%${q}%`)
      .query(`
        SELECT *
        FROM Agents
        WHERE is_active = 1
          AND (
            agent_name LIKE @searchTerm
            OR agent_id LIKE @searchTerm
          )
        ORDER BY agent_creation_date DESC
      `);

    return res.status(200).json(result.recordset);
  } catch (error) {
    logAgentAction(`Error searching agents: ${error.message}`);
    return res.status(500).json({ error: "Failed to search agents" });
  }
});

/**
 * API 10.87.85 - PUT /api/agents/:id/deactivate
 * Deactivates an agent (soft delete)
 */
app.put("/api/agents/:id/deactivate", async (req, res) => {
  const { id } = req.params;
  if (!(await requireRoles(req, res, AGENT_MANAGER_ROLES, "You do not have permission to deactivate agents."))) return;
  logAgentAction(`Deactivating agent ID = ${id} ...`);

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.NVarChar, id)
      .query(`
        UPDATE Agents
        SET
          is_active = 0,
          deactivated_date = GETDATE()
        WHERE agent_id = @id
      `);

    if (result.rowsAffected[0] > 0) {
      logAgentAction(`Agent ${id} deactivated successfully.`);
      return res.status(200).json({ message: "Agent deactivated" });
    } else {
      return res.status(404).json({ error: "Agent not found" });
    }
  } catch (err) {
    logAgentAction(`Error deactivating agent: ${err.message}`);
    return res.status(500).json({ error: "Failed to deactivate agent" });
  }
});

// Logging utility for agent endpoints
function logAgentAction(message) {
  const timestamp = getISTTimeString();
  console.log(`[${timestamp}] ${message}`);
}

/* ===================== 10.16 RBAC & Admin Settings APIs ===================== */

/**
 * Middleware helper: verifies the caller is Admin or Super Admin by checking
 * the Authorization token against ActiveSessions + Users tables.
 */
async function resolveCallerRole(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
  if (!token) return null;
  try {
    const pool = await connectToDatabase();
    const sess = await pool.request()
      .input("token", sql.NVarChar, token)
      .query(`
        SELECT u.AccountType, u.Username
        FROM ActiveSessions s
        JOIN Users u ON s.Username = u.Username
        WHERE s.Token = @token AND s.IsActive = 1
      `);
    if (sess.recordset.length === 0) return null;
    return sess.recordset[0];
  } catch {
    return null;
  }
}

function isAdminRole(accountType) {
  return ["Super Admin", "Admin"].includes(accountType);
}

/**
 * Resolves the caller's role, preferring req.user (set by authGate) and falling
 * back to a direct token lookup when enforcement is disabled. Returns
 * { username, accountType } or null.
 */
async function getCallerRole(req) {
  if (req.user?.username) {
    return { username: req.user.username, accountType: req.user.accountType || "" };
  }
  const caller = await resolveCallerRole(req);
  return caller ? { username: caller.Username, accountType: caller.AccountType || "" } : null;
}

/**
 * Guard that ensures the caller has one of the allowed roles. Sends a 401/403
 * response and returns null when unauthorized; otherwise returns the caller.
 */
async function requireRoles(req, res, allowedRoles, message) {
  const caller = await getCallerRole(req);
  if (!caller) {
    res.status(401).json({ success: false, message: "Authentication required." });
    return null;
  }
  if (!allowedRoles.includes(caller.accountType)) {
    res.status(403).json({ success: false, message: message || "Insufficient permissions." });
    return null;
  }
  return caller;
}

const ADMIN_ROLES = ["Super Admin", "Admin"];
const AGENT_MANAGER_ROLES = ["Super Admin", "Admin", "Manager"];

/** Uses req.user from authGate (preferred) — avoids a second session lookup. */
function requireAdmin(req, res) {
  if (!req.user?.username || !isAdminRole(req.user.accountType)) {
    res.status(403).json({ success: false, message: "Only Admin/Super Admin can manage locations." });
    return null;
  }
  return req.user;
}

/**
 * API 10.90.01 - PUT /api/user/:username/role
 * Updates a user's AccountType (role)
 */
app.put("/api/user/:username/role", async (req, res) => {
  const { username } = req.params;
  const { role } = req.body;
  const validRoles = ["Super Admin", "Admin", "Manager", "Team Leader", "Auditor", "Agent", "IT"];
  if (!role || !validRoles.includes(role)) {
    return res.status(400).json({ success: false, message: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
  }
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || !isAdminRole(caller.AccountType)) {
      return res.status(403).json({ success: false, message: "Only Admin/Super Admin can change roles." });
    }
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, username)
      .input("role", sql.NVarChar, role)
      .query("UPDATE dbo.Users SET AccountType = @role WHERE Username = @username");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    writeLog(`[${getISTTimeString()}] Role updated: ${username} -> ${role} by ${caller.Username}`);
    return res.status(200).json({ success: true, message: "Role updated successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error updating role:`, error.message);
    return res.status(500).json({ success: false, message: "Server error updating role." });
  }
});

/**
 * API 10.90.02 - GET /api/admin/locations
 * Returns all locations from the Locations table (admin-managed)
 */
app.get("/api/admin/locations", async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can view locations."))) return;
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT LocationID, LocationName, IsActive, CreatedAt, UpdatedAt FROM dbo.Locations ORDER BY LocationName");
    return res.status(200).json({ success: true, locations: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching admin locations:`, error.message);
    return res.status(500).json({ success: false, message: error.message || "Server error fetching locations." });
  }
});

/**
 * API 10.90.03 - POST /api/admin/locations
 * Creates a new location
 */
app.post("/api/admin/locations", async (req, res) => {
  const { locationName } = req.body;
  if (!locationName || !locationName.trim()) {
    return res.status(400).json({ success: false, message: "Location name is required." });
  }
  try {
    const caller = requireAdmin(req, res);
    if (!caller) return;
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const existing = await pool.request()
      .input("name", sql.NVarChar, locationName.trim())
      .query("SELECT LocationID FROM dbo.Locations WHERE LocationName = @name");
    if (existing.recordset.length > 0) {
      return res.status(400).json({ success: false, message: "Location already exists." });
    }
    await pool.request()
      .input("name", sql.NVarChar, locationName.trim())
      .query("INSERT INTO dbo.Locations (LocationName) VALUES (@name)");
    writeLog(`[${getISTTimeString()}] Location created: ${locationName.trim()} by ${caller.username}`);
    return res.status(201).json({ success: true, message: "Location created." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error creating location:`, error.message);
    return res.status(500).json({ success: false, message: "Server error creating location." });
  }
});

/**
 * API 10.90.04 - PUT /api/admin/locations/:id
 * Updates a location
 */
app.put("/api/admin/locations/:id", async (req, res) => {
  const { id } = req.params;
  const { locationName, isActive } = req.body;
  try {
    if (!requireAdmin(req, res)) return;
    const pool = await connectToDatabase();
    const updates = [];
    const request = pool.request().input("id", sql.Int, parseInt(id, 10));
    if (locationName !== undefined) {
      updates.push("LocationName = @name");
      request.input("name", sql.NVarChar, locationName.trim());
    }
    if (isActive !== undefined) {
      updates.push("IsActive = @active");
      request.input("active", sql.Bit, isActive ? 1 : 0);
    }
    if (updates.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update." });
    }
    updates.push("UpdatedAt = GETDATE()");
    const result = await request.query(`UPDATE dbo.Locations SET ${updates.join(", ")} WHERE LocationID = @id`);
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Location not found." });
    }
    return res.status(200).json({ success: true, message: "Location updated." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error updating location:`, error.message);
    return res.status(500).json({ success: false, message: "Server error updating location." });
  }
});

/**
 * API 10.90.05 - DELETE /api/admin/locations/:id
 * Deletes a location
 */
app.delete("/api/admin/locations/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const caller = requireAdmin(req, res);
    if (!caller) return;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("id", sql.Int, parseInt(id, 10))
      .query("DELETE FROM dbo.Locations WHERE LocationID = @id");
    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ success: false, message: "Location not found." });
    }
    writeLog(`[${getISTTimeString()}] Location deleted: ID ${id} by ${caller.username}`);
    return res.status(200).json({ success: true, message: "Location deleted." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error deleting location:`, error.message);
    return res.status(500).json({ success: false, message: "Server error deleting location." });
  }
});

/**
 * API 10.90.06 - GET /api/admin/settings
 * Returns all application settings
 */
app.get("/api/admin/settings", async (req, res) => {
  try {
    if (!(await requireRoles(req, res, ADMIN_ROLES, "Only Admin/Super Admin can view settings."))) return;
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT SettingKey, SettingValue, UpdatedAt, UpdatedBy FROM dbo.AppSettings");
    const settings = {};
    result.recordset.forEach(row => { settings[row.SettingKey] = row.SettingValue; });
    return res.status(200).json({ success: true, settings });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching settings:`, error.message);
    return res.status(500).json({ success: false, message: "Server error fetching settings." });
  }
});

/**
 * API 10.90.07 - PUT /api/admin/settings
 * Updates application settings (batch key-value pairs)
 */
app.put("/api/admin/settings", async (req, res) => {
  const { settings } = req.body;
  if (!settings || typeof settings !== "object") {
    return res.status(400).json({ success: false, message: "Settings object is required." });
  }
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || !isAdminRole(caller.AccountType)) {
      return res.status(403).json({ success: false, message: "Only Admin/Super Admin can update settings." });
    }
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    for (const [key, value] of Object.entries(settings)) {
      await pool.request()
        .input("key", sql.NVarChar, key)
        .input("value", sql.NVarChar, value || "")
        .input("updatedBy", sql.NVarChar, caller.Username)
        .query(`
          MERGE dbo.AppSettings AS target
          USING (SELECT @key AS SettingKey) AS source
          ON target.SettingKey = source.SettingKey
          WHEN MATCHED THEN UPDATE SET SettingValue = @value, UpdatedAt = GETDATE(), UpdatedBy = @updatedBy
          WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@key, @value, @updatedBy);
        `);
    }
    writeLog(`[${getISTTimeString()}] Settings updated by ${caller.Username}: ${Object.keys(settings).join(", ")}`);
    return res.status(200).json({ success: true, message: "Settings updated." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error updating settings:`, error.message);
    return res.status(500).json({ success: false, message: "Server error updating settings." });
  }
});

/**
 * API 10.90.07b - GET /api/public/branding
 * Public app name + logo for login page, favicon, shell (no auth).
 */
app.get("/api/public/branding", async (req, res) => {
  try {
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT SettingKey, SettingValue FROM dbo.AppSettings WHERE SettingKey IN ('app_name', 'app_logo_url')");
    const settings = { app_name: "AI-Powered Call Analysis", app_logo_url: "" };
    result.recordset.forEach((row) => { settings[row.SettingKey] = row.SettingValue; });
    const uploaded = publicLogoUrl(req);
    const external = settings.app_logo_url && !settings.app_logo_url.startsWith("/api/branding")
      ? settings.app_logo_url
      : "";
    const logoUrl = uploaded ? `${uploaded}?v=${Date.now()}` : external;
    return res.status(200).json({
      success: true,
      appName: settings.app_name || "AI-Powered Call Analysis",
      logoUrl,
    });
  } catch (error) {
    return res.status(200).json({ success: true, appName: "AI-Powered Call Analysis", logoUrl: "" });
  }
});

/**
 * API 10.90.07c - GET /api/branding/logo
 * Serves uploaded application logo file.
 */
app.get("/api/branding/logo", (req, res) => {
  const filePath = resolveBrandingLogoFile();
  if (!filePath) return res.status(404).json({ success: false, message: "No logo uploaded." });
  res.set("Cache-Control", "no-cache, must-revalidate");
  return res.sendFile(filePath);
});

/**
 * API 10.90.07d - POST /api/admin/logo
 * Upload application logo (Admin/Super Admin).
 */
app.post("/api/admin/logo", uploadAppLogo.single("logo"), async (req, res) => {
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || !isAdminRole(caller.AccountType)) {
      return res.status(403).json({ success: false, message: "Only Admin/Super Admin can upload logo." });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "Please select an image file." });
    }
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    await pool.request()
      .input("key", sql.NVarChar, "app_logo_url")
      .input("value", sql.NVarChar, "/api/branding/logo")
      .input("updatedBy", sql.NVarChar, caller.Username)
      .query(`
        MERGE dbo.AppSettings AS target
        USING (SELECT @key AS SettingKey) AS source
        ON target.SettingKey = source.SettingKey
        WHEN MATCHED THEN UPDATE SET SettingValue = @value, UpdatedAt = GETDATE(), UpdatedBy = @updatedBy
        WHEN NOT MATCHED THEN INSERT (SettingKey, SettingValue, UpdatedBy) VALUES (@key, @value, @updatedBy);
      `);
    const logoUrl = `${req.protocol}://${req.get("host")}/api/branding/logo?v=${Date.now()}`;
    writeLog(`[${getISTTimeString()}] App logo uploaded by ${caller.Username}`);
    return res.status(200).json({ success: true, message: "Logo uploaded.", logoUrl });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error uploading logo:`, error.message);
    return res.status(500).json({ success: false, message: error.message || "Server error uploading logo." });
  }
});

/**
 * API 10.90.08 - GET /api/dropdown/managers
 * Returns list of users with Manager role for dropdown population
 */
app.get("/api/dropdown/managers", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT UserID, Username FROM dbo.Users WHERE AccountType = 'Manager' ORDER BY Username");
    return res.status(200).json({ success: true, managers: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching managers:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.09 - GET /api/dropdown/team-leaders
 * Returns list of users with Team Leader role for dropdown population
 */
app.get("/api/dropdown/team-leaders", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT UserID, Username FROM dbo.Users WHERE AccountType = 'Team Leader' ORDER BY Username");
    return res.status(200).json({ success: true, teamLeaders: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching team leaders:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.10 - GET /api/dropdown/auditors
 * Returns list of users with Auditor role for dropdown population
 */
app.get("/api/dropdown/auditors", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT UserID, Username FROM dbo.Users WHERE AccountType = 'Auditor' ORDER BY Username");
    return res.status(200).json({ success: true, auditors: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching auditors:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.11 - GET /api/dropdown/locations
 * Returns active locations from the managed Locations table for dropdown population.
 * Falls back to agent_location from Agents table if Locations table doesn't exist yet.
 */
app.get("/api/dropdown/locations", async (req, res) => {
  try {
    await ensureAdminSchema();
    const pool = await connectToDatabase();
    try {
      const result = await pool.request()
        .query("SELECT LocationID, LocationName FROM dbo.Locations WHERE IsActive = 1 ORDER BY LocationName");
      return res.status(200).json({ success: true, locations: result.recordset });
    } catch {
      const fallback = await pool.request()
        .query("SELECT DISTINCT agent_location AS LocationName FROM dbo.Agents WHERE agent_location IS NOT NULL AND agent_location <> '' ORDER BY agent_location");
      return res.status(200).json({ success: true, locations: fallback.recordset });
    }
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching dropdown locations:`, error.message);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.90.12 - POST /api/admin/backup
 * Triggers a database backup (Super Admin only)
 */
app.post("/api/admin/backup", async (req, res) => {
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || caller.AccountType !== "Super Admin") {
      return res.status(403).json({ success: false, message: "Only Super Admin can trigger backups." });
    }
    const pool = await connectToDatabase();
    const settingsResult = await pool.request()
      .query("SELECT SettingValue FROM dbo.AppSettings WHERE SettingKey = 'backup_path'");
    let backupPath = settingsResult.recordset[0]?.SettingValue || "";
    if (!backupPath) {
      backupPath = "C:\\SQLBackups";
    }
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dbNameResult = await pool.request().query("SELECT DB_NAME() AS dbname");
    const dbName = dbNameResult.recordset[0].dbname;
    const fullPath = `${backupPath}\\${dbName}_${timestamp}.bak`;

    await pool.request()
      .query(`BACKUP DATABASE [${dbName}] TO DISK = '${fullPath}' WITH FORMAT, INIT, NAME = '${dbName} Backup'`);
    writeLog(`[${getISTTimeString()}] Database backup created: ${fullPath} by ${caller.Username}`);
    return res.status(200).json({ success: true, message: `Backup created: ${fullPath}` });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error creating backup:`, error.message);
    return res.status(500).json({ success: false, message: `Backup failed: ${error.message}` });
  }
});

/**
 * API 10.90.13 - GET /api/admin/backup-history
 * Returns recent SQL Server backup history from msdb (Super Admin only)
 */
app.get("/api/admin/backup-history", async (req, res) => {
  try {
    const caller = await resolveCallerRole(req);
    if (!caller || caller.AccountType !== "Super Admin") {
      return res.status(403).json({ success: false, message: "Only Super Admin can view backup history." });
    }
    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT TOP 20
        bs.database_name,
        bs.backup_start_date AS created_at,
        bs.backup_finish_date AS finished_at,
        CAST(bs.backup_size / 1048576.0 AS DECIMAL(10,2)) AS size_mb,
        bmf.physical_device_name AS path,
        CASE bs.type WHEN 'D' THEN 'Full' WHEN 'I' THEN 'Differential' WHEN 'L' THEN 'Log' ELSE bs.type END AS backup_type
      FROM msdb.dbo.backupset bs
      INNER JOIN msdb.dbo.backupmediafamily bmf ON bs.media_set_id = bmf.media_set_id
      WHERE bs.database_name = DB_NAME()
      ORDER BY bs.backup_start_date DESC
    `);
    const backups = (result.recordset || []).map(row => ({
      filename: row.path ? row.path.split('\\').pop() : '',
      path: row.path,
      created_at: row.created_at,
      finished_at: row.finished_at,
      size: row.size_mb ? `${row.size_mb} MB` : '—',
      backup_type: row.backup_type,
      status: 'OK',
    }));
    return res.status(200).json({ success: true, backups });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error fetching backup history:`, error.message);
    return res.status(200).json({ success: true, backups: [] });
  }
});

/* ===================== 10.16b Bank Settings APIs (Super Admin) ===================== */
app.use(
  "/api/admin/bank-settings",
  createBankSettingsRouter({
    connectToDatabase,
    resolveCallerRole,
    writeLog,
    getISTTimeString,
  })
);
app.use(
  "/api/internal/bank-settings",
  createBankSettingsInternalRouter({
    connectToDatabase,
    getISTTimeString,
  })
);

/* ===================== 10.16c Query Category APIs (Admin) ===================== */
app.use(
  "/api/query-categories",
  createQueryCategoryRouter({
    connectToDatabase,
    resolveCallerRole,
    writeLog,
    getISTTimeString,
  })
);

/* ===================== 10.17 Auto Upload APIs (Super Admin) ===================== */
app.use(
  "/api/admin/auto-upload",
  createAutoUploadRouter({
    sql,
    connectToDatabase,
    resolveCallerRole,
    writeLog,
    getISTTimeString,
    config,
  })
);

/* ===================== 10.18 Manual Audit APIs ===================== */
app.use(
  "/api/audits",
  createAuditRouter({
    sql,
    connectToDatabase,
    writeLog,
    getISTTimeString,
  })
);

app.use(
  "/api",
  createSessionRouter({
    sql,
    sqlConnect,
    writeLog,
    getISTTimeString,
  })
);



// Misc + report routers declare their full "/api/..." paths internally, so they
// mount at "/" (not "/api") to avoid a doubled "/api/api/..." prefix.
app.use(
  "/",
  createMiscRouter({
    sql,
    sqlConnect,
    connectToDatabase,
    writeLog,
    getISTTimeString,
    config,
    assertSelfOrElevated,
    uploadProfilePic,
    profilePicsDir,
    findProfilePictureFile,
    normalizeToneResults,
    validator,
    si,
  })
);

app.use(
  "/",
  createReportRouter({
    sql,
    connectToDatabase,
    sqlConnect,
    writeLog,
    getISTTimeString,
  })
);

/* ===================== 10.6) Call Intelligence (Phase 2d) ===================== */

// Shared date-window clause for intelligence aggregations.
function intelDateClause(request, fromDate, toDate) {
  if (fromDate && toDate) {
    request.input("fromDate", sql.Date, fromDate);
    request.input("toDate", sql.Date, toDate);
    return ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) BETWEEN @fromDate AND @toDate`;
  }
  return ` AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(DAY, -30, GETDATE())`;
}

/**
 * Maps a Consolidated_Audio_Analysis row (and optional JSON blob) to API intelligence payload.
 */
function mapCallIntelligenceFromRecord(r) {
  if (!r) return null;

  let secondary = [];
  try {
    const parsed = JSON.parse(r.AI_Secondary_Query_Types || "[]");
    if (Array.isArray(parsed)) secondary = parsed;
  } catch (_) { /* ignore malformed json */ }

  let fromBlob = null;
  if (r.AI_Call_Intelligence) {
    try {
      fromBlob = JSON.parse(r.AI_Call_Intelligence);
    } catch (_) { /* ignore */ }
  }

  const pick = (col, blobKey, fallback) => {
    const colVal = r[col];
    if (colVal != null && String(colVal).trim() !== "") return colVal;
    if (fromBlob && fromBlob[blobKey] != null && String(fromBlob[blobKey]).trim() !== "") {
      return fromBlob[blobKey];
    }
    return fallback;
  };

  const primaryQueryType = pick("AI_Primary_Query_Type", "Primary_Query_Type", "Other/General Info");
  if (!fromBlob && !r.AI_Primary_Query_Type && !r.AI_Intelligence_Summary && !r.AI_Call_Intelligence) {
    return null;
  }

  if (fromBlob && Array.isArray(fromBlob.Secondary_Query_Types) && !secondary.length) {
    secondary = fromBlob.Secondary_Query_Types;
  }

  return {
    primaryQueryType,
    secondaryQueryTypes: secondary,
    escalationRequested: pick("AI_Escalation_Requested", "Escalation_Requested", "No"),
    escalationActioned: pick("AI_Escalation_Actioned", "Escalation_Actioned", "N/A"),
    escalationCategory: pick("AI_Escalation_Category", "Escalation_Category", "None"),
    csatTransferred: pick("AI_CSAT_Transferred", "CSAT_Transferred", "No"),
    isLoanCall: pick("AI_Loan_Is_Loan_Call", "Loan_Is_Loan_Call", "No"),
    loanType: pick("AI_Loan_Type", "Loan_Type", "None"),
    customerInterest: pick("AI_Loan_Interest", "Loan_Interest", "None"),
    emiAffordability: pick("AI_EMI_Affordability", "EMI_Affordability", "Not Discussed"),
    emiAmount: (() => {
      const v = pick("AI_EMI_Amount", "EMI_Amount", null);
      return v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null;
    })(),
    loanAmount: (() => {
      const v = pick("AI_Loan_Amount", "Loan_Amount", null);
      return v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null;
    })(),
    agentConvinced: pick("AI_Agent_Convinced", "Agent_Convinced", "N/A"),
    successProbability: (() => {
      const v = pick("AI_Loan_Success_Probability", "Loan_Success_Probability", 0);
      return v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : 0;
    })(),
    summary: pick("AI_Intelligence_Summary", "Intelligence_Summary", ""),
  };
}

const CALL_INTELLIGENCE_SELECT = `
  SELECT AI_Primary_Query_Type, AI_Secondary_Query_Types,
         AI_Escalation_Requested, AI_Escalation_Actioned, AI_Escalation_Category,
         AI_CSAT_Transferred,
         AI_Loan_Is_Loan_Call, AI_Loan_Type, AI_Loan_Interest, AI_EMI_Affordability,
         AI_EMI_Amount, AI_Loan_Amount, AI_Agent_Convinced,
         AI_Loan_Success_Probability, AI_Intelligence_Summary, AI_Call_Intelligence
  FROM [dbo].[Consolidated_Audio_Analysis]
  WHERE AudioFileName = @filename
`;

async function fetchCallIntelligenceRow(pool, filename) {
  return pool.request()
    .input("filename", sql.NVarChar, filename)
    .query(CALL_INTELLIGENCE_SELECT);
}

/**
 * GET /api/call-intelligence/:filename
 * Per-call intelligence (escalation, query categories, loan/lead) for ResultPage.
 */
app.get("/api/call-intelligence/:filename", async (req, res) => {
  const filename = decodeURIComponent(req.params.filename || "");
  try {
    const pool = await sqlConnect();
    let result;
    try {
      result = await fetchCallIntelligenceRow(pool, filename);
    } catch (err) {
      if (isMissingDbObjectError(err)) {
        return res.status(200).json({
          success: true,
          intelligence: null,
          message: "Intelligence not available yet.",
        });
      }
      throw err;
    }

    if (!result.recordset.length) {
      const uploadCheck = await pool.request()
        .input("filename", sql.NVarChar, filename)
        .query(`SELECT TOP 1 AudioFileName FROM dbo.AudioUploads WHERE AudioFileName = @filename`);
      if (uploadCheck.recordset.length) {
        await ensureConsolidatedAudioRow(pool, filename);
        result = await fetchCallIntelligenceRow(pool, filename);
      }
    }

    if (!result.recordset.length) {
      return res.status(200).json({
        success: true,
        intelligence: null,
        message: "Intelligence not available for this call yet.",
      });
    }

    const intelligence = mapCallIntelligenceFromRecord(result.recordset[0]);
    if (!intelligence) {
      return res.status(200).json({
        success: true,
        intelligence: null,
        message: "This call was processed before call intelligence was enabled.",
      });
    }

    return res.status(200).json({ success: true, intelligence });
  } catch (error) {
    console.error(
      `[${getISTTimeString()}] Error fetching call intelligence for ${filename}:`,
      error.message
    );
    writeLog(`[${getISTTimeString()}] Error fetching call intelligence: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching call intelligence." });
  }
});


/* ===================== 11) WebSocket Integration ===================== */
const { attachWebSocketHub } = require("./websocket/wsHub");
const wss = attachWebSocketHub(server, { sql, sqlConnect, getISTTimeString, resolveProjectPath });

/* ===================== 12) Start the Server ===================== */
// Known-weak placeholder values that must never reach production.
const WEAK_SECRET_VALUES = new Set([
  "changeme", "change-me", "secret", "password", "passw0rd", "test", "testing",
  "dev", "development", "default", "admin", "token", "12345678", "your-secret",
  "your_secret_here", "replace-me", "todo",
]);
const MIN_SECRET_LENGTH = 12;

function classifySecret(value) {
  const v = String(value || "").trim();
  if (!v) return "missing";
  if (WEAK_SECRET_VALUES.has(v.toLowerCase())) return "weak";
  if (v.length < MIN_SECRET_LENGTH) return "weak";
  return "ok";
}

/**
 * Validates production secrets. Fail-closed in production:
 *   - MISSING required secret  → fatal (exit) unless ALLOW_WEAK_SECRETS=true
 *   - WEAK required secret     → loud warning; fatal only if ENFORCE_SECRET_STRENGTH=true
 * In non-production, everything is a warning only.
 */
function logSecurityConfigWarnings() {
  const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
  const allowWeak = String(process.env.ALLOW_WEAK_SECRETS || "false").toLowerCase() === "true";
  const enforceStrength = String(process.env.ENFORCE_SECRET_STRENGTH || "false").toLowerCase() === "true";
  const authEnforced = String(process.env.API_AUTH_ENFORCE || "true").toLowerCase() !== "false";

  // Visibility: which secrets came from Docker secret files (names only, no values).
  if (Array.isArray(__secretsFromFiles) && __secretsFromFiles.length) {
    const msg = `[SECURITY] Secrets loaded from files (not env): ${__secretsFromFiles.join(", ")}`;
    console.log(msg);
    writeLog(`[${getISTTimeString()}] ${msg}`);
  }

  if (!authEnforced) {
    const msg = "[SECURITY] API_AUTH_ENFORCE is FALSE — API authentication is DISABLED. Do not run like this in production.";
    console.warn(msg);
    writeLog(`[${getISTTimeString()}] ${msg}`);
  }

  const required = [
    ["ORCHESTRATOR_SECRET", process.env.ORCHESTRATOR_SECRET],
    ["CALLBACK_SECRET", process.env.CALLBACK_SECRET],
    ["LICENSE_SECRET_KEY", process.env.LICENSE_SECRET_KEY],
    ["SERVICE_TOKEN", process.env.SERVICE_TOKEN || process.env.UPLOAD_SERVICE_TOKEN],
  ];

  const fatal = [];
  for (const [name, value] of required) {
    const verdict = classifySecret(value);
    if (verdict === "ok") continue;

    if (!isProd) {
      const msg = `[SECURITY-DEV] ${name} is ${verdict} (ok for dev; required & strong in production).`;
      console.warn(msg);
      writeLog(`[${getISTTimeString()}] ${msg}`);
      continue;
    }

    if (verdict === "missing") {
      const msg = `[SECURITY] ${name} is MISSING — required for production.`;
      console.error(msg);
      writeLog(`[${getISTTimeString()}] ${msg}`);
      if (!allowWeak) fatal.push(name);
    } else {
      // weak
      const msg = `[SECURITY] ${name} is WEAK (too short or a known placeholder). Use crypto.randomBytes(32).hex.`;
      console.error(msg);
      writeLog(`[${getISTTimeString()}] ${msg}`);
      if (enforceStrength && !allowWeak) fatal.push(name);
    }
  }

  if (isProd) {
    const cors = String(process.env.CORS_ORIGIN || "").trim();
    if (!cors) {
      const msg = "[SECURITY] CORS_ORIGIN is empty in production — refusing to start with an open CORS policy.";
      console.error(msg);
      writeLog(`[${getISTTimeString()}] ${msg}`);
      if (!allowWeak) fatal.push("CORS_ORIGIN");
    }
  }

  if (fatal.length) {
    const msg = `[SECURITY] FATAL: refusing to start in production due to: ${fatal.join(", ")}. ` +
      `Set strong secrets (Docker secrets recommended) or override with ALLOW_WEAK_SECRETS=true (NOT for prod).`;
    console.error(msg);
    writeLog(`[${getISTTimeString()}] ${msg}`);
    process.exit(1);
  }
}

server.listen(PORT, async () => {
  logSecurityConfigWarnings();
  try {
    await initRedis();
    startUploadWorker({ sql, config, writeLog });
  } catch (err) {
    console.warn("[WARN] Redis init failed:", err.message);
  }
  try {
    await ensureAdminSchema();
    console.log("[INFO] Admin schema (Locations, AppSettings) verified.");
  } catch (err) {
    console.error("[WARN] Admin schema bootstrap failed:", err.message);
  }
  try {
    const pool = await connectToDatabase();
    const mig = await runDatabaseMigrations(pool);
    if (mig.ok) {
      console.log(`[INFO] Database migrations OK: ${(mig.steps || []).join(", ")}`);
    } else {
      console.error("[WARN] Database migrations partial failure:", mig.error);
    }
  } catch (err) {
    console.error("[WARN] Database migration bootstrap failed:", err.message);
  }
  try {
    const pool = await connectToDatabase();
    await ensureCallProcessingLogSchema(pool);
    console.log("[INFO] CallProcessingLog schema verified.");
  } catch (err) {
    console.error("[WARN] CallProcessingLog schema bootstrap failed:", err.message);
  }
  try {
    const pool = await connectToDatabase();
    const sched = await autoUploadService.initAutoUpload(pool, config);
    if (sched.scheduled) {
      console.log(`[INFO] Auto-upload scheduler active (${sched.expression}, Asia/Kolkata).`);
    } else {
      console.log("[INFO] Auto-upload scheduler not active (disabled or invalid cron).");
    }
  } catch (err) {
    console.error("[WARN] Auto-upload init failed:", err.message);
  }
  console.log(`[INFO] Server is running on http://localhost:${PORT}`);
});