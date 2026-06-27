#!/usr/bin/env bash
# Shared paths and helpers for production deploy scripts.
set -euo pipefail

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPTS_DIR="$(cd "$_LIB_DIR/.." && pwd)"
PROD_DIR="$(cd "$SCRIPTS_DIR/.." && pwd)"
DOCKER_IMAGES_DIR="${DOCKER_IMAGES_DIR:-$PROD_DIR/docker-images}"
MODEL_BUNDLES_DIR="${MODEL_BUNDLES_DIR:-$PROD_DIR/model-bundles}"
DOCS_DIR="${DOCS_DIR:-$PROD_DIR/docs}"
# Legacy single images/ folder (still supported)
LEGACY_IMAGES_DIR="$PROD_DIR/images"

resolve_docker_images_dir() {
  if [[ -d "$DOCKER_IMAGES_DIR" ]] && compgen -G "$DOCKER_IMAGES_DIR/*.tar" >/dev/null 2>&1; then
    echo "$DOCKER_IMAGES_DIR"
  elif [[ -d "$LEGACY_IMAGES_DIR" ]]; then
    echo "$LEGACY_IMAGES_DIR"
  else
    echo "$DOCKER_IMAGES_DIR"
  fi
}

resolve_model_bundles_dir() {
  if [[ -d "$MODEL_BUNDLES_DIR" ]] && compgen -G "$MODEL_BUNDLES_DIR/*.tar" >/dev/null 2>&1; then
    echo "$MODEL_BUNDLES_DIR"
  elif [[ -d "$LEGACY_IMAGES_DIR" ]]; then
    echo "$LEGACY_IMAGES_DIR"
  else
    echo "$MODEL_BUNDLES_DIR"
  fi
}

find_bundle_tar() {
  local name="$1"
  local dir
  for dir in "$(resolve_model_bundles_dir)" "$LEGACY_IMAGES_DIR"; do
    [[ -f "$dir/$name" ]] && { echo "$dir/$name"; return 0; }
  done
  return 1
}

log()  { echo "[deploy] $*"; }
warn() { echo "[deploy] WARNING: $*" >&2; }
die()  { echo "[deploy] ERROR: $*" >&2; exit 1; }

cd "$PROD_DIR"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Required command not found: $1"
}

require_file() {
  [[ -f "$1" ]] || die "Missing required file: $1"
}

bytes_human() {
  local n="${1:-0}"
  if (( n >= 1073741824 )); then
    echo "$(awk "BEGIN {printf \"%.2f GB\", $n/1073741824}")"
  elif (( n >= 1048576 )); then
    echo "$(awk "BEGIN {printf \"%.2f MB\", $n/1048576}")"
  else
    echo "${n} B"
  fi
}

fix_script_line_endings() {
  local f
  for f in "$PROD_DIR"/deploy.sh "$PROD_DIR"/fix-line-endings.sh "$PROD_DIR"/scripts/*.sh "$PROD_DIR"/scripts/lib/*.sh; do
    [[ -f "$f" ]] || continue
    if sed --version 2>/dev/null | grep -q GNU; then
      sed -i 's/\r$//' "$f" 2>/dev/null || true
    else
      sed -i '' 's/\r$//' "$f" 2>/dev/null || true
    fi
    chmod +x "$f" 2>/dev/null || true
  done
}

load_compose_env() {
  if [[ -f "$PROD_DIR/.env" ]]; then
    # shellcheck disable=SC1091
    set -a; source "$PROD_DIR/.env"; set +a
  fi
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-call-analysis-prod}"
  export COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
}
