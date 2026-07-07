#!/usr/bin/env bash
# App-only hotfix deploy (Sprint 6-9) — backend + frontend + ai, no model/llm steps.
set -euo pipefail
PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

echo "==> Sprint 6-9 hardening deploy"
bash "$PROD_ROOT/scripts/bootstrap-prod-secrets.sh"
bash "$PROD_ROOT/scripts/validate-prod-layout.sh"

IMG_DIR="$(resolve_docker_images_dir)"
for tar in sp-backend.tar sp-frontend.tar sp-aimvp.tar; do
  if [[ -f "$IMG_DIR/$tar" ]]; then
    echo "==> Loading $tar"
    docker load -i "$IMG_DIR/$tar"
  else
    echo "ERROR: missing $IMG_DIR/$tar" >&2
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
  return 1
}

tag_if_missing sp-backend:prod ai-call-backend:prod || true
tag_if_missing sp-frontend:prod ai-powered-call-analysis-frontend:prod sp-frontend:latest || true
tag_if_missing sp-aimvp:prod ai-call-orchestrator:prod || true

remove_legacy_containers

docker compose up -d --force-recreate --no-deps backend frontend ai
echo ""
docker compose ps backend frontend ai
echo ""
echo "==> Backend log (expect: secrets from files, no bull error):"
docker logs "$SP_CONTAINER_BACKEND" --tail 25
