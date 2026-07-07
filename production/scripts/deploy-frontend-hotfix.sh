#!/usr/bin/env bash
# Frontend-only hotfix — load tar, fix sp-frontend:prod tag, force-recreate container.
set -euo pipefail
PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

IMG_DIR="$(resolve_docker_images_dir)"
TAR="$IMG_DIR/sp-frontend.tar"
if [[ ! -f "$TAR" ]]; then
  echo "ERROR: missing $TAR — copy from dev production/docker-images/" >&2
  exit 1
fi

echo "==> Loading sp-frontend.tar"
docker load -i "$TAR"

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

tag_if_missing sp-frontend:prod sp-frontend:latest

echo "==> Recreating frontend container"
docker compose up -d --force-recreate --no-deps frontend

echo "==> Verify (hard-refresh browser: Ctrl+Shift+R)"
docker compose ps frontend
docker image inspect sp-frontend:prod --format '{{.Id}} {{.Created}}'
