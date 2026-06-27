# Production deploy — AI-Powered Call Analysis

Offline bundle for **10.64.194.130** (no internet on prod).

**Layout reference:** [`STRUCTURE.md`](STRUCTURE.md)  
**Full build & debug:** [`PRODUCTION-RUNBOOK.md`](PRODUCTION-RUNBOOK.md)

## Contents

```
production/
├── docker-compose.yml        ← stack definition (service: ai, llm, backend, …)
├── .env / .env.example       ← PROFILE_PICS_DIR, BRANDING_DIR, secrets
├── docker-images/            ← sp-*.tar image archives
├── model-bundles/            ← ASR/LLM weight tars → volumes/models/
├── license/license.lic
└── scripts/
    ├── deploy.sh             ← folders + validate + models + load images
    ├── deploy-prod.sh        ← full refresh (models + images + recreate services)
    ├── 01-create-folders.sh  ← creates volumes/* (incl. profile_pictures, branding)
    ├── validate-prod-layout.sh
    ├── 02-load-images.sh
    ├── 03-up.sh
    └── backup-db.sh
```

## Services (6 containers)

| Service | Port | Role |
|---------|------|------|
| frontend | **8081** | Web UI |
| backend | **5000**, **8080** | API, WebSocket, uploads, profile pics, branding |
| db | internal | SQL Server |
| redis | internal | Cache |
| llm | internal | Llama 3.1-8B AWQ via vLLM |
| ai | internal | Transcription + scoring orchestrator |

Requires **NVIDIA GPU** (host index **1** on dual-GPU servers).

## Deploy on prod (Linux, offline)

**Print these:**

1. **`COPY-TO-PROD.md`** — what to copy from dev  
2. **`PROD-SERVER-STEPS.md`** — step-by-step on prod  

**Recommended:**

```bash
cd /home/suvadip/Call-Analysis/Project/production
./scripts/deploy.sh --with-up
```

Or patch refresh:

```bash
bash scripts/deploy-prod.sh
```

## Persistent host folders (must exist before compose up)

| Host path | Container path | Data |
|-----------|----------------|------|
| `volumes/profile_pictures/` | `/app/assets/profile_pictures` | User profile photos |
| `volumes/branding/` | `/app/uploads/branding` | Admin app logo |
| `volumes/audio/` | `/app/data/Sample_Audio` | Call recordings |
| `volumes/chat/` | `/app/data/Chat_Dump` | Chat exports |
| `volumes/batch/metadata/` | `/app/data/batch_metadata` | Batch CSV |
| `volumes/batch/audio/` | `/app/data/batch_audio` | Batch WAV |

Created automatically by `01-create-folders.sh`. Validated by `validate-prod-layout.sh`.

## Useful commands

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f llm
docker compose logs -f ai
docker compose up -d --force-recreate backend   # after sp-backend.tar
./scripts/validate-prod-layout.sh
./scripts/backup-db.sh
```

Open **http://10.64.194.130:8081**
