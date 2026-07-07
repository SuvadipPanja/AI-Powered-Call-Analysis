# AI Stack — Ops Runbook (distributed architecture, 2026-07-02)

Spec: `docs/AI-STACK-SPEC.md` (frozen). Backup of the previous monolith:
`backup-2026-07-02/` + docker tags `*:backup-20260702`.

## Architecture

| Compose service | Container | Image | Port | Model(s) / role |
|---|---|---|---|---|
| `ai-controller` | `sp_ai_controller` | `sp-ai-controller:prod` | 8000 (alias `ai`) | Pipeline orchestrator: chunking, diarization, WPM, DB, enrichment, taboo, callbacks; local fallback models |
| `ai-whisper-lang` | `sp_ai_whisper_lang` | `sp-ai-whisper-lang:prod` | 8010 | Whisper-large-v3 LID + IndicLID + chunk-vote language detection |
| `ai-nemo` | `sp_ai_nemo` | `sp-ai-nemo:prod` | 8020 | NeMo: parakeet-rnnt-1.1b (English) + stt_hi_conformer_ctc_medium (Hindi) |
| `ai-seamless` | `sp_ai_seamless_m4t` | `sp-ai-seamless-m4t:prod` | 8030 | SeamlessM4T v2 large (Hindi/Bengali/regional ASR) |
| `llm` | `sp_ai_llama` | `sp-llm:prod` | 8001 (alias `llm`) | vLLM **Qwen3-8B-AWQ** (shared-GPU default) — Qwen3-14B / Llama kept in `volumes/models/` for rollback |

**Shared-GPU prod defaults (2026-07):**
- **LLM = Qwen3-8B-AWQ** (`env.qwen3-8b.template`, util `0.38`, `LLM_MAX_MODEL_LEN=6144`)
- **Sentiment** = CPU HuggingFace (`SENTIMENT_BACKEND=transformers`) — fewer LLM bursts per call
- **NeMo preload** = English only (`AI_NEMO_PRELOAD_LANGUAGES=English`) — Hindi/Bengali still use Seamless
- Language detection on **GPU** (`WHISPER_LANG_DEVICE=cuda`); tone on CPU (`EMOTION2VEC_DEVICE=cpu`)
- **Transcription is unchanged** — NeMo + Seamless ASR; LLM only affects cleanup/scoring/intelligence

For max accuracy on a **dedicated** GPU, switch to Qwen3-14B in `.env` (see `.env.example` preset).

| `db` / `redis` / `backend` / `frontend` | sp_db / sp_redis / sp_backend / sp_frontend | unchanged | | |

Backend reaches the AI stack at `AI_MAIN_URL=http://ai:8000`; the controller reaches vLLM at `http://llm:8001/v1`. All model services load eagerly at startup (first boot: several minutes).

## Qwen3-8B deploy (shared GPU with another team)

Copy from dev: `env.qwen3-8b.template` → `production/.env` (keep your secrets), then:

```bash
cd /home/suvadip/Call-Analysis/Project/production
ls volumes/models/Qwen3-8B-AWQ/config.json
bash scripts/deploy-qwen3-8b.sh
```

Or manually:

```bash
bash scripts/bootstrap-prod-secrets.sh
docker compose up -d --force-recreate llm          # wait healthy 5–8 min
docker compose up -d --force-recreate ai-nemo ai-controller
nvidia-smi -i "${GPU_DEVICE_ID:-1}"
bash scripts/verify-qwen3-8b-prod.sh
```

After deploy, re-process sample calls and check UI (see **Verification** below).

## Start / stop

```bash
cd /home/suvadip/Call-Analysis/Project/production

docker compose up -d                      # whole stack
docker compose stop                       # stop all (keeps containers)
docker compose down                       # remove containers (volumes persist)

# AI stack only:
docker compose up -d ai-whisper-lang ai-nemo ai-seamless ai-controller
docker compose restart ai-controller      # restart just the controller
```

Full deploy from copied files: `bash scripts/deploy-prod.sh`
(loads tars, extracts models, starts llm first, then app + AI services).

## Health checks

```bash
docker compose ps          # STATUS column shows (healthy) / (health: starting)

docker exec sp_ai_controller   curl -s http://localhost:8000/health   # aggregates downstream
docker exec sp_ai_whisper_lang curl -s http://localhost:8010/health
docker exec sp_ai_nemo         curl -s http://localhost:8020/health
docker exec sp_ai_seamless_m4t curl -s http://localhost:8030/health
docker exec sp_ai_llama python3 -c "import urllib.request;print(urllib.request.urlopen('http://127.0.0.1:8001/v1/models',timeout=5).read().decode())"
```

`/health` returns `{"ready": true|false, "service": ..., "models": {...},
"device": ..., "error": ...}` — HTTP 200 when ready, 503 while models are still
loading (or failed). The controller's `/health` also reports each downstream
service, so one curl to :8000 gives the whole picture.

## Logs

| Where | What |
|---|---|
| `volumes/logs/ai-controller/*.log` | controller rotating file logs (LOG_MAX_MB=20 × LOG_BACKUP_COUNT=10) + `call_processing_YYYY-MM-DD.log` JSON events |
| `volumes/logs/ai-whisper-lang/`, `volumes/logs/ai-nemo/`, `volumes/logs/ai-seamless/` | per-service rotating file logs (same rotation policy) |
| `volumes/logs/llm/` | vLLM logs |
| `docker logs <container>` | stdout (docker json-file, rotated 50m × 5) |
| DB `CallProcessingLog` table | per-call pipeline stage log (from the controller) |

```bash
tail -f volumes/logs/ai-controller/*.log
docker logs sp_ai_nemo --tail 100 -f
docker exec sp_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -C \
  -Q "SELECT TOP 20 * FROM CallProcessingLog ORDER BY LogID DESC"
```

## Change language → model routing

Routing lives in `production/.env` (see `.env.example` § TRANSCRIPTION ROUTING).
Priority per detected language: `FASTER_WHISPER_ASR_LANGUAGES` →
`NEMO_ASR_LANGUAGES` → SeamlessM4T (everything else).

Example — move Hindi from Seamless to the NeMo conformer:

```bash
# .env:  NEMO_ASR_LANGUAGES=Hindi,English
docker compose up -d ai-controller     # env is read ONCE at container start
```

Only the controller needs recreating for routing changes; the model services
keep serving. Changing model paths/devices for a service requires recreating
that service too (e.g. `docker compose up -d ai-nemo`).

## VRAM budget (single GPU — `GPU_DEVICE_ID`, default host index 1)

### 48 GB GPU safe profile (default `.env` on prod)

| Service | Approx. VRAM |
|---|---|
| ai-whisper-lang (LID on GPU) | ~2–3 GB |
| ai-nemo (parakeet + Hindi conformer) | ~3 GB |
| ai-seamless | ~5 GB |
| llm (Qwen3-14B-AWQ, `LLM_GPU_MEMORY_UTIL=0.42`) | ~20 GB |
| **Baseline total** | **~31 GB** |
| **Typical spike (1 call, 2 chunk parallel)** | **~35–38 GB** |
| **Hard cap policy** | Keep **AI_MAX_CONCURRENT_JOBS=1** — do not run 2+ calls |

Target: stay **below 40 GB** on a 48 GB card (~83%) so Asterisk neighbors + burst never hit 99%.

If `nvidia-smi` exceeds **42 GB** during a call: lower `LLM_GPU_MEMORY_UTIL=0.38` or switch to Qwen3-8B preset.

### Qwen3-8B fallback (24 GB or tight shared GPU)

If Qwen3-8B still OOMs with Asterisk neighbors on the same GPU:

1. `LLM_GPU_MEMORY_UTIL=0.32`
2. `LLM_MAX_MODEL_LEN=4096`
3. `docker compose stop ai-seamless` (English-only batches only — breaks regional ASR)
4. Last resort: Llama-3.1-8B-AWQ @ 0.35 (`.env.example` rollback preset)

`nvidia-smi -i <GPU_DEVICE_ID>` during a live call — stay below ~90% to avoid failures.

## Verification after Qwen3-8B switch

Re-process these calls and confirm in UI + `CallProcessingLog`:

| Call type | Check |
|---|---|
| Cashback / hold (`…LS4D5.mp3`) | Hold ~1m26s, mobile digits, agent name |
| English-heavy | NeMo path, scoring JSON |
| Hindi/Bengali | Seamless path, entity digits in transcript |

Pass: no `CUDA out of memory` in `docker logs sp_ai_llama sp_ai_nemo`; numbers show as digits; hold detection unchanged.

```bash
bash scripts/verify-qwen3-8b-prod.sh
```

## Helper-model cache (air-gap)

The controller's small helper models (Silero VAD for diarization, MiniLM
script model, sentiment models) load from `/root/.cache`, which is mounted to
`volumes/hub-cache/`. Seed it once during deploy (before first `up`):

```bash
mkdir -p volumes/hub-cache
tar xzf hub-cache-seed.tar.gz -C volumes/hub-cache   # copied from dev
```

If the seed is missing AND the server has internet, the controller downloads
them on first boot and they persist in `volumes/hub-cache/` afterwards. If
diarization health says `Failed to load Silero VAD`, this cache is missing.

## Troubleshooting

- **Service shows `(health: starting)` for a long time** — normal on first
  boot (eager model load; start_period 600s). Check progress:
  `docker logs sp_ai_nemo --tail 50`.
- **`/health` 503 with `"error"` set** — model file missing/corrupt under
  `volumes/models/`. Re-extract the model bundle (scripts/extract-*.sh) and
  `docker compose restart <service>`.
- **Service down mid-call — what happens?** The controller falls back
  automatically: language detection falls back to controller-local detection;
  ASR falls back to controller-local faster-whisper (lazy-loaded). Calls keep
  completing, slower. NOTE: a failed **ASR** service is latched off for the
  controller's process lifetime — after fixing the service, run
  `docker compose restart ai-controller` to route calls back to it.
  (Language detection is NOT latched; it retries the lang service each call.)
- **Backend can't reach AI** — `AI_MAIN_URL` must be `http://ai:8000`; verify
  alias: `docker exec sp_backend getent hosts ai` → controller IP.
- **Old `sp_ai` / `sp_llm` containers present** — pre-restructure leftovers;
  `scripts/deploy-prod.sh` / `03-up.sh` remove them automatically
  (`remove_legacy_containers`), or: `docker rm -f sp_ai sp_llm`.
- **GPU not visible** — `docker info | grep -i nvidia`; if empty:
  `sudo nvidia-ctk runtime configure --runtime=docker && sudo systemctl restart docker`.

## Rollback to the pre-restructure monolith

```bash
cd /home/suvadip/Call-Analysis/Project/production
docker compose down

# 1) Restore compose + env from the backup
cp backup-2026-07-02/docker-compose.yml docker-compose.yml
cp backup-2026-07-02/.env .env                    # only if .env was changed

# 2) Ensure the legacy image is present (either restore path works)
docker load -i docker-images/sp-aimvp.tar         # if tar still on disk
docker tag sp-aimvp:backup-20260702 sp-aimvp:prod # if backup tags were kept
docker tag sp-llm:backup-20260702  sp-llm:prod    # (llm image is unchanged)

# 3) Bring the old stack back
bash scripts/bootstrap-prod-secrets.sh
docker compose up -d
```

The old compose uses containers `sp_ai` + `sp_llm`; the new-name containers
(`sp_ai_*`) are removed by `docker compose down` in step 1. DB, audio, models
and logs all live in `volumes/` and are untouched by rollback.
