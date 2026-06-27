#!/usr/bin/env bash
# =============================================================================
#  Validate production folder layout before docker compose up.
#  Ensures host volumes, compose mounts, and .env paths stay in sync when
#  shipping the bundle to a new prod server.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

REQUIRED_HOST_DIRS=(
  volumes/audio
  volumes/batch/metadata
  volumes/batch/audio
  volumes/chat
  volumes/logs
  volumes/logs/ai
  volumes/logs/llm
  volumes/profile_pictures
  volumes/branding
  volumes/models
  volumes/work
)

REQUIRED_ENV_KEYS=(
  PROFILE_PICS_DIR
  BRANDING_DIR
)

COMPOSE_FILE="$PROD_DIR/docker-compose.yml"
errors=0
warnings=0

fail() {
  echo "[validate] ERROR: $*" >&2
  errors=$((errors + 1))
}

warn() {
  echo "[validate] WARNING: $*" >&2
  warnings=$((warnings + 1))
}

ok() {
  echo "[validate] OK  $*"
}

echo "==> Validating production layout under $PROD_DIR"

for d in "${REQUIRED_HOST_DIRS[@]}"; do
  if [[ -d "$PROD_DIR/$d" ]]; then
    ok "directory $d"
  else
    fail "missing directory: $d (run ./scripts/01-create-folders.sh)"
  fi
done

if [[ ! -f "$COMPOSE_FILE" ]]; then
  fail "missing docker-compose.yml"
else
  ok "docker-compose.yml present"
  for mount in \
    "./volumes/profile_pictures:/app/assets/profile_pictures" \
    "./volumes/branding:/app/uploads/branding" \
    "./volumes/chat:/app/data/Chat_Dump"; do
    if grep -Fq "$mount" "$COMPOSE_FILE"; then
      ok "compose mount $mount"
    else
      fail "docker-compose.yml missing mount: $mount"
    fi
  done
  for env_key in PROFILE_PICS_DIR BRANDING_DIR; do
    if grep -q "${env_key}:" "$COMPOSE_FILE"; then
      ok "compose env $env_key"
    else
      fail "docker-compose.yml missing backend env $env_key"
    fi
  done
fi

if [[ -f "$PROD_DIR/.env" ]]; then
  ok ".env present"
  # shellcheck disable=SC1091
  set -a; source "$PROD_DIR/.env"; set +a
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if [[ -n "${!key:-}" ]]; then
      ok ".env $key=${!key}"
    else
      warn ".env missing or empty: $key (copy from .env.example)"
    fi
  done
else
  warn ".env missing — 01-create-folders.sh will create from .env.example"
fi

if [[ -f "$PROD_DIR/.env.example" ]]; then
  for key in "${REQUIRED_ENV_KEYS[@]}"; do
    if grep -q "^${key}=" "$PROD_DIR/.env.example"; then
      ok ".env.example documents $key"
    else
      fail ".env.example missing $key"
    fi
  done
fi

IMG_DIR="$(resolve_docker_images_dir)"
if compgen -G "$IMG_DIR/*.tar" >/dev/null 2>&1; then
  ok "docker image archives in $(basename "$IMG_DIR")/"
else
  warn "no *.tar in $IMG_DIR (load images before compose up)"
fi

echo ""
if (( errors > 0 )); then
  echo "[validate] FAILED — $errors error(s), $warnings warning(s)"
  exit 1
fi

echo "[validate] PASSED — $warnings warning(s)"
exit 0
