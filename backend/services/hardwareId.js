/**
 * Sprint 5 — Runtime server/VM hardware identity (no hardcoding).
 *
 * Computes a stable fingerprint from HOST-LEVEL identifiers that are visible
 * inside a container WITHOUT host networking:
 *   - /etc/machine-id            (host machine id; mount read-only)
 *   - /sys/class/dmi/id/product_uuid   (DMI/SMBIOS UUID — unique per server/VM)
 *   - /sys/class/dmi/id/board_serial   (motherboard serial, when present)
 *   - first disk serial          (/sys/block/<dev>/device/serial or wwid)
 *   - MAC addresses              (best-effort; container MACs differ from host,
 *                                 so MACs are a WEAK signal and optional)
 *
 * IMPORTANT (Docker): the container's eth0 MAC is NOT the host NIC MAC. That is
 * why the primary identity is DMI product_uuid + machine-id, which are stable
 * host identifiers. Mount them read-only (see docs/license-worldclass-roadmap.md):
 *   volumes:
 *     - /etc/machine-id:/etc/machine-id:ro
 *   (product_uuid is exposed via /sys by default on most hosts)
 */
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");

function readFirstLine(filePath) {
  try {
    const v = fs.readFileSync(filePath, "utf8").trim();
    return v || null;
  } catch {
    return null;
  }
}

function getMachineId() {
  return (
    (process.env.HOST_MACHINE_ID_PATH && readFirstLine(process.env.HOST_MACHINE_ID_PATH)) ||
    readFirstLine("/etc/machine-id") ||
    readFirstLine("/var/lib/dbus/machine-id") ||
    null
  );
}

function getProductUuid() {
  // Requires CAP or root to read on some kernels; degrade gracefully.
  // In containers, the host file is typically bind-mounted at /host/dmi/product_uuid
  // (see docker-compose.yml) since /sys cannot always be overlaid directly.
  return (
    (process.env.HOST_PRODUCT_UUID_PATH && readFirstLine(process.env.HOST_PRODUCT_UUID_PATH)) ||
    readFirstLine("/host/dmi/product_uuid") ||
    readFirstLine("/sys/class/dmi/id/product_uuid") ||
    readFirstLine("/sys/devices/virtual/dmi/id/product_uuid") ||
    null
  );
}

function getBoardSerial() {
  return (
    readFirstLine("/sys/class/dmi/id/board_serial") ||
    readFirstLine("/sys/class/dmi/id/product_serial") ||
    null
  );
}

function getFirstDiskSerial() {
  try {
    const blockDir = "/sys/block";
    if (!fs.existsSync(blockDir)) return null;
    const devices = fs
      .readdirSync(blockDir)
      .filter((d) => !d.startsWith("loop") && !d.startsWith("ram") && !d.startsWith("dm-"))
      .sort();
    for (const dev of devices) {
      const candidates = [
        `${blockDir}/${dev}/device/serial`,
        `${blockDir}/${dev}/device/wwid`,
        `${blockDir}/${dev}/serial`,
      ];
      for (const c of candidates) {
        const v = readFirstLine(c);
        if (v) return v;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getMacAddresses() {
  const macs = [];
  const interfaces = os.networkInterfaces();
  for (const iface of Object.values(interfaces)) {
    for (const details of iface || []) {
      if (!details.internal && details.mac && details.mac !== "00:00:00:00:00:00") {
        macs.push(details.mac.toUpperCase());
      }
    }
  }
  return [...new Set(macs)].sort();
}

/**
 * Collect raw identity components (for diagnostics / minting).
 */
function collectIdentity() {
  return {
    machineId: getMachineId(),
    productUuid: getProductUuid(),
    boardSerial: getBoardSerial(),
    diskSerial: getFirstDiskSerial(),
    macAddresses: getMacAddresses(),
    hostname: os.hostname(),
  };
}

/**
 * Deterministic server fingerprint (sha256 hex).
 *
 * Built from STRONG host identifiers only (machine-id + product_uuid +
 * board/disk serial). MACs are intentionally excluded from the strong
 * fingerprint because container MACs are unstable; they are still reported by
 * collectIdentity() and can be bound separately via allowedMacs if desired.
 *
 * At least one strong component must be present; otherwise returns null so the
 * caller can fail closed rather than bind to an empty fingerprint.
 */
function getServerFingerprint() {
  const id = collectIdentity();
  const strong = [id.machineId, id.productUuid, id.boardSerial, id.diskSerial].filter(Boolean);
  if (strong.length === 0) return null;
  const material = [
    `machine-id:${id.machineId || ""}`,
    `product-uuid:${id.productUuid || ""}`,
    `board-serial:${id.boardSerial || ""}`,
    `disk-serial:${id.diskSerial || ""}`,
  ].join("|");
  return crypto.createHash("sha256").update(material).digest("hex");
}

/**
 * How many strong identity components were available — useful to warn when a
 * fingerprint is weaker than ideal (e.g. only machine-id present).
 */
function fingerprintStrength() {
  const id = collectIdentity();
  return [id.machineId, id.productUuid, id.boardSerial, id.diskSerial].filter(Boolean).length;
}

module.exports = {
  collectIdentity,
  getServerFingerprint,
  fingerprintStrength,
  getMachineId,
  getProductUuid,
  getBoardSerial,
  getFirstDiskSerial,
  getMacAddresses,
};
