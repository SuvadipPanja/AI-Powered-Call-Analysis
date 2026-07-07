# AI Stack Restructure — SPEC (single source of truth)

Date: 2026-07-02. This spec is FROZEN for the restructure build. All agents/files
must follow it exactly. Backup of the previous state: `production/backup-2026-07-02/`
and docker tags `*:backup-20260702`.

## 1. Architecture

The monolithic `sp-aimvp` AI container is split into cooperating services.
Code base stays `ai-mvp/` (same logic, same files) — services are thin HTTP
wrappers; the controller keeps the full pipeline and calls services over HTTP.

```
                       ┌──────────────────────────────┐
 backend (sp_backend)──►  sp_ai_controller  (:8000)   │  chunking/diarization, WPM,
                       │  image: sp-ai-controller:prod │  duration, DB, enrichment,
                       └──────┬──────────┬─────────────┘  taboo, progress, callbacks
                              │          │
              language?       │          │ per-chunk ASR (parallel)
                              ▼          ▼
        ┌──────────────────────┐   ┌──────────────────────────┐
        │ sp_ai_whisper_lang   │   │ English → sp_ai_nemo      │(:8020)
        │ (:8010)              │   │  parakeet-rnnt-1.1b +     │
        │ Whisper-V3 LID +     │   │  stt_hi_conformer_ctc_med │
        │ old AI/ chunk-vote   │   ├──────────────────────────┤
        │ logic                │   │ Hindi/Bengali/others →    │
        └──────────────────────┘   │ sp_ai_seamless_m4t (:8030)│
                                   └──────────────────────────┘
                              │
                              ▼  LLM tasks (cleanup, translate, scoring,
        ┌──────────────────────┐  intelligence, category discovery)
        │ sp_ai_llama (:8001)  │  image: sp-llm:prod (vLLM, unchanged)
        └──────────────────────┘
```

All model services load models **at startup** (eager) and stay resident.
`restart: unless-stopped`. First `up` is slow; afterwards always ready.

## 2. Images / containers / ports

| Compose service | Container        | Image                     | Port | Purpose |
|-----------------|------------------|---------------------------|------|---------|
| `ai-controller` | `sp_ai_controller` | `sp-ai-controller:prod` | 8000 | Orchestrator (existing orchestrator.py) |
| `ai-whisper-lang` | `sp_ai_whisper_lang` | `sp-ai-whisper-lang:prod` | 8010 | Language detection |
| `ai-nemo`       | `sp_ai_nemo`     | `sp-ai-nemo:prod`         | 8020 | NeMo ASR (English parakeet + Hindi conformer) |
| `ai-seamless`   | `sp_ai_seamless_m4t` | `sp-ai-seamless-m4t:prod` | 8030 | SeamlessM4T v2 ASR (Hindi/Bengali/regional) |
| `llm`           | `sp_ai_llama`    | `sp-llm:prod` (unchanged) | 8001 | vLLM Llama-3.1-8B |
| db/redis/backend/frontend | sp_db / sp_redis / sp_backend / sp_frontend | unchanged | | |

- `ai-controller` gets network alias **`ai`** so `AI_MAIN_URL=http://ai:8000` keeps working.
- `llm` keeps network alias **`llm`** (OPENAI_BASE_URL=http://llm:8001/v1 unchanged).
- All 4 AI images build FROM a shared local base **`sp-ai-base:prod`**
  (= `ai-call-orchestrator:prod` + full current `ai-mvp/` code at `/app` +
  `vim less curl htop procps net-tools` + `gunicorn`). One combined tar
  `production/docker-images/sp-ai-stack.tar` holds all 4 images (layers dedupe).

## 3. HTTP contracts (FROZEN)

Uniform JSON; errors: `{"success": false, "message": "..."}` + 4xx/5xx.

### GET /health (all services)
```json
{"ready": true, "service": "sp-ai-nemo", "models": {"English": "loaded", "Hindi": "loaded"},
 "device": "cuda", "error": null, "uptime_sec": 123.4, "threads": 4}
```
`ready` is true only when required models are loaded. HTTP 200 when ready, 503 when not.

### POST /detect-language  (sp-ai-whisper-lang)
multipart `file=<audio wav/mp3>`; optional form `audio_id`.
```json
{"success": true, "language": "Bengali", "confidence": 0.93,
 "method": "whisper-v3+chunk-vote", "details": {"votes": {"Bengali": 3, "Hindi": 1}}}
```

### POST /transcribe  (sp-ai-nemo, sp-ai-seamless-m4t)
multipart `file=<prepared chunk wav>` + form `lang=<Language name>`; optional `audio_id`.
```json
{"success": true, "text": "...", "engine": "nemo-parakeet-rnnt-1.1b"}
```
Empty audio → `{"success": true, "text": ""}`. Unsupported lang → 400.

## 4. Shared modules (already written — DO NOT MODIFY, import only)

- `ai-mvp/log_setup.py` — `init_service_logging(service_name)`: rotating file
  (`/app/logs/<service>.log`, LOG_MAX_MB × LOG_BACKUP_COUNT) + stdout, LOG_LEVEL.
- `ai-mvp/lang_client.py` — `detect_language_remote(path) -> str`,
  `lang_service_health() -> dict`.
- `ai-mvp/asr_client.py` — `transcribe_remote(path, language, service) -> (text, engine)`
  with `service in {"nemo","seamless"}`, `asr_service_health(service) -> dict`.

## 5. Env vars (single `production/.env`; compose uses `${VAR:-default}` ONLY)

New (controller): `AI_DISTRIBUTED` (compose default true; config.py default false),
`AI_LANG_SERVICE_URL` (http://ai-whisper-lang:8010), `AI_LANG_SERVICE_TIMEOUT_SEC` (180),
`AI_NEMO_SERVICE_URL` (http://ai-nemo:8020), `AI_SEAMLESS_SERVICE_URL` (http://ai-seamless:8030),
`AI_ASR_SERVICE_TIMEOUT_SEC` (300), `ASR_CHUNK_PARALLELISM` (2).

New (all services): `AI_SERVICE_PORT`, `AI_SERVICE_THREADS` (4),
`LOG_LEVEL` (INFO), `LOG_MAX_MB` (20), `LOG_BACKUP_COUNT` (10).

Lang service extra: `AI_LANG_MULTI_CHUNK` (true), `AI_LANG_CHUNK_COUNT` (4),
`AI_LANG_CHUNK_SEC` (20) — old `AI/src/2nd step Language_Detection` energy-ranked
multi-window voting layered over current `language_worker` detection.

Existing keys KEEP EXACT NAMES (routing read once at container start):
`TRANSCRIBE_BACKEND`, `NEMO_ASR_LANGUAGES` (default English),
`FASTER_WHISPER_ASR_LANGUAGES`, `SEAMLESS_M4T_ENABLED/MODEL_PATH/DEVICE`,
`ENGLISH_NEMO_MODEL_PATH=/models/nemo/parakeet-rnnt-1.1b.nemo`,
`HINDI_NEMO_MODEL_PATH=/models/nemo/stt_hi_conformer_ctc_medium.nemo`,
`WHISPER_LANG_MODEL_PATH`, `WHISPER_LANG_DEVICE`, `SP_NEMO_*` (legacy, default off),
all `LANG_*`, `DIAR_*`, `TRANSCRIPT_*`, `QUERY_CATEGORY_*`, DB/secrets keys.

Routing semantics (unchanged `_resolve_asr_backend`): FASTER_WHISPER override →
NEMO_ASR_LANGUAGES → SeamlessM4T. In distributed mode "nemo" → nemo SERVICE,
"seamless-m4t" → seamless SERVICE; failures fall back to controller-local
faster-whisper (lazy) exactly like today.

## 6. Concurrency (worker concept)

- Services: gunicorn `--workers 1 --threads ${AI_SERVICE_THREADS}` (single model
  copy on GPU; threads queue requests; GPU inference guarded by a per-model lock).
- Controller: Flask threaded (as today); per-chunk ASR fan-out via
  `ThreadPoolExecutor(ASR_CHUNK_PARALLELISM)` preserving chunk order in output.
  In distributed mode the global `_pipeline_lock` is bypassed (no shared local
  models) so multiple audios process concurrently end-to-end.
- Controller local model fallbacks stay serialized under the existing lock.

## 7. Logging

Every container: `init_service_logging(<service>)` at startup → rotating
`/app/logs/<service>.log` (mounted `./volumes/logs/<service>/`), plus existing
`log_call_event` JSON + DB CallProcessingLog from the controller. Docker
json-file rotation stays (50m × 5).

## 8. File ownership (agents MUST stay in-lane)

- **Agent LANG**: `services/sp-ai-whisper-lang/server.py`, `services/sp-ai-whisper-lang/Dockerfile`.
- **Agent ASR**: `services/sp-ai-nemo/server.py` + `Dockerfile`,
  `services/sp-ai-seamless-m4t/server.py` + `Dockerfile`.
- **Agent CTRL**: `ai-mvp/config.py` (new vars), `ai-mvp/transcribe.py`,
  `ai-mvp/orchestrator.py`, `services/sp-ai-controller/Dockerfile`,
  `services/sp-ai-base/Dockerfile` (shared base).
- **Agent INFRA**: `production/docker-compose.yml`, `production/.env.example`,
  `production/scripts/*`, `production/docs/*`, dev build script
  `production-build/build-ai-stack.ps1`.
- Shared modules in §4: read-only for everyone.

## 9. Verification protocol (after build)

`py_compile` all Python; `docker compose config -q`; build base + 4 images;
boot with CPU/no-GPU override (`docker-compose.verify.yml`) — services must
reach HTTP and report `ready:false` with a clear model-missing error (no
crash-loop); client↔server contract round-trip against mock; controller
`/health` aggregates downstream service healths. Full GPU inference is verified
on prod after deploy.
