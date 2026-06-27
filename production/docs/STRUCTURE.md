# Production layout (SP — Suvadip Panja)

```
production/
├── docker-compose.yml      # Stack: sp-db, sp-backend, sp-frontend, sp-llm, sp-aimvp
├── docker-images/          # Docker image tars only (offline load)
│   ├── sp-db.tar
│   ├── sp-backend.tar
│   ├── sp-frontend.tar
│   ├── sp-aimvp.tar
│   ├── sp-llm.tar
│   └── sp-redis.tar
├── model-bundles/          # Model weight tars (extract → volumes/models/)
│   ├── 07-llama-awq.tar       # LLM (Llama-3.1-8B-Instruct AWQ)
│   ├── 09-seamless-m4t.tar    # Hindi + Bengali ASR
│   ├── 10-indiclid.tar        # Text language-detection hint
│   ├── 12-faster-whisper.tar  # Fallback ASR (large-v3, CTranslate2)
│   └── 13-whisper-large-v3.tar# Language detection / LID (transformers, fp16)
├── docs/                   # All deployment markdown
├── scripts/
└── volumes/                # Host-persisted data (created by 01-create-folders.sh)
    ├── audio/              # Call recordings
    ├── batch/metadata/     # Batch CSV
    ├── batch/audio/        # Batch WAV
    ├── chat/               # Chat dump exports
    ├── profile_pictures/   # User profile photos → backend /app/assets/profile_pictures
    ├── branding/           # Admin app logo → backend /app/uploads/branding
    ├── logs/               # Backend + AI + LLM logs
    └── models/             # Extracted model weights
        ├── Meta-Llama-3.1-8B-Instruct-AWQ/
        ├── seamless-m4t-v2-large/
        ├── indiclid/
        ├── faster-whisper-large-v3/
        ├── Whisper-large-v3/
        └── nemo/
```

## ASR routing (final)

| Language | Engine |
|----------|--------|
| English | NeMo parakeet (in `sp-aimvp`) |
| Hindi | SeamlessM4T v2 |
| Bengali | SeamlessM4T v2 |
| Fallback (all) | faster-whisper large-v3 |

> **Retired:** `sp-nemo` (IndicConformer Sherpa-ONNX) and the in-container
> IndicConformer `.nemo` models. Hindi/Bengali transcribe better on SeamlessM4T,
> so `sp-nemo.tar`, `08-indicconformer.tar`, `11-indic-onnx.tar`,
> `volumes/models/nemo/indicconformer_*`, and `volumes/models/indic-onnx/` were
> removed. The legacy `images/` folder is also gone (use `docker-images/`).

## Service images (SP naming)

| Service | Image tag | Role |
|---------|-----------|------|
| db | `sp-db:prod` | SQL Server |
| backend | `sp-backend:prod` | Node API + upload |
| frontend | `sp-frontend:prod` | React UI |
| llm | `sp-llm:prod` | vLLM / Llama AWQ |
| ai | `sp-aimvp:prod` | **Orchestrator** — controls LID, diarization, NeMo, SeamlessM4T, scoring |

**sp-aimvp** is the single controller when audio is uploaded: it runs language detection, picks ASR engine, calls LLM for scoring.

### Future: `sp-nemo` (separate container)

NeMo ASR currently runs inside `sp-aimvp`. A dedicated `sp-nemo` microservice (like the legacy `AI/src/...` layout) can be split later with HTTP/gRPC from aimvp.

## Migrate from old `images/` folder

```powershell
powershell -ExecutionPolicy Bypass -File production\scripts\migrate-prod-layout.ps1
```

## Deploy

```bash
./scripts/01-create-folders.sh      # creates all volumes/* incl. profile_pictures + branding
./scripts/validate-prod-layout.sh   # verifies compose mounts + .env paths
bash scripts/deploy-prod.sh         # or ./scripts/deploy.sh --with-up
```

After LID/ASR fixes, **re-process calls** — old rows keep wrong language.
