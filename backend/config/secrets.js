/**
 * Docker-secrets-aware secret hydration (Sprint 6 — secrets hygiene).
 *
 * Resolves sensitive values from FILES (Docker / Swarm secrets) rather than plain
 * environment variables. File-sourced secrets never appear in `docker inspect`,
 * `/proc/1/environ`, the image layers, or `docker compose config` output — so a
 * client probing the running container cannot read them.
 *
 * Resolution order per secret NAME (a file ALWAYS wins over inline env):
 *   1. process.env[`${NAME}_FILE`]        → read that exact path
 *   2. <RUN_SECRETS_DIR>/<lowercase NAME> → conventional Docker secret mount
 *   3. existing process.env[NAME]         → fallback (dev / pre-migration)
 *
 * Call hydrateSecrets() ONCE at process startup, before any module reads a value.
 * It is idempotent and safe to call from multiple entrypoints.
 */
const fs = require("fs");
const path = require("path");

// Secrets we manage. UPLOAD_SERVICE_TOKEN is the legacy alias of SERVICE_TOKEN.
const MANAGED = [
  "LICENSE_SECRET_KEY",
  "ORCHESTRATOR_SECRET",
  "CALLBACK_SECRET",
  "SERVICE_TOKEN",
  "UPLOAD_SERVICE_TOKEN",
  "DB_PASSWORD",
  "JWT_SECRET",
  "SESSION_SECRET",
];

function runSecretsDir() {
  return process.env.RUN_SECRETS_DIR || "/run/secrets";
}

function readSecretFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const value = fs.readFileSync(filePath, "utf8").trim();
    return value.length ? value : null;
  } catch {
    return null;
  }
}

/**
 * Hydrate managed secrets from files into process.env (file wins over env).
 * @returns {string[]} names that were loaded from a file (NEVER the values)
 */
function hydrateSecrets() {
  const loadedFromFile = [];
  for (const name of MANAGED) {
    let value = readSecretFile(process.env[`${name}_FILE`]);
    if (!value) {
      value = readSecretFile(path.join(runSecretsDir(), name.toLowerCase()));
    }
    if (value) {
      process.env[name] = value;
      loadedFromFile.push(name);
    }
  }
  return loadedFromFile;
}

module.exports = { hydrateSecrets, MANAGED };
