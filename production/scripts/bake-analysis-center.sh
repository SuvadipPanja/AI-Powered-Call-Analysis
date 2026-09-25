#!/usr/bin/env bash
# Bake the analysis-center stamp into the live controller.
# A blank Consolidated_Audio_Analysis.CenterKey is filled from AudioUploads.
# Does not change scoring, ASR, or translate.
#
# From /home/suvadip/Call-Analysis/Project/production:
#   sed -i 's/\r$//' scripts/bake-analysis-center.sh docker/Dockerfile.analysis-center.patch
#   bash scripts/bake-analysis-center.sh
#   bash scripts/bake-analysis-center.sh recreate
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

DO_RECREATE=0
if [[ "${1:-}" == "recreate" ]]; then
  DO_RECREATE=1
fi

for f in analysis-center/db.py docker/Dockerfile.analysis-center.patch; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing $PROD_ROOT/$f" >&2
    exit 1
  fi
done

if ! grep -q "_stamp_analysis_center" analysis-center/db.py; then
  echo "ERROR: db.py is missing the center stamp" >&2
  exit 1
fi
if ! grep -q "upsert_scoring_result" analysis-center/db.py; then
  echo "ERROR: db.py is missing scoring save" >&2
  exit 1
fi

sed -i 's/\r$//' \
  analysis-center/db.py \
  docker/Dockerfile.analysis-center.patch \
  scripts/bake-analysis-center.sh

echo "==> current controller image"
docker inspect sp_ai_controller --format 'container={{.Name}} image={{.Image}}' || true
docker image inspect sp-ai-controller:prod --format 'prod={{.Id}} created={{.Created}}'

if docker image inspect sp-ai-controller:pre-analysis-center >/dev/null 2>&1; then
  echo "==> keeping existing sp-ai-controller:pre-analysis-center"
else
  echo "==> tag rollback: sp-ai-controller:prod -> :pre-analysis-center"
  docker tag sp-ai-controller:prod sp-ai-controller:pre-analysis-center
fi

echo "==> bake overlay"
docker build -t sp-ai-controller:prod -f docker/Dockerfile.analysis-center.patch .

echo "==> verify baked marker"
docker run --rm --entrypoint grep sp-ai-controller:prod -n \
  "_stamp_analysis_center" /app/db.py

if [[ "$DO_RECREATE" -eq 1 ]]; then
  echo "==> recreate ai-controller only"
  docker compose up -d --force-recreate --no-deps ai-controller
  docker exec sp_ai_controller grep -n "_stamp_analysis_center" /app/db.py
else
  echo
  echo "Image is baked. Recreate when no call is Processing:"
  echo "  bash scripts/bake-analysis-center.sh recreate"
fi

echo
echo "Rollback:"
echo "  docker tag sp-ai-controller:pre-analysis-center sp-ai-controller:prod"
echo "  docker compose up -d --force-recreate --no-deps ai-controller"
