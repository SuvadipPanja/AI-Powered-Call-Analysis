#!/bin/sh
# Sprint 4 — Docker license gate entrypoint (OPT-IN).
#
# Default behaviour is UNCHANGED: the container starts the server directly.
# Enable the pre-boot license gate by setting LICENSE_GATE_ENABLE=true in the
# backend environment. When enabled, the container refuses to start unless a
# valid (or within-grace) license is present.
#
# Wire it up in docker-compose.yml:
#   backend:
#     entrypoint: ["/app/license-entrypoint.sh"]
#     command: ["node", "server.js"]
set -e

if [ "${LICENSE_GATE_ENABLE:-false}" = "true" ]; then
  echo "[entrypoint] License gate enabled — validating before boot..."
  node /app/tools/license-gate.js
  echo "[entrypoint] License gate passed."
else
  echo "[entrypoint] License gate disabled (set LICENSE_GATE_ENABLE=true to enforce)."
fi

# Hand off to the container's command (defaults to node server.js).
if [ "$#" -eq 0 ]; then
  exec node server.js
else
  exec "$@"
fi
