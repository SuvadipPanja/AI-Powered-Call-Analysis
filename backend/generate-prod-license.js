#!/usr/bin/env node
/**
 * Generate production license.lic (MAC-locked).
 *
 * Usage (from backend/):
 *   LICENSE_SECRET_KEY=... HOST_MAC=8c:84:74:6b:08:7e node generate-prod-license.js
 *   LICENSE_SECRET_KEY=... HOST_MAC=... node generate-prod-license.js ../production/license/license.lic
 */
require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const secretKey = process.env.LICENSE_SECRET_KEY;
const macAddress = (process.env.HOST_MAC || "").trim();

if (!secretKey || secretKey.length !== 32) {
  console.error("ERROR: LICENSE_SECRET_KEY must be exactly 32 characters in .env");
  process.exit(1);
}
if (!macAddress) {
  console.error("ERROR: HOST_MAC must be set in .env (prod server NIC MAC)");
  process.exit(1);
}

const payload = {
  signature: "$Panja",
  startDate: "2025-01-01T00:00:00.000Z",
  endDate: "2031-03-17T00:00:00.000Z",
  users: 500,
  macAddress: macAddress.toUpperCase(),
  appId: "ai-call-analysis-prod",
};

const payloadStr = JSON.stringify(payload);
const aad = crypto.createHash("sha512").update(payloadStr).digest("hex");
const keyMaterial = crypto.pbkdf2Sync(secretKey, payload.appId, 100000, 32, "sha256");
const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial, nonce);
cipher.setAAD(Buffer.from(aad, "hex"));
let ciphertext = cipher.update(payloadStr, "utf8");
ciphertext = Buffer.concat([ciphertext, cipher.final()]);
const authTag = cipher.getAuthTag();
const ciphertextWithTag = Buffer.concat([ciphertext, authTag]);
const license = {
  appId: payload.appId,
  nonce: Buffer.from(nonce).toString("base64"),
  aad,
  ciphertext: Buffer.from(ciphertextWithTag).toString("base64"),
};
const licenseKey = Buffer.from(JSON.stringify(license)).toString("base64");

const outArg = process.argv[2];
const outPath = outArg
  ? path.resolve(outArg)
  : path.join(__dirname, "..", "production", "license", "license.lic");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, licenseKey);

console.log("Production license written:", outPath);
console.log("  MAC:", payload.macAddress);
console.log("  appId:", payload.appId);
console.log("  valid:", payload.startDate, "→", payload.endDate);
console.log("");
console.log("Copy to prod server:");
console.log("  production/license/license.lic → /home/suvadip/Call-Analysis/Project/production/license/");
console.log("Then: docker compose -f docker-compose.prod.yml restart backend");
