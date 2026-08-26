#!/usr/bin/env bash
#
# Cloud Agent start phase — per-boot runtime reconciliation. Idempotent and
# safe to re-run: brings up the Docker daemon, the MSSQL + Redis containers,
# creates/patches the dev schema and seeds the test users. Returns once the
# database is reachable so the backend/frontend terminals can start against it.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB_SA_PASSWORD="Root@1234"
DB_NAME="call_analysis_db"
SQLCMD="/opt/mssql-tools18/bin/sqlcmd"

echo "[start] Ensuring Docker daemon is running…"
if ! sudo docker info >/dev/null 2>&1; then
  sudo rm -f /var/run/docker.pid 2>/dev/null || true
  sudo dockerd --storage-driver=fuse-overlayfs >/tmp/dockerd.log 2>&1 &
  for i in $(seq 1 30); do
    sudo docker info >/dev/null 2>&1 && break
    sleep 2
  done
fi
sudo docker info >/dev/null 2>&1 || { echo "[start] ERROR: Docker daemon did not start"; tail -20 /tmp/dockerd.log; exit 1; }

# Start (or create) a container by name. $1=name, rest=docker run args after image.
ensure_container() {
  local name="$1"; shift
  if [ -n "$(sudo docker ps -q -f "name=^${name}$")" ]; then
    return 0                                   # already running
  fi
  if [ -n "$(sudo docker ps -aq -f "name=^${name}$")" ]; then
    sudo docker start "$name" >/dev/null       # exists but stopped
  else
    sudo docker run -d --name "$name" "$@" >/dev/null   # create fresh
  fi
}

echo "[start] Ensuring Redis container…"
ensure_container ai_call_redis -p 6379:6379 --restart unless-stopped redis:7-alpine

echo "[start] Ensuring MSSQL container…"
ensure_container ai_call_db \
  -e ACCEPT_EULA=Y -e MSSQL_SA_PASSWORD="$DB_SA_PASSWORD" -e MSSQL_PID=Developer \
  -p 1433:1433 --restart unless-stopped mcr.microsoft.com/mssql/server:2022-latest

echo "[start] Waiting for MSSQL to accept connections…"
for i in $(seq 1 60); do
  if sudo docker exec ai_call_db "$SQLCMD" -S localhost -U sa -P "$DB_SA_PASSWORD" -C -Q "SELECT 1" >/dev/null 2>&1; then
    echo "[start]  -> MSSQL ready"
    break
  fi
  sleep 2
done

echo "[start] Applying dev schema (idempotent)…"
sudo docker exec ai_call_db "$SQLCMD" -S localhost -U sa -P "$DB_SA_PASSWORD" -C \
  -Q "IF DB_ID('$DB_NAME') IS NULL CREATE DATABASE [$DB_NAME]"
sudo docker exec -i ai_call_db "$SQLCMD" -S localhost -U sa -P "$DB_SA_PASSWORD" -C -d "$DB_NAME" \
  < scripts/sql/dev_bootstrap_core.sql
sudo docker exec -i ai_call_db "$SQLCMD" -S localhost -U sa -P "$DB_SA_PASSWORD" -C -d "$DB_NAME" \
  < scripts/sql/create_consolidated_audio_analysis.sql

echo "[start] Seeding test users (idempotent upsert)…"
( cd backend && node seed-test-users.js ) || echo "[start] WARN: user seed failed (non-fatal)"

echo "[start] Ready. Test accounts are documented in TEST_ACCOUNTS.md."
