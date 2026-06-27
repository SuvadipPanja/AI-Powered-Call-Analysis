# Production Runbook — AI-Powered Call Analysis

> **Purpose:** Single source of truth for how this production bundle was built, how it runs on prod, and how to debug it.  
> **Audience:** Humans + AI agents — read this **first** when production behavior differs from dev.  
> **Last updated:** 2026-06-27  
> **Current layout:** See [`STRUCTURE.md`](STRUCTURE.md) — `docker-compose.yml`, `docker-images/sp-*.tar`, service `llm` (not `qwen`), Llama AWQ (not Qwen3-4B).
> **Target server:** `10.64.194.130` (offline Linux, **2× NVIDIA L40S**, use **GPU 1 only**, no domain)

---

## 1. Two worlds: dev laptop vs production Docker

| Topic | Dev laptop (`ai-mvp/`) | Production Docker (`production/`) |
|-------|------------------------|-----------------------------------|
| LLM (scoring, translation, enrichment) | **Ollama** (`localhost:11434`) | **Qwen3-4B** via **vLLM** container (`qwen:8001`) |
| AI orchestrator entry | `python orchestrator.py` | `run_orchestrator_prod.py` (patch then orchestrator) |
| Source change for prod LLM | **None** in `ai-mvp/` | Overlay in `production-build/ai-overlay/` baked into `05-ai.tar` |
| Batch auto-upload | Backend + Admin UI | Same — **no** separate AutoUpload container |
| Database | Local SQL Server / Windows auth | SQL Server in Docker, restore from `backup.bak` |
| Transcription | Same pipeline code | Same code in `05-ai.tar`, models from `models-bundle.tgz` |

**Rule:** Fixing prod LLM/scoring does **not** require editing dev `scoring_worker.py` unless the bug is in shared logic. Prod-only LLM routing is in the overlay + compose env.

---

## 2. Repository layout (what lives where)

```
project-root/
├── production/              ← OFFLINE DEPLOY BUNDLE (copy to prod server)
│   ├── PRODUCTION-RUNBOOK.md   ← THIS FILE
│   ├── docker-compose.yml
│   ├── docker-images/sp-*.tar
│   ├── model-bundles/*.tar
│   ├── license/license.lic
│   └── scripts/                ← deploy only (01–03, backup-db)
│
├── production-build/        ← REBUILD SOURCES (NOT copied to prod)
│   ├── ai-overlay/             ← Qwen/vLLM patch for orchestrator
│   └── docker/Dockerfile.orchestrator.prod
│
├── ai-mvp/                  ← Dev orchestrator (unchanged for prod)
├── backend/                 ← Baked into 02-backend.tar
├── frontend/                ← Baked into 03-frontend.tar
├── Database/                ← backup.bak + Dockerfile → 01-db.tar
└── docs/                    ← Optional planning docs
```

---

## 3. Production bundle contents

### 3.1 Docker images (`production/images/`)

| Archive | Image tag | What is inside |
|---------|-----------|----------------|
| `01-db.tar` | `call-analysis-db:prod` | SQL Server 2022 + `Database/backup.bak`. First start restores `call_analysis_db`. |
| `02-backend.tar` | `ai-call-backend:prod` | Node API, WebSocket, license check, **integrated auto-upload service**, calls AI. |
| `03-frontend.tar` | `ai-powered-call-analysis-frontend:prod` | React + Nginx. Built with `PUBLIC_HOST` → API `http://10.64.194.130:5000`. |
| `04-redis.tar` | `redis:7-alpine` | Cache/sessions. |
| `05-ai.tar` | `ai-call-orchestrator:prod` | NeMo GPU base + **prod LLM overlay**. Transcription pipeline. |
| `06-qwen-vllm.tar` | `vllm/vllm-openai:latest` | Serves Qwen3-4B OpenAI API on port 8001 inside container. |

**Removed:** `07-autoupload.tar` — legacy standalone uploader; replaced by backend + Admin UI.

### 3.2 Model bundles (extract before `compose up`)

| Bundle | Extract to | Contents |
|--------|------------|----------|
| `models-bundle.tgz` (~19 GB) | `volumes/models/` | `Whisper-large-v3/` (language detection), `faster-whisper-large-v3/`, `nemo/stt_hi_conformer_ctc_medium.nemo`, `nemo/parakeet-rnnt-1.1b.nemo` |
| `qwen-model-bundle.tgz` (~12 GB) | `volumes/models/` | `Qwen3-4B/` (same folder as ASR models) |

### 3.3 Deploy scripts

| Script | When | Action |
|--------|------|--------|
| **`deploy.sh`** | **First deploy / refresh** | **Master script:** preflight → folders → extract models → load images → verify → GPU check. You run `compose up` manually (or pass `--with-up`). |
| `extract-model-bundles.sh` | Called by deploy | Extract `models-bundle.tgz` + `qwen-model-bundle.tgz` (skips if already present) |
| `01-create-folders.sh` | Called by deploy | Creates `volumes/*` incl. `profile_pictures`, `branding`; backfills `.env` upload paths |
| `validate-prod-layout.sh` | Called by deploy | Verifies host folders, compose mounts, `.env` `PROFILE_PICS_DIR` / `BRANDING_DIR` |
| `02-load-images.sh` | Called by deploy | `docker load` from `docker-images/` (legacy `images/` supported) |
| `03-up.sh` | Optional (`--with-up`) | GPU preflight + `docker compose up -d` |
| `backup-db.sh` | Optional | Backup running DB to `production/backup/` |

---

## 4. How images were built (build machine — Windows/WSL)

Build sources live in **`production-build/`**, not in the deploy bundle.

### 4.1 Database image

```bash
# Requires Database/backup.bak (SQL backup of call_analysis_db)
docker build -t call-analysis-db:prod Database/
docker save -o production/images/01-db.tar call-analysis-db:prod
```

- `Database/Dockerfile` copies `backup.bak` into image.
- `Database/entrypoint.sh` restores DB **only if** `call_analysis_db` does not exist (fresh `dbdata` volume).

### 4.2 Backend & frontend

```bash
docker build -t ai-call-backend:prod backend/

# Frontend bakes PUBLIC_HOST at build time:
# frontend/.env.production.local → REACT_APP_API_BASE_URL=http://10.64.194.130:5000
docker build -t ai-powered-call-analysis-frontend:prod frontend/
```

### 4.3 AI orchestrator (two-stage — dev code + prod overlay)

```bash
# Stage 1: GPU base (same as dev Dockerfile.gpu, CMD orchestrator.py)
docker build -t ai-orchestrator-gpu-base:prod -f ai-mvp/Dockerfile.gpu ai-mvp

# Stage 2: Prod overlay (Qwen patch only)
docker build -t ai-call-orchestrator:prod \
  -f production-build/docker/Dockerfile.orchestrator.prod .

docker save -o production/images/05-ai.tar ai-call-orchestrator:prod
```

**Prod overlay files** (`production-build/ai-overlay/`):

- `bootstrap_prod_llm.py` — if `LLM_BACKEND=openai`, replaces `scoring_worker.ollama_generate` / `ollama_health` with OpenAI client.
- `llm_openai_backend.py` — HTTP client to `http://qwen:8001/v1/chat/completions`.
- `run_orchestrator_prod.py` — runs bootstrap **in same process**, then `runpy.run_module("orchestrator")`.

**Dev `ai-mvp/` is NOT modified** for production LLM.

### 4.4 vLLM (Qwen server)

```bash
docker pull vllm/vllm-openai:latest
docker save -o production/images/06-qwen-vllm.tar vllm/vllm-openai:latest
```

### 4.5 Model bundles (build machine, internet once)

- ASR: package from `models/` → `models-bundle.tgz`
- LLM: `git clone` + `git lfs pull` for `Qwen/Qwen3-4B` → `qwen-model-bundle.tgz`

---

## 5. Credentials & secrets (`production/.env`)

| Variable | Purpose | Prod value (as configured) |
|----------|---------|----------------------------|
| `PUBLIC_HOST` | Baked into frontend at build | `10.64.194.130` |
| `SA_PASSWORD` | SQL Server SA | `S@039039820p` |
| `HOST_MAC` | License MAC lock | `8c:84:74:6b:08:7e` |
| `LICENSE_SECRET_KEY` | License decode (32 chars) | `091ad9dc7953999521d5385ee61e3b83` |
| `CORS_ORIGIN` | Browser origin | `http://10.64.194.130:8081` |
| `ORCHESTRATOR_SECRET` | Backend → AI auth header | 64-hex (see `.env`) |
| `CALLBACK_SECRET` | AI callbacks | 64-hex |
| `SERVICE_TOKEN` | Optional service auth | 64-hex |
| `AI_MAIN_URL` | Backend → orchestrator | `http://ai:8000` |
| `REDIS_URL` | Backend cache | `redis://redis:6379` |
| `QWEN_SERVED_NAME` | vLLM model name | `Qwen3-4B` |
| `QWEN_MODEL_PATH` | Path inside qwen container | `/models/Qwen3-4B` |
| `QWEN_GPU_MEMORY_UTIL` | vLLM VRAM fraction | `0.25` (shared GPU) |
| `OPENAI_API_KEY` | Placeholder for vLLM | `local-prod` |

**Never commit `.env` or `license.lic` to git.**

---

## 6. Running stack — containers, ports, volumes

### 6.1 External ports (host → LAN/browser)

| Port | Service | Use |
|------|---------|-----|
| **8081** | frontend | Web UI |
| **5000** | backend | REST API |
| **8080** | backend | WebSocket |

### 6.2 Internal only (Docker network)

| Service | Port | Role |
|---------|------|------|
| db | 1433 | SQL Server |
| redis | 6379 | Redis |
| ai | 8000 | Orchestrator |
| qwen | 8001 | vLLM OpenAI API |

### 6.3 Volume mounts (host → container)

| Host path | Container(s) | Purpose |
|-----------|--------------|---------|
| `volumes/audio` | backend, ai | Uploaded/processed WAV files |
| `volumes/batch/metadata` | backend | Batch CSV parent (Admin auto-upload) |
| `volumes/batch/audio` | backend | Batch audio parent |
| `volumes/chat` | backend | Chat dump exports |
| `volumes/profile_pictures` | backend | User profile photos (persist across restart) |
| `volumes/branding` | backend | Admin app logo (persist across restart) |
| `volumes/models` | backend, ai, llm | ASR + Llama AWQ (all models) |
| `volumes/logs`, `volumes/work` | backend, ai | Logs, temp work |
| `license/` | backend | `license.lic` |
| Docker volume `dbdata` | db | Persistent SQL data |
| Docker volume `redisdata` | redis | Redis persistence |

### 6.4 Docker isolation (shared host with other stacks)

This stack is isolated from other teams' Docker applications:

| Setting | Value | Purpose |
|---------|-------|---------|
| `COMPOSE_PROJECT_NAME` | `call-analysis-prod` | Unique Compose project prefix |
| `DOCKER_NETWORK_NAME` | `call-analysis-prod-net` | Dedicated bridge — **not** shared with other compose files |
| Container names | `ai_call_*` | Fixed names, no generic `redis`/`backend` collisions |
| Volumes | `call-analysis-prod-dbdata`, `call-analysis-prod-redisdata` | Named volumes — won't attach to other projects |
| Host ports | `8081`, `5000`, `8080` (override via `.env` if clash) | Only this stack publishes these ports |

Internal DNS (`db`, `redis`, `ai`, `qwen`, `backend`) resolves **only** inside `call-analysis-prod-net`.

### 6.5 GPU allocation (dual-GPU server)

| Host GPU | Use |
|----------|-----|
| **GPU 0** | Reserved — other team application (do not use) |
| **GPU 1** | **This stack** — `ai` (NeMo/Whisper) + `qwen` (vLLM) share this device |

Configure in `.env`:

```bash
GPU_DEVICE_ID=1
```

Compose passes `device_ids: ["1"]` and `NVIDIA_VISIBLE_DEVICES=1` to **both** `ai` and `qwen`. Inside each container the GPU appears as `cuda:0` (normal NVIDIA remapping).

Verify on prod:

```bash
nvidia-smi -i 1          # should show ai_call / python only after stack is up
nvidia-smi -i 0          # other team — leave untouched
docker compose -f docker-compose.prod.yml logs qwen | tail
```

If OOM on GPU 1, lower `QWEN_GPU_MEMORY_UTIL` (e.g. `0.20`) — both services share the same physical card.

---

## 7. End-to-end request flows

### 7.1 User login & app

```
Browser → http://10.64.194.130:8081 (frontend/nginx, static React)
Browser → http://10.64.194.130:5000/api/* (backend)
Browser → ws://10.64.194.130:8080 (live progress)
Backend → db:1433 (call_analysis_db)
Backend → redis:6379
Backend validates license (HOST_MAC + license.lic + LICENSE_SECRET_KEY)
```

### 7.2 Manual audio upload + AI processing

```
1. User uploads WAV via UI
2. Backend saves to volumes/audio (AUDIO_UPLOAD_DIR=/app/data/Sample_Audio)
3. Backend inserts AudioUploads row
4. Backend POST http://ai:8000/process-audio  { audioFile }
   Header: X-Orchestrator-Secret: ORCHESTRATOR_SECRET
5. ai container — process_audio_job() in background thread
```

### 7.3 AI pipeline inside `ai` container (transcription)

Code: `ai-mvp/transcribe.py`, `orchestrator.py` (unchanged logic in prod image).

```
Audio file
  → Diarization (Silero VAD, stereo Agent/Customer)
  → Language detection: Whisper Large V3 ONLY (language_worker.py)
       Path: /models/Whisper-large-v3
  → Transcription per chunk (backend = faster-whisper by default in prod):
       • faster-whisper large-v3 → /models/faster-whisper-large-v3
       • OR NeMo if TRANSCRIBE_BACKEND=nemo:
           Hindi  → stt_hi_conformer_ctc_medium.nemo
           English → parakeet-rnnt-1.1b.nemo
  → Result: transcript + language + duration
```

Prod compose sets `NEMO_DEVICE=cuda`. Default `TRANSCRIBE_BACKEND` in image env is **auto** → prefers faster-whisper if models present.

### 7.4 AI pipeline — LLM steps (Qwen on prod, Ollama on dev)

After transcription, in `orchestrator.py`:

```
If Hindi/other → translation_worker → calls scoring_worker.ollama_generate
                 (prod: patched to OpenAI → qwen:8001)

If SCORING_ENABLED → score_call() → qwen (JSON scoring)

If ENRICHMENT_ENABLED → enrich_call() → qwen (sentiment, tone, script)

Results → upsert_scoring_result / upsert_transcription_result → db:1433
Progress → update_processing_progress → backend/WS can poll
```

**Prod LLM path:**

```
ai container
  LLM_BACKEND=openai
  OPENAI_BASE_URL=http://qwen:8001/v1
  OPENAI_MODEL=Qwen3-4B
    ↓ HTTP POST /v1/chat/completions
qwen container (vLLM)
  loads Qwen3-4B from /models/qwen/Qwen3-4B
  GPU memory util: QWEN_GPU_MEMORY_UTIL=0.25
```

### 7.5 Batch auto-upload (integrated — no extra container)

```
Super Admin → Admin Settings → Auto Upload panel (frontend)
  → PUT/POST /api/admin/auto-upload/*
Backend autoUploadService.js:
  → Read CSV from metadataParentPath (configure: /app/data/batch_metadata)
  → Copy audio from audioParentPath (/app/data/batch_audio)
  → Copy to Sample_Audio, INSERT AudioUploads
  → executePythonScript() → same AI path as manual upload
  → Optional cron via initAutoUpload() on backend startup
```

Host drop layout:

```
volumes/batch/metadata/<DD_MM_YYYY>/metadata_DD_MM_YYYY.csv
volumes/batch/audio/<DD_MM_YYYY>/*.wav
```

---

## 8. Database: backup, restore, refresh

### 8.1 First deploy

- Empty Docker volume `dbdata` → `entrypoint.sh` restores from `backup.bak` in image.
- **All data from build-time backup** appears (users, history, settings).

### 8.2 After prod is live

- Data persists in **`dbdata`** volume across restarts.
- `docker compose down` **without** `-v` keeps data.
- `docker compose down -v` **wipes DB** → next start re-restores from old backup in image.

### 8.3 Take new backup on prod

```bash
./scripts/backup-db.sh
# → production/backup/call_analysis_YYYYMMDD_HHMMSS.bak
```

### 8.4 Refresh data baked into `01-db.tar` (on build machine)

```bash
cp production/backup/call_analysis_*.bak Database/backup.bak
docker build -t call-analysis-db:prod Database/
docker save -o production/images/01-db.tar call-analysis-db:prod
```

---

## 9. Deploy procedure (prod server, offline)

### 9.1 One-command prep (recommended)

```bash
cd /opt/call-analysis/production
./deploy.sh
```

This orchestrates:

1. CRLF fix + `chmod +x` on all scripts  
2. Preflight: `docker`, `docker compose`, bundles, image tars, `.env`, license  
3. `01-create-folders.sh`  
4. `extract-model-bundles.sh` → `volumes/models` (ASR + Qwen)  
5. `02-load-images.sh`  
6. Verify compose image tags exist  
7. GPU / nvidia-container-toolkit warning  

Then **you** start the stack:

```bash
docker compose -f docker-compose.prod.yml up -d
```

Flags:

| Flag | Effect |
|------|--------|
| `--force-models` | Re-extract both model bundles |
| `--skip-load` | Skip `docker load` (images already on host) |
| `--with-up` | Also run `03-up.sh` (compose up -d) |

### 9.2 Manual step-by-step

```bash
cd /opt/call-analysis/production
sed -i 's/\r$//' scripts/*.sh && chmod +x scripts/*.sh

./scripts/01-create-folders.sh
./scripts/extract-model-bundles.sh
./scripts/02-load-images.sh
docker compose -f docker-compose.prod.yml up -d
```

**First-time Admin setup:** Auto Upload paths → `/app/data/batch_metadata`, `/app/data/batch_audio`.

**Verify:**

```bash
docker compose -f docker-compose.prod.yml ps
docker compose logs db | tail      # "Database restore complete"
docker compose logs qwen | tail    # model loaded
docker compose logs ai | tail      # ASR ready, scoring ready
curl -s -o /dev/null -w "%{http_code}" http://10.64.194.130:5000/...
```

---

## 10. Production readiness checklist

| Item | Status |
|------|--------|
| 6 images exported | Yes |
| ASR + LLM bundles | Yes |
| `.env` + license configured | Yes |
| Frontend IP baked | `10.64.194.130` |
| GPU + nvidia-container-toolkit on prod | **Must verify on server** |
| GPU 1 only (`GPU_DEVICE_ID=1`) | Configured — GPU 0 for other team |
| Docker network/volumes isolated | `call-analysis-prod-net` + named volumes |
| GPU 1 shared ai+qwen | **Risk: OOM** — tune `QWEN_GPU_MEMORY_UTIL` |
| HTTPS | Not configured (HTTP only) |
| End-to-end test on prod hardware | **Recommended before go-live** |

---

## 11. Debugging guide (for agents & operators)

When user reports **"X not working in production"**, check in order:

| Symptom | Likely cause | Where to look |
|---------|--------------|---------------|
| Login/CORS error | `CORS_ORIGIN` mismatch | `.env`, browser URL must be `:8081` |
| API calls localhost | Frontend rebuilt wrong `PUBLIC_HOST` | Rebuild `03-frontend.tar` |
| License invalid | MAC / key / file mismatch | `HOST_MAC`, `license.lic`, `LICENSE_SECRET_KEY` |
| DB connection fail | SA password, db not healthy | `docker compose logs db`, `SA_PASSWORD` |
| AI never starts | Orchestrator secret, ai down | `AI_MAIN_URL`, `ORCHESTRATOR_SECRET`, `logs ai` |
| Transcription fail | Models not extracted | `volumes/models`, `logs ai` |
| Scoring/translation fail | qwen not ready, wrong model path | `logs qwen`, `QWEN_MODEL_PATH`, `volumes/models/Qwen3-4B` |
| GPU OOM | ai + qwen share GPU 1 | Lower `QWEN_GPU_MEMORY_UTIL`, check `nvidia-smi -i 1` |
| Wrong GPU used | `GPU_DEVICE_ID` missing/wrong | Set `GPU_DEVICE_ID=1` in `.env`, recreate ai+qwen |
| Batch upload no files | Wrong Admin paths | `/app/data/batch_metadata`, host `volumes/batch/` |
| Empty License History | DB restore / wrong DB | `dbdata` volume, restore logs |
| Dev works, prod doesn't | Ollama vs Qwen, overlay, paths | Compare §1 and §7 |

**Log commands:**

```bash
docker compose -f docker-compose.prod.yml logs -f backend
docker compose -f docker-compose.prod.yml logs -f ai
docker compose -f docker-compose.prod.yml logs -f qwen
docker compose -f docker-compose.prod.yml logs -f db
```

---

## 12. Change log (update this section when fixing prod issues)

| Date | Change | Notes |
|------|--------|-------|
| 2026-06-19 | Initial production bundle | 7 images, Ollama planned |
| 2026-06-20 | Switched LLM to Qwen3-4B + vLLM | Removed Ollama; overlay in `production-build/` |
| 2026-06-20 | Removed `07-autoupload` container | Batch upload via backend + Admin UI only |
| 2026-06-20 | Added batch volume mounts to backend | `volumes/batch/` → `/app/data/batch_*` |
| 2026-06-20 | Created this runbook | `PRODUCTION-RUNBOOK.md` |
| 2026-06-21 | Dual-GPU isolation | `GPU_DEVICE_ID=1`, named network/volumes, compose project name |
| 2026-06-21 | Deploy recovery doc | `DEPLOY-RECOVERY.md` — CRLF, Qwen path, backend env, AI Python fix |
| 2026-06-22 | Single models folder | All weights under `volumes/models/` (Qwen + ASR); qwen mounts same path |
| 2026-06-27 | Profile pics + branding persistence | Host `volumes/profile_pictures`, `volumes/branding`; compose mounts + `validate-prod-layout.sh`; SP image layout in `docker-images/` |

---

## 13. Agent instructions

When asked to fix production issues:

1. Read **this file** completely.
2. Confirm which layer: frontend / backend / db / ai / qwen / volumes / `.env`.
3. Do **not** change dev `ai-mvp` Ollama setup unless the bug is in shared Python logic.
4. Prod LLM changes → `production-build/ai-overlay/` + rebuild `05-ai.tar`.
5. After any fix, update **§12 Change log** and relevant sections in this file.
