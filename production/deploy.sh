#!/usr/bin/env bash
# Wrapper — run from production/ folder:  ./deploy.sh [options]
exec "$(dirname "$0")/scripts/deploy.sh" "$@"
