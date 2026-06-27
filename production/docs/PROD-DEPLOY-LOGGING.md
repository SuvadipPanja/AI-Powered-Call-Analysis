# Production Deploy — Logging + LLM Rename

**Prod server:** `10.64.194.130`  
**Prod path:** `/home/suvadip/Call-Analysis/Project/production`

Compose file is **`docker-compose.yml`** — run from the `production/` folder:

```bash
docker compose up -d
```

---

## PART A — On DEV (Windows) — build images

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-patch-images.ps1
```

---

## PART B — What to copy (DEV → PROD)

**Source (dev laptop):** `C:\Project\AI-Powered Call Analysis project\production\`  
**Destination (prod server):** `/home/suvadip/Call-Analysis/Project/production/`

### Required for this update (logging + llm rename)

| Copy FROM (dev) | Copy TO (prod) | Size (approx) | Purpose |
|-----------------|----------------|---------------|---------|
| `production\images\02-backend.tar` | `production/images/02-backend.tar` | ~112 MB | Backend + call logging |
| `production\images\03-frontend.tar` | `production/images/03-frontend.tar` | ~66 MB | Frontend UI |
| `production\images\05-ai.tar` | `production/images/05-ai.tar` | ~5.4 GB | AI orchestrator + prod logging |
| `production\docker-compose.yml` | `production/docker-compose.yml` | small | Stack definition (`docker compose up -d`) |
| `production\.env` | `production/.env` | small | Secrets + LLM_* settings |
| `production\scripts\deploy-prod.sh` | `production/scripts/deploy-prod.sh` | small | One-shot deploy script |
| `production\scripts\03-up.sh` | `production/scripts/03-up.sh` | small | Full stack start |
| `production\scripts\02-load-images.sh` | `production/scripts/02-load-images.sh` | small | Load all tars |

### Copy only if missing on prod (first install or broken)

| Copy FROM (dev) | Copy TO (prod) | Notes |
|-----------------|----------------|-------|
| `production\images\01-db.tar` | `production/images/01-db.tar` | SQL Server image |
| `production\images\04-redis.tar` | `production/images/04-redis.tar` | Redis image |
| `production\images\06-qwen-vllm.tar` | `production/images/06-qwen-vllm.tar` | vLLM base image (name legacy, still works) |
| `production\images\07-llama-awq.tar` | `production/images/07-llama-awq.tar` | Llama AWQ weights (~5.3 GB) — only if model not extracted |
| `production\license\license.lic` | `production/license/license.lic` | App license |
| `production\models-bundle.tgz` | `production/models-bundle.tgz` | NeMo ASR models (first install) |

### Do NOT overwrite on prod (keep existing data)

| Folder on prod | Why |
|----------------|-----|
| `production/volumes/dbdata/` (Docker volume) | Database data |
| `production/volumes/audio/` | Uploaded call recordings |
| `production/volumes/logs/` | Existing logs (optional backup) |
| `production/volumes/models/` | Already extracted models (if present) |

### How to copy (pick one method)

**Option 1 — SCP from dev (PowerShell / WSL):**

```powershell
$SRC = "C:\Project\AI-Powered Call Analysis project\production"
$DST = "suvadip@10.64.194.130:/home/suvadip/Call-Analysis/Project/production"

scp "$SRC\images\02-backend.tar" "$DST/images/"
scp "$SRC\images\03-frontend.tar" "$DST/images/"
scp "$SRC\images\05-ai.tar"       "$DST/images/"
scp "$SRC\docker-compose.yml"     "$DST/"
scp "$SRC\.env"                   "$DST/"
scp "$SRC\scripts\deploy-prod.sh" "$DST/scripts/"
scp "$SRC\scripts\03-up.sh"       "$DST/scripts/"
scp "$SRC\scripts\02-load-images.sh" "$DST/scripts/"
```

**Option 2 — USB / shared folder:** copy the same files into the matching paths on prod.

**On prod after copy — remove old compose file if it exists:**

```bash
rm -f /home/suvadip/Call-Analysis/Project/production/docker-compose.prod.yml
```

---

## PART C — On PROD — step-by-step commands

```bash
# 1) Login and go to project folder
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

# 2) Fix Windows line endings on scripts
sed -i 's/\r$//' scripts/*.sh
chmod +x scripts/*.sh

# 3) Remove legacy qwen container (renamed to llm)
docker stop ai_call_qwen 2>/dev/null || true
docker rm ai_call_qwen 2>/dev/null || true

# 4) Ensure log folders exist
mkdir -p volumes/logs/ai volumes/logs/llm

# 5) Load updated Docker images
docker load -i images/02-backend.tar
docker load -i images/03-frontend.tar
docker load -i images/05-ai.tar

# 6) Start LLM (vLLM) first — wait until healthy (~5–10 min first time)
docker compose up -d --force-recreate llm
docker inspect ai_call_llm --format='{{.State.Health.Status}}'
# repeat until output is: healthy

# 7) Recreate app services
docker compose up -d --force-recreate backend frontend ai

# 8) Verify all containers
docker compose ps
```

**Or use the deploy script (steps 3–8 in one command):**

```bash
bash scripts/deploy-prod.sh
```

**Fresh full stack (all services including db/redis):**

```bash
docker compose up -d
```

---

## Log file paths (host)

| Path | Service | Contents |
|------|---------|----------|
| `volumes/logs/call_processing.log` | backend | JSON — dispatch + callbacks |
| `volumes/logs/ai/call_processing_YYYY-MM-DD.log` | ai | JSON — ASR, translate, LLM, scoring |

```bash
docker compose logs -f backend
docker compose logs -f ai
docker compose logs -f llm
tail -f volumes/logs/call_processing.log
```

---

## Query failed calls (SQL Server)

```bash
docker exec ai_call_db /opt/mssql-tools18/bin/sqlcmd -S localhost -U sa -P "$SA_PASSWORD" -C -Q "
SELECT TOP 50 LogID, AudioFileName, Service, Stage, Level, Message, CreatedAt
FROM dbo.CallProcessingLog
WHERE Level = 'ERROR'
ORDER BY LogID DESC"
```

---

## Service rename reference

| Old | New |
|-----|-----|
| `docker-compose.prod.yml` | `docker-compose.yml` |
| compose service `qwen` | `llm` |
| container `ai_call_qwen` | `ai_call_llm` |
| env `QWEN_*` | `LLM_*` |
