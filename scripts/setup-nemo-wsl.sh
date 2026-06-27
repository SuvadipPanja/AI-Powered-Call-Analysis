#!/usr/bin/env bash
# One-time setup: NeMo ASR inside WSL2 Ubuntu for CPU full-flow testing
set -euo pipefail

PROJECT="/mnt/c/Project/AI-Powered Call Analysis project"
VENV="$PROJECT/ai-mvp/.venv-wsl"

echo "=== NeMo WSL setup (Ubuntu) ==="

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  python3 python3-pip python3-venv python3-dev \
  build-essential git curl ffmpeg libsndfile1 \
  unixodbc unixodbc-dev

# Microsoft ODBC driver for SQL Server (pyodbc from WSL → Windows SQL)
if ! odbcinst -q -d 2>/dev/null | grep -qi "ODBC Driver 18"; then
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

pip install -r "$PROJECT/ai-mvp/requirements.txt"
pip install "nemo_toolkit[asr]"

echo "=== Setup complete ==="
python -c "import nemo; print('nemo', nemo.__version__)"
