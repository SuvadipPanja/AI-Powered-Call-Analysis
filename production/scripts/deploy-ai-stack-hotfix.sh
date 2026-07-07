#!/usr/bin/env bash
# Hotfix deploy — ai-controller only (transcript number normalization + Silero GPU).
# Copy sp-ai-stack.tar (+ optional docker-compose.yml) to prod, then:
#   sed -i 's/\r$//' scripts/deploy-ai-stack-hotfix.sh   # if copied from Windows
#   bash scripts/deploy-ai-stack-hotfix.sh
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

echo "=============================================="
echo " AI stack hotfix — reload sp-ai-stack + ai-controller"
echo " Root: $PROD_ROOT"
echo " Changes: transcript number normalization (Part A)"
echo "           SILERO_VAD_DEVICE=cuda for diarization VAD"
echo "           hold detection — skip agent thank-you after hold request"
echo " Pipeline: normalize -> format numbers -> entity -> context cleanup -> polish"
echo "=============================================="

IMG_DIR="$(resolve_docker_images_dir)"
TAR="$IMG_DIR/sp-ai-stack.tar"

if [[ ! -f "$TAR" ]]; then
  echo "ERROR: Missing $TAR" >&2
  echo "Copy from dev: production/docker-images/sp-ai-stack.tar" >&2
  exit 1
fi

if [[ -f "$PROD_ROOT/.env" ]] && [[ -f "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh" ]]; then
  echo "==> Syncing secrets from .env ..."
  bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"
fi

echo "==> Loading sp-ai-stack.tar (may take several minutes) ..."
docker load -i "$TAR"

echo "==> Recreating ai-controller ..."
docker compose up -d --force-recreate ai-controller

echo "==> Waiting for ai-controller ..."
sleep 8
docker ps --filter name=sp_ai_controller --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo ""
echo "Verify settings:"
echo "  bash scripts/verify-hold-prod.sh"
echo "  bash scripts/verify-gpu-policy.sh"
echo "  docker exec sp_ai_controller python test_hold_detection.py"
echo "  docker exec sp_ai_controller python -m pytest test_transcript_format.py -q"
echo ""
echo "Verify after RE-PROCESSING a call (stale rows keep old hold=No):"
echo "  docker logs sp_ai_controller 2>&1 | grep -i 'Hold detected=' | tail -10"
echo ""
echo "Done."