#!/usr/bin/env bash
#
# Cloud Agent install phase — idempotent, build-time setup for the two web-app
# services (backend + frontend). Heavy, per-boot runtime (Docker daemon, MSSQL
# + Redis containers, schema, seed) lives in start.sh instead.
#
# The AI pipeline (ai-mvp/, Ollama, GPU models) is intentionally OUT OF SCOPE
# for the cloud dev environment — it needs a GPU, an Ollama server and ~10GB of
# offline ML models. Auth, user/agent management and the app shell all work
# without it; call-data widgets simply show empty states.
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "[install] Installing system packages…"
sudo apt-get update -qq
# docker.io           -> local MSSQL + Redis containers
# unixodbc-dev        -> msnodesqlv8 native addon compiles against it (npm install)
# fuse-overlayfs/fuse3-> Docker storage driver that works in the nested VM
# iptables            -> Docker networking
# redis-tools         -> optional redis-cli for debugging
sudo apt-get install -y -qq \
  docker.io unixodbc-dev fuse-overlayfs fuse3 iptables redis-tools
# Resolve any deferred conffile prompts non-interactively (fuse3 /etc/fuse.conf).
sudo dpkg --configure -a --force-confold >/dev/null 2>&1 || true

echo "[install] Installing backend dependencies…"
( cd backend && npm install --no-audit --no-fund )

echo "[install] Installing frontend dependencies…"
( cd frontend && npm install --no-audit --no-fund )

echo "[install] Writing dev environment files (only if missing)…"
if [ ! -f backend/.env ]; then
  cp .cursor/templates/backend.env.dev backend/.env
  echo "[install]  -> wrote backend/.env"
fi
if [ ! -f frontend/.env ]; then
  cp .cursor/templates/frontend.env.dev frontend/.env
  echo "[install]  -> wrote frontend/.env"
fi

echo "[install] Ensuring local runtime directories…"
mkdir -p "logs/Backend Log" "logs/Details_Log" "logs/License_Log" \
         data/Sample_Audio data/Chat_Dump \
         backend/assets/profile_pictures backend/license

echo "[install] Generating local MAC-locked dev license (only if missing)…"
if [ ! -f backend/license/license.lic ]; then
  ( cd backend && node generate-local-license.js )
fi

echo "[install] Done."
