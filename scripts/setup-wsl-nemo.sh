#!/bin/bash
# Setup NeMo ASR in WSL2 Ubuntu for full-flow CPU testing
set -euo pipefail

PROJECT="/mnt/c/Project/AI-Powered Call Analysis project"
VENV="$PROJECT/ai-mvp/.venv-wsl"
HOST_IP=$(grep nameserver /etc/resolv.conf | awk '{print $2}')

echo "=== AI Call Analysis — WSL NeMo setup ==="
echo "Project: $PROJECT"
echo "Windows host IP (for SQL): $HOST_IP"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  python3-venv python3-pip python3-dev \
  ffmpeg libsndfile1 build-essential \
  curl gnupg2 apt-transport-https unixodbc-dev

# Microsoft ODBC driver for SQL Server
if ! dpkg -l msodbcsql18 2>/dev/null | grep -q ^ii; then
  curl -fsSL https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft.gpg
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/ubuntu/22.04/prod jammy main" \
    > /etc/apt/sources.list.d/mssql-release.list
  apt-get update -qq
  ACCEPT_EULA=Y apt-get install -y -qq msodbcsql18
fi

python3 -m venv "$VENV"
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --upgrade pip wheel setuptools

echo "Installing PyTorch (CPU)..."
pip install torch torchaudio --index-url https://download.pytorch.org/whl/cpu

echo "Installing NeMo ASR (this may take 10–20 minutes)..."
pip install "nemo_toolkit[asr]"

echo "Installing ai-mvp dependencies..."
pip install -r "$PROJECT/ai-mvp/requirements.txt"

# WSL environment file
cat > "$PROJECT/ai-mvp/.env.wsl" << EOF
PROJECT_ROOT=$PROJECT
AUDIO_UPLOAD_DIR=$PROJECT/data/Sample_Audio
LOG_DIR=$PROJECT/logs/ai-mvp
AI_WORK_DIR=$PROJECT/data/ai-mvp-work
DIARIZATION_OUTPUT_DIR=$PROJECT/data/diarization_output/Chunk
PORT=8000

WHISPER_LANG_MODEL_PATH=$PROJECT/models/Whisper-large-v3
HINDI_NEMO_MODEL_PATH=$PROJECT/models/nemo/stt_hi_conformer_ctc_medium.nemo
ENGLISH_NEMO_MODEL_PATH=$PROJECT/models/nemo/parakeet-rnnt-1.1b.nemo

NEMO_DEVICE=cpu
TRANSCRIBE_BACKEND=nemo

DB_SERVER=${HOST_IP}\\SQLEXPRESS01
DB_DATABASE=call_analysis_db
DB_USE_WINDOWS_AUTH=false
DB_USER=sa
DB_PASSWORD=Root@1234
EOF

echo ""
echo "=== Setup complete ==="
echo "Start AI MVP in WSL:"
echo "  bash $PROJECT/scripts/start-wsl-nemo.sh"
echo ""
echo "Point Windows backend .env to WSL:"
echo "  AI_MAIN_URL=http://localhost:8000"
echo "  (WSL forwards port 8000 to Windows localhost)"
