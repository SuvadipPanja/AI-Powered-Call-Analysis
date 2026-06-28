#!/usr/bin/env node
/**
 * Docker entrypoint license gate — runs BEFORE the server starts.
 *
 * Refuses to boot (non-zero exit) when no valid license can be loaded, so a
 * customer cannot run the stack without a license. Honours the grace window:
 * an expired-but-in-grace license is allowed to boot (read-only mode is then
 * enforced at runtime by middleware/licenseGuard.js).
 *
 * Bypass for development only: LICENSE_GATE_DISABLE=true (ignored in production).
 *
 * Exit codes: 0 = OK / grace, 1 = invalid/expired/missing.
 */
const fs = require("fs");
const path = require("path");
const { decodeLicense } = require("../services/licenseCodec");
const ls = require("../services/licenseSecurity");

function fail(msg) {
  console.error(`[license-gate] BLOCKED: ${msg}`);
  process.exit(1);
}
function ok(msg) {
  console.log(`[license-gate] OK: ${msg}`);
  process.exit(0);
}

if (String(process.env.LICENSE_GATE_DISABLE || "false").toLowerCase() === "true") {
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    fail("LICENSE_GATE_DISABLE is not permitted in production.");
  }
  ok("gate disabled (LICENSE_GATE_DISABLE=true) — development only.");
}

const licenseFilePath = process.env.LICENSE_FILE_PATH;
const secretKey = process.env.LICENSE_SECRET_KEY;

if (!secretKey) fail("LICENSE_SECRET_KEY not set.");
if (!licenseFilePath) fail("LICENSE_FILE_PATH not set.");
if (!fs.existsSync(path.resolve(licenseFilePath))) fail(`license file not found at ${licenseFilePath}.`);

const raw = fs.readFileSync(path.resolve(licenseFilePath), "utf8").trim();
if (!raw) fail("license file is empty.");

// 1) Unwrap + verify RSA signature (signed v2 requires public key + valid sig).
let sig;
try {
  sig = ls.assertSignedLicenseOrThrow(raw);
} catch (e) {
  fail(e.message);
}

// 2) Decrypt inner payload.
let payload;
try {
  payload = decodeLicense(sig.inner, secretKey);
} catch (e) {
  fail(`license decryption failed: ${e.message}`);
}

// 3) Static signature.
if (payload.signature !== "$Panja") fail("invalid embedded signature.");

// 4) Hardware binding.
const hw = ls.verifyHardwareBinding(payload);
if (!hw.ok) fail(hw.reason || "hardware binding failed.");

// 5) Not-yet-valid.
if (payload.startDate && new Date() < new Date(payload.startDate)) {
  fail(`license not valid until ${payload.startDate}.`);
}

// 6) Expiry / grace.
const verdict = ls.evaluateExpiry(payload.endDate);
if (verdict.state === "expired") fail(`license expired ${verdict.daysOverdue} day(s) ago (grace exhausted).`);
if (verdict.state === "grace") {
  ok(`license expired but within grace (${verdict.graceRemaining} day(s) left) — booting in read-only mode.`);
}

ok(`license valid (${verdict.daysUntilExpiry} day(s) remaining).`);
