#!/usr/bin/env bash
# Full deploy: Llama AWQ + bank config on prod (offline model from 07-llama-awq.tar).
#
#   sudo su
#   conda activate speech-analytics
#   cd /home/suvadip/Call-Analysis/Project/production
#   bash scripts/deploy-llama-bank-config.sh

set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

echo "=============================================="
echo " Llama AWQ + Bank Config — prod deploy"
echo " Root: $PROD_ROOT"
echo "=============================================="

# --- 1) Extract Llama AWQ from tar (offline) --------------------------------
MODEL_DIR="$PROD_ROOT/volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ"
if [[ ! -f "$MODEL_DIR/config.json" ]]; then
  if [[ -f "$PROD_ROOT/images/07-llama-awq.tar" ]]; then
    echo "==> Extracting Llama AWQ from images/07-llama-awq.tar ..."
    bash "$PROD_ROOT/scripts/extract-llama-awq.sh"
  else
    echo "!! No model. Copy images/07-llama-awq.tar from dev first."
    exit 1
  fi
else
  echo "==> Llama AWQ already at $MODEL_DIR"
fi

# --- 2) Load updated Docker images ----------------------------------------
for tar in 02-backend.tar 03-frontend.tar 05-ai.tar; do
  if [[ -f "images/$tar" ]]; then
    echo "==> Loading images/$tar ..."
    docker load -i "images/$tar"
  else
    echo "!! Missing images/$tar — copy from dev machine first"
    exit 1
  fi
done

# --- 3) Recreate llm (vLLM) first — loads AWQ on GPU 1 --------------------
echo "==> Starting vLLM (llm service) with Llama AWQ ..."
docker compose up -d --force-recreate llm

echo "==> Waiting for vLLM health (up to ~10 min on first AWQ load) ..."
TRIES=0
until docker inspect ai_call_llm --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do
  TRIES=$((TRIES + 1))
  if [[ $TRIES -gt 40 ]]; then
    echo "!! vLLM not healthy after 10 min. Check: docker logs ai_call_llm --tail 80"
    exit 1
  fi
  STATUS=$(docker inspect ai_call_llm --format='{{.State.Health.Status}}' 2>/dev/null || echo "starting")
  echo "    ... $STATUS ($TRIES/40)"
  sleep 15
done
echo "==> vLLM healthy"

# --- 4) Recreate backend, frontend, ai ------------------------------------
echo "==> Recreating backend, frontend, ai ..."
docker compose up -d --force-recreate backend frontend ai

echo ""
echo "=============================================="
echo " Deploy complete"
echo "=============================================="
docker compose ps
echo ""
echo "Next steps:"
echo "  1. Open http://10.64.194.130:8081 -> Admin Settings -> Bank Config (Super Admin)"
echo "  2. Set bank name + glossary, Save"
echo "  3. Re-upload test calls to verify translation/scoring"
echo ""
echo "Verify vLLM model:"
echo "  docker exec ai_call_llm curl -s http://127.0.0.1:8001/v1/models | head -c 500"
