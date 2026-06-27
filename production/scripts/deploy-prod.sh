#!/usr/bin/env bash
# Production deploy â€” Llama AWQ + bank config + logging.
# Copy tars + scripts from dev, then on prod:
#   bash scripts/deploy-prod.sh
# (Line endings are auto-fixed â€” no manual sed required.)

set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# Auto-fix CRLF on all deploy scripts (Windows copy â†’ Linux)
# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

echo "=============================================="
echo " Call Analysis â€” production deploy"
echo " Root: $PROD_ROOT"
echo "=============================================="
# Remove legacy qwen container (renamed to llm)
if docker ps -a --format '{{.Names}}' | grep -qx 'ai_call_qwen'; then
  echo "==> Removing legacy ai_call_qwen container ..."
  docker stop ai_call_qwen 2>/dev/null || true
  docker rm ai_call_qwen 2>/dev/null || true
fi

mkdir -p docker-images model-bundles docs license 2>/dev/null || true

bash "$PROD_ROOT/scripts/01-create-folders.sh"
bash "$PROD_ROOT/scripts/validate-prod-layout.sh" || {
  echo "!! Layout validation failed — fix folders/.env before continuing"
  exit 1
}

IMG_DIR="$(resolve_docker_images_dir)"
BUNDLE_DIR="$(resolve_model_bundles_dir)"
echo "==> Docker images dir: $IMG_DIR"
echo "==> Model bundles dir: $BUNDLE_DIR"

# --- 1) Extract SeamlessM4T v2 (Hindi + Bengali + other Indic ASR) --------
SEAMLESS_CFG="$PROD_ROOT/volumes/models/seamless-m4t-v2-large/config.json"
if [[ ! -f "$SEAMLESS_CFG" ]] && { [[ -f "$BUNDLE_DIR/09-seamless-m4t.tar" ]] || [[ -f "$PROD_ROOT/images/09-seamless-m4t.tar" ]]; }; then
  bash "$PROD_ROOT/scripts/extract-seamless-m4t.sh"
elif [[ -f "$SEAMLESS_CFG" ]]; then
  echo "==> SeamlessM4T v2 model already present"
else
  echo "!! WARN: No SeamlessM4T model â€” copy model-bundles/09-seamless-m4t.tar from dev (Bengali ASR)"
fi

# --- 1c) Extract IndicLID --------------------------------------------------
INDICLID_FTN="$PROD_ROOT/volumes/models/indiclid/indiclid-ftn/model_baseline_roman.bin"
if [[ ! -f "$INDICLID_FTN" ]] && { [[ -f "$BUNDLE_DIR/10-indiclid.tar" ]] || [[ -f "$PROD_ROOT/images/10-indiclid.tar" ]]; }; then
  bash "$PROD_ROOT/scripts/extract-indiclid.sh"
elif [[ -f "$INDICLID_FTN" ]]; then
  echo "==> IndicLID model already present"
else
  echo "!! WARN: No IndicLID model â€” copy model-bundles/10-indiclid.tar from dev (LID accuracy)"
fi

# --- 1d) Extract Whisper large-v3 (language detection / LID) ---------------
WHISPER_LID="$PROD_ROOT/volumes/models/Whisper-large-v3/model.safetensors"
if [[ ! -f "$WHISPER_LID" ]] && { [[ -f "$BUNDLE_DIR/13-whisper-large-v3.tar" ]] || [[ -f "$PROD_ROOT/images/13-whisper-large-v3.tar" ]]; }; then
  bash "$PROD_ROOT/scripts/extract-whisper-lid.sh"
elif [[ -f "$WHISPER_LID" ]]; then
  echo "==> Whisper large-v3 (LID) already present"
else
  echo "!! WARN: No Whisper large-v3 LID model â€” copy model-bundles/13-whisper-large-v3.tar from dev"
fi

# --- 1e) Extract faster-whisper large-v3 (fallback ASR) --------------------
FW_MODEL="$PROD_ROOT/volumes/models/faster-whisper-large-v3/model.bin"
if [[ ! -f "$FW_MODEL" ]] && { [[ -f "$BUNDLE_DIR/12-faster-whisper.tar" ]] || [[ -f "$PROD_ROOT/images/12-faster-whisper.tar" ]]; }; then
  bash "$PROD_ROOT/scripts/extract-faster-whisper.sh"
elif [[ -f "$FW_MODEL" ]]; then
  echo "==> faster-whisper large-v3 already present"
else
  echo "!! WARN: No faster-whisper model â€” copy model-bundles/12-faster-whisper.tar from dev (fallback ASR)"
fi

# --- 2) Extract Llama model ------------------------------------------------
MODEL_DIR="$PROD_ROOT/volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ"
if [[ ! -f "$MODEL_DIR/config.json" ]]; then
  bash "$PROD_ROOT/scripts/extract-llama-awq.sh"
else
  echo "==> Llama AWQ model already extracted"
fi

# --- 3) Load Docker images (SP names + legacy fallbacks) -------------------
load_tar() {
  local sp_name="$1"
  local legacy_name="$2"
  local path=""
  for path in "$IMG_DIR/$sp_name" "$IMG_DIR/$legacy_name" "$PROD_ROOT/images/$legacy_name"; do
    if [[ -f "$path" ]]; then
      echo "==> Loading $(basename "$path") ..."
      docker load -i "$path"
      return 0
    fi
  done
  echo "!! WARN: missing $sp_name (also tried $legacy_name)"
  return 1
}

load_tar "sp-backend.tar" "02-backend.tar" || true
load_tar "sp-frontend.tar" "03-frontend.tar" || true
load_tar "sp-aimvp.tar" "05-ai.tar" || true

# Tag legacy names â†’ SP compose tags if needed
tag_if_missing() {
  local target="$1"; shift
  if docker image inspect "$target" >/dev/null 2>&1; then
    return 0
  fi
  local src
  for src in "$@"; do
    if docker image inspect "$src" >/dev/null 2>&1; then
      docker tag "$src" "$target"
      echo "==> Tagged $src -> $target"
      return 0
    fi
  done
  echo "!! WARN: could not tag $target (tried: $*)"
  return 1
}

tag_if_missing sp-aimvp:prod   ai-call-orchestrator:prod
tag_if_missing sp-backend:prod ai-call-backend:prod
tag_if_missing sp-frontend:prod ai-powered-call-analysis-frontend:prod ai-call-frontend:prod
tag_if_missing sp-db:prod      call-analysis-db:prod ai-call-db:prod

# vLLM upstream image may have any repo:tag â€” auto-detect
if ! docker image inspect sp-llm:prod >/dev/null 2>&1; then
  VLLM_SRC="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -iE 'vllm|qwen' | grep -v '<none>' | head -n1)"
  if [[ -n "$VLLM_SRC" ]]; then
    docker tag "$VLLM_SRC" sp-llm:prod
    echo "==> Tagged $VLLM_SRC -> sp-llm:prod"
  else
    echo "!! WARN: no vLLM image found â€” load images/06-*.tar (vllm) first"
  fi
fi

# --- 4) Start vLLM (llm service) first ------------------------------------
echo "==> Starting vLLM (llm service) ..."
docker compose up -d --force-recreate llm

echo "==> Waiting for vLLM health ..."
TRIES=0
until docker inspect ai_call_llm --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do
  TRIES=$((TRIES + 1))
  if [[ $TRIES -gt 40 ]]; then
    echo "!! TIMEOUT â€” docker logs ai_call_llm --tail 80"
    exit 1
  fi
  echo "    ... $(docker inspect ai_call_llm --format='{{.State.Health.Status}}' 2>/dev/null || echo starting) ($TRIES/40)"
  sleep 15
done
echo "==> vLLM healthy"

# --- 5) Recreate app services ----------------------------------------------
docker compose up -d --force-recreate backend frontend ai

echo ""
docker compose ps
echo ""
echo "Persistent uploads (host):"
echo "  volumes/profile_pictures/  → user profile photos"
echo "  volumes/branding/          → admin app logo"
echo ""
echo "Logs:"
echo "  docker logs ai_call_backend --tail 50"
echo "  docker logs ai_call_ai --tail 50"
echo "  tail -f volumes/logs/call_processing.log"
echo "  tail -f volumes/logs/ai/call_processing_\$(date +%Y-%m-%d).log"
echo "  docker exec ai_call_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '\$SA_PASSWORD' -C -Q \"SELECT TOP 20 * FROM CallProcessingLog ORDER BY LogID DESC\""
