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
  volumes/logs/ai-controller
  volumes/logs/ai-whisper-lang
  volumes/logs/ai-nemo
  volumes/logs/ai-seamless
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

# Host .env — compose interpolation + bootstrap source; backend uses .env.container
SECURITY_ENV_KEYS=(
  SA_PASSWORD
  HOST_MAC
  CORS_ORIGIN
  API_AUTH_ENFORCE
  LICENSE_SECRET_KEY
  ORCHESTRATOR_SECRET
  CALLBACK_SECRET
  SERVICE_TOKEN
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
  for env_key in PROFILE_PICS_DIR BRANDING_DIR CORS_ORIGIN API_AUTH_ENFORCE; do
    if grep -q "${env_key}:" "$COMPOSE_FILE"; then
      ok "compose env $env_key"
    else
      fail "docker-compose.yml missing backend env $env_key"
    fi
  done
  if grep -q "secrets:" "$COMPOSE_FILE" && grep -q "license_secret_key" "$COMPOSE_FILE"; then
    ok "compose Docker secrets block"
  else
    fail "docker-compose.yml missing Sprint 6 secrets block"
  fi
  if grep -A3 'env_file:' "$COMPOSE_FILE" | grep -q '\.env\.container'; then
    ok "backend env_file uses .env.container"
  else
    fail "docker-compose.yml backend env_file must be .env.container (not .env)"
  fi
fi

SECRET_FILES=(
  secrets/license_secret_key
  secrets/orchestrator_secret
  secrets/callback_secret
  secrets/service_token
  secrets/db_password
)

CONTAINER_ENV_STRIP_KEYS=(
  LICENSE_SECRET_KEY
  ORCHESTRATOR_SECRET
  CALLBACK_SECRET
  SERVICE_TOKEN
  DB_PASSWORD
  SA_PASSWORD
)

CONTAINER_ENV_REQUIRED_KEYS=(
  LICENSE_PUBLIC_KEY_PATH
  CORS_ORIGIN
  API_AUTH_ENFORCE
)

for legacy_env in .env.secrets .env.backend; do
  if [[ -f "$PROD_DIR/$legacy_env" ]]; then
    warn "deprecated split-env file present: $legacy_env — production uses single .env only (see docs/PROD-FILES-AND-DEPLOY.md)"
  fi
done

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
  for key in "${SECURITY_ENV_KEYS[@]}"; do
    if [[ -z "${!key:-}" ]]; then
      fail ".env missing or empty: $key (required for production)"
    else
      ok ".env $key is set"
    fi
  done
  for sf in "${SECRET_FILES[@]}"; do
    if [[ -f "$PROD_DIR/$sf" ]]; then
      ok "secret file $sf"
    else
      fail "missing $sf — run ./scripts/bootstrap-prod-secrets.sh"
    fi
  done
  if [[ -f "$PROD_DIR/.env.container" ]]; then
    ok ".env.container present"
    for key in "${CONTAINER_ENV_STRIP_KEYS[@]}"; do
      if grep -qE "^\s*(export\s+)?${key}\s*=" "$PROD_DIR/.env.container"; then
        fail ".env.container still contains $key — re-run ./scripts/bootstrap-prod-secrets.sh"
      else
        ok ".env.container excludes $key"
      fi
    done
    for key in "${CONTAINER_ENV_REQUIRED_KEYS[@]}"; do
      if grep -qE "^\s*(export\s+)?${key}\s*=" "$PROD_DIR/.env.container"; then
        ok ".env.container includes $key"
      else
        fail ".env.container missing $key — re-run ./scripts/bootstrap-prod-secrets.sh"
      fi
    done
  else
    fail "missing .env.container — run ./scripts/bootstrap-prod-secrets.sh"
  fi
  if [[ "${API_AUTH_ENFORCE:-true}" == "false" ]]; then
    fail "API_AUTH_ENFORCE=false — authentication disabled; do not run production like this"
  fi
  if [[ -n "${LICENSE_SECRET_KEY:-}" && ${#LICENSE_SECRET_KEY} -ne 32 ]]; then
    fail "LICENSE_SECRET_KEY must be exactly 32 characters (got ${#LICENSE_SECRET_KEY})"
  fi
  if [[ -z "${LICENSE_PUBLIC_KEY_PATH:-}" ]]; then
    fail "LICENSE_PUBLIC_KEY_PATH empty — set LICENSE_PUBLIC_KEY_PATH=/app/keys/vendor-root-public.pem in .env"
  elif [[ "${LICENSE_PUBLIC_KEY_PATH}" != "/app/keys/vendor-root-public.pem" ]]; then
    warn "LICENSE_PUBLIC_KEY_PATH=${LICENSE_PUBLIC_KEY_PATH} — expected /app/keys/vendor-root-public.pem"
  else
    ok "LICENSE_PUBLIC_KEY_PATH set"
  fi
  frontend_port="${FRONTEND_HTTP_PORT:-8081}"
  expected_cors="http://${PUBLIC_HOST:-}:${frontend_port}"
  if [[ -n "${PUBLIC_HOST:-}" && -n "${CORS_ORIGIN:-}" ]]; then
    if [[ "$CORS_ORIGIN" == *"$expected_cors"* ]]; then
      ok "CORS_ORIGIN includes expected frontend URL ($expected_cors)"
    else
      warn "CORS_ORIGIN=$CORS_ORIGIN — expected to include $expected_cors (browser origin must match)"
    fi
  fi
else
  warn ".env missing — 01-create-folders.sh will create from .env.example"
fi

if [[ -f "$PROD_DIR/.env.example" ]]; then
  for key in "${REQUIRED_ENV_KEYS[@]}" "${SECURITY_ENV_KEYS[@]}" LICENSE_PUBLIC_KEY_PATH; do
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
