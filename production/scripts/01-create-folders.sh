#!/usr/bin/env bash
# =============================================================================
#  Prepare the host folders + config on the PRODUCTION server (run once).
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROD="$(cd "$HERE/.." && pwd)"
cd "$PROD"

echo "==> Creating persistent data folders under $PROD/volumes ..."
mkdir -p \
  volumes/audio \
  volumes/batch/metadata \
  volumes/batch/audio \
  volumes/chat \
  volumes/logs \
  volumes/logs/ai \
  volumes/logs/llm \
  volumes/profile_pictures \
  volumes/branding \
  volumes/models \
  volumes/work
mkdir -p license

chmod -R 777 volumes 2>/dev/null || true

# Keep empty persistent dirs visible when listing (optional marker files)
touch volumes/profile_pictures/.gitkeep volumes/branding/.gitkeep 2>/dev/null || true

if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example — EDIT IT NOW (SA_PASSWORD, PUBLIC_HOST, secrets)."
else
  echo "==> .env already present (leaving it untouched)."
  # Backfill upload paths added after older prod deploys
  grep -q '^PROFILE_PICS_DIR=' .env 2>/dev/null || echo 'PROFILE_PICS_DIR=/app/assets/profile_pictures' >> .env
  grep -q '^BRANDING_DIR=' .env      2>/dev/null || echo 'BRANDING_DIR=/app/uploads/branding' >> .env
fi

if [ ! -f license/license.lic ]; then
  echo "!!  WARNING: production/license/license.lic is MISSING."
  echo "    Place your MAC-locked license file there (must match HOST_MAC in .env)."
fi

cat <<'EOF'

Batch auto-upload (Admin → Auto Upload settings on first login):
  Metadata parent path:  /app/data/batch_metadata
  Audio parent path:     /app/data/batch_audio

Drop files on the HOST at:
  volumes/batch/metadata/<DD_MM_YYYY>/metadata_DD_MM_YYYY.csv
  volumes/batch/audio/<DD_MM_YYYY>/*.wav

Persistent user uploads (survive backend/frontend container restart):
  volumes/profile_pictures/   → user profile photos (/app/assets/profile_pictures)
  volumes/branding/           → admin app logo (/app/uploads/branding)

EOF

echo "Folders ready:"
find volumes -maxdepth 3 -type d | sort
echo ""
echo "Next: ./scripts/validate-prod-layout.sh  (then ./deploy.sh or docker compose up -d)"
