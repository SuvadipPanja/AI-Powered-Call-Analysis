#!/usr/bin/env bash
# ============================================================================
# license-deploy.sh — backend image deploy + v3 license helper (prod / client)
#
# Subcommands:
#   deploy        Load sp-backend.tar, recreate backend, show fingerprint+status
#   fingerprint   Print this server's hardware fingerprint (for license signing)
#   status        Print current license status (JSON)
#   clean-slate   Wipe ALL licenses from DB + delete license file, then recreate
#                 backend (boots LOCKED until a license is uploaded). Use on a
#                 fresh client or when switching from v2 to v3.
#   rows          Show how many license rows exist in the DB (expect 1 when ok)
#
# Usage:
#   bash scripts/license-deploy.sh deploy
#   bash scripts/license-deploy.sh fingerprint
#   bash scripts/license-deploy.sh clean-slate        # prompts for confirmation
#   bash scripts/license-deploy.sh clean-slate --yes   # no prompt
#
# Env overrides: DB_CONTAINER, BACKEND_CONTAINER, DB_NAME, SA_PASSWORD
# ============================================================================
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings
load_compose_env

DB_CONTAINER="${DB_CONTAINER:-ai_call_db}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-ai_call_backend}"
DB_NAME="${DB_NAME:-call_analysis_db}"
SA_PASSWORD="${SA_PASSWORD:-${MSSQL_SA_PASSWORD:-}}"
LICENSE_FILE="${LICENSE_FILE:-$PROD_ROOT/license/license.lic}"
PUBLIC_HOST="${PUBLIC_HOST:-localhost}"

sqlcmd() {
  [[ -n "$SA_PASSWORD" ]] || die "SA_PASSWORD not set (put it in .env or export it)."
  docker exec "$DB_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
    -S localhost -U sa -P "$SA_PASSWORD" -No -Q "$1"
}

cmd_fingerprint() {
  log "Server hardware fingerprint (paste into sign-license-v3.js --fingerprint):"
  docker exec "$BACKEND_CONTAINER" node /app/tools/print-server-id.js
}

cmd_status() {
  log "License status:"
  if command -v python3 >/dev/null 2>&1; then
    curl -s "http://${PUBLIC_HOST}:5000/api/license-status" | python3 -m json.tool || \
      curl -s "http://localhost:5000/api/license-status"
  else
    curl -s "http://${PUBLIC_HOST}:5000/api/license-status"; echo
  fi
}

cmd_rows() {
  log "License rows in DB (expect 1 when a single active license is installed):"
  sqlcmd "SELECT COUNT(*) AS rows FROM ${DB_NAME}.dbo.Licenses;"
}

cmd_deploy() {
  local tar
  tar="$(resolve_docker_images_dir)/sp-backend.tar"
  require_file "$tar"
  log "Loading backend image: $tar"
  docker load -i "$tar"
  log "Recreating backend ..."
  docker compose rm -sf backend || true
  docker compose up -d --force-recreate backend
  log "Waiting for backend to come up ..."
  sleep 6
  docker compose logs backend --tail=20 | grep -iE "License|Server is running|No license" || true
  echo
  cmd_fingerprint
  echo
  cmd_status
}

cmd_clean_slate() {
  local confirm="${1:-}"
  if [[ "$confirm" != "--yes" ]]; then
    echo "This DELETES ALL license rows from ${DB_NAME}.dbo.Licenses and removes"
    echo "  $LICENSE_FILE"
    echo "The backend will boot LOCKED until you upload a new license via Admin -> License."
    read -r -p "Type 'yes' to continue: " ans
    [[ "$ans" == "yes" ]] || die "Aborted."
  fi
  log "Deleting all license rows ..."
  sqlcmd "DELETE FROM ${DB_NAME}.dbo.Licenses;"
  log "Removing license file (if present) ..."
  rm -f "$LICENSE_FILE" || true
  log "Recreating backend (will boot locked) ..."
  docker compose rm -sf backend || true
  docker load -i "$(resolve_docker_images_dir)/sp-backend.tar" || true
  docker compose up -d --force-recreate backend
  sleep 6
  docker compose logs backend --tail=15 | grep -iE "License|No license|Server is running" || true
  echo
  cmd_fingerprint
  log "Next: sign a license bound to the fingerprint above, then upload it in Admin -> License."
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    deploy)       cmd_deploy "$@";;
    fingerprint)  cmd_fingerprint "$@";;
    status)       cmd_status "$@";;
    rows)         cmd_rows "$@";;
    clean-slate)  cmd_clean_slate "$@";;
    *)
      echo "Usage: bash scripts/license-deploy.sh {deploy|fingerprint|status|rows|clean-slate [--yes]}"
      exit 1;;
  esac
}

main "$@"
