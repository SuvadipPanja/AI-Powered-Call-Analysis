#!/usr/bin/env bash
# Extract IndicLID weights from images/10-indiclid.tar → volumes/models/indiclid/
set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
# shellcheck source=lib/common.sh
source "${PROD_ROOT}/scripts/lib/common.sh"
TAR="$(find_bundle_tar "10-indiclid.tar" 2>/dev/null || echo "$PROD_ROOT/images/10-indiclid.tar")"
DEST="$PROD_ROOT/volumes/models/indiclid"

if [[ ! -f "$TAR" ]]; then
  echo "!! Missing $TAR — copy from dev machine first"
  exit 1
fi

mkdir -p "$PROD_ROOT/volumes/models"
echo "==> Extracting IndicLID to volumes/models/ ..."
tar xf "$TAR" -C "$PROD_ROOT/volumes/models"

for f in \
  indiclid-ftn/model_baseline_roman.bin \
  indiclid-ftr/model_baseline_roman.bin \
  indiclid-bert/basline_nn_simple.pt
do
  if [[ ! -f "$DEST/$f" ]]; then
    echo "!! Expected file missing after extract: $DEST/$f"
    exit 1
  fi
  echo "    OK $f"
done

if [[ -d "$DEST/IndicBERTv2-MLM-only" ]]; then
  echo "    OK IndicBERTv2-MLM-only/ tokenizer"
else
  echo "!! WARN: IndicBERT tokenizer not in tar — roman-script LID may be weaker"
fi

echo "==> IndicLID ready at $DEST"
