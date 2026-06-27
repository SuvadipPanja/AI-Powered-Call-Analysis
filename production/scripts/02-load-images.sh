#!/usr/bin/env bash
# =============================================================================
#  Load the transferred Docker images on the PRODUCTION server (offline-safe).
#  Supports docker-images/ (sp-*.tar) and legacy images/ (0*.tar).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

IMG_DIR="$(resolve_docker_images_dir)"
shopt -s nullglob
ARCHIVES=("$IMG_DIR"/*.tar "$IMG_DIR"/*.tar.gz)
if [ ${#ARCHIVES[@]} -eq 0 ]; then
  echo "ERROR: no image archives found in $IMG_DIR"
  echo "Copy sp-*.tar into docker-images/ (or legacy 0*.tar into images/) from dev."
  exit 1
fi

for f in "${ARCHIVES[@]}"; do
  echo "==> Loading $(basename "$f") ..."
  docker load -i "$f"
done

# Tag legacy names → SP compose tags if load used old archives
tag_if_missing() {
  local target="$1"; shift
  if docker image inspect "$target" >/dev/null 2>&1; then
    return 0
  fi
  local src
  for src in "$@"; do
    if docker image inspect "$src" >/dev/null 2>&1; then
      docker tag "$src" "$target"
      echo "==> Tagged $src -> $target"
      return 0
    fi
  done
  return 1
}

tag_if_missing sp-db:prod       call-analysis-db:prod ai-call-db:prod || true
tag_if_missing sp-backend:prod  ai-call-backend:prod || true
tag_if_missing sp-frontend:prod ai-powered-call-analysis-frontend:prod ai-call-frontend:prod || true
tag_if_missing sp-aimvp:prod    ai-call-orchestrator:prod || true

if ! docker image inspect sp-llm:prod >/dev/null 2>&1; then
  VLLM_SRC="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -iE 'vllm|qwen|llm' | grep -v '<none>' | head -n1 || true)"
  if [[ -n "$VLLM_SRC" ]]; then
    docker tag "$VLLM_SRC" sp-llm:prod
    echo "==> Tagged $VLLM_SRC -> sp-llm:prod"
  fi
fi

echo ""
echo "Loaded images (SP tags):"
docker images | grep -E "sp-db|sp-backend|sp-frontend|sp-aimvp|sp-llm|redis" || true
echo ""
echo "Next: ./scripts/validate-prod-layout.sh  then  docker compose up -d"
