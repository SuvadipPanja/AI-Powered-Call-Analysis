#!/usr/bin/env bash
# Run AI MVP orchestrator in WSL with NeMo on CPU
set -euo pipefail

PROJECT="/mnt/c/Project/AI-Powered Call Analysis project"
VENV="$PROJECT/ai-mvp/.venv-wsl"
# Default gateway is the Windows host IP in WSL2 (not always the resolv.conf nameserver)
WIN_HOST="$(ip route show default | awk '{print $3}')"

if [[ ! -d "$VENV" ]]; then
  echo "Run setup first: wsl -d Ubuntu-22.04 bash /mnt/c/Project/AI-Powered\\ Call\\ Analysis\\ project/scripts/setup-nemo-wsl.sh"
  exit 1
fi

# shellcheck disable=SC1091
source "$VENV/bin/activate"
cd "$PROJECT/ai-mvp"

export PROJECT_ROOT="$PROJECT"
export AUDIO_UPLOAD_DIR="$PROJECT/data/Sample_Audio"
export LOG_DIR="$PROJECT/logs/ai-mvp"
export AI_WORK_DIR="$PROJECT/data/ai-mvp-work"
export DIARIZATION_OUTPUT_DIR="$PROJECT/data/diarization_output/Chunk"
export WHISPER_LANG_MODEL_PATH="$PROJECT/models/Whisper-large-v3"
export HINDI_NEMO_MODEL_PATH="$PROJECT/models/nemo/stt_hi_conformer_ctc_medium.nemo"
export ENGLISH_NEMO_MODEL_PATH="$PROJECT/models/nemo/parakeet-rnnt-1.1b.nemo"
export NEMO_DEVICE=cpu
export TRANSCRIBE_BACKEND=nemo
export PORT=8000
# Models are on disk under models/ — do not hit HuggingFace/NVIDIA hubs at runtime
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1
export HF_DATASETS_OFFLINE=1

# Windows SQL Server from WSL (sa auth). Named instances do not work from WSL.
# SQLEXPRESS01 has TCP disabled by default — enable in SQL Configuration Manager,
# set IPAll TCP port (e.g. 1434; 1433 may be used by SQLEXPRESS), restart SQL, allow firewall.
export DB_TCP_PORT="${DB_TCP_PORT:-1434}"
export DB_SERVER="${WIN_HOST},${DB_TCP_PORT}"
export DB_DATABASE=call_analysis_db
export DB_USE_WINDOWS_AUTH=false
export DB_USER=sa
export DB_PASSWORD=Root@1234

echo "Starting AI MVP (NeMo CPU) on port $PORT"
echo "Windows host for SQL: $DB_SERVER"
echo "Health: http://localhost:8000/health"
python orchestrator.py
