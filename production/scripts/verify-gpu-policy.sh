#!/usr/bin/env bash
# Verify production GPU policy env vars (and optional compose GPU reservations).
# Usage (on prod):
#   sed -i 's/\r$//' scripts/verify-gpu-policy.sh   # if copied from Windows
#   bash scripts/verify-gpu-policy.sh
# Optional: CHECK_COMPOSE_GPU=1 bash scripts/verify-gpu-policy.sh
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"

ENV_FILE="${ENV_FILE:-$PROD_ROOT/.env}"
FAIL=0

expect_var() {
  local key="$1"
  local want="$2"
  local val
  val="$(grep -E "^${key}=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '\r' || true)"
  if [[ -z "$val" ]]; then
    echo "WARN: $key not set in .env (compose default may apply)"
    return 0
  fi
  if [[ "$val" != "$want" ]]; then
    echo "FAIL: $key=$val (expected $want)"
    FAIL=1
  else
    echo "OK:   $key=$val"
  fi
}

echo "==> GPU policy check (.env: $ENV_FILE)"
if [[ ! -f "$ENV_FILE" ]]; then
  echo "WARN: missing .env — checking running ai-controller only"
else
  expect_var WHISPER_LANG_DEVICE cuda
  expect_var NEMO_DEVICE cuda
  expect_var SEAMLESS_M4T_DEVICE cuda
  expect_var FASTER_WHISPER_DEVICE cuda
  expect_var SILERO_VAD_DEVICE cuda
  expect_var PYANNOTE_DEVICE cuda
  expect_var EMOTION2VEC_DEVICE cpu
  expect_var SENTIMENT_BACKEND transformers
  expect_var AI_MAX_CONCURRENT_JOBS 1
  expect_var ASR_CHUNK_PARALLELISM 1
fi

if docker ps --format '{{.Names}}' | grep -qx sp_ai_controller; then
  echo ""
  echo "==> ai-controller runtime"
  docker exec sp_ai_controller printenv SILERO_VAD_DEVICE WHISPER_LANG_DEVICE EMOTION2VEC_DEVICE SENTIMENT_BACKEND 2>/dev/null \
    | sort || true
  echo ""
  echo "==> diarization health (silero_device)"
  if HEALTH="$(docker exec sp_ai_controller curl -sf http://localhost:8000/health 2>/dev/null)"; then
    echo "$HEALTH" | python3 -c "
import sys, json
d = json.load(sys.stdin)
dia = (d.get('transcription') or {}).get('diarization') or {}
dev = dia.get('silero_device', 'unknown')
ready = dia.get('ready', False)
print(f'       silero_device={dev} ready={ready}')
sys.exit(0 if dev == 'cuda' else 1)
" 2>/dev/null && echo "  OK   Silero VAD on CUDA" || echo "  WARN silero_device is not cuda (check SILERO_VAD_DEVICE in compose/.env)"
  else
    echo "WARN: could not read /health from sp_ai_controller (container starting?)"
  fi
else
  echo "WARN: sp_ai_controller not running — skip runtime checks"
fi

if [[ "${CHECK_COMPOSE_GPU:-0}" == "1" ]]; then
  echo ""
  echo "==> docker compose GPU reservations (grep)"
  grep -n 'gpu-reservation\|nvidia' docker-compose.yml | head -40 || true
fi

if [[ "$FAIL" -ne 0 ]]; then
  echo ""
  echo "GPU policy verification FAILED — see production/env.gpu-asr-llm.template"
  exit 1
fi
echo ""
echo "GPU policy verification passed (or warnings only)."