# Step-by-step — cuDNN crash fix (AI restarts ~6s after Processing)

**Root cause:** transformers Whisper language detection on CUDA crashes with `libcudnn_ops` / `cudnnCreateTensorDescriptor`. Fix: `WHISPER_LANG_DEVICE=cpu` in new AI image.

**Dev laptop status:** `production/images/05-ai.tar` rebuilt (~10 GB, includes fix).

---

## PART A — On your Windows dev laptop (done / verify)

### Step 1 — Confirm the new image file exists

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
Get-Item production\images\05-ai.tar | Select-Object Name, @{N='GB';E={[math]::Round($_.Length/1GB,2)}}, LastWriteTime
```

Expected: **~10 GB**, modified **today**.

### Step 2 — Copy these files to prod via WinSCP (or USB)

| Copy FROM (dev laptop) | Copy TO (prod server) |
|------------------------|------------------------|
| `production\images\05-ai.tar` | `/home/suvadip/Call-Analysis/Project/production/images/05-ai.tar` |
| `production\docker-compose.prod.yml` | `.../production/docker-compose.prod.yml` |
| `production\.env` | `.../production/.env` |
| `production\DEPLOY-RECOVERY.md` | `.../production/DEPLOY-RECOVERY.md` |
| `production\scripts\extract-model-bundles.sh` | `.../production/scripts/extract-model-bundles.sh` |

**Do not copy** `models-bundle.tgz` again unless you need to re-extract models.

---

## PART B — On prod server (Linux)

### Step 3 — Go to the production folder

```bash
cd /home/suvadip/Call-Analysis/Project/production
```

**Important:** always run `docker compose` from this folder, **not** from `volumes/models/`.

### Step 4 — Fix ALL script line endings (CRLF from Windows)

```bash
sed -i 's/\r$//' deploy.sh fix-line-endings.sh scripts/*.sh scripts/lib/*.sh
chmod +x deploy.sh fix-line-endings.sh scripts/*.sh
```

Or: `sh fix-line-endings.sh`

### Step 5 — ASR models (faster-whisper folder optional)

Your `models-bundle.tgz` has **Whisper-large-v3** but **no** `faster-whisper-large-v3` CT2 folder — that is OK.
faster-whisper uses `large-v3` from `/models` cache at runtime.

Verify you already have:

```bash
ls volumes/models/
# Need: Whisper-large-v3  nemo  Qwen3-4B
```

Only re-extract if something is missing:

```bash
./scripts/extract-model-bundles.sh --force
```

### Step 6 — Load the new AI image

```bash
docker load -i images/05-ai.tar
```

Expected line: `Loaded image: ai-call-orchestrator:prod`

### Step 7 — Recreate qwen, then ai

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen
sleep 45
docker compose -f docker-compose.prod.yml up -d --force-recreate ai
sleep 20
docker compose -f docker-compose.prod.yml ps
```

All services should show **Up**.

### Step 8 — Verify health (language detect on CPU)

```bash
docker exec ai_call_ai curl -s http://127.0.0.1:8000/health | python3 -m json.tool | grep -A6 language_detection
```

Expected:

```json
"language_detection": {
    "device": "cpu",
    "ready": true,
    ...
}
```

### Step 9 — Test one call upload

1. Open UI: `http://10.64.194.130:8081`
2. Upload a short call file
3. In a second SSH session:

```bash
tail -f volumes/logs/ai/orchestrator_$(date +%Y-%m-%d).log
```

Expected log sequence (no container restart):

```
Accepted job: ...
Processing: ...
Transcribed ... chunks=...
```

Or watch:

```bash
docker logs -f ai_call_ai 2>&1 | grep -iE "Processing|Transcribed|Error|Complete"
```

### Step 10 — If it still crashes

```bash
docker logs ai_call_ai --tail 80
docker inspect ai_call_ai --format 'OOMKilled={{.State.OOMKilled}}'
```

Lower Qwen GPU use in `.env`:

```bash
QWEN_GPU_MEMORY_UTIL=0.15
```

Then:

```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen ai
```

---

## Quick reference

| Problem | Fix |
|---------|-----|
| `docker compose` file not found | `cd /home/suvadip/Call-Analysis/Project/production` |
| `faster-whisper-large-v3` missing | `./scripts/extract-model-bundles.sh --force` |
| `language_detection.device` still `cuda` | Reload `05-ai.tar` + recreate `ai` |
| Stuck at 35% but logs show `Transcribed` | Normal for long calls — wait for scoring |
| cuDNN error in logs | Old image still running — repeat Steps 6–7 |
