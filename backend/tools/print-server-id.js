#!/usr/bin/env node
/**
 * CUSTOMER TOOL — run INSIDE the backend container on the target server:
 *   docker exec ai_call_backend node tools/print-server-id.js
 *
 * Prints the server's hardware fingerprint + identity components. Send the
 * `serverFingerprint` value to the vendor so a license can be minted for this
 * exact server. The license will only validate here.
 *
 * For an accurate host-level fingerprint, the container must see host identity:
 *   volumes:
 *     - /etc/machine-id:/etc/machine-id:ro
 *   (DMI product_uuid is exposed via /sys on most hosts by default)
 */
const hardwareId = require("../services/hardwareId");

const identity = hardwareId.collectIdentity();
const fingerprint = hardwareId.getServerFingerprint();
const strength = hardwareId.fingerprintStrength();

const out = {
  serverFingerprint: fingerprint,
  fingerprintStrength: `${strength}/4 strong identifiers`,
  identity: {
    machineId: identity.machineId ? "present" : "MISSING (mount /etc/machine-id:ro)",
    productUuid: identity.productUuid ? "present" : "missing",
    boardSerial: identity.boardSerial ? "present" : "missing",
    diskSerial: identity.diskSerial ? "present" : "missing",
    macAddresses: identity.macAddresses,
    hostname: identity.hostname,
  },
};

console.log(JSON.stringify(out, null, 2));

if (!fingerprint) {
  console.error("\nWARNING: no strong host identifiers found. Mount /etc/machine-id:ro and ensure /sys DMI is readable.");
  process.exit(2);
}
if (strength < 2) {
  console.error("\nNOTE: only one strong identifier present — fingerprint is weaker than recommended.");
}
