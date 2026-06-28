#!/usr/bin/env node
/**
 * VENDOR OFFLINE TOOL — issue an RSA-signed (v2) license.
 *
 * Produces a v2 bundle:  base64( { v:2, license:<aes>, signature:<rsa-b64> } )
 * which the backend verifies with the public key (cannot be forged without the
 * offline private key). The inner <aes> is the same AES-256-GCM format the
 * backend already understands, so v2 licenses remain self-contained.
 *
 * Two modes:
 *   1) Issue from a payload JSON:
 *        LICENSE_SECRET_KEY=... node tools/sign-license.js \
 *          --payload payload.json --private license-keys/license-private.pem --out license.lic
 *   2) Wrap an existing legacy AES license string (sign in place):
 *        node tools/sign-license.js \
 *          --wrap existing-license.txt --private license-keys/license-private.pem --out license.lic
 *
 * payload.json example:
 *   {
 *     "signature": "$Panja",
 *     "macAddress": "8C:84:74:6B:08:7E",
 *     "fingerprint": "<optional sha256 from license-fingerprint tool>",
 *     "startDate": "2026-01-01",
 *     "endDate": "2027-01-01",
 *     "customer": "Acme Bank",
 *     "seats": 500
 *   }
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { encodeLicense } = require("../services/licenseCodec");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

const privatePath = arg("--private");
const outPath = arg("--out") || "license.lic";
const payloadPath = arg("--payload");
const wrapPath = arg("--wrap");

if (!privatePath || !fs.existsSync(privatePath)) {
  console.error("ERROR: --private <license-private.pem> is required and must exist.");
  process.exit(1);
}
const privateKeyPem = fs.readFileSync(privatePath, "utf8");

let innerLicense;
if (wrapPath) {
  innerLicense = fs.readFileSync(wrapPath, "utf8").trim();
} else if (payloadPath) {
  const secretKey = process.env.LICENSE_SECRET_KEY;
  if (!secretKey) {
    console.error("ERROR: LICENSE_SECRET_KEY env is required to issue from --payload.");
    process.exit(1);
  }
  const payload = JSON.parse(fs.readFileSync(payloadPath, "utf8"));
  if (!payload.signature) payload.signature = "$Panja";
  innerLicense = encodeLicense(payload, secretKey);
} else {
  console.error("ERROR: provide either --payload <file> or --wrap <file>.");
  process.exit(1);
}

const signer = crypto.createSign("RSA-SHA256");
signer.update(innerLicense);
signer.end();
const signature = signer.sign(privateKeyPem).toString("base64");

const bundle = { v: 2, license: innerLicense, signature };
const encoded = Buffer.from(JSON.stringify(bundle)).toString("base64");

fs.writeFileSync(path.resolve(outPath), encoded, "utf8");
console.log("Signed v2 license written to:", path.resolve(outPath));
console.log("Deploy it as the backend LICENSE_FILE_PATH and set LICENSE_PUBLIC_KEY_PATH on the server.");
