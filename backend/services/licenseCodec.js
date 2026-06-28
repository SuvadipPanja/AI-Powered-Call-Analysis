/**
 * Shared AES-256-GCM license codec (pure, no logging/DB deps).
 *
 * This is the exact algorithm the backend has always used; extracted so that
 * server.js, the offline signing tool, and the Docker entrypoint gate decode
 * licenses identically.
 */
const crypto = require("crypto");

/**
 * Decode a legacy (inner) AES-256-GCM license string into its payload object.
 * @param {string} licenseKey base64( JSON { appId, nonce, aad, ciphertext } )
 * @param {string} secretKey  LICENSE_SECRET_KEY
 * @returns {object} decrypted payload
 */
function decodeLicense(licenseKey, secretKey) {
  const licenseStr = Buffer.from(licenseKey, "base64").toString();
  const license = JSON.parse(licenseStr);
  const { appId, nonce, aad, ciphertext } = license;

  const keyMaterial = crypto.pbkdf2Sync(secretKey, appId, 100000, 32, "sha256");
  const decodedNonce = Buffer.from(nonce, "base64");
  const decodedCiphertextWithTag = Buffer.from(ciphertext, "base64");

  const authTagLength = 16;
  if (decodedCiphertextWithTag.length < authTagLength) {
    throw new Error("Ciphertext is too short to contain an auth tag");
  }
  const ciphertextLength = decodedCiphertextWithTag.length - authTagLength;
  const actualCiphertext = decodedCiphertextWithTag.slice(0, ciphertextLength);
  const authTag = decodedCiphertextWithTag.slice(ciphertextLength);

  const decodedAad = Buffer.from(aad, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", keyMaterial, decodedNonce);
  decipher.setAuthTag(authTag);
  decipher.setAAD(decodedAad);

  let decrypted = decipher.update(actualCiphertext);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return JSON.parse(decrypted.toString());
}

/**
 * Encode a payload object into a legacy AES-256-GCM license string.
 * Mirrors decodeLicense. Used by the offline signing/issuing tool.
 * @param {object} payload
 * @param {string} secretKey
 * @param {string} [appId]
 * @returns {string} base64 license string
 */
function encodeLicense(payload, secretKey, appId = "AI-Call-Analysis") {
  const keyMaterial = crypto.pbkdf2Sync(secretKey, appId, 100000, 32, "sha256");
  const nonce = crypto.randomBytes(12);
  const aad = crypto.randomBytes(16);

  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial, nonce);
  cipher.setAAD(aad);
  let encrypted = cipher.update(JSON.stringify(payload));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertextWithTag = Buffer.concat([encrypted, authTag]);

  const license = {
    appId,
    nonce: nonce.toString("base64"),
    aad: aad.toString("hex"),
    ciphertext: ciphertextWithTag.toString("base64"),
  };
  return Buffer.from(JSON.stringify(license)).toString("base64");
}

module.exports = { decodeLicense, encodeLicense };
