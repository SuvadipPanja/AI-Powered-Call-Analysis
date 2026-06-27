#!/usr/bin/env bash
# Run SQL migrations inside the DB container (prod offline).
# Usage: bash scripts/run-db-migrate.sh
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PROD_ROOT"

# shellcheck source=lib/common.sh
source "$PROD_ROOT/scripts/lib/common.sh"
fix_script_line_endings

DB_CONTAINER="${DB_CONTAINER:-ai_call_db}"
DB_NAME="${DB_NAME:-call_analysis_db}"
SA_PASSWORD="${SA_PASSWORD:-${MSSQL_SA_PASSWORD:-}}"

if [[ -z "$SA_PASSWORD" ]] && [[ -f "$PROD_ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$PROD_ROOT/.env"; set +a
  SA_PASSWORD="${SA_PASSWORD:-}"
fi

if [[ -z "$SA_PASSWORD" ]]; then
  die "Set SA_PASSWORD in .env or environment"
fi

MIGRATION="$PROD_ROOT/migrations/004_db_comprehensive.sql"
if [[ ! -f "$MIGRATION" ]]; then
  MIGRATION="$PROD_ROOT/../backend/migrations/004_db_comprehensive.sql"
fi
if [[ ! -f "$MIGRATION" ]]; then
  die "Migration file not found: 004_db_comprehensive.sql"
fi

log "Running 004_db_comprehensive.sql on $DB_CONTAINER / $DB_NAME ..."
docker cp "$MIGRATION" "$DB_CONTAINER:/tmp/004_db_comprehensive.sql"
docker exec "$DB_CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$SA_PASSWORD" -C -d "$DB_NAME" \
  -i /tmp/004_db_comprehensive.sql

log "Restarting backend to run Node migrations ..."
docker compose restart backend

log "Done. Open Admin → Bank Config — should load without error."
