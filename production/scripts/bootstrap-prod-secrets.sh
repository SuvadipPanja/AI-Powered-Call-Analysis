# Populate production/secrets/* and .env.container from production/.env.
# .env.container is the backend env_file — secret keys stripped so printenv stays clean.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

SECRETS_DIR="$PROD_DIR/secrets"
ENV_FILE="$PROD_DIR/.env"
CONTAINER_ENV_FILE="$PROD_DIR/.env.container"

CONTAINER_ENV_STRIP_KEYS=(
  LICENSE_SECRET_KEY
  ORCHESTRATOR_SECRET
  CALLBACK_SECRET
  SERVICE_TOKEN
  DB_PASSWORD
  SA_PASSWORD
)

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: Missing $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$SECRETS_DIR"

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

write_secret() {
  local name="$1"
  local value="$2"
  local path="$SECRETS_DIR/$name"
  if [[ -z "${value// }" ]]; then
    echo "ERROR: $name is empty" >&2
    exit 1
  fi
  printf '%s' "$value" > "$path"
  chmod 600 "$path" 2>/dev/null || true
  echo "[bootstrap-secrets] wrote $path"
}

write_container_env() {
  local tmp
  tmp="$(mktemp)"
  while IFS= read -r line || [[ -n "$line" ]]; do
    local skip=0
    for key in "${CONTAINER_ENV_STRIP_KEYS[@]}"; do
      if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?${key}[[:space:]]*= ]]; then
        skip=1
        break
      fi
    done
    if [[ $skip -eq 0 ]]; then
      printf '%s\n' "$line"
    fi
  done < "$ENV_FILE" > "$tmp"
  mv "$tmp" "$CONTAINER_ENV_FILE"
  chmod 600 "$CONTAINER_ENV_FILE" 2>/dev/null || true
  echo "[bootstrap-secrets] wrote $CONTAINER_ENV_FILE (secret keys stripped - do not edit manually)"
}

write_secret license_secret_key "${LICENSE_SECRET_KEY:-}"
write_secret orchestrator_secret "${ORCHESTRATOR_SECRET:-}"
write_secret callback_secret "${CALLBACK_SECRET:-}"
write_secret service_token "${SERVICE_TOKEN:-}"
write_secret db_password "${SA_PASSWORD:-}"

write_container_env

echo "[bootstrap-secrets] Done. Secret files ready under $SECRETS_DIR"
