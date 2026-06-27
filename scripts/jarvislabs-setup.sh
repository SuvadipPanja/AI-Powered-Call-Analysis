#!/usr/bin/env bash
# Jarvis Labs Ubuntu GPU instance — one-time setup for NeMo orchestrator
# Run as root or with sudo after SSH into the VM.
set -euo pipefail

PROJECT_DIR="${PROJECT_DIR:-$HOME/ai-call-analysis}"
COMPOSE_FILE="docker-compose.jarvis.yml"

echo "==> Jarvis Labs NeMo setup (project dir: $PROJECT_DIR)"

# --- Docker ---
if ! command -v docker &>/dev/null; then
  echo "==> Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  usermod -aG docker "$USER" || true
fi

# --- NVIDIA Container Toolkit ---
if ! docker info 2>/dev/null | grep -qi nvidia; then
  echo "==> Installing NVIDIA Container Toolkit..."
  distribution=$(. /etc/os-release; echo "${ID}${VERSION_ID}")
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
  curl -fsSL "https://nvidia.github.io/libnvidia-container/${distribution}/nvidia-container-toolkit.list" \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update
  apt-get install -y nvidia-container-toolkit
  nvidia-ctk runtime configure --runtime=docker
  systemctl restart docker
fi

# --- Project code (choose one) ---
if [ ! -d "$PROJECT_DIR" ]; then
  echo ""
  echo "Project not found at $PROJECT_DIR"
  echo "From your Windows laptop, copy the repo (models ~10GB take longest):"
  echo "  scp -r \"C:/Project/AI-Powered Call Analysis project\" jarvis@<JARVIS_IP>:~/ai-call-analysis"
  echo "  # or: rsync -avz --progress ./ jarvis@<JARVIS_IP>:~/ai-call-analysis/"
  echo ""
  mkdir -p "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "ERROR: $COMPOSE_FILE not found in $PROJECT_DIR"
  echo "Upload the full project before continuing."
  exit 1
fi

# --- Env file for callback mode (edit BACKEND_CALLBACK_URL + CALLBACK_SECRET) ---
if [ ! -f .env.jarvis ]; then
  cat > .env.jarvis <<'EOF'
DB_ENABLED=false
BACKEND_CALLBACK_URL=http://REPLACE_WITH_LAPTOP_TAILSCALE_IP:5000/api/internal/transcription-callback
CALLBACK_SECRET=REPLACE_WITH_SHARED_SECRET
EOF
  echo "Created .env.jarvis — edit BACKEND_CALLBACK_URL and CALLBACK_SECRET before starting."
fi

echo "==> GPU check"
nvidia-smi || { echo "nvidia-smi failed — pick a GPU template in Jarvis Labs"; exit 1; }

echo "==> Building and starting orchestrator..."
docker compose --env-file .env.jarvis -f "$COMPOSE_FILE" up --build -d

echo "==> Waiting for health..."
for i in $(seq 1 30); do
  if curl -sf http://localhost:8000/health >/dev/null; then
    echo "OK — orchestrator healthy"
    curl -s http://localhost:8000/health | head -c 500
    echo ""
    echo ""
    echo "Next: on laptop set backend/.env"
    echo "  AI_MAIN_URL=http://<JARVIS_PUBLIC_IP>:8000"
    echo "  AI_MAIN_REMOTE=true"
    echo "  CALLBACK_SECRET=<same as .env.jarvis>"
    exit 0
  fi
  sleep 10
done

echo "Health check timed out. Logs:"
docker compose -f "$COMPOSE_FILE" logs --tail=80
exit 1
