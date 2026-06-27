#!/bin/bash
set -euo pipefail

PROJECT="/mnt/c/Project/AI-Powered Call Analysis project"
VENV="$PROJECT/ai-mvp/.venv-wsl"

if [[ ! -d "$VENV" ]]; then
  echo "Run setup first: sudo bash $PROJECT/scripts/setup-wsl-nemo.sh"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
cd "$PROJECT/ai-mvp"

# Load WSL-specific env (overrides .env)
set -a
# shellcheck disable=SC1091
source "$PROJECT/ai-mvp/.env.wsl"
set +a

echo "Starting AI MVP (NeMo CPU) on port ${PORT:-8000}..."
echo "Backend: TRANSCRIBE_BACKEND=$TRANSCRIBE_BACKEND NEMO_DEVICE=$NEMO_DEVICE"
python orchestrator.py
