#!/usr/bin/env bash
# Extract SeamlessM4T v2 Large weights from images/09-seamless-m4t.tar → volumes/models/seamless-m4t-v2-large/
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
TAR="$PROD_ROOT/images/09-seamless-m4t.tar"
DEST="$PROD_ROOT/volumes/models/seamless-m4t-v2-large"

if [[ ! -f "$TAR" ]]; then
  echo "!! Missing $TAR — copy from dev machine first"
  exit 1
fi

mkdir -p "$PROD_ROOT/volumes/models"
echo "==> Extracting SeamlessM4T v2 to volumes/models/ ..."
tar xf "$TAR" -C "$PROD_ROOT/volumes/models"

for f in config.json model.safetensors.index.json; do
  if [[ ! -f "$DEST/$f" ]]; then
    echo "!! Expected model file missing after extract: $DEST/$f"
    exit 1
  fi
  echo "    OK $f"
done

shards=$(find "$DEST" -maxdepth 1 -name 'model-*.safetensors' | wc -l)
if [[ "$shards" -lt 1 ]]; then
  echo "!! No model-*.safetensors shards under $DEST"
  exit 1
fi
echo "    OK $shards safetensors shard(s)"

echo "==> SeamlessM4T v2 model ready at $DEST"
