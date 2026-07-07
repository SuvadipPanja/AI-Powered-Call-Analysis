/**
 * Sprint 9 — short-lived HMAC work tokens for AI-MVP dispatch.
 *
 * Backend issues a token when enqueueing/dispatching a job; AI-MVP verifies the
 * token binds to the audio filename and optional licensed module list.
 * Legacy X-Orchestrator-Secret remains supported when token enforcement is off.
 */
const crypto = require("crypto");

const DEFAULT_TTL_SEC = 900;

function base64url(input) {
  return Buffer.from(input, typeof input === "string" ? "utf8" : undefined).toString("base64url");
}

function signingSecret() {
  return (process.env.ORCHESTRATOR_SECRET || "").trim();
}

function tokenTtlSec() {
  const n = parseInt(process.env.AI_WORK_TOKEN_TTL_SEC || String(DEFAULT_TTL_SEC), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TTL_SEC;
}

function enforcementEnabled() {
  if (process.env.AI_WORK_TOKEN_ENFORCE === "false") return false;
  return Boolean(signingSecret());
}

function licenseRef() {
  const p = global.licensePayload;
  if (!p) return "";
  return String(p.licenseId || p.customer || p.issuerKeyId || "").slice(0, 64);
}

/**
 * @param {string} audioFile
 * @param {{ modules?: string[] }} [opts]
 * @returns {string|null}
 */
function issueWorkToken(audioFile, opts = {}) {
  const secret = signingSecret();
  if (!secret || !audioFile) return null;

  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: "ai-mvp",
    sub: audioFile,
    jti: crypto.randomBytes(12).toString("hex"),
    iat: now,
    exp: now + tokenTtlSec(),
    modules: Array.isArray(opts.modules) ? opts.modules : [],
    lic: licenseRef(),
  };

  const h = base64url(JSON.stringify(header));
  const p = base64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${sig}`;
}

function orchestratorAuthHeaders(audioFile, opts = {}) {
  const headers = {};
  const secret = signingSecret();
  if (secret) {
    headers["X-Orchestrator-Secret"] = secret;
  }
  const modules = Array.isArray(opts.modules) ? opts.modules : [];
  const token = issueWorkToken(audioFile, { modules, ...opts });
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function assertAiDispatchAllowed(audioFile) {
  const { checkAiEntitlement, pipelineModules } = require("./aiEntitlement");
  const { tryAcquireAiSlot } = require("./aiJobSlots");
  const modules = pipelineModules();
  const entitlement = checkAiEntitlement(modules);
  if (!entitlement.ok) {
    return { ok: false, reason: entitlement.reason };
  }
  const slot = await tryAcquireAiSlot();
  if (!slot.ok) {
    return { ok: false, reason: slot.reason };
  }
  return { ok: true, modules };
}

module.exports = {
  issueWorkToken,
  orchestratorAuthHeaders,
  assertAiDispatchAllowed,
  enforcementEnabled,
  tokenTtlSec,
};
