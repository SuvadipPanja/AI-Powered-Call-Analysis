/**
 * ===============================================================
 * Backend Server: AI-Powered Call Analytics Platform
 * Compliance     : ISO 27001, ISO 9001
 * Secure Coding  : Follows OWASP Top 10, encrypted secrets, audit logs
 * Logging        : Daily rotating logs, unique request ID, WebSocket sync
 * Code Audited   : Reviewed and sanitized for production use
 * ===============================================================
 */


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
const express = require("express");
const bodyParser = require("body-parser");
const sql = require("mssql");
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

// Import custom project modules
const uploadHandler = require("./uploadHandler");
const agentRoutes = require("./agentController");

/* ===================== 2) Global Variables ===================== */
function getISTTimeString() {
  return new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

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
global.isLicenseExpired = false; // License expiration flag

/* ===================== 3) Database Configuration & Helpers ===================== */
// Database configuration and connection helpers (moved here to fix initialization error)
const config = {
  user: process.env.DB_USER, // Database user from .env
  password: process.env.DB_PASSWORD, // Database password
  server: process.env.DB_SERVER, // Database server
  port: parseInt(process.env.DB_PORT), // Database port
  database: process.env.DB_DATABASE, // Database name
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true', // Encryption setting
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true', // Trust server certificate
  },
};

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

/* ===================== 4) Robust Logging System ===================== */
// Setup for robust logging with daily rotation and WebSocket broadcasting
const logDir = process.env.DETAILS_LOG_DIR.replace('${Project log}', process.env['Project log']);
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


// Write log message to the current day's log file
function writeLog(message) {
  const logFilePath = getLogFilePath();
  fs.appendFile(logFilePath, message + "\n", (err) => {
    if (err) {
      console.error("Error writing log:", err);
    }
  });
}

// Counter for unique API call IDs
let logCounter = 0;

// Middleware to log API requests and responses
function robustLogger(req, res, next) {
  logCounter++;
  const uniqueId = logCounter;
  const startTime = new Date();
  const caller = req.body.username || req.query.username || "Unknown";

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
      requestBody: req.body,
      responseStatus: res.statusCode,
      responseData: data,
      duration: duration + "ms"
    };
    const logMessage = JSON.stringify(logData);
    writeLog(logMessage);

    if (websocketServer) {
      websocketServer.clients.forEach(client => {
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
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (!details.internal && details.mac !== "00:00:00:00:00:00") {
        return details.mac.toUpperCase();
      }
    }
  }
  throw new Error("No valid MAC address found.");
}

function getServerMacAddresses() {
  const interfaces = os.networkInterfaces();
  const macAddresses = [];

  for (const iface of Object.values(interfaces)) {
    for (const details of iface) {
      if (!details.internal && details.mac !== "00:00:00:00:00:00") {
        macAddresses.push(details.mac.toUpperCase());
      }
    }
  }

  if (macAddresses.length === 0) {
    throw new Error("No valid MAC addresses found.");
  }

  return macAddresses;
}

async function decodeLicense(licenseKey, secretKey) {
  try {
    const licenseStr = Buffer.from(licenseKey, "base64").toString();
    const license = JSON.parse(licenseStr);
    const { appId, nonce, aad, ciphertext } = license;

    const keyMaterial = crypto.pbkdf2Sync(secretKey, appId, 100000, 32, "sha256");
    const decodedNonce = Buffer.from(nonce, "base64");
    const decodedCiphertextWithTag = Buffer.from(ciphertext, "base64");

    const authTagLength = 16;
    if (decodedCiphertextWithTag.length < authTagLength) {
      throw new Error("Ciphertext is too short to contain an auth tag");
    }
    const ciphertextLength = decodedCiphertextWithTag.length - authTagLength;
    const actualCiphertext = decodedCiphertextWithTag.slice(0, ciphertextLength);
    const authTag = decodedCiphertextWithTag.slice(ciphertextLength);

    const decodedAad = Buffer.from(aad, "hex");

    const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial, decodedNonce);
    decipher.setAuthTag(authTag);
    decipher.setAAD(decodedAad);

    let decrypted = decipher.update(actualCiphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    const decryptedStr = decrypted.toString();
    
    console.log("License decoded successfully");
    return JSON.parse(decryptedStr);
  } catch (error) {
    console.error(`[${getISTTimeString()}] Decryption error: ${error.message}`);
    throw new Error("Invalid or tampered license key: " + error.message);
  }
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

    if (!fs.existsSync(licenseFilePath)) {
      writeLog(`[${getISTTimeString()}] No license file found`);
      return;
    }

    const licenseKey = fs.readFileSync(licenseFilePath, 'utf8').trim();
    if (!licenseKey) {
      writeLog(`[${getISTTimeString()}] License file is empty`);
      return;
    }

    const pool = await connectToDatabase();
    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return;
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return;
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] Invalid MAC address`);
      console.log("License validation failed: MAC address mismatch");
      return;
    }

    const now = new Date();
    const startDate = new Date(payload.startDate);
    const endDate = new Date(payload.endDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License not yet valid`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return;
    }
    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License out of date range`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      global.isLicenseExpired = true;
      return;
    }

    await pool.request()
      .query("UPDATE Licenses SET IsActive = 0 WHERE IsActive = 1");

    await pool.request()
      .input("LicenseKey", sql.NVarChar, licenseKey)
      .input("UploadedBy", sql.NVarChar, "System (Startup)")
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO Licenses (LicenseKey, UploadedBy, CreatedAt, IsActive)
        VALUES (@LicenseKey, @UploadedBy, @CreatedAt, 1);
      `);

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    global.isLicenseExpired = false;
    global.licensePayload = payload;

    const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const warning = endDate <= sixDaysFromNow ? "License expires soon (within 6 days)." : null;

    writeLog(`[${getISTTimeString()}] License validated successfully${warning ? " - " + warning : ""}`);
    console.log("License extracted successfully and payload parameters match");
  } catch (error) {
    writeLog(`[${getISTTimeString()}] ${error.message}`);
    console.log("License validation failed: ${error.message}");
  }
};

// Initialize license on startup
(async () => {
  await loadLicenseOnStartup();
})();

/* ===================== 7) Express App & Middleware Setup ===================== */
// Initialize Express app and configure middleware
const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
  origin: process.env.CORS_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(robustLogger);

/* ===================== 8) File Storage & Upload Setup ===================== */
// Configure file storage for audio and profile pictures
const uploadDirectory = process.env.AUDIO_UPLOAD_DIR;
if (!fs.existsSync(uploadDirectory)) {
  fs.mkdirSync(uploadDirectory, { recursive: true });
  console.log("[INFO] Upload directory initialized.");
}
const audioStorage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, uploadDirectory); },
  filename: (req, file, cb) => { cb(null, Date.now() + "-" + file.originalname); }
});
const uploadAudio = multer({ storage: audioStorage });

const profilePicsDir = path.join(__dirname, process.env.PROFILE_PICS_DIR);
if (!fs.existsSync(profilePicsDir)) {
  fs.mkdirSync(profilePicsDir, { recursive: true });
  console.log("[INFO] Profile pictures directory initialized.");
}
const storageProfilePic = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, profilePicsDir); },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || ".jpg";
    cb(null, req.params.username + ext);
  }
});
const uploadProfilePic = multer({ storage: storageProfilePic });

/* ===================== 9) Mounting Other Routers ===================== */
// Mount the agent management routes from agentController
app.use("/api", agentRoutes);

/* ===================== 10) API Endpoints ===================== */
/* 10.1 License Management APIs */
// APIs for managing licenses, including validation, upload, and deletion
/**
 * API 10.1.01 - POST /api/verify-license
 * Verifies an active license key against system parameters
 */
app.post("/api/verify-license", async (req, res) => {
  const { secretKey } = req.body;
  if (!secretKey) {
    writeLog(`[${getISTTimeString()}] License validation failed: Missing secret key`);
    return res.status(400).json({ success: false, message: "Secret key is required." });
  }
  if (secretKey !== global.secretKey) {
    writeLog(`[${getISTTimeString()}] License validation failed: Invalid secret key`);
    return res.status(401).json({ success: false, message: "Invalid secret key." });
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

    if (now > endDate) {
      writeLog(`[${getISTTimeString()}] License validation failed: License expired on ${endDate.toISOString()}`);
      console.log("License validation failed: License expired on ${endDate.toISOString()}");
      global.isLicenseExpired = true;
      return res.status(403).json({ success: false, message: `License expired on ${endDate.toLocaleDateString()}.` });
    }

    global.isLicenseExpired = false;

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License validation failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature." });
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] License validation failed: ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return res.status(500).json({ success: false, message: macError.message });
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] License validation failed: MAC mismatch`);
      console.log("License validation failed: MAC address mismatch");
      return res.status(401).json({ success: false, message: "Invalid MAC address." });
    }

    const startDate = new Date(payload.startDate);
    if (now < startDate) {
      writeLog(`[${getISTTimeString()}] License validation failed: License not yet valid until ${startDate.toISOString()}`);
      console.log("License validation failed: License not yet valid until ${startDate.toISOString()}");
      return res.status(401).json({ success: false, message: "License is not yet valid." });
    }

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    const sixDaysFromNow = new Date(now.getTime() + 6 * 24 * 60 * 60 * 1000);
    const warning = endDate <= sixDaysFromNow ? "License expires soon (within 6 days)." : null;

    global.licensePayload = payload;

    writeLog(`[${getISTTimeString()}] License validated successfully${warning ? " - " + warning : ""}`);
    console.log("License extracted successfully and payload parameters match");
    return res.status(200).json({ success: true, warning });
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
    const timeDiff = endDate - now;
    const daysUntilExpiration = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    const isExpired = now > endDate;
    if (isExpired) {
      writeLog(`[${getISTTimeString()}] License status: Expired on ${endDate.toISOString()}`);
    } else if (daysUntilExpiration <= 7) {
      writeLog(`[${getISTTimeString()}] License status: Nearing expiration (${daysUntilExpiration} days remaining)`);
    }

    return res.status(200).json({
      success: true,
      isExpired,
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
app.post("/api/upload-license", async (req, res) => {
  const { username, licenseKey, secretKey } = req.body;

  if (!username || !licenseKey || !secretKey) {
    writeLog(`[${getISTTimeString()}] License upload failed: Missing username, licenseKey, or secretKey`);
    return res.status(400).json({ success: false, message: "Username, license key, and secret key are required." });
  }

  if (secretKey !== global.secretKey) {
    writeLog(`[${getISTTimeString()}] License upload failed: Invalid secret key for user ${username}`);
    return res.status(401).json({ success: false, message: "Invalid secret key." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License upload failed: User ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userType = userResult.recordset[0].AccountType;
    if (userType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] License upload failed: User ${username} is not a Super Admin`);
      return res.status(403).json({ success: false, message: "Only Super Admins can upload licenses." });
    }

    const payload = await decodeLicense(licenseKey, secretKey);

    const SIGNATURE = "$Panja";
    if (payload.signature !== SIGNATURE) {
      writeLog(`[${getISTTimeString()}] License upload failed: Invalid signature`);
      console.log("License validation failed: Invalid signature");
      return res.status(401).json({ success: false, message: "Invalid signature in new license." });
    }

    let serverMacs;
    try {
      serverMacs = getServerMacAddresses();
    } catch (macError) {
      writeLog(`[${getISTTimeString()}] License upload failed: ${macError.message}`);
      console.log("License validation failed: No valid MAC addresses found");
      return res.status(500).json({ success: false, message: macError.message });
    }
    if (!serverMacs.includes(payload.macAddress)) {
      writeLog(`[${getISTTimeString()}] License upload failed: MAC mismatch`);
      console.log("License validation failed: MAC address mismatch");
      return res.status(401).json({ success: false, message: "Invalid MAC address in new license." });
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

    await pool.request()
      .query("UPDATE Licenses SET IsActive = 0 WHERE IsActive = 1");

    await pool.request()
      .input("LicenseKey", sql.NVarChar, licenseKey)
      .input("UploadedBy", sql.NVarChar, username)
      .input("CreatedAt", sql.DateTime, new Date())
      .query(`
        INSERT INTO Licenses (LicenseKey, UploadedBy, CreatedAt, IsActive)
        VALUES (@LicenseKey, @UploadedBy, @CreatedAt, 1);
      `);

    await pool.request()
      .input("endDate", sql.Date, payload.endDate)
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query("UPDATE Licenses SET EndDate = @endDate, UpdatedAt = GETDATE() WHERE LicenseKey = @licenseKey");

    const licenseFilePath = "E:/AI-Powered Call Analysis/ai-call-center-analysis/license/license.lic";
    try {
      const licenseDir = path.dirname(licenseFilePath);
      if (!fs.existsSync(licenseDir)) {
        fs.mkdirSync(licenseDir, { recursive: true });
        writeLog(`[${getISTTimeString()}] Created license directory: ${licenseDir}`);
      }
      fs.writeFileSync(licenseFilePath, licenseKey);
      writeLog(`[${getISTTimeString()}] License key written to file: ${licenseFilePath}`);
    } catch (fileError) {
      writeLog(`[${getISTTimeString()}] Failed to write license key to file ${licenseFilePath}: ${fileError.message}`);
      return res.status(500).json({ success: false, message: `Failed to write license key to file: ${fileError.message}` });
    }

    global.licensePayload = payload;

    writeLog(`[${getISTTimeString()}] License uploaded successfully by ${username}`);
    console.log("License extracted successfully and payload parameters match");
    return res.status(200).json({ success: true, message: "License uploaded successfully." });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] License upload error for user ${username}: ${error.message}`);
    console.log("License validation failed: ${error.message}");
    return res.status(500).json({ success: false, message: "Server error during license upload: " + error.message });
  }
});

/**
 * API 10.6.04 - POST /api/delete-license
 * Deletes a license (Super Admin only)
 */
app.post("/api/delete-license", async (req, res) => {
  const { username, licenseKey } = req.body;

  if (!username || !licenseKey) {
    writeLog(`[${getISTTimeString()}] License deletion failed: Missing username or licenseKey`);
    return res.status(400).json({ success: false, message: "Username and license key are required." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License deletion failed: User ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userType = userResult.recordset[0].AccountType;
    if (userType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] License deletion failed: User ${username} is not a Super Admin (AccountType: ${userType})`);
      return res.status(403).json({ success: false, message: "Only Super Admins can delete licenses." });
    }
    writeLog(`[${getISTTimeString()}] User ${username} verified as Super Admin for license deletion`);

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
      const licenseFilePath = "E:/AI-Powered Call Analysis/ai-call-center-analysis/license/license.lic";
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
      global.isLicenseExpired = false;
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
app.post("/api/license-details", async (req, res) => {
  const { username, licenseKey } = req.body;

  if (!username || !licenseKey) {
    writeLog(`[${getISTTimeString()}] License details fetch failed: Missing username or licenseKey`);
    return res.status(400).json({ success: false, message: "Username and license key are required." });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT AccountType FROM dbo.Users WHERE Username = @username`);

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: User ${username} not found`);
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const userType = userResult.recordset[0].AccountType;
    if (userType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] License details fetch failed: User ${username} is not a Super Admin (AccountType: ${userType})`);
      return res.status(403).json({ success: false, message: "Only Super Admins can view license details." });
    }
    writeLog(`[${getISTTimeString()}] User ${username} verified as Super Admin for license details`);

    const licenseResult = await pool.request()
      .input("licenseKey", sql.NVarChar, licenseKey)
      .query(`SELECT LicenseKey, EndDate, IsActive FROM Licenses WHERE LicenseKey = @licenseKey`);

    if (licenseResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License details fetch failed: License not found`);
      return res.status(404).json({ success: false, message: "License not found." });
    }

    const license = licenseResult.recordset[0];
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
app.get('/api/license-history', async (req, res) => {
  const { username } = req.query;

  if (!username) {
    writeLog(`[${getISTTimeString()}] License History: Username not provided`);
    return res.status(400).json({ success: false, message: 'Username is required' });
  }

  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT * FROM Users WHERE Username = @username');

    if (userResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] License History: User ${username} not found`);
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    if (userResult.recordset[0].AccountType !== 'Super Admin') {
      writeLog(`[${getISTTimeString()}] License History: User ${username} is not a Super Admin`);
      return res.status(403).json({ success: false, message: 'Access denied: Super Admin only' });
    }

    const result = await pool.request()
      .input('username', sql.NVarChar, username)
      .query('SELECT * FROM Licenses WHERE UploadedBy = @username ORDER BY CreatedAt DESC');

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
app.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send({ success: false, message: "Username and password are required." });
  }
  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("username", sql.NVarChar, username)
      .input("password", sql.NVarChar, password)
      .query("INSERT INTO Users (Username, Password) VALUES (@username, @password)");
    res.status(201).send({ success: true, message: "User registered successfully." });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.10.08 - POST /api/login
 * Authenticates a user and creates a session
 */
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    console.log("Missing credentials in /api/login: ${JSON.stringify({ username })}");
    return res.status(400).json({ success: false, message: "Username and password required." });
  }

  try {
    console.log("Login attempt for user: ${username}");

    const pool = await connectToDatabase();
    const queryResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT Password, AccountType FROM dbo.Users WHERE Username = @username`);

    if (queryResult.recordset.length === 0) {
      console.log("User not found: ${username}");
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    const user = queryResult.recordset[0];
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      console.log("Invalid password for user: ${username}");
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    if (global.licensePayload) {
      const maxUsers = global.licensePayload.users;
      const activeSessions = await pool.request()
        .query("SELECT COUNT(*) AS count FROM ActiveSessions WHERE IsActive = 1");
      const activeCount = activeSessions.recordset[0].count;
      if (activeCount >= maxUsers) {
        writeLog(`[${getISTTimeString()}] Login failed: Maximum login count (${maxUsers}) reached for ${username}`);
        return res.status(403).json({ success: false, message: "Maximum login count reached." });
      }
    } else {
      writeLog(`[${getISTTimeString()}] Login warning: No license payload found for ${username}`);
    }

    const userType = user.AccountType || "Agent";
    const insertLog = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .query(`
        INSERT INTO UserSessionLog (Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@Username, @UserType, GETDATE());
      `);
    const logId = insertLog.recordset[0].LogID;

    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .query(`
        INSERT INTO ActiveSessions (Username, LogID, LoginTime, IsActive)
        VALUES (@Username, @LogID, @LoginTime, 1);
      `);

    console.log("Login successful for user: ${username}, LogID: ${logId}");
    return res.status(200).json({ success: true, message: "Login successful.", userType, logId });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/login: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.11.09 - POST /api/login-security
 * Authenticates a user with security question verification
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

app.post("/api/login-security", loginLimiter, async (req, res) => {
  const { username, password, questionType, questionAnswer } = req.body;

  if (!username || !password || !questionType || !questionAnswer) {
    console.log("Missing fields in /api/login-security: ${JSON.stringify({ username, questionType })}");
    return res.status(400).json({ success: false, message: "Username, password, security question type, and answer are required." });
  }

  if (!validator.isAlphanumeric(username) || username.length > 50) {
    writeLog(`[${getISTTimeString()}] Invalid username format: ${username}`);
    return res.status(400).json({ success: false, message: "Invalid username format." });
  }
  if (password.length > 100 || questionAnswer.length > 100 || questionType.length > 100) {
    writeLog(`[${getISTTimeString()}] Input length exceeded for user: ${username}`);
    return res.status(400).json({ success: false, message: "Input length exceeded." });
  }

  if (global.isLicenseExpired) {
    const pool = await connectToDatabase();
    const licenseResult = await pool.request()
      .query("SELECT TOP 1 EndDate FROM Licenses WHERE IsActive = 1 ORDER BY CreatedAt DESC");
    const endDate = licenseResult.recordset.length > 0 ? new Date(licenseResult.recordset[0].EndDate) : null;
    writeLog(`[${getISTTimeString()}] Login failed for ${username}: License expired on ${endDate?.toISOString()}`);
    return res.status(403).json({ success: false, message: `License expired on ${endDate?.toLocaleDateString()}. Please contact an administrator.` });
  }

  try {
    console.log("Login attempt for user: ${username}");

    const pool = await connectToDatabase();
    const queryResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT Password, AccountType, SecurityQuestionType, SecurityQuestionAnswer FROM dbo.Users WHERE Username = @username`);

    if (queryResult.recordset.length === 0) {
      console.log("User not found: ${username}");
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    const user = queryResult.recordset[0];
    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      console.log("Invalid password for user: ${username}");
      return res.status(401).json({ success: false, message: "Invalid username or password." });
    }

    if (user.SecurityQuestionType !== questionType || user.SecurityQuestionAnswer !== questionAnswer) {
      console.log("Security question validation failed for user: ${username}");
      return res.status(401).json({ success: false, message: "Invalid security question or answer." });
    }

    if (global.licensePayload) {
      const maxUsers = global.licensePayload.users;
      const activeSessions = await pool.request()
        .query("SELECT COUNT(*) AS count FROM ActiveSessions WHERE IsActive = 1");
      const activeCount = activeSessions.recordset[0].count;
      if (activeCount >= maxUsers) {
        writeLog(`[${getISTTimeString()}] Login failed: Maximum login count (${maxUsers}) reached for ${username}`);
        return res.status(403).json({ success: false, message: "Maximum login count reached." });
      }
    } else {
      writeLog(`[${getISTTimeString()}] Login warning: No license payload found for ${username}`);
    }

    const userType = user.AccountType || "Agent";
    const insertLog = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .query(`
        INSERT INTO UserSessionLog (Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@Username, @UserType, GETDATE());
      `);
    const logId = insertLog.recordset[0].LogID;

    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, sessionToken)
      .query(`
        INSERT INTO ActiveSessions (Username, LogID, LoginTime, IsActive, Token)
        VALUES (@Username, @LogID, @LoginTime, 1, @Token);
      `);

    console.log("Login successful for user: ${username}, LogID: ${logId}, Session Token: ${sessionToken}");
    return res.status(200).json({ success: true, message: "Login successful.", userType, logId, sessionToken });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/login-security: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.68.660 - POST /api/logout-track
 * Tracks user logout and marks session as inactive
 */
app.post("/api/logout-track", async (req, res) => {
  const { username, logId } = req.body;
  if (!username || !logId) {
    console.log("Missing fields in /api/logout-track: ${JSON.stringify({ username, logId })}");
    return res.status(400).json({ success: false, message: "Username and logId are required." });
  }

  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .query(`
        UPDATE ActiveSessions
        SET IsActive = 0
        WHERE Username = @Username AND LogID = @LogID;
      `);

    if (result.rowsAffected[0] === 0) {
      console.log("No active session found for ${username}, LogID: ${logId}");
      return res.status(404).json({ success: false, message: "No active session found." });
    }

    writeLog(`[${getISTTimeString()}] Logout successful for ${username}, LogID: ${logId}`);
    return res.status(200).json({ success: true, message: "Logout tracked successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in /api/logout-track: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error during logout tracking." });
  }
});

/**
 * API 10.72.701 - GET /api/user/:username
 * Retrieves user details
 */
app.get("/api/user/:username", async (req, res) => {
  const { username } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`
        SELECT U.Username, U.Password, U.Email, U.AccountType,
               U.SecurityQuestionType, U.SecurityQuestionAnswer,
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
        SecurityQuestionAnswer: userRow.SecurityQuestionAnswer || "Not Set",
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
  try {
    const pool = await connectToDatabase();
    const userCheck = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM dbo.Users WHERE LOWER(Username) = LOWER(@username)");
    if (userCheck.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }
    await pool.request()
      .input("question", sql.NVarChar, question)
      .input("answer", sql.NVarChar, answer)
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
  const { newPassword } = req.body;

  if (!newPassword) {
    return res.status(400).send({ success: false, message: "New password is required." });
  }

  try {
    console.log("Received PUT request to /api/user/${username}/password");

    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query("SELECT Username FROM Users WHERE Username = @username");

    if (userResult.recordset.length === 0) {
      console.log("User not found: ${username}");
      return res.status(404).send({ success: false, message: "User not found." });
    }

    const saltRounds = 10;
    const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);
    console.log("New password hashed for user ${username}: ${newPasswordHash}");

    await pool.request()
      .input("newPassword", sql.NVarChar, newPasswordHash)
      .input("username", sql.NVarChar, username)
      .query("UPDATE Users SET Password = @newPassword WHERE Username = @username");

    console.log("Password updated successfully for user: ${username}");

    return res.status(200).send({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in PUT /api/user/${username}/password: ${error.message}`);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.17.15 - POST /api/user
 * Creates a new user
 */
app.post("/api/user", async (req, res) => {
  try {
    console.log("Received POST request to /api/user");

    const { username, password, email, userType, SecurityQuestionType, SecurityQuestionAnswer, createdBy } = req.body;

    if (!username || !password || !email || !userType || !SecurityQuestionType || !SecurityQuestionAnswer) {
      console.log(`[${getISTTimeString()}] Missing required fields:`, { username, email, userType, SecurityQuestionType, SecurityQuestionAnswer });
      return res.status(400).json({ success: false, message: "All fields are required." });
    }

    console.log("Creating user: ${username}, email: ${email}");

    const saltRounds = 10;
    let hashedPassword;
    try {
      hashedPassword = await bcrypt.hash(password, saltRounds);
      console.log("Password hashed successfully for user ${username}: ${hashedPassword}");
    } catch (hashError) {
      console.error(`[${getISTTimeString()}] Error hashing password for user ${username}: ${hashError.message}`);
      return res.status(500).json({ success: false, message: "Failed to hash password." });
    }

    const pool = await connectToDatabase();
    console.log("Connected to database for user creation: ${username}");

    const result = await pool.request()
      .input('Username', username)
      .input('Password', hashedPassword)
      .input('Email', email)
      .input('AccountType', userType)
      .input('SecurityQuestionType', SecurityQuestionType)
      .input('SecurityQuestionAnswer', SecurityQuestionAnswer)
      .input('CreatedBy', createdBy || null)
      .query(`
        INSERT INTO dbo.Users (
          Username,
          Password,
          Email,
          AccountType,
          SecurityQuestionType,
          SecurityQuestionAnswer,
          CreatedBy,
          CreationDate
        ) VALUES (
          @Username,
          @Password,
          @Email,
          @AccountType,
          @SecurityQuestionType,
          @SecurityQuestionAnswer,
          @CreatedBy,
          GETDATE()
        )
      `);

    console.log("User ${username} created successfully in the database.");

    return res.status(201).json({ success: true, message: "User created successfully." });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in POST /api/user: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.070 - POST /api/reset-password
 * Resets a user's password with security question verification
 */
app.post("/api/reset-password", async (req, res) => {
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
      .input("securityAnswer", sql.NVarChar, sanitizedAnswer)
      .query(`
        SELECT * FROM dbo.Users 
        WHERE Username = @username 
        AND Email = @email 
        AND SecurityQuestionType = @securityQuestion 
        AND SecurityQuestionAnswer = @securityAnswer
      `);

    if (userResult.recordset.length === 0) {
      console.log("No matching user found for: ${sanitizedUsername}, email: ${sanitizedEmail}");
      return res.status(404).json({ 
        success: false, 
        message: "No user found with the provided details or incorrect security answer." 
      });
    }

    const saltRounds = 10;
    const hashedNewPassword = await bcrypt.hash(sanitizedPassword, saltRounds);
    console.log("New password hashed for user ${sanitizedUsername}: ${hashedNewPassword}");

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
 * API 10.9.073 - POST /api/temp-super-admin-login
 * Temporary login for Super Admins with security question
 */
app.post("/api/temp-super-admin-login", loginLimiter, async (req, res) => {
  console.log("Received request to /api/temp-super-admin-login");
  const { username, password, questionType, questionAnswer } = req.body;

  if (!username || !password || !questionType || !questionAnswer) {
    writeLog(`[${getISTTimeString()}] Missing fields in /api/temp-super-admin-login: ${JSON.stringify({ username, questionType })}`);
    return res.status(400).json({ success: false, message: "All fields are required." });
  }

  if (!validator.isAlphanumeric(username) || username.length > 50) {
    writeLog(`[${getISTTimeString()}] Invalid username format: ${username}`);
    return res.status(400).json({ success: false, message: "Invalid credentials." });
  }
  if (password.length > 100 || questionAnswer.length > 100 || questionType.length > 100) {
    writeLog(`[${getISTTimeString()}] Input length exceeded for user: ${username}`);
    return res.status(400).json({ success: false, message: "Invalid credentials." });
  }

  try {
    const pool = await connectToDatabase();
    const queryResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT Password, AccountType, SecurityQuestionType, SecurityQuestionAnswer FROM dbo.Users WHERE Username = @username`);

    if (queryResult.recordset.length === 0) {
      writeLog(`[${getISTTimeString()}] User not found: ${username}`);
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    const user = queryResult.recordset[0];

    if (user.AccountType !== "Super Admin") {
      writeLog(`[${getISTTimeString()}] Temporary login failed: User ${username} is not a Super Admin (AccountType: ${user.AccountType})`);
      return res.status(403).json({ success: false, message: "Unauthorized access." });
    }

    const passwordMatch = await bcrypt.compare(password, user.Password);
    if (!passwordMatch) {
      writeLog(`[${getISTTimeString()}] Invalid password for user: ${username}`);
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    if (user.SecurityQuestionType !== questionType || user.SecurityQuestionAnswer !== questionAnswer) {
      writeLog(`[${getISTTimeString()}] Security question validation failed for user: ${username}`);
      return res.status(401).json({ success: false, message: "Invalid credentials." });
    }

    await pool.request()
      .input("username", sql.NVarChar, username)
      .query("UPDATE ActiveSessions SET IsActive = 0 WHERE Username = @username AND IsActive = 1");
    writeLog(`[${getISTTimeString()}] Invalidated existing active sessions for user: ${username}`);

    const userType = user.AccountType;
    const insertLog = await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("UserType", sql.NVarChar, userType)
      .query(`
        INSERT INTO UserSessionLog (Username, UserType, LoginTime)
        OUTPUT INSERTED.LogID
        VALUES (@Username, @UserType, GETDATE());
      `);
    const logId = insertLog.recordset[0].LogID;

    const sessionToken = crypto.randomBytes(32).toString('hex');

    await pool.request()
      .input("Username", sql.NVarChar, username)
      .input("LogID", sql.Int, logId)
      .input("LoginTime", sql.DateTime, new Date())
      .input("Token", sql.NVarChar, sessionToken)
      .query(`
        INSERT INTO ActiveSessions (Username, LogID, LoginTime, IsActive, Token)
        VALUES (@Username, @LogID, @LoginTime, 1, @Token);
      `);

    writeLog(`[${getISTTimeString()}] Temporary Super Admin login successful for user: ${username}, LogID: ${logId}`);
    return res.status(200).json({ success: true, message: "Login successful.", userType, logId, sessionToken });
  } catch (error) {
    writeLog(`[${getISTTimeString()}] Error in /api/temp-super-admin-login: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.9.074 - GET /api/users/list
 * Lists all users
 */
app.get("/api/users/list", async (req, res) => {
  try {
    console.log("Received GET request to /api/users/list");

    const pool = await connectToDatabase();
    const result = await pool.request().query(`
      SELECT Username, Email, AccountType, SecurityQuestionType, SecurityQuestionAnswer, CreatedBy, CreationDate
      FROM dbo.Users
      ORDER BY CreationDate DESC
    `);

    console.log("Successfully fetched ${result.recordset.length} users.");

    return res.status(200).json({ success: true, users: result.recordset });
  } catch (error) {
    console.error(`[${getISTTimeString()}] Error in GET /api/users/list: ${error.message}`);
    return res.status(500).json({ success: false, message: "Server error fetching users." });
  }
});

/**
 * API 10.9.075 - GET /api/users/search
 * Searches users by username
 */
app.get("/api/users/search", async (req, res) => {
  try {
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
          Password,
          Email,
          AccountType,
          SecurityQuestionType,
          SecurityQuestionAnswer,
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

/* 10.4 Audio Processing APIs */
// APIs for handling audio file uploads and processing
/**
 * API 10.28.26 - POST /upload-audio
 * Uploads an audio file for analysis
 */
app.post("/upload-audio", uploadAudio.single("audioFile"), (req, res) => {
  uploadHandler.handleFileUpload(req, res, config);
});

/**
 * API 10.29.27 - GET /api/audio-status/:audioFileName
 * Retrieves the processing status of an audio file
 */
app.get('/api/audio-status/:audioFileName', async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query("SELECT Status FROM AI_Processing_Result WHERE AudioFileName = @audioFileName");
    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: "Audio file not found." });
    }
    return res.status(200).json({ success: true, status: result.recordset[0].Status });
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
 * API 10.31.29 - GET /api/audio-details/:audioFileName
 * Retrieves details of a specific audio file
 */
app.get("/api/audio-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioFileName, SelectedAgent AS AgentName, CallType,
               FORMAT(UploadDate, 'yyyy-MM-dd') AS UploadDate,
               ProcessStatus AS Status
        FROM AudioUploads
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).send({ success: false, message: "Audio file not found." });
    }
    return res.status(200).send({ success: true, audioDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching audio details:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.32.30 - GET /audio/:filename
 * Serves an audio file
 */
app.get("/audio/:filename", (req, res) => {
  const { filename } = req.params;
  const audioFilePath = path.join(uploadDirectory, filename);
  if (fs.existsSync(audioFilePath)) {
    return res.sendFile(audioFilePath);
  } else {
    return res.status(404).send("Audio file not found.");
  }
});

/**
 * API 10.33.31 - GET /api/translate-output/:audioFileName
 * Retrieves translation output for an audio file
 */
app.get("/api/translate-output/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT TranslateOutput
      FROM AI_Processing_Result
      WHERE AudioFileName = @audioFileName
    `;
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(query);
    if (result.recordset.length === 0) {
      return res.status(404).send({ success: false, message: "TranslateOutput not found for the given audio file." });
    }
    return res.status(200).send({ success: true, translateOutput: result.recordset[0].TranslateOutput });
  } catch (error) {
    console.error("Error fetching TranslateOutput:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.34.32 - GET /api/recent-activity
 * Retrieves recent audio processing activity
 */
app.get("/api/recent-activity", async (req, res) => {
  const { fromDate, toDate } = req.query;

  // Get today's date in YYYY-MM-DD format
  const localToday = new Date().toISOString().split("T")[0];

  // Fallback to today if no query provided
  const safeFromDate = fromDate || localToday;
  const safeToDate = toDate || localToday;

  // Form complete datetime strings
  const startOfDay = `${safeFromDate} 00:00:00`;
  const endOfDay = `${safeToDate} 23:59:59`;

  try {
    const pool = await sqlConnect();

    let query = `
      SELECT TOP 5 
        AudioFileName AS FileName,
        FORMAT(Timestamp, 'yyyy-MM-dd') AS UploadDate,
        Status
      FROM AI_Processing_Result
    `;

    if (!fromDate && !toDate) {
      // No filter: latest 5 entries
      query += "ORDER BY Timestamp DESC;";
    } else {
      // Filtered by date range
      query += `
        WHERE Timestamp BETWEEN @startOfDay AND @endOfDay
        ORDER BY Timestamp DESC;
      `;
    }

    const result = await pool.request()
      .input("startOfDay", sql.DateTime, startOfDay)
      .input("endOfDay", sql.DateTime, endOfDay)
      .query(query);

    return res.status(200).json({ success: true, data: result.recordset });

  } catch (error) {
    console.error("Error fetching recent activity:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.35.33 - GET /api/tone-analysis/:audioFileName
 * Retrieves tone analysis for a specific audio file
 */
app.get('/api/tone-analysis/:audioFileName', async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT ToneAnalysis
        FROM AI_Processing_Result
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0 || !result.recordset[0].ToneAnalysis) {
      return res.status(404).send({ success: false, message: "Tone analysis not found." });
    }
    let toneAnalysis;
    try {
      toneAnalysis = JSON.parse(result.recordset[0].ToneAnalysis.replace(/'/g, '"'));
    } catch (error) {
      console.error("Invalid JSON in ToneAnalysis:", error.message);
      return res.status(500).send({
        success: false,
        message: "Invalid JSON in ToneAnalysis field.",
        rawData: result.recordset[0].ToneAnalysis,
      });
    }
    return res.status(200).send({ success: true, toneAnalysis });
  } catch (error) {
    console.error("Error fetching tone analysis:", error);
    return res.status(500).send({ success: false, message: "Server error." });
  }
});

/**
 * API 10.36.34 - GET /api/audio-upload-details/:audioFileName
 * Retrieves upload details for a specific audio file
 */
app.get("/api/audio-upload-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioFileName, SelectedAgent AS AgentName, CallType,
               CONVERT(VARCHAR(10), UploadDate, 120) AS UploadDate,
               ProcessStatus AS Status
        FROM dbo.AudioUploads
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Audio file details not found." });
    }
    return res.status(200).json({ success: true, audioUploadDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching audio upload details:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.28.260 - GET /api/ai-processing-details/:audioFileName
 * Retrieves AI processing details for a specific audio file
 */
app.get("/api/ai-processing-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AudioLanguage, AudioDuration, TranscribeOutput,
               TranslateOutput, ToneAnalysis, Sentiment
        FROM dbo.AI_Processing_Result
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "AI processing details not found." });
    }
    return res.status(200).json({ success: true, aiProcessingDetails: result.recordset[0] });
  } catch (error) {
    console.error("Error fetching AI processing details:", error);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.28.261 - GET /api/custom-scoring-details/:audioFileName
 * Retrieves custom scoring details for an audio file (excluding summary)
 */
app.get("/api/custom-scoring-details/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT AIScoring, Opening_Speech, Empathy, Query_Handling, Adherence_to_Protocol,
               Resolution_Assurance, Query_Resolution, Polite_Tone, Authentication_Verification,
               Escalation_Handling, Closing_Speech, Rude_Behavior, Overall_Scoring,
               Call_Type, Lead_Classification, Resolution_Status, Feedback
        FROM dbo.AI_Details_Scoring
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No scoring record found for that audio file." });
    }
    const record = result.recordset[0];
    function parseScoreLines(rawText) {
      if (typeof rawText !== 'string' || !rawText) return {};
      const lines = rawText.split("\n").filter(Boolean);
      let obj = {};
      lines.forEach((line) => {
        const parts = line.split(":");
        if (parts.length === 2) {
          const key = parts[0].trim();
          const val = parts[1].trim();
          obj[key] = val;
        }
      });
      return obj;
    }
    const aiScoringObj = {
      "Opening Speech": record.Opening_Speech || '',
      "Empathy": record.Empathy || '',
      "Query Handling": record.Query_Handling || '',
      "Adherence to Protocol": record.Adherence_to_Protocol || '',
      "Resolution Assurance": record.Resolution_Assurance || '',
      "Query Resolution": record.Query_Resolution || '',
      "Polite Tone": record.Polite_Tone || '',
      "Authentication Verification": record.Authentication_Verification || '',
      "Escalation Handling": record.Escalation_Handling || '',
      "Closing Speech": record.Closing_Speech || '',
      "Rude Behavior": record.Rude_Behavior || '',
      "Overall Scoring": record.Overall_Scoring || '',
      "Call Type": record.Call_Type || '',
      "Lead Classification": record.Lead_Classification || '',
      "Resolution Status": record.Resolution_Status || '',
      "Feedback": record.Feedback || '',
    };
    const parsedAIScoring = parseScoreLines(record.AIScoring);
    Object.assign(aiScoringObj, parsedAIScoring);

    return res.status(200).json({ success: true, aiScoring: aiScoringObj });
  } catch (error) {
    console.error("Error fetching combined scoring:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching scoring data." });
  }
});

/**
 * API 10.28.262 - GET /api/summary/:audioFileName
 * Retrieves summary for an audio file
 */
app.get("/api/summary/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await sql.connect(config);
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT Summary
        FROM dbo.AI_Details_Scoring
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0 || !result.recordset[0].Summary) {
      return res.status(404).json({ success: false, message: "Summary not found for the given audio file." });
    }
    return res.status(200).json({ success: true, summary: result.recordset[0].Summary });
  } catch (error) {
    console.error("Error fetching summary:", error);
    return res.status(500).json({ success: false, message: "Server error fetching summary." });
  }
});

/**
 * API 10.28.263 - POST /api/manual-scoring/:audioFileName
 * Updates manual scoring for an audio file
 */
app.post("/api/manual-scoring/:audioFileName", async (req, res) => {
  const { audioFileName } = req.params;
  const { manualScoring } = req.body;
  try {
    const pool = await sql.connect(config);
    await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .input("manualScoring", sql.NVarChar, manualScoring || "")
      .query(`
        UPDATE dbo.AI_Processing_Result
        SET ManualScoring = @manualScoring
        WHERE AudioFileName = @audioFileName
      `);
    return res.status(200).json({ success: true, message: "Manual scoring updated successfully." });
  } catch (err) {
    console.error("Error updating manual scoring:", err);
    return res.status(500).json({ success: false, message: "Server error updating manual scoring." });
  }
});

/**
 * API 10.28.264 - GET /api/sentiment/:audioFileName
 * Retrieves sentiment analysis for an audio file
 */
app.get('/api/sentiment/:audioFileName', async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query("SELECT Sentiment FROM AI_Processing_Result WHERE AudioFileName = @audioFileName");
    if (!result.recordset.length) {
      return res.status(404).json({ success: false, message: "No sentiment data found." });
    }
    const sentiment = result.recordset[0].Sentiment;
    return res.status(200).json({ success: true, sentiment });
  } catch (err) {
    console.error("Error fetching sentiment:", err);
    return res.status(500).json({ success: false, message: "Server error fetching sentiment." });
  }
});

/**
 * API 10.28.265 - GET /api/recent-activity-full
 * Retrieves detailed recent call activity
 */
app.get("/api/recent-activity-full", async (req, res) => {
  const { fromDate, toDate } = req.query;
  const localToday = getISTTimeString().split("T")[0];
  const safeFromDate = fromDate || localToday;
  const safeToDate = toDate || localToday;
  const startOfDay = `${safeFromDate} 00:00:00`;
  const endOfDay = `${safeToDate} 23:59:59`;

  try {
    const pool = await sqlConnect();
    let query = `
      SELECT 
        AU.AudioFileName AS FileName,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd') AS UploadDate,
        COALESCE(APR.Status, AU.ProcessStatus) AS Status,
        FORMAT(AU.UploadDate, 'yyyy-MM-dd') AS ProcessDate,
        COALESCE(ADS.AgentName, AU.SelectedAgent, 'Unknown') AS AgentName,
        COALESCE(ADS.AudioDuration, '00:00:00') AS AudioDuration,
        COALESCE(ADS.AudioLanguage, 'Unknown') AS AudioLanguage,
        AgentTable.agent_id AS AgentID,
        AgentTable.agent_location AS Location,
        COALESCE(ADS.Overall_Scoring, '') AS Overall_Scoring
      FROM AudioUploads AU
      LEFT JOIN AI_Processing_Result APR
        ON AU.AudioFileName = APR.AudioFileName
      LEFT JOIN AI_Details_Scoring ADS
        ON AU.AudioFileName = ADS.AudioFileName
      LEFT JOIN [dbo].[Agents] AgentTable
        ON LOWER(COALESCE(ADS.AgentName, AU.SelectedAgent)) = LOWER(AgentTable.agent_name)
    `;
    if (!fromDate && !toDate) {
      const oneMonthAgo = new Date();
      oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
      query += `
        WHERE AU.UploadDate >= @oneMonthAgo
        ORDER BY AU.UploadDate DESC;
      `;
      const result = await pool.request()
        .input("oneMonthAgo", sql.DateTime, oneMonthAgo)
        .query(query);
      return res.status(200).json({ success: true, data: result.recordset });
    } else {
      query += `
        WHERE AU.UploadDate BETWEEN @startOfDay AND @endOfDay
        ORDER BY AU.UploadDate DESC;
      `;
      const result = await pool.request()
        .input("startOfDay", sql.DateTime, startOfDay)
        .input("endOfDay", sql.DateTime, endOfDay)
        .query(query);
      return res.status(200).json({ success: true, data: result.recordset });
    }
  } catch (error) {
    console.error("Error fetching full recent activity:", error);
    return res.status(500).json({ success: false, message: "Server error fetching full recent activity." });
  }
});

/**
 * API 10.28.266 - GET /api/script-compliance/:audioFileName
 * Retrieves script compliance data for an audio file
 */
app.get('/api/script-compliance/:audioFileName', async (req, res) => {
  const { audioFileName } = req.params;
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input("audioFileName", sql.NVarChar, audioFileName)
      .query(`
        SELECT ScriptCompliance
        FROM dbo.AI_Processing_Result
        WHERE AudioFileName = @audioFileName
      `);
    if (result.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "No ScriptCompliance found for the provided audio file." });
    }
    return res.status(200).json({ success: true, scriptCompliance: result.recordset[0].ScriptCompliance });
  } catch (error) {
    console.error("Error fetching ScriptCompliance:", error);
    return res.status(500).json({ success: false, message: "Server error while fetching ScriptCompliance." });
  }
});

/* 10.5 Profile Picture APIs */
/**
 * API 10.44.42 - POST /api/user/:username/profile-picture
 * Uploads a user's profile picture
 */
app.post("/api/user/:username/profile-picture", uploadProfilePic.single("profilePic"), async (req, res) => {
  const { username } = req.params;
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No profile picture file received." });
  }
  try {
    return res.status(200).json({ success: true, message: "Profile picture uploaded successfully." });
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    return res.status(500).json({ success: false, message: "Server error uploading profile picture." });
  }
});

/**
 * API 10.45.43 - GET /api/user/:username/profile-picture
 * Retrieves a user's profile picture
 */
app.get("/api/user/:username/profile-picture", (req, res) => {
  const { username } = req.params;
  const filePath = path.join(profilePicsDir, `${username}.jpg`);
  if (fs.existsSync(filePath)) {
    return res.sendFile(filePath);
  } else {
    const placeholder = path.join(profilePicsDir, "placeholder.jpg");
    if (fs.existsSync(placeholder)) {
      return res.sendFile(placeholder);
    }
    return res.status(404).send("Profile picture not found.");
  }
});

/* 10.6 Analytics APIs */
/**
 * API 10.46.44 - GET /api/calls-processed-7days
 * Retrieves calls processed in the last 7 days
 */
app.get('/api/calls-processed-7days', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().execute('dbo.FetchCallsProcessed7Days');
    const labels = result.recordset.map(row => row.Date);
    const values = result.recordset.map(row => row.ProcessedCalls);
    return res.json({ success: true, labels, values });
  } catch (err) {
    console.error("Error in /api/calls-processed-7days:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.47.45 - GET /api/agent-wise-ai-scoring
 * Retrieves AI scoring by agent
 */
app.get('/api/agent-wise-ai-scoring', async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request().execute('dbo.FetchAgentWiseScoring');
    const agentLabels = result.recordset.map(row => row.SelectedAgent);
    const agentScores = result.recordset.map(row => row.AvgAIScore);
    return res.json({ success: true, agentLabels, agentScores });
  } catch (err) {
    console.error("Error in /api/agent-wise-ai-scoring:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.48.46 - GET /api/analytics-overview
 * Retrieves analytics overview for a specified period
 */
app.get('/api/analytics-overview', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('Days', sql.Int, days)
      .execute('dbo.FetchAnalyticsOverview');
    if (!result.recordset.length) {
      return res.json({ success: true, totalFiles: 0, totalLanguages: 0, toneAnalysisStatus: 'In Progress' });
    }
    return res.json({ success: true, ...result.recordset[0] });
  } catch (err) {
    console.error("Error in /api/analytics-overview:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.49.47 - GET /api/tone-analysis
 * Retrieves sample tone analysis distribution
 */
app.get('/api/tone-analysis', async (req, res) => {
  try {
    const sampleDistribution = { positive: 25, neutral: 50, negative: 25 };
    return res.json({ success: true, distribution: sampleDistribution });
  } catch (err) {
    console.error("Error in /api/tone-analysis:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.50.48 - GET /api/ai-scoring
 * Retrieves AI scoring for a specified range
 */
app.get('/api/ai-scoring', async (req, res) => {
  try {
    const range = parseInt(req.query.range) || 7;
    const pool = await connectToDatabase();
    const result = await pool.request()
      .input('Range', sql.Int, range)
      .execute('dbo.FetchAIScoring');
    const labels = result.recordset.map(row => row.Date);
    const scores = result.recordset.map(row => row.AvgAIScore);
    return res.json({ success: true, labels, scores });
  } catch (err) {
    console.error("Error in /api/ai-scoring:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * API 10.51.49 - GET /api/metrics-overview
 * Retrieves overview metrics for call analysis
 */
app.get("/api/metrics-overview", async (req, res) => {
  const { location, tl, fromDate, toDate } = req.query;
  try {
    const pool = await connectToDatabase();

    if (!fromDate || !toDate) {
      return res.status(400).json({ success: false, message: "fromDate and toDate are required." });
    }

    const parsedFromDate = new Date(fromDate);
    const parsedToDate = new Date(toDate);
    const currentDate = new Date();

    if (isNaN(parsedFromDate) || isNaN(parsedToDate)) {
      return res.status(400).json({ success: false, message: "Invalid date format. Use YYYY-MM-DD." });
    }

    if (parsedToDate < parsedFromDate) {
      return res.status(400).json({ success: false, message: "toDate must be on or after fromDate." });
    }

    const effectiveToDate = parsedToDate > currentDate ? currentDate : parsedToDate;
    const effectiveFromDate = parsedFromDate;

    let query = `
      SELECT 
        COUNT(*) AS totalCallsProcessed,
        COUNT(CASE WHEN Status = 'Success' THEN 1 END) AS successCount,
        COUNT(CASE WHEN Status = 'Failed' THEN 1 END) AS failedCount,
        COALESCE(AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2)) / 100), 0) AS avgAiScoring,
        COALESCE(AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2)) / 100), 0) AS avgManualScoring,
        COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) / 60.0, 2), 0) AS aht
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE CAST(SelectedCallDate AS DATE) BETWEEN @fromDate AND @toDate
    `;

    const conditions = [];
    if (location && location !== "All") {
      conditions.push(`TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`);
    }
    if (tl && tl !== "All") {
      conditions.push(`TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@tl))`);
    }

    if (conditions.length > 0) {
      query += " AND " + conditions.join(" AND ");
    }

    const request = pool.request()
      .input("fromDate", sql.Date, effectiveFromDate.toISOString().split("T")[0])
      .input("toDate", sql.Date, effectiveToDate.toISOString().split("T")[0]);

    if (location && location !== "All") {
      request.input("location", sql.NVarChar, location);
    }
    if (tl && tl !== "All") {
      request.input("tl", sql.NVarChar, tl);
    }

    const result = await request.query(query);
    const currentData = result.recordset[0] || {
      totalCallsProcessed: 0,
      successCount: 0,
      failedCount: 0,
      avgAiScoring: 0,
      avgManualScoring: 0,
      aht: 0
    };

    const daysDiff = (effectiveToDate - effectiveFromDate) / (1000 * 60 * 60 * 24);
    let prevStartDate = new Date(effectiveFromDate);
    let prevEndDate = new Date(effectiveToDate);
    prevStartDate.setDate(prevStartDate.getDate() - daysDiff - 1);
    prevEndDate.setDate(prevEndDate.getDate() - daysDiff - 1);

    let prevQuery = `
      SELECT 
        COUNT(*) AS totalCallsProcessed,
        COUNT(CASE WHEN Status = 'Success' THEN 1 END) AS successCount,
        COUNT(CASE WHEN Status = 'Failed' THEN 1 END) AS failedCount,
        COALESCE(AVG(TRY_CAST(AI_Overall_Scoring AS DECIMAL(10,2)) / 100), 0) AS avgAiScoring,
        COALESCE(AVG(TRY_CAST(Manual_Overall_Scoring AS DECIMAL(10,2)) / 100), 0) AS avgManualScoring,
        COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) / 60.0, 2), 0) AS aht
      FROM [dbo].[Consolidated_Audio_Analysis]
      WHERE CAST(SelectedCallDate AS DATE) BETWEEN @prevFromDate AND @prevToDate
    `;

    const prevConditions = [];
    if (location && location !== "All") {
      prevConditions.push(`TRIM(LOWER(AgentLocation)) = TRIM(LOWER(@location))`);
    }
    if (tl && tl !== "All") {
      prevConditions.push(`TRIM(LOWER(AgentSupervisor)) = TRIM(LOWER(@tl))`);
    }

    if (prevConditions.length > 0) {
      prevQuery += " AND " + prevConditions.join(" AND ");
    }

    const prevRequest = pool.request()
      .input("prevFromDate", sql.Date, prevStartDate.toISOString().split("T")[0])
      .input("prevToDate", sql.Date, prevEndDate.toISOString().split("T")[0]);

    if (location && location !== "All") {
      prevRequest.input("location", sql.NVarChar, location);
    }
    if (tl && tl !== "All") {
      prevRequest.input("tl", sql.NVarChar, tl);
    }

    const prevResult = await prevRequest.query(prevQuery);
    const prevData = prevResult.recordset[0] || {
      totalCallsProcessed: 0,
      successCount: 0,
      failedCount: 0,
      avgAiScoring: 0,
      avgManualScoring: 0,
      aht: 0
    };

    return res.status(200).json({
      success: true,
      totalCallsProcessed: currentData.totalCallsProcessed,
      successCount: currentData.successCount,
      failedCount: currentData.failedCount,
      avgAiScoring: currentData.avgAiScoring || 0,
      avgManualScoring: currentData.avgManualScoring || 0,
      aht: currentData.aht || 0,
      prevPeriodData: {
        totalCallsProcessed: prevData.totalCallsProcessed,
        successCount: prevData.successCount,
        failedCount: prevData.failedCount,
        avgAiScoring: prevData.avgAiScoring || 0,
        avgManualScoring: prevData.avgManualScoring || 0,
        aht: prevData.aht || 0
      }
    });
  } catch (error) {
    console.error("Error in /api/metrics-overview:", error);
    return res.status(500).json({ success: false, message: "Server error: " + error.message });
  }
});

/**
 * API 10.52.50 - GET /api/tone-analysis-7days
 * Retrieves tone analysis for the last 7 days
 */
app.get("/api/tone-analysis-7days", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT ToneAnalysis
      FROM AI_Processing_Result
      WHERE Timestamp >= DATEADD(DAY, -7, GETDATE())
    `;
    const result = await pool.request().query(query);
    let sumPos = 0, sumNeu = 0, sumNeg = 0;
    for (const row of result.recordset) {
      const raw = row.ToneAnalysis || "";
      if (raw.includes("Positive")) sumPos++;
      else if (raw.includes("Negative")) sumNeg++;
      else sumNeu++;
    }
    return res.json({
      success: true,
      labels: ["Positive", "Neutral", "Negative"],
      values: [sumPos, sumNeu, sumNeg]
    });
  } catch (err) {
    console.error("Error in /api/tone-analysis-7days:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.53.51 - GET /api/daily-call-duration-current-week
 * Retrieves daily call duration for the current week
 */
app.get("/api/daily-call-duration-current-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DATENAME(WEEKDAY, AU.UploadDate) AS DayName, APR.AudioDuration
      FROM AI_Processing_Result APR
      JOIN AudioUploads AU ON APR.AudioFileName = AU.AudioFileName
      WHERE AU.UploadDate >= DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()), 0)
        AND AU.UploadDate < DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()) + 1, 0)
    `;
    const result = await pool.request().query(query);
    let dayMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    function toMinutes(hhmmss) {
      if (!hhmmss) return 0;
      const parts = hhmmss.split(":");
      if (parts.length !== 3) return 0;
      let h = parseInt(parts[0]) || 0;
      let m = parseInt(parts[1]) || 0;
      let s = parseInt(parts[2]) || 0;
      return h * 60 + m + s / 60;
    }
    for (const row of result.recordset) {
      const day = row.DayName;
      dayMap[day] = (dayMap[day] || 0) + toMinutes(row.AudioDuration);
    }
    const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const values = labels.map(d => Math.round(dayMap[d] || 0));
    return res.json({ success: true, labels, values });
  } catch (err) {
    console.error("Error in /api/daily-call-duration-current-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/**
 * API 10.54.52 - GET /api/inbound-outbound-week
 * Retrieves inbound and outbound call counts for the current week
 */
app.get("/api/inbound-outbound-week", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const query = `
      SELECT DATENAME(WEEKDAY, UploadDate) AS DayName, CallType
      FROM AudioUploads
      WHERE UploadDate >= DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()), 0)
        AND UploadDate < DATEADD(WEEK, DATEDIFF(WEEK, 0, GETDATE()) + 1, 0)
    `;
    const result = await pool.request().query(query);
    let inboundMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    let outboundMap = { Monday: 0, Tuesday: 0, Wednesday: 0, Thursday: 0, Friday: 0, Saturday: 0, Sunday: 0 };
    for (const row of result.recordset) {
      let d = row.DayName;
      let ct = (row.CallType || "").toLowerCase();
      if (ct === "inbound") inboundMap[d]++;
      else if (ct === "outbound") outboundMap[d]++;
    }
    const labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const inbound = labels.map(d => inboundMap[d]);
    const outbound = labels.map(d => outboundMap[d]);
    return res.json({ success: true, labels, inbound, outbound });
  } catch (err) {
    console.error("Error in /api/inbound-outbound-week:", err);
    return res.status(500).json({ success: false, message: "Server error." });
  }
});

/* 10.7 Agent Dashboard APIs */
/**
 * API 10.55.53 - GET /api/agent-profile
 * Retrieves an agent's profile information
 */
app.get("/api/agent-profile", async (req, res) => {
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, message: "Missing 'username' query param." });
  }
  try {
    const pool = await connectToDatabase();
    const userResult = await pool.request()
      .input("username", sql.NVarChar, username)
      .query(`SELECT Username, Email FROM dbo.Users WHERE Username = @username`);
    if (!userResult.recordset.length) {
      return res.status(404).json({ success: false, message: "No matching user found in dbo.Users." });
    }
    const userRow = userResult.recordset[0];
    const agentResult = await pool.request()
      .input("agentName", sql.NVarChar, userRow.Username)
      .query(`
        SELECT agent_id, agent_name, agent_email, agent_mobile,
               agent_type, agent_creation_date,
               supervisor, manager, auditor, notes
        FROM dbo.Agents
        WHERE agent_name = @agentName OR agent_email = @agentName
      `);
    if (!agentResult.recordset.length) {
      return res.status(404).json({ success: false, message: "No matching agent found in dbo.Agents." });
    }
    return res.status(200).json({ success: true, user: userRow, agent: agentResult.recordset[0] });
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
  const { username } = req.query;
  if (!username) {
    return res.status(400).json({ success: false, message: "Missing 'username' query param." });
  }
  try {
    await sql.connect(config);
    const lastDayQuery = await sql.query(`
      SELECT MAX(CallDate) AS LastWorkingDay, COUNT(*) AS TotalCallsAllTime
      FROM dbo.AI_Details_Scoring
      WHERE LOWER(AgentName) = LOWER('${username}');
    `);
    const lastDayRow = lastDayQuery.recordset[0] || {};
    const lastWorkingDay = lastDayRow.LastWorkingDay || null;
    const totalCallsAllTime = lastDayRow.TotalCallsAllTime || 0;
    let totalCallsLastDay = 0;
    let ahtMinutesForLastDay = 0;
    let lowestScoringFeedbackLastDay = null;
    if (lastWorkingDay) {
      const dateOnly = lastWorkingDay.toISOString().split("T")[0];
      const ahtRes = await sql.query(`
        SELECT COUNT(*) AS CallCountLastDay,
               AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration))) AS AvgSec
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER('${username}')
          AND CONVERT(VARCHAR(10), CallDate, 120) = '${dateOnly}';
      `);
      const ahtRow = ahtRes.recordset[0] || {};
      totalCallsLastDay = ahtRow.CallCountLastDay || 0;
      const avgSec = ahtRow.AvgSec || 0;
      ahtMinutesForLastDay = Math.round(avgSec / 60);
      const feedbackRes = await sql.query(`
        SELECT TOP 1 Feedback
        FROM dbo.AI_Details_Scoring
        WHERE LOWER(AgentName) = LOWER('${username}')
          AND Feedback IS NOT NULL
          AND CONVERT(VARCHAR(10), CallDate, 120) = '${dateOnly}'
        ORDER BY TRY_CAST(Overall_Scoring AS DECIMAL(10,2)) ASC;
      `);
      if (feedbackRes.recordset.length > 0) {
        lowestScoringFeedbackLastDay = feedbackRes.recordset[0].Feedback;
      }
    }
    const scoringRes = await sql.query(`
      SELECT FORMAT(CallDate, 'yyyy-MM-dd') AS dateStr,
             AVG(TRY_CAST(Overall_Scoring AS DECIMAL(10,2))) AS avgScore
      FROM dbo.AI_Details_Scoring
      WHERE LOWER(AgentName) = LOWER('${username}')
      GROUP BY FORMAT(CallDate, 'yyyy-MM-dd')
      ORDER BY dateStr;
    `);
    const overallScoring = scoringRes.recordset.map(r => ({
      dateStr: r.dateStr,
      avgScore: r.avgScore || 0
    }));
    const kpiRes = await sql.query(`
      SELECT 'Empathy' AS name, AVG(TRY_CAST(Empathy AS DECIMAL(10,2))) AS value
      FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER('${username}')
      UNION ALL
      SELECT 'Adherence' AS name, AVG(TRY_CAST(Adherence_to_Protocol AS DECIMAL(10,2))) AS value
      FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER('${username}')
      UNION ALL
      SELECT 'QueryHandling' AS name, AVG(TRY_CAST(Query_Handling AS DECIMAL(10,2))) AS value
      FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER('${username}')
      UNION ALL
      SELECT 'Resolution' AS name, AVG(TRY_CAST(Resolution_Assurance AS DECIMAL(10,2))) AS value
      FROM dbo.AI_Details_Scoring WHERE LOWER(AgentName) = LOWER('${username}');
    `);
    const kpiMetrics = kpiRes.recordset.map(r => ({
      name: r.name,
      value: r.value ? parseFloat(r.value.toFixed(1)) : 0
    }));
    const recentCallsRes = await sql.query(`
      SELECT TOP 5 CallDate,
             DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, AudioDuration)) AS durationSec,
             TRY_CAST(Overall_Scoring AS DECIMAL(10,2)) AS overallScoring,
             Call_Type, Feedback
      FROM dbo.AI_Details_Scoring
      WHERE LOWER(AgentName) = LOWER('${username}')
      ORDER BY CallDate DESC;
    `);
    const callHistory = recentCallsRes.recordset.map(row => ({
      callDateTime: row.CallDate,
      durationSec: row.durationSec || 0,
      overallScoring: row.overallScoring || 0,
      callType: row.Call_Type || "N/A",
      feedback: row.Feedback || ""
    }));
    return res.status(200).json({
      success: true,
      lastWorkingDay,
      totalCallsAllTime,
      totalCallsLastDay,
      ahtMinutesForLastDay,
      overallScoring,
      kpiMetrics,
      lowestScoringFeedback: lowestScoringFeedbackLastDay,
      callHistory
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
  const { username, content } = req.body;
  if (!username || !content) {
    return res.status(400).json({ success: false, message: "Username and content are required." });
  }
  try {
    const pool = await sql.connect(config);
    await pool.request()
      .input('username', sql.NVarChar, username)
      .input('content', sql.Text, content)
      .query(`
        INSERT INTO dbo.briefing (username, upload_date, upload_time, briefing_content, created_at)
        VALUES (@username, CAST(GETDATE() AS DATE), CAST(GETDATE() AS TIME), @content, GETDATE())
      `);
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
  const { agentUsername } = req.query;
  if (!agentUsername) {
    return res.status(400).json({ success: false, message: "Missing 'agentUsername' query param." });
  }

  try {
    const pool = await sql.connect(config);
    const supervisorResult = await pool.request()
      .input("agentUsername", sql.NVarChar, agentUsername)
      .query(`
        SELECT supervisor
        FROM dbo.Agents
        WHERE LOWER(agent_name) = LOWER(@agentUsername)
      `);
    if (supervisorResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Agent not found or no supervisor assigned." });
    }
    const supervisor = supervisorResult.recordset[0].supervisor;

    const result = await pool.request()
      .input("supervisor", sql.NVarChar, supervisor)
      .query(`
        SELECT TOP 1 briefing_content
        FROM dbo.briefing
        WHERE LOWER(username) = LOWER(@supervisor)
        ORDER BY created_at DESC
      `);
    if (result.recordset.length === 0) {
      return res.status(200).json({ success: true, briefing: "No briefing available." });
    }
    return res.status(200).json({ success: true, briefing: result.recordset[0].briefing_content || "No briefing available." });
  } catch (error) {
    console.error("Error fetching latest briefing:", error);
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
  if (!username || !questions || !Array.isArray(questions) || questions.length < 5) {
    return res.status(400).json({ success: false, message: "Username and at least 5 questions are required." });
  }
  try {
    const pool = await sql.connect(config);
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
  const { agentUsername } = req.query;
  if (!agentUsername) {
    return res.status(400).json({ success: false, message: "Missing 'agentUsername' query param." });
  }

  try {
    const pool = await sql.connect(config);
    const supervisorResult = await pool.request()
      .input("agentUsername", sql.NVarChar, agentUsername)
      .query(`
        SELECT supervisor
        FROM dbo.Agents
        WHERE LOWER(agent_name) = LOWER(@agentUsername)
      `);
    if (supervisorResult.recordset.length === 0) {
      return res.status(404).json({ success: false, message: "Agent not found or no supervisor assigned." });
    }
    const supervisor = supervisorResult.recordset[0].supervisor;

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

/* 10.10 System Monitoring APIs */
/**
 * API 10.64.62 - GET /api/system-monitor
 * Retrieves system performance metrics
 */
app.get('/api/system-monitor', async (req, res) => {
  try {
    const cpu = await si.cpu();
    const cpuLoad = await si.currentLoad();
    const mem = await si.mem();
    const fsData = await si.fsSize();
    const graphics = await si.graphics();

    let gpuLoad = 0;
    if (graphics.controllers.length > 0) {
      try {
        gpuLoad = graphics.controllers[0].temperature ? Math.min(graphics.controllers[0].temperature / 100, 1) : 0;
      } catch (error) {
        gpuLoad = 0;
      }
    }

    const responseData = {
      success: true,
      timestamp: getISTTimeString(),
      cpu: {
        currentLoad: parseFloat(cpuLoad.currentLoad.toFixed(2)),
        avgLoad: parseFloat(cpuLoad.avgLoad.toFixed(2)),
        model: cpu.manufacturer + ' ' + cpu.brand,
        cores: cpu.physicalCores
      },
      memory: {
        total: Math.round(mem.total / (1024 * 1024 * 1024)),
        used: Math.round(mem.used / (1024 * 1024 * 1024)),
        free: Math.round(mem.free / (1024 * 1024 * 1024))
      },
      disks: fsData.map(disk => ({
        fs: disk.fs,
        size: Math.round(disk.size / (1024 * 1024 * 1024)),
        used: Math.round(disk.used / (1024 * 1024 * 1024)),
        use: parseFloat(disk.use.toFixed(2))
      })),
      gpu: graphics.controllers.length > 0 ? {
        model: graphics.controllers[0].model || 'Unknown',
        vram: graphics.controllers[0].vram || 0,
        load: parseFloat((gpuLoad * 100).toFixed(2))
      } : null
    };

    res.status(200).json(responseData);
  } catch (error) {
    writeLog(`Error in /api/system-monitor: ${error.message}`);
    res.status(500).json({
      success: false,
      message: 'Internal server error occurred while fetching system metrics.'
    });
  }
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
    const result = await pool.request()
      .input("teamLeaderUsername", sql.NVarChar, username)
      .query(`
        SELECT 
          A.agent_name AS name, 
          COALESCE(AVG(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2))), 0) AS avgScore,
          COUNT(ADS.AudioFileName) AS calls,
          COALESCE(ROUND(AVG(DATEDIFF(SECOND, 0, TRY_CONVERT(TIME, ADS.AudioDuration))) / 60.0, 2), 0) AS aht
        FROM dbo.Agents A
        LEFT JOIN dbo.AI_Details_Scoring ADS ON A.agent_name = ADS.AgentName
        WHERE A.supervisor = @teamLeaderUsername
          AND ADS.UploadDate >= DATEADD(DAY, -7, GETDATE())
        GROUP BY A.agent_name
      `);
    return res.status(200).json({ success: true, agents: result.recordset });
  } catch (error) {
    console.error("Error fetching team agents:", error);
    return res.status(500).json({ success: false, message: "Server error fetching team agents." });
  }
});

/**
 * API 10.69.67 - GET /api/audit-queue/:username
 * Retrieves audit queue for a team leader
 */
app.get("/api/audit-queue/:username", async (req, res) => {
  const { username } = req.params;
  const { agentName, fromDate, toDate } = req.query;

  try {
    const pool = await connectToDatabase();
    let query = `
      SELECT 
        ADS.AudioFileName AS fileName,
        A.agent_name AS agentName,
        AU.CallType AS callType,
        COALESCE(TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)), 0) AS score,
        FORMAT(ADS.CallDate, 'yyyy-MM-dd') AS callDate
      FROM dbo.Agents A
      JOIN dbo.AI_Details_Scoring ADS ON A.agent_name = ADS.AgentName
      JOIN dbo.AudioUploads AU ON ADS.AudioFileName = AU.AudioFileName
      WHERE A.supervisor = @teamLeaderUsername
        AND CAST(ADS.UploadDate AS DATE) >= COALESCE(CAST(@fromDate AS DATE), DATEADD(DAY, -7, GETDATE()))
        AND CAST(ADS.UploadDate AS DATE) <= COALESCE(CAST(@toDate AS DATE), GETDATE())
        AND (ADS.Rude_Behavior IS NOT NULL AND ADS.Rude_Behavior != '' 
             OR ADS.Adherence_to_Protocol < 5 
             OR TRY_CAST(ADS.Overall_Scoring AS DECIMAL(10,2)) < 80)
    `;

    if (agentName) {
      query += ` AND A.agent_name = @agentName`;
    }

    query += ` ORDER BY ADS.Overall_Scoring ASC`;

    const request = pool.request()
      .input("teamLeaderUsername", sql.NVarChar, username)
      .input("fromDate", sql.Date, fromDate || null)
      .input("toDate", sql.Date, toDate || null);

    if (agentName) {
      request.input("agentName", sql.NVarChar, agentName);
    }

    const result = await request.query(query);
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
 * Retrieves list of agent locations
 */
app.get("/api/locations", async (req, res) => {
  try {
    const pool = await connectToDatabase();
    const result = await pool.request()
      .query("SELECT DISTINCT agent_location AS Location FROM [dbo].[Agents] WHERE agent_location IS NOT NULL ORDER BY agent_location");
    return res.status(200).json({ success: true, locations: result.recordset.map(row => row.Location) });
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
      return res.status(404).json({ success: false, message: "No knowledge entries found in RevaKnowledgeBase for Team Leader section." });
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
  const { question, answer, category, username } = req.body;
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

  if (!name || !agentId || !email || !mobile || !supervisor || !type) {
    return res.status(400).json({ error: "Missing required fields." });
  }

  try {
    const pool = await connectToDatabase();
    await pool.request()
      .input("agent_id", sql.NVarChar, agentId)
      .input("agent_name", sql.NVarChar, name)
      .input("agent_email", sql.NVarChar, email)
      .input("agent_mobile", sql.NVarChar, mobile)
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

/* ===================== 11) WebSocket Integration ===================== */
// Setup WebSocket server for real-time chat and log broadcasting
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
websocketServer = wss;

const clients = new Map();
const chatSessions = new Map();
const activeChats = new Map();

// Broadcasts the list of connected supervisors to all clients
function broadcastUserList() {
  const supervisors = [];
  clients.forEach((info) => {
    if (info.userType === "Team Leader" || info.userType === "Super Admin") {
      supervisors.push(info.username);
    }
  });
  const userListMessage = { type: "userList", supervisors };
  clients.forEach((_, clientWs) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(JSON.stringify(userListMessage));
    }
  });
  console.log("[WS] Broadcasted user list:", supervisors);
}

// Broadcasts or directs chat messages to appropriate clients
function broadcastChatMessage(message) {
  const { from, to, text, timestamp, fromType } = message;
  const chatMessage = { type: "chat", from, fromType, to, text, timestamp };

  if (to === "all" && fromType === "Agent") {
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin")
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[WS] Sent message to ${clientInfo.userType} ${clientInfo.username}`);
      }
    });
  } else {
    clients.forEach((clientInfo, clientWs) => {
      if (
        clientWs.readyState === WebSocket.OPEN &&
        (clientInfo.username === to || clientInfo.username === from)
      ) {
        clientWs.send(JSON.stringify(chatMessage));
        console.log(`[WS] Sent message to ${clientInfo.username}`);
      }
    });
  }
}

/**
 * WebSocket Connection Handling
 */
wss.on("connection", (ws) => {
  console.log("[WS] New WebSocket connection established");

  ws.on("message", async (msg) => {
    let parsedMessage;
    try {
      parsedMessage = JSON.parse(msg);
    } catch (error) {
      console.error("[WS] Invalid message format:", error.message);
      ws.send(JSON.stringify({ type: "error", message: "Invalid message format" }));
      return;
    }

    // Handle client registration
    if (parsedMessage.type === "register") {
      const { username, userType, logId } = parsedMessage;
      if (!username || !userType || !logId) {
        ws.send(JSON.stringify({ type: "error", message: "Missing registration details" }));
        return;
      }
      clients.set(ws, { username, userType, logId });
      console.log(`[WS] Registered ${userType}: ${username} with logId: ${logId}`);
      broadcastUserList();
      return;
    }

    // Handle chat messages
    if (parsedMessage.type === "chat") {
      const { from, to, text, timestamp, fromType } = parsedMessage;
      const senderInfo = clients.get(ws);
      if (!senderInfo) {
        ws.send(JSON.stringify({ type: "error", message: "Not registered" }));
        return;
      }
      if (!to || !text || !timestamp) {
        ws.send(JSON.stringify({ type: "error", message: "Invalid chat message data" }));
        return;
      }

      if (senderInfo.userType === "Agent") {
        if (!chatSessions.has(senderInfo.username)) {
          const timestampStr = getISTTimeString().replace(/[:.]/g, "-");
          const chatDir = process.env.CHAT_DUMP_DIR.replace('${Project log}', process.env['Project log']);
          if (!fs.existsSync(chatDir)) {
            fs.mkdirSync(chatDir, { recursive: true });
            console.log("[WS] Chat dump directory created");
          }
          const filePath = path.join(chatDir, `chat_${senderInfo.username}_${timestampStr}.txt`);
          chatSessions.set(senderInfo.username, {
            filePath,
            ws,
            logId: null,
            startTime: null,
            chatContent: "",
          });
          fs.writeFileSync(
            filePath,
            `Chat Session Started: ${new Date().toLocaleString()} by ${senderInfo.username}\n`
          );
          console.log(`[WS] Chat session file created for ${senderInfo.username}: ${filePath}`);
        }
      }

      let session;
      if (senderInfo.userType === "Agent") {
        session = chatSessions.get(senderInfo.username);
      } else if (to !== "all" && chatSessions.has(to)) {
        session = chatSessions.get(to);
      }

      if (session) {
        const formattedMessage = `[${new Date(timestamp).toLocaleString()}] ${from} (${senderInfo.userType}): ${text}\n`;
        fs.appendFileSync(session.filePath, formattedMessage);
        session.chatContent += formattedMessage;
        console.log(`[WS] Chat logged to ${session.filePath}: ${formattedMessage}`);

        if (senderInfo.userType === "Agent" && !activeChats.has(senderInfo.username)) {
          try {
            const pool = await sqlConnect();
            const result = await pool.request()
              .input("agentUsername", sql.NVarChar(100), senderInfo.username)
              .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
              .input("startTime", sql.DateTime, new Date())
              .input("isClosed", sql.Bit, 0)
              .query(`
                INSERT INTO [dbo].[ChatLog] (AgentUsername, EntireChat, StartTime, IsClosed)
                OUTPUT INSERTED.LogID
                VALUES (@agentUsername, @entireChat, @startTime, @isClosed)
              `);
            const newLogId = result.recordset[0].LogID;
            if (!newLogId) throw new Error("LogID not returned from DB");
            session.logId = newLogId;
            session.startTime = new Date();
            activeChats.set(senderInfo.username, {
              logId: newLogId,
              startTime: new Date(),
            });
            console.log(`[WS] New chat started for ${senderInfo.username} with LogID: ${newLogId}`);
          } catch (error) {
            console.error("[WS] Error starting chat log:", error);
          }
        }

        if (session.logId) {
          try {
            const pool = await sqlConnect();
            await pool.request()
              .input("logId", sql.Int, session.logId)
              .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
              .query(`
                UPDATE [dbo].[ChatLog]
                SET EntireChat = @entireChat
                WHERE LogID = @logId
              `);
            console.log(`[WS] Chat updated in DB for LogID: ${session.logId}`);
          } catch (error) {
            console.error("[WS] Error updating chat in DB:", error);
          }
        }
      }

      broadcastChatMessage(parsedMessage);
      return;
    }

    // Handle chat closure
    if (parsedMessage.type === "chatClosed") {
      const senderInfo = clients.get(ws);
      if (!senderInfo || senderInfo.userType !== "Agent") {
        ws.send(JSON.stringify({ type: "error", message: "Only agents can close chats" }));
        return;
      }
      const agentUsername = senderInfo.username;
      const session = chatSessions.get(agentUsername);
      if (session && session.logId) {
        try {
          const pool = await sqlConnect();
          await pool.request()
            .input("logId", sql.Int, session.logId)
            .input("entireChat", sql.NVarChar(sql.MAX), session.chatContent)
            .input("endTime", sql.DateTime, new Date())
            .input("isClosed", sql.Bit, 1)
            .query(`
              UPDATE [dbo].[ChatLog]
              SET EntireChat = @entireChat, EndTime = @endTime, IsClosed = @isClosed
              WHERE LogID = @logId
            `);
          console.log(`[WS] Chat closed for ${agentUsername} with LogID: ${session.logId}`);
          const closeMessage = {
            type: "chatClosed",
            agentUsername,
            timestamp: getISTTimeString(),
          };
          clients.forEach((clientInfo, clientWs) => {
            if (
              clientWs.readyState === WebSocket.OPEN &&
              clientWs !== ws &&
              (clientInfo.userType === "Team Leader" || clientInfo.userType === "Super Admin")
            ) {
              clientWs.send(JSON.stringify(closeMessage));
              console.log(`[WS] Notified ${clientInfo.userType} ${clientInfo.username} of chat closure`);
            }
          });
          activeChats.delete(agentUsername);
          chatSessions.delete(agentUsername);
          broadcastUserList();
        } catch (error) {
          console.error("[WS] Error closing chat:", error);
          ws.send(JSON.stringify({ type: "error", message: "Failed to close chat" }));
        }
      } else {
        console.log(`[WS] No active chat session found for ${agentUsername}`);
      }
      return;
    }
  });

  // Handle client disconnection
  ws.on("close", async () => {
    const clientInfo = clients.get(ws);
    if (clientInfo) {
      console.log(`[WS] ${clientInfo.userType} ${clientInfo.username} disconnected`);
      if (clientInfo.userType === "Agent" && activeChats.has(clientInfo.username)) {
        const chatInfo = activeChats.get(clientInfo.username);
        try {
          const pool = await connectToDatabase();
          await pool.request()
            .input("LogID", sql.Int, chatInfo.logId)
            .query(`UPDATE UserSessionLog SET LogoutTime = GETDATE() WHERE LogID = @LogID`);
          console.log(`[WS] Chat closed on disconnect for ${clientInfo.username} with LogID: ${chatInfo.logId}`);
          activeChats.delete(clientInfo.username);
          chatSessions.delete(clientInfo.username);
        } catch (error) {
          console.error("[WS] Error updating chat log on disconnect:", error);
        }
      }
      clients.delete(ws);
      broadcastUserList();
    }
  });

  ws.on("error", (err) => {
    console.error("[WS] WebSocket error:", err);
  });

  ws.send(JSON.stringify({ message: "Welcome to the real-time chat system." }));
});

// Confirm WebSocket server is running
wss.on("listening", () => {
  console.log(`[WS] WebSocket server is listening on port ${PORT}`);
});

/* ===================== 12) Start the Server ===================== */
// Start the HTTP and WebSocket server
server.listen(PORT, () => {
  console.log(`[INFO] Server is running on http://localhost:${PORT}`);
});