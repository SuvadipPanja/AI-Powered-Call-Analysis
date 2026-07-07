# Session handoff — 7 Jul 2026 (full chat summary)

Handoff document for the next team or agentic system. Covers what was attempted, what was fixed, current prod state, and how dev → prod Docker workflow works.

---

## 1. What this chat covered (chronological)

| Topic | Status | Notes |
|-------|--------|-------|
| Create User page “Failed to create user” | **Fixed (earlier in chat)** | `LoginAlias` DB migration, clearer errors, tests, `sp-backend.tar` + `sp-frontend.tar` |
| Hold detection on Reports/Dashboard | **Wired (earlier)** | Backend hold-summary API, dashboard KPI, report columns |
| Number normalization (`9 8 5 triple 2 8 11 3 7` → mobile digits) | **Fixed in code** | `ai-mvp/transcript_format_worker.py`, 31+ tests, Dockerfile gate |
| Silero diarization on GPU only | **Fixed in code** | `SILERO_VAD_DEVICE=cuda`, model + waveform on GPU |
| GPU policy (ASR/LID/LLM on GPU; sentiment/emotion on CPU) | **Documented** | `env.gpu-asr-llm.template`, `verify-gpu-policy.sh` |
| Prod deploy of `sp-ai-stack.tar` | **User ran deploy** | Hotfix script succeeded; verify showed env warnings |
| Hold still “No agent hold detected” on cashback call | **Root cause found + fix built** | See §3 — **must re-process call** after new tar |
| `.env` copy-paste for prod | **Dev `production/.env` updated** | Section `# === AI stack hotfix Jul 2026 ===` at bottom |

---

## 2. Current stage (as of end of session)

### Code on dev (repo)

- **Hold fix:** `ai-mvp/hold_worker.py` — agent “thank you for speaking” after hold request no longer ends hold early (was causing ~5s duration &lt; 8s min → `Hold_Detected=No`).
- **Numbers:** triple/quadruple, literal digits, mobile `11` → `1,1` in `transcript_format_worker.py`.
- **Silero GPU:** `diarization_worker.py` + `SILERO_VAD_DEVICE=cuda`.
- **Tests:** `test_hold_detection.py` (16), `test_transcript_format.py` (31), `test_diarization_silero_device.py` — all passing locally before last tar build.
- **Build gate:** `services/sp-ai-base/Dockerfile` runs `test_hold_detection.py && test_transcript_format.py` at image build.

### Artifacts on dev laptop

| Artifact | Path | ~Size | When |
|----------|------|-------|------|
| AI stack tar (latest with hold fix) | `production/docker-images/sp-ai-stack.tar` | ~5.49 GB | 2026-07-07 ~20:04 |
| Dev env (copy to prod) | `production/.env` | — | Updated with hotfix section |
| Deploy script | `production/scripts/deploy-ai-stack-hotfix.sh` | — | |
| Verify hold | `production/scripts/verify-hold-prod.sh` | — | |
| Verify GPU | `production/scripts/verify-gpu-policy.sh` | — | |
| Env reference block | `production/env.prod-copy-paste.block` | — | Optional; full file is `production/.env` |

### Prod (user already deployed once)

- User ran `deploy-ai-stack-hotfix.sh` successfully (containers recreated).
- `verify-gpu-policy.sh`: warned `SILERO_VAD_DEVICE not set in .env` (before dev `.env` sync).
- UI still showed **No hold** on cashback call — expected if call was **not re-processed** after hold fix tar, OR old tar without thank-you skip was still in use.

### What prod still needs (checklist)

1. Copy **latest** `sp-ai-stack.tar` (20:04 build with hold fix) if not already loaded.
2. Copy **dev** `production/.env` → prod (includes `SILERO_VAD_DEVICE=cuda`, `HOLD_DETECTION_ENABLED=true`).
3. `sed -i 's/\r$//'` on scripts copied from Windows.
4. `bash scripts/deploy-ai-stack-hotfix.sh`
5. `bash scripts/verify-hold-prod.sh` and `verify-gpu-policy.sh`
6. **Re-process** the cashback / hold test call in Upload UI (Ctrl+Shift+R on result page).
7. Confirm logs: `docker logs sp_ai_controller 2>&1 | grep -i 'Hold detected=' | tail -5` → `Hold detected=Yes`.

---

## 3. Critical things to notice (avoid repeat failures)

### 3.1 Hold detection is transcript-based, not Silero

- Hold runs in **ai-controller** on **diarized English transcript** after translation/cleanup (`orchestrator.py` → `hold_worker.analyze_hold`).
- Silero GPU affects **diarization/VAD only**, not hold phrase logic.
- **`HOLD_DETECTION_ENABLED=true`** must be set (compose default is true; explicit in `.env` is safer).

### 3.2 Stale DB rows after deploy

- Deploying a new image **does not** re-run AI on old calls.
- `AI_Hold_*` columns stay old until user **re-processes** audio in UI.
- Always verify on a **freshly processed** call after hotfix.

### 3.3 Hold failure root cause (this session)

Prod transcript pattern:

1. Agent: “Can I put your call on hold for 2 minutes…”
2. Customer: “Hmm, absolutely.”
3. Agent: “Thank you sir, thank you for speaking…” ← **incorrectly ended hold**
4. ~83s gap
5. Agent returns with substantive line

Old logic measured hold until step 3 (~5s) &lt; `HOLD_MIN_GAP_AFTER_PHRASE_SEC` (8s) → episode rejected → UI “No hold detected”.

**Fix:** skip brief agent “hold setup” politeness lines in `_next_hold_end_sec`.

### 3.4 Number normalization

- Runs in pipeline **before** LLM cleanup (`format_transcript` / `transcript_format_worker.py`).
- Re-process required for old transcripts showing `9 8 5 triple 2 8 11 3 7`.

### 3.5 GPU / VRAM policy (user choice)

| Component | Device | Env |
|-----------|--------|-----|
| Whisper LID, NeMo, Seamless, Faster-Whisper, Silero VAD | GPU | `*_DEVICE=cuda` |
| LLM (Qwen3-14B) | GPU | `LLM_GPU_MEMORY_UTIL=0.38`, `GPU_DEVICE_ID=1` |
| Sentiment (HF transformers) | CPU | `SENTIMENT_BACKEND=transformers` |
| Tone (emotion2vec) | CPU | `EMOTION2VEC_DEVICE=cpu` |
| Concurrency | 1 job | `AI_MAX_CONCURRENT_JOBS=1`, etc. |

### 3.6 Windows → Linux scripts

- Shell scripts copied from Windows may have **CRLF** → bash fails on `set -euo pipefail`.
- Fix: `sed -i 's/\r$//' scripts/*.sh` before run, or use scripts with self-heal header (hotfix scripts have this).

### 3.7 Do not rebuild for unrelated hotfixes

- **Safe hotfix scope:** `frontend/**`, `backend/**`, `ai-mvp/**` → respective tars.
- **Do not touch** unless explicit: `AI/src/**`, `sp-llm`, model volumes, full GPU stack without regression plan.

---

## 4. How dev Docker images are built (AI stack)

### 4.1 Image naming (prod standard)

| Role | Image tag | Container name |
|------|-----------|----------------|
| AI orchestrator | `sp-ai-controller:prod` | `sp_ai_controller` |
| Whisper LID | `sp-ai-whisper-lang:prod` | `sp_ai_whisper_lang` |
| NeMo ASR | `sp-ai-nemo:prod` | `sp_ai_nemo` |
| Seamless M4T | `sp-ai-seamless-m4t:prod` | `sp_ai_seamless_m4t` |
| Shared base (not in tar alone) | `sp-ai-base:prod` | — |
| Frontend | `sp-frontend:prod` | `sp_frontend` |
| Backend | `sp-backend:prod` | `sp_backend` |
| LLM | `sp-llm:prod` | `sp_ai_llama` |

### 4.2 Build command (dev Windows)

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
powershell -ExecutionPolicy Bypass -File production-build\build-ai-stack.ps1
```

### 4.3 What the build does

1. **`sp-ai-base:prod`** — `services/sp-ai-base/Dockerfile`, context = repo root. Copies `ai-mvp/` sources (explicit file list, not whole folder — avoids Windows `.venv` symlinks). Runs **`test_hold_detection.py`** and **`test_transcript_format.py`** at build (fail = no image).
2. **`sp-ai-controller:prod`** — `services/sp-ai-controller/Dockerfile`, extends base, orchestrator entrypoint port **8000** inside container.
3. **Model services** — whisper-lang, nemo, seamless — thin Dockerfiles from `services/sp-ai-*`.
4. **`docker save`** — one tar with controller + 3 ASR/LID services (shared layers deduped):

   `production/docker-images/sp-ai-stack.tar`

**Prerequisite:** base image `ai-call-orchestrator:prod` must exist locally (from prior full AI build).

### 4.4 Frontend / backend tars (separate)

```powershell
# Frontend
cd frontend; npm run build
docker build -t sp-frontend:prod -f production-build/docker/Dockerfile.frontend-static.patch frontend
docker save -o production/docker-images/sp-frontend.tar sp-frontend:prod

# Backend — project-specific build script / Dockerfile under backend/
```

See `.cursor/rules/dev-deploy-workflow.mdc` for full prod naming table.

---

## 5. How `.env` and `docker-compose.yml` work together

### 5.1 Files on prod server

```
/home/suvadip/Call-Analysis/Project/production/
  .env                    # Master config (copy from dev; contains secrets)
  .env.container          # Generated by bootstrap-prod-secrets.sh (stripped secrets)
  docker-compose.yml      # Service definitions; ${VAR:-default} from .env
  secrets/                # license, DB password, tokens (from bootstrap)
  docker-images/          # sp-ai-stack.tar, sp-frontend.tar, etc.
  scripts/                # deploy-*.sh, verify-*.sh
  volumes/                # models, logs, audio
```

### 5.2 Flow

1. **`.env`** — human-edited on prod (or copied from dev). Keys like `NEMO_DEVICE=cuda`, `HOLD_DETECTION_ENABLED=true`, `SILERO_VAD_DEVICE=cuda`, DB host, `GPU_DEVICE_ID`, LLM paths.
2. **`bootstrap-prod-secrets.sh`** — reads `.env`, writes `secrets/*` and `.env.container` for containers (no raw secrets in compose file).
3. **`docker compose`** — substitutes `${VAR}` from `.env` into `environment:` blocks in `docker-compose.yml`.
4. **Recreate** — `docker compose up -d --force-recreate ai-controller` picks up new image + env.

### 5.3 Hotfix env block (in dev `production/.env`)

```env
# === AI stack hotfix Jul 2026 (hold + Silero GPU) ===
HOLD_DETECTION_ENABLED=true
SILERO_VAD_DEVICE=cuda
WHISPER_LANG_DEVICE=cuda
NEMO_DEVICE=cuda
SEAMLESS_M4T_DEVICE=cuda
FASTER_WHISPER_DEVICE=cuda
EMOTION2VEC_DEVICE=cpu
SENTIMENT_BACKEND=transformers
TRANSCRIPT_FORMAT_NUMBERS_ENABLED=true
AI_MAX_CONCURRENT_JOBS=1
ASR_CHUNK_PARALLELISM=1
UPLOAD_QUEUE_CONCURRENCY=1
```

Copy entire **`production/.env`** from dev to prod via WinSCP (preserves all secrets + this block).

---

## 6. How tar is made and deployed to prod

### 6.1 Dev: create tar

```powershell
powershell -ExecutionPolicy Bypass -File production-build\build-ai-stack.ps1
# Output: production\docker-images\sp-ai-stack.tar (~5.5 GB)
```

### 6.2 Copy to prod (WinSCP)

| From (dev) | To (prod) |
|------------|-----------|
| `production\docker-images\sp-ai-stack.tar` | `.../production/docker-images/sp-ai-stack.tar` |
| `production\.env` | `.../production/.env` |
| `production\scripts\deploy-ai-stack-hotfix.sh` | `.../production/scripts/` |
| `production\scripts\verify-hold-prod.sh` | `.../production/scripts/` |
| `production\scripts\verify-gpu-policy.sh` | `.../production/scripts/` |

### 6.3 Prod: load and run

```bash
cd /home/suvadip/Call-Analysis/Project/production

# CRLF fix (Windows copies)
sed -i 's/\r$//' scripts/deploy-ai-stack-hotfix.sh scripts/verify-hold-prod.sh scripts/verify-gpu-policy.sh
chmod +x scripts/deploy-ai-stack-hotfix.sh scripts/verify-hold-prod.sh scripts/verify-gpu-policy.sh

# Secrets sync + load tar + recreate controller
bash scripts/bootstrap-prod-secrets.sh   # if .env changed
bash scripts/deploy-ai-stack-hotfix.sh

# Verify
bash scripts/verify-hold-prod.sh
bash scripts/verify-gpu-policy.sh
docker exec sp_ai_controller python test_hold_detection.py
```

### 6.4 Confirm hold on a call

```bash
docker logs sp_ai_controller 2>&1 | grep -i 'Hold detected=' | tail -10
```

In UI: re-process call → Result → Intelligence → **Agent Hold Time** should show Yes + duration ~80–90s for cashback scenario.

---

## 7. How to test on dev (before any tar)

```powershell
cd "C:\Project\AI-Powered Call Analysis project\ai-mvp"
python -m pytest test_hold_detection.py test_transcript_format.py test_diarization_silero_device.py -q
```

Backend/frontend (when touched):

```powershell
cd backend; npm test
cd frontend; npm test; npm run build
```

---

## 8. Key source files (for next agent)

| Area | Path |
|------|------|
| Hold detection | `ai-mvp/hold_worker.py`, `ai-mvp/test_hold_detection.py` |
| Number format | `ai-mvp/transcript_format_worker.py`, `ai-mvp/test_transcript_format.py` |
| Silero GPU | `ai-mvp/diarization_worker.py`, `ai-mvp/config.py` |
| Pipeline order | `ai-mvp/orchestrator.py` (hold after intelligence, before taboo) |
| DB hold columns | `ai-mvp/db.py`, `backend/migrations/006_hold_time.sql`, `backend/services/dbMigrate.js` |
| UI hold display | `frontend/src/components/result/tabs/ResultIntelligenceTab.jsx` |
| Compose | `production/docker-compose.yml` |
| AI base Dockerfile | `services/sp-ai-base/Dockerfile` |
| Build script | `production-build/build-ai-stack.ps1` |

---

## 9. Known gaps / not done in this chat

- Part B GPU template exists but prod `.env` may still need manual merge if user didn’t copy latest dev `.env`.
- User may not have loaded **20:04** tar with hold thank-you fix if only earlier tar was deployed.
- Full regression on prod golden calls (hold, English, Hindi, PNB mobile number) — user-side after re-process.
- No git commit requested; many files may be untracked locally.
- Subagent API quota errors occurred mid-session; some work completed in foreground.

---

## 10. One-page prod recovery (if next system only reads one section)

```bash
cd /home/suvadip/Call-Analysis/Project/production
# 1. Ensure .env has HOLD_DETECTION_ENABLED=true and SILERO_VAD_DEVICE=cuda
# 2. Load latest sp-ai-stack.tar from dev
docker load -i docker-images/sp-ai-stack.tar
docker compose up -d --force-recreate ai-controller
bash scripts/verify-hold-prod.sh
# 3. Re-process test call in UI — mandatory
# 4. Expect: Hold detected=Yes, mobile numbers normalized on new runs
```

---

*Generated for handoff to another agentic system. Project: AI-Powered Call Analysis. Date: 2026-07-07.*
