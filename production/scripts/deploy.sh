#!/usr/bin/env bash
# =============================================================================
#  ONE-SHOT production deploy prep (Linux prod server, offline).
#
#  Does everything required BEFORE "docker compose up":
#    1. Fix script line endings + permissions
#    2. Preflight (docker, bundles, images, .env, license)
#    3. Create volumes/ folders + .env if missing
#    4. Extract models-bundle.tgz + qwen-model-bundle.tgz
#    5. docker load all images from images/
#    6. Verify compose images exist
#    7. GPU preflight (warn only)
#
#  Then YOU run manually:
#    cd /opt/call-analysis/production
#    docker compose up -d
#
#  Usage:
#    ./scripts/deploy.sh              # full prep (skip extract if models exist)
#    ./scripts/deploy.sh --force-models   # re-extract model bundles
#    ./scripts/deploy.sh --with-up        # also run compose up (optional)
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

WITH_UP=false
FORCE_MODELS=false
SKIP_LOAD=false

for arg in "$@"; do
  case "$arg" in
    --with-up)       WITH_UP=true ;;
    --force-models)  FORCE_MODELS=true ;;
    --skip-load)     SKIP_LOAD=true ;;
    -h|--help)
      cat <<'EOF'
Usage: ./scripts/deploy.sh [options]

  --force-models   Re-extract models-bundle.tgz and qwen-model-bundle.tgz
  --skip-load      Skip docker load (images already loaded)
  --with-up        Also run: docker compose up -d
  -h, --help       Show this help

After deploy.sh (without --with-up), start the stack manually:
  docker compose up -d
EOF
      exit 0
      ;;
    *)
      die "Unknown option: $arg (try --help)"
      ;;
  esac
done

REQUIRED_IMAGES=(
  "sp-db:prod"
  "sp-backend:prod"
  "sp-frontend:prod"
  "redis:7-alpine"
  "sp-aimvp:prod"
  "sp-llm:prod"
)

# Primary SP tars in docker-images/; legacy numbered names in images/ still work.
REQUIRED_TARS=(
  "sp-db.tar"
  "sp-backend.tar"
  "sp-frontend.tar"
  "sp-aimvp.tar"
  "sp-llm.tar"
)

LEGACY_TARS=(
  "01-db.tar"
  "02-backend.tar"
  "03-frontend.tar"
  "05-ai.tar"
  "06-qwen-vllm.tar"
)

step() {
  echo ""
  echo "======================================================================"
  log "STEP: $*"
  echo "======================================================================"
}

image_loaded() {
  local ref="$1"
  docker image inspect "$ref" >/dev/null 2>&1
}

verify_images() {
  local missing=()
  for ref in "${REQUIRED_IMAGES[@]}"; do
    if image_loaded "$ref"; then
      log "  OK  $ref"
    else
      missing+=("$ref")
      warn "  MISSING  $ref"
    fi
  done
  if ((${#missing[@]} > 0)); then
    die "Docker images missing after load: ${missing[*]}"
  fi
}

preflight() {
  step "Preflight checks"
  require_cmd docker
  docker compose version >/dev/null 2>&1 || die "docker compose v2 required"
  require_cmd tar

  IMG_DIR="$(resolve_docker_images_dir)"
  local found_any=false
  for t in "${REQUIRED_TARS[@]}" "${LEGACY_TARS[@]}"; do
    if [[ -f "$IMG_DIR/$t" ]] || [[ -f "$IMG_DIR/${t}.gz" ]]; then
      log "  OK  $(basename "$IMG_DIR")/$t"
      found_any=true
    fi
  done
  if [[ "$found_any" == false ]]; then
    die "No image archives in $IMG_DIR (expected sp-*.tar or legacy 0*.tar)"
  fi

  # Model bundles: SP layout (model-bundles/) or legacy root tgz
  if compgen -G "$(resolve_model_bundles_dir)/*.tar" >/dev/null 2>&1; then
    log "  OK  model bundles in $(basename "$(resolve_model_bundles_dir)")/"
  elif [[ -f "$PROD_DIR/models-bundle.tgz" ]]; then
    log "  OK  legacy models-bundle.tgz"
  else
    warn "No model bundles found — extract scripts may fail on fresh server"
  fi

  require_file "$PROD_DIR/docker-compose.yml"

  if [[ ! -f "$PROD_DIR/.env" ]]; then
    warn ".env not found — will be created from .env.example in next step"
  else
    # shellcheck disable=SC1091
    set -a; source "$PROD_DIR/.env"; set +a
    [[ -n "${SA_PASSWORD:-}" ]]     || warn "SA_PASSWORD empty in .env"
    [[ -n "${PUBLIC_HOST:-}" ]]     || warn "PUBLIC_HOST empty in .env"
    [[ -n "${HOST_MAC:-}" ]]        || warn "HOST_MAC empty in .env"
    [[ -n "${LICENSE_SECRET_KEY:-}" ]] || warn "LICENSE_SECRET_KEY empty in .env"
    if     [[ -n "${LICENSE_SECRET_KEY:-}" && ${#LICENSE_SECRET_KEY} -ne 32 ]]; then
      warn "LICENSE_SECRET_KEY should be exactly 32 characters"
    fi
    [[ -n "${PROFILE_PICS_DIR:-}" ]] || warn "PROFILE_PICS_DIR empty in .env"
    [[ -n "${BRANDING_DIR:-}" ]]     || warn "BRANDING_DIR empty in .env"
  fi

  if [[ ! -f "$PROD_DIR/license/license.lic" ]]; then
    warn "license/license.lic missing — backend will reject license until added"
  fi

  log "Preflight passed."
}

gpu_preflight() {
  step "GPU preflight (ai + qwen use host GPU ${GPU_DEVICE_ID:-1} only)"
  if ! command -v nvidia-smi >/dev/null 2>&1; then
    warn "nvidia-smi not found — GPU services may fail"
    return 0
  fi
  local gpu_id="${GPU_DEVICE_ID:-1}"
  log "Host GPU index for this stack: $gpu_id (GPU 0 left for other applications)"
  nvidia-smi -L || true
  nvidia-smi -i "$gpu_id" --query-gpu=index,name,memory.used,memory.total,utilization.gpu --format=csv,noheader 2>/dev/null \
    || warn "Could not query GPU $gpu_id — check GPU_DEVICE_ID in .env"
  if ! docker info 2>/dev/null | grep -qi nvidia; then
    warn "Docker nvidia runtime not registered. On host run:"
    warn "  sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker"
  else
    log "NVIDIA Docker runtime detected."
  fi
  log "Docker network: ${DOCKER_NETWORK_NAME:-call-analysis-prod-net}"
  log "Compose project: ${COMPOSE_PROJECT_NAME:-call-analysis-prod}"
}

main() {
  log "Production deploy prep — $PROD_DIR"
  log "Started at $(date -Is 2>/dev/null || date)"

  load_compose_env

  step "Prepare scripts (line endings + chmod)"
  fix_script_line_endings

  preflight

  step "Create folders and .env"
  bash "$HERE/01-create-folders.sh"

  step "Validate layout (volumes, compose mounts, .env paths)"
  bash "$HERE/validate-prod-layout.sh"

  step "Extract model bundles"
  EXTRACT_ARGS=()
  [[ "$FORCE_MODELS" == true ]] && EXTRACT_ARGS+=(--force)
  bash "$HERE/extract-model-bundles.sh" "${EXTRACT_ARGS[@]}"

  if [[ "$SKIP_LOAD" == false ]]; then
    step "Load Docker images"
    bash "$HERE/02-load-images.sh"
  else
    log "Skipping docker load (--skip-load)"
  fi

  step "Verify required images for compose"
  verify_images

  gpu_preflight

  # shellcheck disable=SC1091
  if [[ -f "$PROD_DIR/.env" ]]; then set -a; source "$PROD_DIR/.env"; set +a; fi

  echo ""
  echo "======================================================================"
  log "DEPLOY PREP COMPLETE"
  echo "======================================================================"
  echo ""
  echo "  Model paths (compose mounts):"
  echo "    volumes/models  → /models  (ASR + Qwen LLM + backend)"
  echo "    volumes/audio            → call recordings (uploads)"
  echo "    volumes/profile_pictures → user profile photos (persist across restarts)"
  echo "    volumes/branding         → admin app logo (persist across restarts)"
  echo "    volumes/batch/*          → batch auto-upload"
  echo ""
  echo "  Admin → Auto Upload (first login):"
  echo "    Metadata: /app/data/batch_metadata"
  echo "    Audio:    /app/data/batch_audio"
  echo ""

  if [[ "$WITH_UP" == true ]]; then
    step "Starting stack (--with-up)"
    bash "$HERE/03-up.sh"
  else
    echo "  Next — start the stack manually:"
    echo ""
    echo "    cd \"$PROD_DIR\""
    echo "    docker compose up -d"
    echo ""
    echo "  GPU: host index ${GPU_DEVICE_ID:-1} only (see .env). Network: ${DOCKER_NETWORK_NAME:-call-analysis-prod-net}"
    echo "  Then open:  http://${PUBLIC_HOST:-YOUR_SERVER_IP}:8081"
    echo "  API:          http://${PUBLIC_HOST:-YOUR_SERVER_IP}:5000"
    echo ""
    echo "  Watch logs:"
    echo "    docker compose logs -f db"
    echo "    docker compose logs -f llm"
    echo "    docker compose logs -f ai"
    echo ""
  fi
}

main "$@"
