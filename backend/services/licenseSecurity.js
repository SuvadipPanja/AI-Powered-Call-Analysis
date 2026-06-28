/**
 * Sprint 4 — License tamper resistance helpers (no external deps; Node crypto only).
 *
 * Backward compatible: everything here is OPT-IN. The legacy AES-256-GCM license
 * keeps working unchanged. New capabilities activate only when the relevant env
 * vars / files are present:
 *   - LICENSE_PUBLIC_KEY_PATH / LICENSE_PUBLIC_KEY  → RSA signature verification
 *   - LICENSE_ENFORCE_SIGNATURE=true               → reject unsigned licenses
 *   - LICENSE_GRACE_DAYS=N                          → read-only window after expiry
 *   - LICENSE_INTEGRITY_CHECK=true + manifest file  → startup integrity check
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

/* ----------------------------- RSA signatures ----------------------------- */

function loadPublicKeyPem() {
  const inline = process.env.LICENSE_PUBLIC_KEY;
  if (inline && inline.trim()) {
    return inline.includes("BEGIN")
      ? inline.replace(/\\n/g, "\n")
      : Buffer.from(inline, "base64").toString("utf8");
  }
  const keyPath = process.env.LICENSE_PUBLIC_KEY_PATH;
  if (keyPath && fs.existsSync(keyPath)) {
    return fs.readFileSync(keyPath, "utf8");
  }
  return null;
}

function hasPublicKey() {
  return Boolean(loadPublicKeyPem());
}

function signatureEnforced() {
  return String(process.env.LICENSE_ENFORCE_SIGNATURE || "false").toLowerCase() === "true";
}

/**
 * Verify an RSA-SHA256 signature over `payloadString`.
 * @returns {boolean}
 */
function verifyRsaSignature(payloadString, signatureB64, publicKeyPem) {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(payloadString);
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Detect and unwrap a v2 signed license bundle:
 *   base64( JSON { v:2, license:<legacy-aes-string>, signature:<rsa-b64> } )
 *
 * @returns {{ inner: string, signed: boolean, signatureValid: boolean, enforced: boolean }}
 */
function unwrapSignedLicense(rawLicenseKey) {
  const result = {
    inner: rawLicenseKey,
    signed: false,
    signatureValid: false,
    enforced: signatureEnforced(),
  };

  let bundle = null;
  try {
    const decoded = Buffer.from(rawLicenseKey, "base64").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (parsed && parsed.v === 2 && typeof parsed.license === "string") {
      bundle = parsed;
    }
  } catch {
    // Not a v2 bundle — legacy license; return as-is.
  }

  if (!bundle) return result;

  result.signed = true;
  result.inner = bundle.license;

  const publicKeyPem = loadPublicKeyPem();
  if (publicKeyPem && bundle.signature) {
    result.signatureValid = verifyRsaSignature(bundle.license, bundle.signature, publicKeyPem);
  }
  return result;
}

/* -------------------------- Hardware fingerprint -------------------------- */

/** Stable machine-id from the OS (Linux/macOS); null if unavailable. */
function readMachineId() {
  const candidates = [
    "/etc/machine-id",
    "/var/lib/dbus/machine-id",
  ];
  for (const file of candidates) {
    try {
      const id = fs.readFileSync(file, "utf8").trim();
      if (id) return id;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** All non-internal MAC addresses (uppercase), HOST_MAC override honoured. */
function collectMacAddresses() {
  const hostMac = process.env.HOST_MAC;
  if (hostMac && hostMac.trim()) return [hostMac.trim().toUpperCase()];

  const macs = [];
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const details of iface || []) {
      if (!details.internal && details.mac && details.mac !== "00:00:00:00:00:00") {
        macs.push(details.mac.toUpperCase());
      }
    }
  }
  return macs;
}

/**
 * Composite hardware fingerprint (sha256 hex). Combines MACs + machine-id.
 * Deterministic and order-independent for MACs.
 */
function getHardwareFingerprint() {
  const macs = collectMacAddresses().sort();
  const machineId = readMachineId() || "";
  const material = `${macs.join(",")}|${machineId}`;
  return crypto.createHash("sha256").update(material).digest("hex");
}

/**
 * Validate a license's hardware binding. Accepts legacy MAC binding OR the new
 * fingerprint binding, whichever the license carries.
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyHardwareBinding(payload) {
  // New-style: payload.fingerprint
  if (payload.fingerprint) {
    const current = getHardwareFingerprint();
    if (payload.fingerprint === current) return { ok: true };
    // Fall through to MAC check if license ALSO carries a MAC (dual-binding).
    if (!payload.macAddress) {
      return { ok: false, reason: "Hardware fingerprint mismatch." };
    }
  }

  // Legacy MAC binding (unchanged behaviour).
  if (payload.macAddress) {
    const macs = collectMacAddresses();
    if (macs.includes(String(payload.macAddress).toUpperCase())) return { ok: true };
    return { ok: false, reason: "MAC address mismatch." };
  }

  return { ok: false, reason: "License has no hardware binding." };
}

/* ---------------------------- Expiry / grace ----------------------------- */

function graceDays() {
  const n = parseInt(process.env.LICENSE_GRACE_DAYS || "0", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Classify license validity for a given end date.
 * @returns {{ state: 'active'|'grace'|'expired', daysUntilExpiry: number, daysOverdue: number, graceRemaining: number }}
 */
function evaluateExpiry(endDate, now = new Date()) {
  const end = new Date(endDate);
  const msPerDay = 24 * 60 * 60 * 1000;
  const daysUntilExpiry = Math.ceil((end - now) / msPerDay);

  if (now <= end) {
    return { state: "active", daysUntilExpiry, daysOverdue: 0, graceRemaining: 0 };
  }

  const daysOverdue = Math.ceil((now - end) / msPerDay);
  const grace = graceDays();
  if (grace > 0 && daysOverdue <= grace) {
    return {
      state: "grace",
      daysUntilExpiry,
      daysOverdue,
      graceRemaining: grace - daysOverdue,
    };
  }
  return { state: "expired", daysUntilExpiry, daysOverdue, graceRemaining: 0 };
}

/* --------------------------- Integrity manifest -------------------------- */

function sha256File(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/**
 * Build a { relativePath: sha256 } manifest for the given files.
 * @param {string} rootDir
 * @param {string[]} relPaths
 */
function buildIntegrityManifest(rootDir, relPaths) {
  const manifest = {};
  for (const rel of relPaths) {
    const abs = path.join(rootDir, rel);
    if (fs.existsSync(abs)) manifest[rel] = sha256File(abs);
  }
  return manifest;
}

/**
 * Validate RSA v2 wrapper when present. Fail closed: signed licenses require a
 * configured public key and a valid signature.
 * @returns {{ inner: string, signed: boolean, signatureValid: boolean, enforced: boolean }}
 */
function assertSignedLicenseOrThrow(licenseKey) {
  const sig = unwrapSignedLicense(licenseKey);
  if (sig.signed) {
    if (!hasPublicKey()) {
      throw new Error("Signed license requires LICENSE_PUBLIC_KEY_PATH or LICENSE_PUBLIC_KEY");
    }
    if (!sig.signatureValid) {
      throw new Error("RSA signature verification failed");
    }
  } else if (signatureEnforced()) {
    throw new Error("Unsigned license rejected (LICENSE_ENFORCE_SIGNATURE=true)");
  }
  return sig;
}

/**
 * Verify current files against a manifest file.
 * @param {boolean} [options.requireManifest=false] when true, missing/empty manifest fails
 * @returns {{ ok: boolean, mismatches: string[], missing: string[] }}
 */
function verifyIntegrity(rootDir, manifestPath, { requireManifest = false } = {}) {
  const result = { ok: true, mismatches: [], missing: [] };
  if (!manifestPath || !fs.existsSync(manifestPath)) {
    if (requireManifest) {
      return { ok: false, mismatches: [], missing: ["<manifest missing>"] };
    }
    return result;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    return { ok: false, mismatches: ["<manifest unreadable>"], missing: [] };
  }
  if (requireManifest && (!manifest || Object.keys(manifest).length === 0)) {
    return { ok: false, mismatches: ["<manifest empty>"], missing: [] };
  }
  for (const [rel, expected] of Object.entries(manifest)) {
    const abs = path.join(rootDir, rel);
    if (!fs.existsSync(abs)) {
      result.missing.push(rel);
      result.ok = false;
      continue;
    }
    if (sha256File(abs) !== expected) {
      result.mismatches.push(rel);
      result.ok = false;
    }
  }
  return result;
}

module.exports = {
  // RSA
  loadPublicKeyPem,
  hasPublicKey,
  signatureEnforced,
  verifyRsaSignature,
  unwrapSignedLicense,
  assertSignedLicenseOrThrow,
  // Fingerprint
  collectMacAddresses,
  getHardwareFingerprint,
  verifyHardwareBinding,
  readMachineId,
  // Expiry
  graceDays,
  evaluateExpiry,
  // Integrity
  sha256File,
  buildIntegrityManifest,
  verifyIntegrity,
};
