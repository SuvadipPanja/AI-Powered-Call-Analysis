#!/usr/bin/env bash
# Download Meta-Llama-3.1-8B-Instruct AWQ on prod (while internet is available).
# Run on prod server as user with write access to production/volumes/models/
#
#   cd /home/suvadip/Call-Analysis/Project/production
#   bash scripts/download-llama-awq.sh
#
# Requires: huggingface-cli (pip install huggingface_hub) OR git-lfs
# Llama license: accept at https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct first,
# then: huggingface-cli login

set -euo pipefail

PROD_ROOT="${PROD_ROOT:-/home/suvadip/Call-Analysis/Project/production}"
MODEL_DIR="${MODEL_DIR:-$PROD_ROOT/volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ}"
HF_REPO="${HF_REPO:-hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4}"

echo "==> Target directory: $MODEL_DIR"
mkdir -p "$MODEL_DIR"

if command -v huggingface-cli >/dev/null 2>&1; then
  echo "==> Downloading via huggingface-cli from $HF_REPO ..."
  huggingface-cli download "$HF_REPO" \
    --local-dir "$MODEL_DIR" \
    --local-dir-use-symlinks False
elif python3 -c "import huggingface_hub" 2>/dev/null; then
  echo "==> Downloading via Python huggingface_hub ..."
  python3 <<PY
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id="${HF_REPO}",
    local_dir="${MODEL_DIR}",
    local_dir_use_symlinks=False,
)
print("Download complete.")
PY
else
  echo "!! huggingface-cli not found. Install with:"
  echo "   pip install -U huggingface_hub"
  echo "   huggingface-cli login"
  exit 1
fi

echo ""
echo "==> Verifying files ..."
test -f "$MODEL_DIR/config.json" || { echo "Missing config.json"; exit 1; }
ls -lh "$MODEL_DIR" | head -20

echo ""
echo "==> Done. Folder ready for vLLM:"
echo "    LLM_MODEL_PATH=/models/Meta-Llama-3.1-8B-Instruct-AWQ"
echo ""
echo "Next: recreate llm container (see PROD-DEPLOY-LOGGING.md or deploy-prod.sh)"
