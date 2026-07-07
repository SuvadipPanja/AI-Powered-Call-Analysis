#!/usr/bin/env bash
# User-management hotfix — LoginAlias migration + create-user UX.
# Deploys sp-backend:prod and sp-frontend:prod (no AI stack rebuild).
# Self-heal CRLF when copied from Windows (must run before set -euo pipefail).
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

IMG_DIR="$(resolve_docker_images_dir)"
BACKEND_TAR="$IMG_DIR/sp-backend.tar"
FRONTEND_TAR="$IMG_DIR/sp-frontend.tar"

for TAR in "$BACKEND_TAR" "$FRONTEND_TAR"; do
  if [[ ! -f "$TAR" ]]; then
    echo "ERROR: missing $TAR — copy from dev production/docker-images/" >&2
    exit 1
  fi
done

tag_if_missing() {
  local target="$1"; shift
  docker image inspect "$target" >/dev/null 2>&1 && return 0
  for src in "$@"; do
    if docker image inspect "$src" >/dev/null 2>&1; then
      docker tag "$src" "$target"
      echo "==> Tagged $src -> $target"
      return 0
    fi
  done
  echo "ERROR: could not resolve image tag for $target" >&2
  exit 1
}

echo "==> Loading sp-backend.tar"
docker load -i "$BACKEND_TAR"
tag_if_missing sp-backend:prod sp-backend:latest

echo "==> Loading sp-frontend.tar"
docker load -i "$FRONTEND_TAR"
tag_if_missing sp-frontend:prod sp-frontend:latest

echo "==> Recreating backend (runs LoginAlias migration on startup)"
docker compose up -d --force-recreate --no-deps backend

echo "==> Waiting for backend health..."
sleep 8
docker compose ps backend

echo "==> Recreating frontend"
docker compose up -d --force-recreate --no-deps frontend

echo ""
echo "==> Post-deploy checks"
echo "  1. docker compose ps backend frontend"
echo "  2. docker logs sp_backend --tail 30 | grep -i 'UsersLoginAlias\\|db-migrate'"
echo "  3. Login as superadmin -> Create User -> confirm success"
echo "  4. Hard refresh browser: Ctrl+Shift+R"
docker compose ps backend frontend
docker image inspect sp-backend:prod --format 'backend {{.Id}} {{.Created}}'
docker image inspect sp-frontend:prod --format 'frontend {{.Id}} {{.Created}}'
