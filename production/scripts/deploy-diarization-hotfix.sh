#!/usr/bin/env bash
# Deploy diarization fix + updated ai-controller (hybrid stereo exclusive + optional Pyannote).
# Copy from dev:
#   production/docker-images/sp-ai-stack.tar
#   production/docker-images/sp-ai-diarization.tar   (optional GPU service)
#   production/docker-compose.yml
#   production/volumes/models/pyannote/speaker-diarization-3.1/  (+ segmentation + wespeaker subfolders)
# Then on prod:
#   sed -i 's/\r$//' scripts/deploy-diarization-hotfix.sh
#   bash scripts/deploy-diarization-hotfix.sh

set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

echo "=============================================="
echo " Diarization hotfix — ai-controller + ai-diarization"
echo " Root: $PROD_ROOT"
echo "=============================================="

IMG_DIR="$(resolve_docker_images_dir)"
STACK_TAR="$IMG_DIR/sp-ai-stack.tar"
DIAR_TAR="$IMG_DIR/sp-ai-diarization.tar"

if [[ ! -f "$STACK_TAR" ]]; then
  echo "ERROR: Missing $STACK_TAR" >&2
  exit 1
fi

if [[ -f "$PROD_ROOT/.env" ]] && [[ -f "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh" ]]; then
  echo "==> Syncing secrets from .env ..."
  bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"
fi

echo "==> Loading sp-ai-stack.tar ..."
docker load -i "$STACK_TAR"

if [[ -f "$DIAR_TAR" ]]; then
  echo "==> Loading sp-ai-diarization.tar ..."
  docker load -i "$DIAR_TAR"
  echo "==> Recreating ai-diarization + ai-controller ..."
  docker compose up -d --force-recreate ai-diarization ai-controller
else
  echo "!! sp-ai-diarization.tar not found — recreating ai-controller only (stereo_exclusive still active)"
  docker compose up -d --force-recreate ai-controller
fi

sleep 10
docker ps --filter name=sp_ai_controller --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker ps --filter name=sp_ai_diarization --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null || true

echo ""
echo "Verify diarization health:"
echo "  docker exec sp_ai_controller curl -s http://localhost:8000/health | head -c 500"
echo "  docker exec sp_ai_diarization curl -s http://localhost:8040/health 2>/dev/null || true"
echo ""
echo "After re-processing a call, check metadata:"
echo "  docker logs sp_ai_controller 2>&1 | grep -iE 'Method:|overlaps=' | tail -10"
echo ""
echo "Done."
