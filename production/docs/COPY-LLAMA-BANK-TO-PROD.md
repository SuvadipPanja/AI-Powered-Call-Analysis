# Copy Llama + Bank Config to Prod — Full Guide

**Prod server:** `10.64.194.130`  
**Prod path:** `/home/suvadip/Call-Analysis/Project/production`

> For **logging deploy** and **qwen→llm rename**, see also [PROD-DEPLOY-LOGGING.md](./PROD-DEPLOY-LOGGING.md).

---

## PART A — On DEV (this Windows machine)

### Step A1 — Build images

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-patch-images.ps1
```

### Step A2 — Download Llama AWQ + create tar

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
powershell -ExecutionPolicy Bypass -File production\scripts\download-llama-awq.ps1
```

If download fails with auth error:
```powershell
pip install -U huggingface_hub
huggingface-cli login
# Accept license: https://huggingface.co/meta-llama/Meta-Llama-3.1-8B-Instruct
powershell -ExecutionPolicy Bypass -File production\scripts\download-llama-awq.ps1
```

---

## PART B — Copy these files to prod

Use **WinSCP**, **scp**, or USB. Destination on prod:  
`/home/suvadip/Call-Analysis/Project/production/`

### Docker images (into `production/images/`)

| Copy from (dev) | To (prod) | Size (approx) |
|-----------------|-----------|---------------|
| `production/images/02-backend.tar` | `production/images/02-backend.tar` | ~112 MB |
| `production/images/03-frontend.tar` | `production/images/03-frontend.tar` | ~60 MB |
| `production/images/05-ai.tar` | `production/images/05-ai.tar` | ~5.4 GB |
| `production/images/07-llama-awq.tar` | `production/images/07-llama-awq.tar` | ~5 GB |

> **Do NOT re-copy** `01-db.tar`, `04-redis.tar`, `06-vllm.tar` (legacy name `06-qwen-vllm.tar` OK) unless missing on prod.

### Config + scripts (into `production/`)

| Copy from (dev) | To (prod) |
|-----------------|-----------|
| `production/.env` | `production/.env` |
| `production/docker-compose.prod.yml` | `production/docker-compose.prod.yml` |
| `production/scripts/deploy-prod.sh` | `production/scripts/deploy-prod.sh` |
| `production/scripts/deploy-llama-bank-config.sh` | `production/scripts/deploy-llama-bank-config.sh` |
| `production/scripts/extract-llama-awq.sh` | `production/scripts/extract-llama-awq.sh` |

---

## PART C — On PROD (after copy)

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

sed -i 's/\r$//' scripts/*.sh
chmod +x scripts/deploy-prod.sh scripts/deploy-llama-bank-config.sh scripts/extract-llama-awq.sh

# Recommended one-shot deploy
bash scripts/deploy-prod.sh
```

**Or** bank-config-only script (includes model extract + image load):

```bash
bash scripts/deploy-llama-bank-config.sh
```

Manual llm-first steps:

```bash
docker stop ai_call_qwen 2>/dev/null; docker rm ai_call_qwen 2>/dev/null
bash scripts/extract-llama-awq.sh
docker load -i images/02-backend.tar
docker load -i images/03-frontend.tar
docker load -i images/05-ai.tar
docker compose -f docker-compose.prod.yml up -d --force-recreate llm
# wait until ai_call_llm healthy
docker compose -f docker-compose.prod.yml up -d --force-recreate backend frontend ai
docker exec ai_call_llm curl -s http://127.0.0.1:8001/v1/models | head -c 400
```

---

## PART D — Configure bank (Super Admin UI)

1. Open: **http://10.64.194.130:8081**
2. Login as **Super Admin**
3. Go to **Admin Settings → Bank Config**
4. Set bank name, glossary, product terms
5. **Re-upload a test call**

---

## PART E — Troubleshooting

| Problem | Fix |
|---------|-----|
| `llm` not healthy | `docker logs ai_call_llm --tail 100` — check `volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ/config.json` |
| GPU OOM on llm | In `.env` lower `LLM_GPU_MEMORY_UTIL=0.30`, recreate llm |
| Failed calls | See [PROD-DEPLOY-LOGGING.md](./PROD-DEPLOY-LOGGING.md) — query `CallProcessingLog` |
| Bank tab missing | Reload frontend tar; login as Super Admin |

---

## Quick checklist

- [ ] Dev: rebuilt 02, 03, 05 tars
- [ ] Copied tars + `.env` + `docker-compose.prod.yml` + scripts
- [ ] Prod: `sed -i 's/\r$//'` on scripts
- [ ] Prod: legacy `ai_call_qwen` removed
- [ ] Prod: `llm` healthy (`ai_call_llm`)
- [ ] Prod: backend, frontend, ai recreated
- [ ] UI: Bank Config saved
- [ ] Test call uploaded and processed
