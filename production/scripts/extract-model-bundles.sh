#!/usr/bin/env bash
# Extract models-bundle.tgz and qwen-model-bundle.tgz into volumes/models/ for compose.
# All models (ASR + Qwen LLM) live in one folder: volumes/models/
# Skips extraction when target models already look present (use --force to re-extract).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$HERE/lib/common.sh"

FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=true ;;
  esac
done

ASR_BUNDLE="$PROD_DIR/models-bundle.tgz"
LLM_BUNDLE="$PROD_DIR/qwen-model-bundle.tgz"
MODELS_DIR="$PROD_DIR/volumes/models"

asr_ready() {
  [[ -d "$MODELS_DIR/faster-whisper-large-v3" ]] \
    || [[ -d "$MODELS_DIR/Whisper-large-v3" ]]
}

asr_complete() {
  [[ -f "$MODELS_DIR/nemo/stt_hi_conformer_ctc_medium.nemo" ]] \
    && [[ -f "$MODELS_DIR/nemo/parakeet-rnnt-1.1b.nemo" ]] \
    && [[ -d "$MODELS_DIR/faster-whisper-large-v3" ]] \
    && [[ -d "$MODELS_DIR/Whisper-large-v3" ]]
}

qwen_ready() {
  [[ -f "$MODELS_DIR/Qwen3-4B/config.json" ]] \
    || compgen -G "$MODELS_DIR"/*/config.json >/dev/null 2>&1 \
    || compgen -G "$MODELS_DIR"/model-*.safetensors >/dev/null 2>&1 \
    || compgen -G "$MODELS_DIR"/*/model-*.safetensors >/dev/null 2>&1
}

extract_asr() {
  require_file "$ASR_BUNDLE"
  mkdir -p "$MODELS_DIR"
  if asr_ready && [[ "$FORCE" == false ]]; then
    log "ASR models already present under volumes/models — skip extract (use --force to redo)"
    return 0
  fi
  log "Extracting models-bundle.tgz → volumes/models (this may take several minutes) ..."
  tar xzf "$ASR_BUNDLE" -C "$MODELS_DIR"
  asr_ready || die "ASR extract finished but expected models not found under volumes/models"
  if ! asr_complete; then
    if [[ ! -d "$MODELS_DIR/faster-whisper-large-v3" ]]; then
      warn "No faster-whisper-large-v3 in bundle (OK — runtime uses large-v3 via /models cache)."
    fi
    if [[ ! -f "$MODELS_DIR/nemo/stt_hi_conformer_ctc_medium.nemo" ]] \
      || [[ ! -f "$MODELS_DIR/nemo/parakeet-rnnt-1.1b.nemo" ]]; then
      warn "NeMo .nemo files missing under volumes/models/nemo/"
    fi
  fi
  log "ASR models ready."
}

extract_llm() {
  require_file "$LLM_BUNDLE"
  mkdir -p "$MODELS_DIR"
  if qwen_ready && [[ "$FORCE" == false ]]; then
    log "Qwen weights already present under volumes/models — skip extract (use --force to redo)"
    return 0
  fi
  log "Extracting qwen-model-bundle.tgz → volumes/models (this may take several minutes) ..."
  tar xzf "$LLM_BUNDLE" -C "$MODELS_DIR"
  qwen_ready || die "Qwen extract finished but config.json / safetensors not found under volumes/models"
  log "Qwen models ready."
}

extract_asr
extract_llm

log "Model bundle extraction complete (all under volumes/models/)."
