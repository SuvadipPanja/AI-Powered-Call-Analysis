#!/usr/bin/env bash
# Deploy Qwen3-8B-AWQ preset on shared-GPU prod (env-only — no image rebuild).
# Prereq: production/.env merged from env.qwen3-8b.template + your secrets.
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

echo "=============================================="
echo " Qwen3-8B shared-GPU deploy"
echo " Root: $PROD_ROOT"
echo "=============================================="

if [[ ! -f "$PROD_ROOT/.env" ]]; then
  echo "ERROR: Missing $PROD_ROOT/.env" >&2
  echo "Copy env.qwen3-8b.template and merge your secrets first." >&2
  exit 1
fi

MODEL_CFG="$PROD_ROOT/volumes/models/Qwen3-8B-AWQ/config.json"
if [[ ! -f "$MODEL_CFG" ]]; then
  echo "ERROR: Missing $MODEL_CFG" >&2
  echo "Extract 15-qwen3-8b-awq.tar into volumes/models/ first." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source "$PROD_ROOT/.env"
set +a

echo "==> LLM model: ${LLM_MODEL_PATH:-unset}"
echo "==> GPU index: ${GPU_DEVICE_ID:-1}"

bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"

echo "==> Recreating vLLM (llm) with Qwen3-8B ..."
docker compose up -d --force-recreate llm

echo "==> Waiting for sp_ai_llama healthy (up to 12 min) ..."
TRIES=0
until docker inspect sp_ai_llama --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do
  TRIES=$((TRIES + 1))
  if [[ $TRIES -gt 48 ]]; then
    echo "!! TIMEOUT — check: docker logs sp_ai_llama --tail 80" >&2
    exit 1
  fi
  STATUS="$(docker inspect sp_ai_llama --format='{{.State.Health.Status}}' 2>/dev/null || echo starting)"
  echo "    ... $STATUS ($TRIES/48)"
  sleep 15
done
echo "==> vLLM healthy"

echo "==> Recreating ai-nemo (English-only preload) + ai-controller ..."
docker compose up -d --force-recreate ai-nemo ai-controller

echo ""
docker compose ps
echo ""
if command -v nvidia-smi >/dev/null 2>&1; then
  nvidia-smi -i "${GPU_DEVICE_ID:-1}" --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader || true
fi
echo ""
echo "Next: bash scripts/verify-qwen3-8b-prod.sh"
echo "Then re-process sample MP3s (hold, English, Hindi) in the UI."
