#!/usr/bin/env node
/**
 * VENDOR OFFLINE TOOL — run on the vendor's secure, offline machine ONLY.
 *
 * Generates an RSA-2048 key pair for license signing:
 *   - license-private.pem  → KEEP OFFLINE. Never ship to customers / git.
 *   - license-public.pem    → ship with the backend (LICENSE_PUBLIC_KEY_PATH).
 *
 * Usage:
 *   node tools/generate-license-keypair.js [outputDir]
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), "license-keys"));
fs.mkdirSync(outDir, { recursive: true });

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const privPath = path.join(outDir, "license-private.pem");
const pubPath = path.join(outDir, "license-public.pem");

fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
fs.writeFileSync(pubPath, publicKey, { mode: 0o644 });

console.log("RSA-2048 license key pair generated:");
console.log("  PRIVATE (keep offline!):", privPath);
console.log("  PUBLIC  (ship to backend):", pubPath);
console.log("");
console.log("Next steps:");
console.log("  1. Store license-private.pem in your offline vault. NEVER commit it.");
console.log("  2. Deploy license-public.pem with the backend and set:");
console.log("       LICENSE_PUBLIC_KEY_PATH=/app/secrets/license-public.pem");
console.log("  3. Issue signed licenses with: node tools/sign-license.js");
