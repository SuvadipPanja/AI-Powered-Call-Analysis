#!/usr/bin/env bash
# Hotfix deploy — Phase 1 (lead reconciliation) + Phase 2 (hold time detection).
# Copy sp-ai-stack.tar, sp-backend.tar, sp-frontend.tar to prod, then:
#   sed -i 's/\r$//' scripts/deploy-scoring-hold-hotfix.sh   # if copied from Windows
#   bash scripts/deploy-scoring-hold-hotfix.sh
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
echo " Scoring + Hold hotfix — ai-controller, backend, frontend"
echo " Root: $PROD_ROOT"
echo " Phase 1: Lead classification reconciled with loan intelligence"
echo " Phase 2: Agent hold-time detection (phrase + silence gap)"
echo "=============================================="

IMG_DIR="$(resolve_docker_images_dir)"
AI_TAR="$IMG_DIR/sp-ai-stack.tar"
BACKEND_TAR="$IMG_DIR/sp-backend.tar"
FRONTEND_TAR="$IMG_DIR/sp-frontend.tar"

for f in "$AI_TAR" "$BACKEND_TAR" "$FRONTEND_TAR"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: Missing $f" >&2
    echo "Copy from dev: production/docker-images/{sp-ai-stack,sp-backend,sp-frontend}.tar" >&2
    exit 1
  fi
done

if [[ -f "$PROD_ROOT/.env" ]] && [[ -f "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh" ]]; then
  echo "==> Syncing secrets from .env ..."
  bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"
fi

echo "==> Loading Docker images (may take several minutes) ..."
docker load -i "$AI_TAR"
docker load -i "$BACKEND_TAR"
docker load -i "$FRONTEND_TAR"

echo "==> Recreating backend (runs DB migration for hold columns) ..."
docker compose up -d --force-recreate backend

echo "==> Recreating ai-controller ..."
docker compose up -d --force-recreate ai-controller

echo "==> Recreating frontend ..."
docker compose up -d --force-recreate frontend

echo "==> Waiting for services ..."
sleep 10
docker ps --filter name=sp_ --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'

echo ""
echo "==> Automated hold verification"
if [[ -f "$PROD_ROOT/scripts/verify-hold-prod.sh" ]]; then
  bash "$PROD_ROOT/scripts/verify-hold-prod.sh" || true
fi

echo ""
echo "Re-process golden calls in UI (hold, English, Hindi), then confirm Result → Intelligence."
echo "Hard refresh browser: Ctrl+Shift+R"
echo "Done."
