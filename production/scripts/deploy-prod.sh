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
# Remove legacy containers (ai_call_* / ai_call_qwen) before sp_* recreate
remove_legacy_containers

mkdir -p docker-images model-bundles docs license secrets 2>/dev/null || true

bash "$PROD_ROOT/scripts/01-create-folders.sh"

if [[ -f "$PROD_ROOT/.env" ]] && [[ -f "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh" ]]; then
  echo "==> Syncing Docker secret files from .env ..."
  bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"
fi

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

# --- 2) Extract LLM + emotion models ---------------------------------------
# Qwen3-14B-AWQ is the default LLM since 2026-07 (scoring/intelligence/
# sentiment/cleanup). Qwen3-8B-AWQ = smaller fallback preset. Llama kept for
# rollback. emotion2vec+ = tone backend (optional — librosa fallback).
extract_model_bundle() {
  local tar_name="$1" dir_name="$2" check_file="$3" required="$4"
  local target="$PROD_ROOT/volumes/models/$dir_name"
  if [[ -f "$target/$check_file" ]]; then
    echo "==> $dir_name already present"
    return 0
  fi
  local tar_path
  if tar_path="$(find_bundle_tar "$tar_name")"; then
    echo "==> Extracting $tar_name -> volumes/models/$dir_name ..."
    mkdir -p "$PROD_ROOT/volumes/models"
    tar -xf "$tar_path" -C "$PROD_ROOT/volumes/models"
    [[ -f "$target/$check_file" ]] || { echo "!! ERROR: $tar_name extract failed ($check_file missing)"; return 1; }
  elif [[ "$required" == "required" ]]; then
    echo "!! WARN: $dir_name missing and no $tar_name bundle — copy it from dev"
    return 1
  else
    echo "==> $dir_name not present (optional) — skipping"
  fi
  return 0
}

extract_model_bundle "14-qwen3-14b-awq.tar"          "Qwen3-14B-AWQ"          "config.json" "required" || QWEN14B_MISSING=1
extract_model_bundle "15-qwen3-8b-awq.tar"           "Qwen3-8B-AWQ"           "config.json" "optional" || true
extract_model_bundle "16-emotion2vec-plus-large.tar" "emotion2vec_plus_large" "model.pt"    "optional" \
  || echo "!! WARN: emotion2vec extract failed — tone analysis falls back to librosa"

# Legacy Llama AWQ (rollback preset) — extract only if its tar is around.
MODEL_DIR="$PROD_ROOT/volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ"
if [[ ! -f "$MODEL_DIR/config.json" ]]; then
  bash "$PROD_ROOT/scripts/extract-llama-awq.sh" || echo "==> (no Llama bundle — fine unless you roll back the LLM)"
else
  echo "==> Llama AWQ model already extracted"
fi

# The LLM the compose/.env actually points at MUST exist before vLLM starts.
LLM_PATH_CONFIGURED="$(grep -E '^LLM_MODEL_PATH=' "$PROD_ROOT/.env" 2>/dev/null | tail -n1 | cut -d= -f2- || true)"
LLM_PATH_CONFIGURED="${LLM_PATH_CONFIGURED:-/models/Qwen3-14B-AWQ}"
LLM_HOST_DIR="$PROD_ROOT/volumes/models/$(basename "$LLM_PATH_CONFIGURED")"
if [[ ! -f "$LLM_HOST_DIR/config.json" ]]; then
  echo "!! ERROR: LLM model not found: $LLM_HOST_DIR (LLM_MODEL_PATH=$LLM_PATH_CONFIGURED)"
  echo "   Copy model-bundles/14-qwen3-14b-awq.tar from dev, or set the Llama"
  echo "   rollback preset in .env (see .env.example)."
  exit 1
fi
echo "==> LLM model OK: $LLM_HOST_DIR"

# --- 2b) Seed torch-hub/HF helper caches (silero VAD, MiniLM, sentiment) ---
# Mounted at /root/.cache in the controller; required air-gapped (no internet).
HUB_CACHE_DIR="$PROD_ROOT/volumes/hub-cache"
if [[ ! -d "$HUB_CACHE_DIR/torch/hub" ]]; then
  if [[ -f "$PROD_ROOT/hub-cache-seed.tar.gz" ]]; then
    echo "==> Seeding volumes/hub-cache from hub-cache-seed.tar.gz ..."
    mkdir -p "$HUB_CACHE_DIR"
    tar xzf "$PROD_ROOT/hub-cache-seed.tar.gz" -C "$HUB_CACHE_DIR"
  else
    echo "!! WARN: volumes/hub-cache empty and no hub-cache-seed.tar.gz —"
    echo "   diarization/sentiment/script models will try to download at first boot."
  fi
else
  echo "==> Helper-model cache already present (volumes/hub-cache)"
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
# Distributed AI stack (2026-07-02): one tar with controller + whisper-lang +
# nemo + seamless images. Legacy sp-aimvp.tar only feeds the old monolith
# compose (backup-2026-07-02/) — kept as a fallback load for rollback.
if ! load_tar "sp-ai-stack.tar" "sp-aimvp.tar"; then
  echo "!! WARN: no sp-ai-stack.tar — the AI services cannot start."
  echo "   Build on dev: powershell -File production-build/build-ai-stack.ps1"
fi

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

remove_legacy_containers

# vLLM upstream image may have any repo:tag — auto-detect
if ! docker image inspect sp-llm:prod >/dev/null 2>&1; then
  VLLM_SRC="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -iE 'vllm|qwen' | grep -v '<none>' | head -n1)"
  if [[ -n "$VLLM_SRC" ]]; then
    docker tag "$VLLM_SRC" sp-llm:prod
    echo "==> Tagged $VLLM_SRC -> sp-llm:prod"
  else
    echo "!! WARN: no vLLM image found â€” load images/06-*.tar (vllm) first"
  fi
fi

# --- 3b) Distributed AI stack images must all be present -------------------
AI_STACK_IMAGES=(sp-ai-controller:prod sp-ai-whisper-lang:prod sp-ai-nemo:prod sp-ai-seamless-m4t:prod)
for img in "${AI_STACK_IMAGES[@]}"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "!! ERROR: missing $img — copy docker-images/sp-ai-stack.tar from dev"
    echo "   (build: production-build/build-ai-stack.ps1). To run the OLD monolith"
    echo "   instead, restore backup-2026-07-02/ (see docs/AI-STACK-RUNBOOK.md)."
    exit 1
  fi
done

# --- 4) Start vLLM (llm service) first ------------------------------------
echo "==> Starting vLLM (llm service) ..."
docker compose up -d --force-recreate llm

echo "==> Waiting for vLLM health ..."
TRIES=0
until docker inspect "$SP_CONTAINER_LLM" --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do
  TRIES=$((TRIES + 1))
  if [[ $TRIES -gt 40 ]]; then
    echo "!! TIMEOUT — docker logs $SP_CONTAINER_LLM --tail 80"
    exit 1
  fi
  echo "    ... $(docker inspect "$SP_CONTAINER_LLM" --format='{{.State.Health.Status}}' 2>/dev/null || echo starting) ($TRIES/40)"
  sleep 15
done
echo "==> vLLM healthy"

# --- 5) Recreate app + AI services -------------------------------------------
# Model services boot first (eager model load — /health ready after minutes);
# controller starts alongside and reports downstream health at :8000/health.
docker compose up -d --force-recreate ai-whisper-lang ai-nemo ai-seamless
docker compose up -d --force-recreate backend frontend ai-controller

echo ""
docker compose ps
echo ""
echo "Persistent uploads (host):"
echo "  volumes/profile_pictures/  → user profile photos"
echo "  volumes/branding/          → admin app logo"
echo ""
echo "AI health (models load at startup — first boot can take ~10 min):"
echo "  docker exec $SP_CONTAINER_AI curl -s http://localhost:8000/health"
echo "  docker exec $SP_CONTAINER_AI_LANG curl -s http://localhost:8010/health"
echo "  docker exec $SP_CONTAINER_AI_NEMO curl -s http://localhost:8020/health"
echo "  docker exec $SP_CONTAINER_AI_SEAMLESS curl -s http://localhost:8030/health"
echo ""
echo "Logs:"
echo "  docker logs $SP_CONTAINER_BACKEND --tail 50"
echo "  docker logs $SP_CONTAINER_AI --tail 50"
echo "  tail -f volumes/logs/call_processing.log"
echo "  tail -f volumes/logs/ai-controller/*.log"
echo "  docker exec $SP_CONTAINER_DB /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P '\$SA_PASSWORD' -C -Q \"SELECT TOP 20 * FROM CallProcessingLog ORDER BY LogID DESC\""
