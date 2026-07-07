#!/usr/bin/env bash
# =============================================================================
#  Start the production stack (db + redis + backend + frontend + llm +
#  ai-controller + ai-whisper-lang + ai-nemo + ai-seamless).
#  Distributed AI stack — see docs/AI-STACK-RUNBOOK.md.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD="$(cd "$HERE/.." && pwd)"
cd "$PROD"

# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

[ -f .env ] || { echo "ERROR: production/.env missing. Run ./scripts/01-create-folders.sh and edit .env."; exit 1; }

bash "$HERE/bootstrap-prod-secrets.sh"
bash "$HERE/validate-prod-layout.sh" || exit 1

remove_legacy_containers

# shellcheck disable=SC1091
set -a; . ./.env; set +a

export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-call-analysis-prod}"
export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
GPU_ID="${GPU_DEVICE_ID:-1}"

# --- GPU preflight: AI services + llm use host GPU index GPU_DEVICE_ID (default 1) ---
if ! command -v nvidia-smi >/dev/null 2>&1; then
  echo "!!  WARNING: nvidia-smi not found. The AI services + vLLM (llm) expect an NVIDIA GPU + driver."
  echo "    Install the NVIDIA driver + nvidia-container-toolkit, OR remove the GPU 'deploy:'"
  echo "    blocks in docker-compose.yml to run CPU-only (slow). Continuing in 5s ..."
  sleep 5
else
  echo "==> GPU config: using host GPU index ${GPU_ID} only (GPU 0 reserved for other apps)"
  nvidia-smi -L || true
  nvidia-smi -i "$GPU_ID" --query-gpu=index,name,memory.used,memory.total --format=csv,noheader 2>/dev/null || true
  if ! docker info 2>/dev/null | grep -qi nvidia; then
    echo "!!  WARNING: Docker has no 'nvidia' runtime registered."
    echo "    Run: sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
    echo "    Continuing in 5s ..."
    sleep 5
  fi
fi

echo "==> Starting stack (project: ${COMPOSE_PROJECT_NAME}, network: ${DOCKER_NETWORK_NAME:-call-analysis-prod-net}) ..."
docker compose up -d

echo ""
echo "==> Waiting for the database to restore + become healthy (first start can take 1-3 min) ..."
docker compose ps

cat <<EOF

------------------------------------------------------------------
  Stack is starting.

  Frontend (web app):  http://${PUBLIC_HOST:-<server>}:${FRONTEND_HTTP_PORT:-8081}
  Backend  (API):      http://${PUBLIC_HOST:-<server>}:${BACKEND_HTTP_PORT:-5000}
  GPU device:          host index ${GPU_ID} (llm + all ai-* services)
  Docker network:      ${DOCKER_NETWORK_NAME:-call-analysis-prod-net}
  Batch auto-upload:   Admin UI → Auto Upload (backend handles runs)
  Drop batch files:    volumes/batch/metadata/  and  volumes/batch/audio/
  Profile pictures:    volumes/profile_pictures/  (persist across restarts)
  App branding logo:   volumes/branding/

  AI stack (models load at startup — first boot takes several minutes):
    ai-controller (sp_ai_controller :8000)   ai-whisper-lang (sp_ai_whisper_lang :8010)
    ai-nemo (sp_ai_nemo :8020)               ai-seamless (sp_ai_seamless_m4t :8030)
    llm (sp_ai_llama :8001)                  → docs/AI-STACK-RUNBOOK.md

  Useful commands:
    docker compose ps
    docker compose logs -f backend
    docker compose logs -f llm
    docker compose logs -f ai-controller
    docker compose logs -f ai-whisper-lang ai-nemo ai-seamless
    nvidia-smi -i ${GPU_ID}
    docker compose down        # stop
------------------------------------------------------------------
EOF
