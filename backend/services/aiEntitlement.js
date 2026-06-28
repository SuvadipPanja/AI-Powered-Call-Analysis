/**
 * Sprint 9 — AI-MVP entitlement enforcement.
 *
 * The license controls whether the AI pipeline may run and which modules are
 * permitted. Reads runtime globals set during license validation:
 *   global.licenseState   "active" | "grace" | "expired"
 *   global.licensePayload  { ai: { enabledModules: [...], maxConcurrentJobs } , ... }
 *
 * Backward compatible: a v2 license (no `ai` block) is treated as unrestricted
 * as long as the license is active. v3 licenses with an `ai.enabledModules`
 * list are enforced module-by-module.
 *
 * AI processing is compute/mutation, so it is allowed ONLY when the license is
 * fully "active" (not in read-only "grace" and not "expired").
 */

// Canonical AI module identifiers, aligned with the AI-MVP pipeline stages
// (see AI/src/Backend main/main_backen_AI.py). Use these names when issuing
// licenses (--ai-modules) and when the AI-MVP self-checks per stage.
const CANONICAL_AI_MODULES = [
  "chunking",            // Step 1: Audio Chunking
  "language-detection",  // Step 2: Language Detection
  "diarization",         // Step 3: Diarization
  "transcription",       // Step 4: Transcription
  "translation",         // Step 5: Translation
  "tone-analysis",       // Step 6: Tone Analysis
  "scoring",             // Step 7: LLaMA Call Scoring
  "sentiment",           // Step 8: Sentiment Analysis
  "sentence-similarity", // Step 9: Sentence Similarity
];

function licenseActive() {
  return (global.licenseState || (global.isLicenseExpired ? "expired" : "active")) === "active";
}

function aiConfig() {
  return (global.licensePayload && global.licensePayload.ai) || {};
}

/** Enabled AI modules from the license (empty list = unrestricted / v2). */
function enabledModules() {
  const mods = aiConfig().enabledModules;
  return Array.isArray(mods) ? mods : [];
}

function maxConcurrentJobs() {
  const n = parseInt(aiConfig().maxConcurrentJobs, 10);
  return Number.isFinite(n) && n > 0 ? n : 0; // 0 = unlimited
}

/**
 * Is a specific AI module licensed right now?
 * @param {string} mod
 */
function isModuleEnabled(mod) {
  if (!global.licensePayload) return false;
  if (!licenseActive()) return false;
  const mods = enabledModules();
  if (mods.length === 0) return true; // v2 / unrestricted
  return mods.includes(mod);
}

/**
 * Gate the AI pipeline. Pass the modules a job needs; empty means "any AI".
 * @param {string[]} [requiredModules]
 * @returns {{ ok: boolean, reason?: string }}
 */
function checkAiEntitlement(requiredModules = []) {
  if (!global.licensePayload) {
    return { ok: false, reason: "No valid license — AI processing disabled." };
  }
  if (!licenseActive()) {
    return { ok: false, reason: `License ${global.licenseState || "expired"} — AI processing disabled.` };
  }
  const mods = enabledModules();
  if (mods.length === 0) return { ok: true }; // unrestricted
  const missing = requiredModules.filter((m) => !mods.includes(m));
  if (missing.length) {
    return { ok: false, reason: `AI modules not licensed: ${missing.join(", ")}` };
  }
  return { ok: true };
}

/** Snapshot for diagnostics / the internal entitlement endpoint. */
function entitlementSnapshot() {
  const mods = enabledModules();
  return {
    licenseState: global.licenseState || (global.isLicenseExpired ? "expired" : "active"),
    aiAllowed: licenseActive(),
    enabledModules: mods,
    // When the license carries no module list, all canonical modules are allowed.
    effectiveModules: mods.length === 0 ? CANONICAL_AI_MODULES : mods,
    canonicalModules: CANONICAL_AI_MODULES,
    maxConcurrentJobs: maxConcurrentJobs(),
    customer: global.licensePayload?.customer || null,
  };
}

module.exports = {
  CANONICAL_AI_MODULES,
  licenseActive,
  enabledModules,
  maxConcurrentJobs,
  isModuleEnabled,
  checkAiEntitlement,
  entitlementSnapshot,
};
