#!/usr/bin/env bash
# =============================================================================
#  Take a fresh backup of the running database (call_analysis_db) and copy it
#  to production/backup/. Use this to refresh the data baked into the db image,
#  or for routine backups. Run on the host where the stack is running.
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD="$(cd "$HERE/.." && pwd)"
cd "$PROD"
# shellcheck disable=SC1091
set -a; . ./.env; set +a

STAMP="$(date +%Y%m%d_%H%M%S)"
CONTAINER="ai_call_db"
OUT_DIR="$PROD/backup"
mkdir -p "$OUT_DIR"

echo "==> Backing up call_analysis_db inside $CONTAINER ..."
docker exec "$CONTAINER" /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$SA_PASSWORD" -C -Q \
  "BACKUP DATABASE call_analysis_db TO DISK = N'/var/opt/mssql/backup/call_analysis_${STAMP}.bak' WITH INIT, COMPRESSION, STATS = 10"

echo "==> Copying backup out to $OUT_DIR ..."
docker cp "$CONTAINER:/var/opt/mssql/backup/call_analysis_${STAMP}.bak" "$OUT_DIR/"

echo ""
echo "Backup saved: $OUT_DIR/call_analysis_${STAMP}.bak"
echo "To bake fresh data into the image, copy it over $PROD/../Database/backup.bak and rebuild (script 00)."
