# Fix notes — all models in volumes/models/

## Correct layout (your server already matches this)

```
volumes/models/
├── Whisper-large-v3/          # language detection only
├── faster-whisper-large-v3/   # transcription (CTranslate2)
├── nemo/
│   ├── parakeet-rnnt-1.1b.nemo
│   └── stt_hi_conformer_ctc_medium.nemo
└── Qwen3-4B/
```

No separate `volumes/qwen/` folder needed.

## If you had Qwen under volumes/qwen/ earlier

```bash
mv volumes/qwen/Qwen3-4B volumes/models/ 2>/dev/null || true
rmdir volumes/qwen 2>/dev/null || true
```

## Extract bundles (both go to volumes/models/)

```bash
tar xzf models-bundle.tgz -C volumes/models
tar xzf qwen-model-bundle.tgz -C volumes/models
```

## Compose paths

| Container | Host mount | Qwen path inside container |
|-----------|------------|----------------------------|
| qwen | `./volumes/models` → `/models` | `/models/Qwen3-4B` |
| ai | `./volumes/models` → `/models` | same |
| backend | `./volumes/models` → `/models` | same |

`.env`: `QWEN_MODEL_PATH=/models/Qwen3-4B`

## AI container restarts ~6s after "Processing:" (cuDNN crash — not OOM)

Symptom: `Accepted job` + `Processing` then orchestrator startup again; no `Transcribed` or `Error processing`.

**Confirmed log signature (not OOM):**
```
Unable to load any of {libcudnn_ops.so.9.1.0, ...}
Invalid handle. Cannot load symbol cudnnCreateTensorDescriptor
```
`OOMKilled=false`, no `dmesg` OOM lines. Crash happens when **transformers Whisper** runs language detection on **CUDA** while Qwen + faster-whisper share GPU 1.

**Fix:** new AI image with `WHISPER_LANG_DEVICE=cpu` + updated compose (already in repo).

### 1. On DEV laptop — rebuild AI image

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
.\production-build\build-fixed-images.ps1 -BuildAiBase
```

Copy to prod: `production/images/05-ai.tar`, `docker-compose.prod.yml`, `.env`, `DEPLOY-RECOVERY.md`

### 2. On prod — load image and recreate (run from `production/`, not `volumes/models/`)

```bash
cd /home/suvadip/Call-Analysis/Project/production

docker load -i images/05-ai.tar

# Optional: extract missing faster-whisper CT2 weights from bundle
tar tzf models-bundle.tgz | grep -i faster-whisper | head
# If listed but folder missing:
./scripts/extract-model-bundles.sh --force
# OR partial:
# tar xzf models-bundle.tgz -C volumes/models

docker compose -f docker-compose.prod.yml up -d --force-recreate qwen
sleep 30
docker compose -f docker-compose.prod.yml up -d --force-recreate ai

# Lang detect should show device: cpu
docker exec ai_call_ai curl -s http://127.0.0.1:8000/health | python3 -m json.tool | grep -A5 language_detection

tail -f volumes/logs/ai/orchestrator_$(date +%Y-%m-%d).log
```

If still OOM (rare): set `QWEN_GPU_MEMORY_UTIL=0.15` in `.env` and recreate `qwen` + `ai` again.

```bash
docker inspect ai_call_ai --format 'OOMKilled={{.State.OOMKilled}}'
watch -n1 'nvidia-smi -i 1 --query-gpu=memory.used,memory.total --format=csv'
```
