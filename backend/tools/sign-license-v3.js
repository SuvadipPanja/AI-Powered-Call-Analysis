#!/usr/bin/env node
/**
 * VENDOR OFFLINE TOOL — issue an Ed25519-signed v3 license. LAPTOP ONLY.
 *
 * The v3 token is bound to ONE server via its hardware fingerprint (obtained by
 * running tools/print-server-id.js on the customer server). It cannot be
 * re-used on other hardware, and it cannot be forged without your private key.
 *
 * Usage:
 *   node tools/sign-license-v3.js \
 *     --private vendor-keys/vendor-root-private.pem \
 *     --fingerprint <serverFingerprint-from-customer> \
 *     --customer "Acme Bank" \
 *     --users 500 --agents 600 \
 *     --not-before 2026-07-01 --not-after 2027-07-01 \
 *     --features reports,audit,reva,ai-scoring \
 *     --ai-modules chunking,language-detection,diarization,transcription,translation,tone-analysis,scoring,sentiment,sentence-similarity \
 *     --ai-jobs 8 \
 *     [--allowed-macs 8C:84:74:6B:08:7E] \
 *     [--revoke <licenseId>,...] \
 *     --out license.lic
 *
 *   Canonical AI module names (must match the pipeline; see
 *   backend/services/aiEntitlement.js CANONICAL_AI_MODULES):
 *     chunking, language-detection, diarization, transcription, translation,
 *     tone-analysis, scoring, sentiment, sentence-similarity
 *   Omit --ai-modules entirely to license ALL AI modules (unrestricted).
 *
 *   Temporary 7-day trial (expiry computed from today):
 *     node tools/sign-license-v3.js --private vendor-keys/vendor-root-private.pem \
 *       --fingerprint <fp> --customer "Acme (TRIAL)" --days 7 --users 50 \
 *       --features reports,audit,reva,ai-scoring \
 *       --ai-modules transcription,diarization,scoring --out trial-7day.lic
 *   (passphrase via prompt or LICENSE_KEY_PASSPHRASE)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { randomUUID } = require("crypto");
const { signV3 } = require("../services/licenseV3");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : def;
}
function list(name) {
  const v = arg(name);
  return v ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}

function promptHidden(question) {
  if (process.env.LICENSE_KEY_PASSPHRASE) return Promise.resolve(process.env.LICENSE_KEY_PASSPHRASE);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (a) => { rl.close(); process.stdout.write("\n"); resolve(a); });
    rl._writeToOutput = () => rl.output.write("*");
  });
}

(async () => {
  const privatePath = arg("--private");
  const fingerprint = arg("--fingerprint");
  const outPath = arg("--out", "license.lic");

  if (!privatePath || !fs.existsSync(privatePath)) {
    console.error("ERROR: --private <vendor-root-private.pem> is required and must exist.");
    process.exit(1);
  }
  const allowedMacs = list("--allowed-macs").map((m) => m.toUpperCase());
  if (!fingerprint && allowedMacs.length === 0) {
    console.error("ERROR: provide --fingerprint (preferred) and/or --allowed-macs.");
    process.exit(1);
  }

  const passphrase = (await promptHidden("Private key passphrase: ")).trim();
  let privateKey;
  try {
    privateKey = crypto.createPrivateKey({ key: fs.readFileSync(privatePath, "utf8"), passphrase });
  } catch (e) {
    console.error("ERROR: could not load private key (wrong passphrase?):", e.message);
    process.exit(1);
  }

  const notBefore = arg("--not-before");
  let notAfter = arg("--not-after");
  // Convenience: --days N sets the expiry N days from now (e.g. --days 7 for a
  // temporary trial license). Ignored if --not-after is given explicitly.
  const days = arg("--days");
  if (!notAfter && days) {
    const d = new Date();
    d.setDate(d.getDate() + parseInt(days, 10));
    notAfter = d.toISOString();
  }
  if (!notAfter) {
    console.error("ERROR: provide --not-after <YYYY-MM-DD> or --days <N>.");
    process.exit(1);
  }

  const payload = {
    v: 3,
    licenseId: arg("--license-id", randomUUID()),
    customer: arg("--customer", "Unknown"),
    issuedAt: new Date().toISOString(),
    notBefore: notBefore ? new Date(notBefore).toISOString() : new Date().toISOString(),
    notAfter: new Date(notAfter).toISOString(),
    hardware: {
      ...(fingerprint ? { serverFingerprint: fingerprint } : {}),
      ...(allowedMacs.length ? { allowedMacs } : {}),
    },
    limits: {
      maxConcurrentUsers: parseInt(arg("--users", "0"), 10) || 0,
      maxAgents: parseInt(arg("--agents", "0"), 10) || 0,
      features: list("--features"),
    },
    ai: {
      enabledModules: list("--ai-modules"),
      maxConcurrentJobs: parseInt(arg("--ai-jobs", "0"), 10) || 0,
    },
    revocation: { crl: list("--revoke") },
    issuerKeyId: arg("--key-id", "vendor"),
  };

  const token = signV3(payload, privateKey);
  fs.writeFileSync(path.resolve(outPath), token, "utf8");

  console.log("Signed v3 license written to:", path.resolve(outPath));
  console.log("  licenseId:", payload.licenseId);
  console.log("  customer :", payload.customer);
  console.log("  bound to :", fingerprint ? `fingerprint ${fingerprint.slice(0, 16)}…` : `MACs ${allowedMacs.join(",")}`);
  console.log("  users    :", payload.limits.maxConcurrentUsers, "| agents:", payload.limits.maxAgents);
  console.log("  valid    :", payload.notBefore, "→", payload.notAfter);
})();
