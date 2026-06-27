require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// SECURITY: Secrets and host-specific values come from the environment, never
// hardcoded. Set LICENSE_SECRET_KEY and HOST_MAC in the backend .env.
const secretKey = process.env.LICENSE_SECRET_KEY;
const macAddress = process.env.HOST_MAC;
if (!secretKey) {
  console.error("ERROR: LICENSE_SECRET_KEY is not set. Define it in .env before generating a license.");
  process.exit(1);
}
if (!macAddress) {
  console.error("ERROR: HOST_MAC is not set. Define it in .env before generating a license.");
  process.exit(1);
}
const payload = {
  signature: "$Panja",
  startDate: "2025-01-01T00:00:00.000Z",
  endDate: "2031-03-17T00:00:00.000Z",
  users: 500,
  macAddress,
  appId: "ai-call-analysis-local-dev",
};

const payloadStr = JSON.stringify(payload);
const aad = crypto.createHash("sha512").update(payloadStr).digest("hex");
const keyMaterial = crypto.pbkdf2Sync(secretKey, payload.appId, 100000, 32, "sha256");
const nonce = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial, nonce);
cipher.setAAD(Buffer.from(aad, "hex"));
let ciphertext = cipher.update(payloadStr, "utf8");
ciphertext = Buffer.concat([ciphertext, cipher.final()]);
const authTag = cipher.getAuthTag();
const ciphertextWithTag = Buffer.concat([ciphertext, authTag]);
const license = {
  appId: payload.appId,
  nonce: Buffer.from(nonce).toString("base64"),
  aad,
  ciphertext: Buffer.from(ciphertextWithTag).toString("base64"),
};
const licenseKey = Buffer.from(JSON.stringify(license)).toString("base64");
const dir = path.join(__dirname, "license");
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "license.lic"), licenseKey);
console.log("License written for MAC", macAddress);
