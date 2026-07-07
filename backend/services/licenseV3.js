/**
 * Sprint 5 — License token v3 (Ed25519-signed, asymmetric).
 *
 * A v3 license is:  base64url( JSON payload + { "signature": <ed25519-b64> } )
 * The signature is computed by the vendor's PRIVATE key over the CANONICAL JSON
 * of the payload WITHOUT the signature field. The server holds only the PUBLIC
 * key and can verify but NEVER forge. There is no symmetric secret in the
 * trust path.
 *
 * Verification is fully offline (air-gap friendly). No external deps — Node
 * crypto only.
 */
const crypto = require("crypto");
const fs = require("fs");

const { evaluateExpiry } = require("./licenseSecurity");
const hardwareId = require("./hardwareId");

/* ------------------------- canonical JSON (stable) ------------------------ */

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`)
    .join(",")}}`;
}

/* ------------------------------ key loading ------------------------------- */

/** Load the vendor PUBLIC key (PEM). Reused env contract from Sprint 4. */
function loadVendorPublicKey() {
  const inline = process.env.LICENSE_PUBLIC_KEY;
  if (inline && inline.trim()) {
    const pem = inline.includes("BEGIN") ? inline.replace(/\\n/g, "\n") : Buffer.from(inline, "base64").toString("utf8");
    return crypto.createPublicKey(pem);
  }
  const keyPath = process.env.LICENSE_PUBLIC_KEY_PATH;
  if (keyPath && fs.existsSync(keyPath)) {
    return crypto.createPublicKey(fs.readFileSync(keyPath, "utf8"));
  }
  return null;
}

function hasVendorPublicKey() {
  try {
    return Boolean(loadVendorPublicKey());
  } catch {
    return false;
  }
}

/* ------------------------------ encode/decode ----------------------------- */

function b64urlEncode(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecodeToString(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8");
}

/** True if the string looks like a v3 token (decodes to JSON with v:3). */
function isV3Token(raw) {
  try {
    const parsed = JSON.parse(b64urlDecodeToString(raw));
    return parsed && parsed.v === 3 && typeof parsed.signature === "string";
  } catch {
    return false;
  }
}

/* --------------------------------- sign ----------------------------------- */

/**
 * Sign a v3 payload with an Ed25519 private key. LAPTOP-ONLY (vendor tool).
 * @param {object} payload   without `signature`
 * @param {crypto.KeyObject|{key:string,passphrase:string}} privateKey
 * @returns {string} v3 token (base64url)
 */
function signV3(payload, privateKey) {
  const body = { ...payload, v: 3 };
  delete body.signature;
  const message = Buffer.from(canonicalize(body), "utf8");
  const signature = crypto.sign(null, message, privateKey).toString("base64");
  const token = { ...body, signature };
  return b64urlEncode(JSON.stringify(token));
}

/* -------------------------------- verify ---------------------------------- */

/**
 * Verify a v3 token's Ed25519 signature.
 * @returns {{ ok: boolean, payload: object|null, reason?: string }}
 */
function verifyV3(raw, publicKey = loadVendorPublicKey()) {
  if (!publicKey) return { ok: false, payload: null, reason: "No vendor public key configured" };
  let token;
  try {
    token = JSON.parse(b64urlDecodeToString(raw));
  } catch {
    return { ok: false, payload: null, reason: "Malformed v3 token" };
  }
  if (!token || token.v !== 3 || typeof token.signature !== "string") {
    return { ok: false, payload: null, reason: "Not a v3 token" };
  }
  const { signature, ...body } = token;
  const message = Buffer.from(canonicalize(body), "utf8");
  let valid = false;
  try {
    valid = crypto.verify(null, message, publicKey, Buffer.from(signature, "base64"));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, payload: null, reason: "Ed25519 signature invalid" };
  return { ok: true, payload: body };
}

/* ------------------------------- evaluate --------------------------------- */

/**
 * Full validation of a verified v3 payload against this server + clock.
 * Call AFTER verifyV3 succeeds.
 *
 * @returns {{
 *   state: 'active'|'grace'|'expired'|'invalid',
 *   reason?: string,
 *   limits?: object,
 *   ai?: object,
 *   daysUntilExpiry?: number,
 *   graceRemaining?: number
 * }}
 */
function evaluateV3(payload, { now = new Date(), serverFingerprint } = {}) {
  // 1) Time window — not yet valid.
  if (payload.notBefore && now < new Date(payload.notBefore)) {
    return { state: "invalid", reason: "License not yet valid" };
  }

  // 2) Hardware binding.
  const fp = serverFingerprint || hardwareId.getServerFingerprint();
  const bound = payload.hardware || {};
  if (bound.serverFingerprint) {
    if (!fp) return { state: "invalid", reason: "Server fingerprint unavailable" };
    if (fp !== bound.serverFingerprint) {
      // Allow MAC fallback only if explicitly listed (weak, optional).
      const macs = hardwareId.getMacAddresses();
      const macOk = Array.isArray(bound.allowedMacs) && bound.allowedMacs.some((m) => macs.includes(String(m).toUpperCase()));
      if (!macOk) return { state: "invalid", reason: "Hardware fingerprint mismatch" };
    }
  } else if (Array.isArray(bound.allowedMacs) && bound.allowedMacs.length) {
    const macs = hardwareId.getMacAddresses();
    if (!bound.allowedMacs.some((m) => macs.includes(String(m).toUpperCase()))) {
      return { state: "invalid", reason: "MAC address mismatch" };
    }
  } else {
    return { state: "invalid", reason: "License has no hardware binding" };
  }

  // 3) Revocation — in-token CRL + server-persisted merged CRL (Sprint 8).
  try {
    const licenseRevocation = require("./licenseRevocation");
    if (payload.licenseId && licenseRevocation.isRevoked(payload.licenseId)) {
      return { state: "invalid", reason: "License revoked" };
    }
  } catch {
    /* optional during tests */
  }
  if (Array.isArray(payload.revocation?.crl) && payload.licenseId && payload.revocation.crl.includes(payload.licenseId)) {
    return { state: "invalid", reason: "License revoked" };
  }

  // 4) Expiry / grace (reuses Sprint 4 grace window via LICENSE_GRACE_DAYS).
  if (!payload.notAfter) return { state: "invalid", reason: "License has no expiry" };
  const verdict = evaluateExpiry(payload.notAfter, now);

  return {
    state: verdict.state,
    limits: payload.limits || {},
    ai: payload.ai || {},
    daysUntilExpiry: verdict.daysUntilExpiry,
    graceRemaining: verdict.graceRemaining,
  };
}

module.exports = {
  canonicalize,
  loadVendorPublicKey,
  hasVendorPublicKey,
  isV3Token,
  signV3,
  verifyV3,
  evaluateV3,
  b64urlEncode,
};
