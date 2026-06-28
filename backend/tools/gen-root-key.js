#!/usr/bin/env node
/**
 * VENDOR OFFLINE TOOL — run on your dev laptop ONLY.
 *
 * Generates the Ed25519 vendor root key pair for v3 license signing:
 *   - vendor-root-private.pem  → PASSPHRASE-ENCRYPTED. Keep on your laptop only.
 *                                Never commit, never ship, never put in an image.
 *   - vendor-root-public.pem   → ship/bake into backend + ai-mvp images
 *                                (LICENSE_PUBLIC_KEY_PATH). Safe to expose.
 *
 * The private key is encrypted at rest with AES-256-CBC + your passphrase. For
 * maximum safety, store vendor-root-private.pem in your OS keychain / a hardware
 * token and delete the file from disk after import.
 *
 * Usage:
 *   node tools/gen-root-key.js [outputDir]
 *   (you will be prompted for a passphrase; or set LICENSE_KEY_PASSPHRASE)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

function promptHidden(question) {
  if (process.env.LICENSE_KEY_PASSPHRASE) return Promise.resolve(process.env.LICENSE_KEY_PASSPHRASE);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const stdout = process.stdout;
    rl.question(question, (answer) => {
      rl.close();
      stdout.write("\n");
      resolve(answer);
    });
    // Mask input.
    rl._writeToOutput = () => rl.output.write("*");
  });
}

(async () => {
  const outDir = path.resolve(process.argv[2] || path.join(process.cwd(), "vendor-keys"));
  fs.mkdirSync(outDir, { recursive: true });

  const passphrase = (await promptHidden("Set a passphrase for the private key: ")).trim();
  if (passphrase.length < 12) {
    console.error("ERROR: passphrase must be at least 12 characters.");
    process.exit(1);
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
      cipher: "aes-256-cbc",
      passphrase,
    },
  });

  const privPath = path.join(outDir, "vendor-root-private.pem");
  const pubPath = path.join(outDir, "vendor-root-public.pem");
  fs.writeFileSync(privPath, privateKey, { mode: 0o600 });
  fs.writeFileSync(pubPath, publicKey, { mode: 0o644 });

  console.log("Ed25519 vendor root key pair generated:");
  console.log("  PRIVATE (encrypted, keep offline!):", privPath);
  console.log("  PUBLIC  (ship to images):", pubPath);
  console.log("");
  console.log("Next:");
  console.log("  1. Import the private key into your OS keychain, then delete the file if possible.");
  console.log("  2. Bake vendor-root-public.pem into the images; set LICENSE_PUBLIC_KEY_PATH.");
  console.log("  3. Issue licenses with: node tools/sign-license-v3.js");
})();
