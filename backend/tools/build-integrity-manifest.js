#!/usr/bin/env node
/**
 * Build a startup integrity manifest (sha256 of critical backend files).
 *
 * Run during the image build (after source is copied). At runtime, the server
 * verifies these hashes when LICENSE_INTEGRITY_CHECK=true and reports tampering.
 *
 * Usage:  node tools/build-integrity-manifest.js [rootDir] [outFile]
 *   rootDir defaults to the backend app root (parent of /tools)
 *   outFile defaults to <rootDir>/integrity-manifest.json
 */
const fs = require("fs");
const path = require("path");
const ls = require("../services/licenseSecurity");

const rootDir = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const outFile = path.resolve(process.argv[3] || path.join(rootDir, "integrity-manifest.json"));

// Critical files whose tampering should be detected. Keep this list to security-
// sensitive modules so the manifest stays stable across benign content changes.
const CRITICAL = [
  "server.js",
  "services/licenseCodec.js",
  "services/licenseSecurity.js",
  "services/licenseAudit.js",
  "services/licenseV3.js",
  "services/hardwareId.js",
  "services/timeGuard.js",
  "services/aiEntitlement.js",
  "keys/vendor-root-public.pem",
  "middleware/auth.js",
  "middleware/rbac.js",
  "middleware/licenseGuard.js",
  "middleware/sessionProof.js",
  "tools/license-gate.js",
];

const manifest = ls.buildIntegrityManifest(rootDir, CRITICAL);
fs.writeFileSync(outFile, JSON.stringify(manifest, null, 2), "utf8");
console.log(`Integrity manifest written to ${outFile} (${Object.keys(manifest).length} files).`);
