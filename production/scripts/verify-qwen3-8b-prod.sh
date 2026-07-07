#!/usr/bin/env bash
# Post-deploy checks for Qwen3-8B shared-GPU preset.
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# shellcheck disable=SC1091
if [[ -f "$PROD_ROOT/.env" ]]; then
  set -a
  source "$PROD_ROOT/.env"
  set +a
fi

GPU_ID="${GPU_DEVICE_ID:-1}"
FAIL=0

pass() { echo "[OK] $*"; }
fail() { echo "[FAIL] $*"; FAIL=1; }

echo "=== Qwen3-8B prod verification ==="

if [[ -f "$PROD_ROOT/volumes/models/Qwen3-8B-AWQ/config.json" ]]; then
  pass "Qwen3-8B-AWQ model present"
else
  fail "Missing volumes/models/Qwen3-8B-AWQ/config.json"
fi

LLM_HEALTH="$(docker inspect sp_ai_llama --format='{{.State.Health.Status}}' 2>/dev/null || echo missing)"
if [[ "$LLM_HEALTH" == "healthy" ]]; then
  pass "sp_ai_llama healthy"
else
  fail "sp_ai_llama status=$LLM_HEALTH (docker logs sp_ai_llama --tail 50)"
fi

CTRL_HEALTH="$(docker inspect sp_ai_controller --format='{{.State.Health.Status}}' 2>/dev/null || echo missing)"
if [[ "$CTRL_HEALTH" == "healthy" ]]; then
  pass "sp_ai_controller healthy"
else
  fail "sp_ai_controller status=$CTRL_HEALTH"
fi

if docker exec sp_ai_llama python3 -c \
  "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/v1/models', timeout=5)" \
  >/dev/null 2>&1; then
  pass "vLLM /v1/models responds"
else
  fail "vLLM API not responding"
fi

MODEL_ID="$(docker exec sp_ai_llama printenv LLM_SERVED_NAME 2>/dev/null || true)"
if [[ -z "$MODEL_ID" ]]; then
  MODEL_ID="$(grep -E '^LLM_SERVED_NAME=' "$PROD_ROOT/.env" 2>/dev/null | cut -d= -f2- || true)"
fi
if [[ "$MODEL_ID" == *"8B"* ]]; then
  pass "LLM_SERVED_NAME looks like 8B: $MODEL_ID"
else
  fail "Expected Qwen3-8B in .env (got: ${MODEL_ID:-unset})"
fi

if command -v nvidia-smi >/dev/null 2>&1; then
  echo ""
  echo "GPU $GPU_ID:"
  nvidia-smi -i "$GPU_ID" --query-gpu=memory.used,memory.total,utilization.gpu --format=csv,noheader || true
  pass "nvidia-smi ran (watch during a live call — stay below ~90%)"
fi

echo ""
echo "=== Manual UI checks (re-process after deploy) ==="
echo "  1. Hold call (*LS4D5.mp3) — hold ~1m26s, mobile digits"
echo "  2. English call — NeMo ASR, scoring completes"
echo "  3. Hindi/Bengali call — Seamless ASR, numbers as digits"
echo ""
echo "Logs: docker logs sp_ai_llama --tail 30 | grep -i oom"
echo "      tail volumes/logs/ai-controller/call_processing_*.log"

if [[ $FAIL -ne 0 ]]; then
  exit 1
fi
echo "=== Automated checks passed ==="
