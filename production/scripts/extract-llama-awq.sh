#!/usr/bin/env bash
# Extract Llama AWQ model tar (copied from dev — no internet on prod).
#
#   cd /home/suvadip/Call-Analysis/Project/production
#   bash scripts/extract-llama-awq.sh

set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
TAR="$PROD_ROOT/images/07-llama-awq.tar"
MODEL_DIR="$PROD_ROOT/volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ"

if [[ -f "$MODEL_DIR/config.json" ]]; then
  echo "==> Model already extracted: $MODEL_DIR"
  ls -lh "$MODEL_DIR" | head -8
  exit 0
fi

if [[ ! -f "$TAR" ]]; then
  echo "!! Missing $TAR"
  echo "   Copy 07-llama-awq.tar from dev machine first."
  exit 1
fi

mkdir -p "$PROD_ROOT/volumes/models"
echo "==> Extracting $TAR (this may take a few minutes) ..."
tar -xf "$TAR" -C "$PROD_ROOT/volumes/models"

if [[ ! -f "$MODEL_DIR/config.json" ]]; then
  echo "!! Extract failed — config.json not found"
  exit 1
fi

echo "==> OK. Model ready at:"
echo "    $MODEL_DIR"
ls -lh "$MODEL_DIR" | head -10
