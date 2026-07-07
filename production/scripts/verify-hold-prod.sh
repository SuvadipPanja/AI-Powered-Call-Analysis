#!/usr/bin/env bash
# Post-deploy hold detection verification (prod).
# Usage: bash scripts/verify-hold-prod.sh
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

echo "=============================================="
echo " Hold detection — prod verification"
echo "=============================================="

FAIL=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "  OK   $name"
  else
    echo "  FAIL $name" >&2
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "==> AI controller"
if docker ps --format '{{.Names}}' | grep -q '^sp_ai_controller$'; then
  check "hold_worker import" docker exec sp_ai_controller python -c "from hold_worker import analyze_hold; print('hold_worker OK')"
  HOLD_ENV="$(docker exec sp_ai_controller printenv HOLD_DETECTION_ENABLED 2>/dev/null || echo true)"
  echo "       HOLD_DETECTION_ENABLED=${HOLD_ENV:-true}"
  if [[ "${HOLD_ENV:-true}" == "false" ]]; then
    echo "  WARN HOLD_DETECTION_ENABLED=false — holds will never be detected" >&2
    FAIL=$((FAIL + 1))
  fi
  check "unit test in container" docker exec sp_ai_controller python test_hold_detection.py
else
  echo "  SKIP sp_ai_controller not running"
fi

echo ""
echo "==> Backend API"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:5000}"
if curl -sf "${BACKEND_URL}/api/system-monitor/health" >/dev/null 2>&1; then
  HOLD_JSON="$(curl -sf "${BACKEND_URL}/api/reports/hold-summary" 2>/dev/null || echo '{}')"
  echo "       hold-summary: $(echo "$HOLD_JSON" | head -c 200)"
  if echo "$HOLD_JSON" | grep -q '"success":true'; then
    echo "  OK   GET /api/reports/hold-summary"
  else
    echo "  FAIL GET /api/reports/hold-summary" >&2
    FAIL=$((FAIL + 1))
  fi
else
  echo "  SKIP backend not reachable at $BACKEND_URL"
fi

echo ""
echo "==> DB hold columns (optional — requires sqlcmd in sp_db)"
if docker ps --format '{{.Names}}' | grep -q '^sp_db$'; then
  docker exec sp_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$(grep DB_PASSWORD .env 2>/dev/null | cut -d= -f2- | tr -d '\"')" -C -d call_analysis_db -Q \
    "SELECT TOP 3 AudioFileName, AI_Hold_Detected, AI_Hold_Count, AI_Hold_Total_Sec FROM dbo.Consolidated_Audio_Analysis WHERE Status='Success' ORDER BY UploadDate DESC" 2>/dev/null \
    || echo "  SKIP sqlcmd query (check DB password / tool path)"
else
  echo "  SKIP sp_db not running"
fi

echo ""
echo "==> Manual golden-call checks (after UI re-process)"
echo "  1. Re-process hold call (cashback / put on hold) in Upload UI"
echo "  2. Result page → Intelligence → Agent Hold Time should show Yes + episodes"
echo "  3. docker logs sp_ai_controller 2>&1 | grep -i 'hold detected' | tail -5"
echo ""

if [[ "$FAIL" -gt 0 ]]; then
  echo "FAILED: $FAIL check(s)" >&2
  exit 1
fi
echo "All automated checks passed."
