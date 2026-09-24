#!/usr/bin/env bash
# Auto Upload was pausing on "AI acceptance could not be established"
# while the live controller had already started the call.
# Backend only. Does not change the controller, scoring, or language detection.
#
# From /home/suvadip/Call-Analysis/Project/production:
#   sed -i 's/\r$//' scripts/bake-auto-upload-ack.sh docker/Dockerfile.auto-upload-ack.patch auto-upload-ack/*.js
#   bash scripts/bake-auto-upload-ack.sh
#   bash scripts/bake-auto-upload-ack.sh recreate
#
# Rollback:
#   docker tag sp-backend:pre-auto-upload-ack sp-backend:prod
#   docker compose up -d --force-recreate --no-deps backend
if grep -q $'\r' "$0" 2>/dev/null; then
  sed -i 's/\r$//' "$0"
  exec bash "$0" "$@"
fi
set -euo pipefail
PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
cd "$PROD_ROOT"

DO_RECREATE=0
if [[ "${1:-}" == "recreate" ]]; then
  DO_RECREATE=1
fi

for f in \
  auto-upload-ack/aiDispatchProtocol.js \
  auto-upload-ack/autoUploadService.js \
  docker/Dockerfile.auto-upload-ack.patch
do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing $PROD_ROOT/$f" >&2
    exit 1
  fi
done

if ! grep -q "legacyController" auto-upload-ack/aiDispatchProtocol.js; then
  echo "ERROR: aiDispatchProtocol.js is missing the live-controller acceptance" >&2
  exit 1
fi
if ! grep -q "already sent and is still processing" auto-upload-ack/autoUploadService.js; then
  echo "ERROR: autoUploadService.js is missing the in-progress follow" >&2
  exit 1
fi

sed -i 's/\r$//' \
  scripts/bake-auto-upload-ack.sh \
  docker/Dockerfile.auto-upload-ack.patch \
  auto-upload-ack/aiDispatchProtocol.js \
  auto-upload-ack/autoUploadService.js

echo "==> current backend image"
docker inspect sp_backend --format 'container={{.Name}} image={{.Image}}' || true
docker image inspect sp-backend:prod --format 'prod={{.Id}} created={{.Created}}'

if docker image inspect sp-backend:pre-auto-upload-ack >/dev/null 2>&1; then
  echo "==> keeping existing sp-backend:pre-auto-upload-ack"
else
  echo "==> tag rollback: sp-backend:prod -> :pre-auto-upload-ack"
  docker tag sp-backend:prod sp-backend:pre-auto-upload-ack
fi

echo "==> bake overlay"
docker build -t sp-backend:prod -f docker/Dockerfile.auto-upload-ack.patch .

echo "==> verify baked markers"
docker run --rm --entrypoint grep sp-backend:prod -n \
  "legacyController" /app/services/aiDispatchProtocol.js
docker run --rm --entrypoint grep sp-backend:prod -n \
  "already sent and is still processing" /app/services/autoUploadService.js

if [[ "$DO_RECREATE" -eq 1 ]]; then
  echo "==> recreate backend only"
  docker compose up -d --force-recreate --no-deps backend
else
  echo
  echo "Image is baked. Recreate when no upload is being admitted:"
  echo "  bash scripts/bake-auto-upload-ack.sh recreate"
fi

echo
echo "Rollback:"
echo "  docker tag sp-backend:pre-auto-upload-ack sp-backend:prod"
echo "  docker compose up -d --force-recreate --no-deps backend"
