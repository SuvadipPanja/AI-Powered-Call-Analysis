#!/usr/bin/env bash
# Extract faster-whisper large-v3 (CTranslate2) from model-bundles/12-faster-whisper.tar
# â†’ volumes/models/faster-whisper-large-v3/   (fallback ASR engine)
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
DEST="$PROD_ROOT/volumes/models/faster-whisper-large-v3"

TAR=""
for p in "$PROD_ROOT/model-bundles/12-faster-whisper.tar" "$PROD_ROOT/images/12-faster-whisper.tar"; do
  [[ -f "$p" ]] && TAR="$p" && break
done

if [[ -z "$TAR" ]]; then
  echo "!! Missing 12-faster-whisper.tar in model-bundles/ or images/ â€” copy from dev first"
  exit 1
fi

mkdir -p "$PROD_ROOT/volumes/models"
echo "==> Extracting faster-whisper large-v3 to volumes/models/ ..."
tar xf "$TAR" -C "$PROD_ROOT/volumes/models"

for f in model.bin config.json tokenizer.json; do
  if [[ ! -f "$DEST/$f" ]]; then
    echo "!! Expected file missing after extract: $DEST/$f"
    exit 1
  fi
  echo "    OK $f"
done

echo "==> faster-whisper large-v3 ready at $DEST"
