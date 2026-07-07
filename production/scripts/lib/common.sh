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

# Standard production container names (sp_* — matches docker-compose.yml).
# 2026-07-02 AI restructure: sp_ai → sp_ai_controller, sp_llm → sp_ai_llama,
# plus the new model services (docs/AI-STACK-SPEC.md).
export SP_CONTAINER_DB="${SP_CONTAINER_DB:-sp_db}"
export SP_CONTAINER_REDIS="${SP_CONTAINER_REDIS:-sp_redis}"
export SP_CONTAINER_BACKEND="${SP_CONTAINER_BACKEND:-sp_backend}"
export SP_CONTAINER_FRONTEND="${SP_CONTAINER_FRONTEND:-sp_frontend}"
export SP_CONTAINER_LLM="${SP_CONTAINER_LLM:-sp_ai_llama}"
export SP_CONTAINER_AI="${SP_CONTAINER_AI:-sp_ai_controller}"
export SP_CONTAINER_AI_LANG="${SP_CONTAINER_AI_LANG:-sp_ai_whisper_lang}"
export SP_CONTAINER_AI_NEMO="${SP_CONTAINER_AI_NEMO:-sp_ai_nemo}"
export SP_CONTAINER_AI_SEAMLESS="${SP_CONTAINER_AI_SEAMLESS:-sp_ai_seamless_m4t}"
export SP_CONTAINER_API_GATEWAY="${SP_CONTAINER_API_GATEWAY:-sp_api_gateway}"

# Stop and remove containers from older layouts so compose can recreate with
# the new names (ai_call_* era, plus pre-restructure sp_ai / sp_llm).
remove_legacy_containers() {
  local legacy=(
    ai_call_qwen
    ai_call_db ai_call_redis ai_call_backend ai_call_frontend
    ai_call_llm ai_call_ai ai_call_api_gateway
    sp_ai sp_llm
  )
  local name
  for name in "${legacy[@]}"; do
    if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then
      log "Removing legacy container $name"
      docker stop "$name" 2>/dev/null || true
      docker rm "$name" 2>/dev/null || true
    fi
  done
}
