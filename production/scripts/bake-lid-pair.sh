#!/usr/bin/env bash
# Language detection correction for every center.
# Marathi customer words are not erased by a Hindi agent greeting.
# A decisive Hindi acoustic vote can correct a false Bengali label.
# Does not change scoring, PTP, or TVS Pass/Fail.
#
# From /home/suvadip/Call-Analysis/Project/production:
#   sed -i 's/\r$//' scripts/bake-lid-pair.sh docker/Dockerfile.lid-pair.patch
#   bash scripts/bake-lid-pair.sh
#   bash scripts/bake-lid-pair.sh recreate
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
  lang-lid/wordmatch_lid.py \
  lang-lid/acoustic_lid_worker.py \
  docker/Dockerfile.lid-pair.patch
do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: missing $PROD_ROOT/$f" >&2
    exit 1
  fi
done

if ! grep -q "def marathi_overrides_hindi" lang-lid/wordmatch_lid.py; then
  echo "ERROR: wordmatch_lid.py is missing the Marathi override" >&2
  exit 1
fi
if ! grep -q "vakgyata-hindi-over-bengali" lang-lid/acoustic_lid_worker.py; then
  echo "ERROR: acoustic_lid_worker.py is missing the Hindi-over-Bengali correction" >&2
  exit 1
fi
if ! grep -q "vakgyata-hindi-over-kannada" lang-lid/acoustic_lid_worker.py; then
  echo "ERROR: acoustic_lid_worker.py is missing the Hindi-over-Kannada correction" >&2
  exit 1
fi

sed -i 's/\r$//' \
  lang-lid/wordmatch_lid.py \
  lang-lid/acoustic_lid_worker.py \
  docker/Dockerfile.lid-pair.patch \
  scripts/bake-lid-pair.sh

echo "==> current language image"
docker inspect sp_ai_whisper_lang --format 'container={{.Name}} image={{.Image}}' || true
docker image inspect sp-ai-whisper-lang:prod --format 'prod={{.Id}} created={{.Created}}'

if docker image inspect sp-ai-whisper-lang:pre-lid-pair >/dev/null 2>&1; then
  echo "==> keeping existing sp-ai-whisper-lang:pre-lid-pair"
else
  echo "==> tag rollback: sp-ai-whisper-lang:prod -> :pre-lid-pair"
  docker tag sp-ai-whisper-lang:prod sp-ai-whisper-lang:pre-lid-pair
fi

echo "==> bake overlay"
docker build -t sp-ai-whisper-lang:prod -f docker/Dockerfile.lid-pair.patch .

echo "==> verify baked markers"
docker run --rm --entrypoint grep sp-ai-whisper-lang:prod -n \
  "def marathi_overrides_hindi" /app/wordmatch_lid.py
docker run --rm --entrypoint grep sp-ai-whisper-lang:prod -n \
  "vakgyata-hindi-over-bengali" /app/acoustic_lid_worker.py
docker run --rm --entrypoint grep sp-ai-whisper-lang:prod -n \
  "vakgyata-hindi-over-kannada" /app/acoustic_lid_worker.py

if [[ "$DO_RECREATE" -eq 1 ]]; then
  echo "==> recreate language service only"
  docker compose up -d --force-recreate --no-deps ai-whisper-lang
  docker exec sp_ai_whisper_lang grep -n "def marathi_overrides_hindi" /app/wordmatch_lid.py
else
  echo
  echo "Image is baked. Recreate when no call is in language detection:"
  echo "  bash scripts/bake-lid-pair.sh recreate"
fi

echo
echo "Re-process Audio_104 and Audio_035 after recreate. Old rows do not change by themselves."
echo "Rollback:"
echo "  docker tag sp-ai-whisper-lang:pre-lid-pair sp-ai-whisper-lang:prod"
echo "  docker compose up -d --force-recreate --no-deps ai-whisper-lang"
