#!/bin/sh
# Fix Windows CRLF line endings on deploy scripts (run once after copying bundle to Linux).
# Usage: sh fix-line-endings.sh
set -e
cd "$(dirname "$0")"
for f in deploy.sh scripts/*.sh scripts/lib/*.sh; do
  [ -f "$f" ] || continue
  sed -i 's/\r$//' "$f" 2>/dev/null || sed -i '' 's/\r$//' "$f"
  chmod +x "$f"
done
echo "Line endings fixed. Run: ./deploy.sh"
