#!/usr/bin/env bash
# Extract Whisper large-v3 (transformers, fp16) from model-bundles/13-whisper-large-v3.tar
# â†’ volumes/models/Whisper-large-v3/   (language detection / LID engine)
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
DEST="$PROD_ROOT/volumes/models/Whisper-large-v3"

TAR=""
for p in "$PROD_ROOT/model-bundles/13-whisper-large-v3.tar" "$PROD_ROOT/images/13-whisper-large-v3.tar"; do
  [[ -f "$p" ]] && TAR="$p" && break
done

if [[ -z "$TAR" ]]; then
  echo "!! Missing 13-whisper-large-v3.tar in model-bundles/ or images/ â€” copy from dev first"
  exit 1
fi

mkdir -p "$PROD_ROOT/volumes/models"
echo "==> Extracting Whisper large-v3 (LID) to volumes/models/ ..."
tar xf "$TAR" -C "$PROD_ROOT/volumes/models"

for f in config.json model.safetensors tokenizer.json preprocessor_config.json; do
  if [[ ! -f "$DEST/$f" ]]; then
    echo "!! Expected file missing after extract: $DEST/$f"
    exit 1
  fi
  echo "    OK $f"
done

echo "==> Whisper large-v3 (LID) ready at $DEST"
