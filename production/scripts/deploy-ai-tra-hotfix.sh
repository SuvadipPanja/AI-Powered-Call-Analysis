#!/usr/bin/env bash
# Hotfix deploy â€” Transcript Refinement Agent (TRA) ai-controller only.
# On prod after copying sp-ai-stack.tar + .env + docker-compose.yml:
#   bash scripts/deploy-ai-tra-hotfix.sh

set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

echo "=============================================="
echo " TRA hotfix â€” reload sp-ai-stack + ai-controller"
echo " Root: $PROD_ROOT"
echo "=============================================="

IMG_DIR="$(resolve_docker_images_dir)"
TAR="$IMG_DIR/sp-ai-stack.tar"

if [[ ! -f "$TAR" ]]; then
  echo "!! Missing $TAR â€” copy from dev production/docker-images/sp-ai-stack.tar"
  exit 1
fi

if [[ -f "$PROD_ROOT/.env" ]] && [[ -f "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh" ]]; then
  echo "==> Syncing secrets from .env ..."
  bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"
fi

echo "==> Loading sp-ai-stack.tar (this may take a few minutes) ..."
docker load -i "$TAR"

echo "==> Recreating ai-controller with TRA env ..."
docker compose up -d --force-recreate ai-controller

echo "==> Waiting for ai-controller health ..."
sleep 8
docker ps --filter name=sp_ai_controller --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo ""
echo "Verify TRA after re-processing a call:"
echo "  docker logs sp_ai_controller --tail 200 | grep -iE 'TRA|refinement|pre_audit'"
echo ""
echo "Expected env (grep from container):"
echo "  docker exec sp_ai_controller printenv | grep TRANSCRIPT_REFINEMENT"
echo ""
echo "Done."
