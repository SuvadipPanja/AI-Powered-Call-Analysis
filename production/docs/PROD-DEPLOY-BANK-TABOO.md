# Production deploy — Bank Config + Taboo words + IndicConformer

## Which files to copy to prod?

| File | Action on prod |
|------|----------------|
| `02-backend.tar` | `docker load -i` |
| `03-frontend.tar` | `docker load -i` |
| `05-ai.tar` | `docker load -i` |
| `08-indicconformer.tar` | **NOT** docker load — extract models only |
| `docker-compose.yml` | Copy if changed |
| `scripts/*.sh` | Copy (LF-normalized on dev rebuild) |

**Do not re-copy** if already on prod: `01-db`, `04-redis`, `06-qwen-vllm`, `07-llama-awq`.

## Step-by-step (prod server)

```bash
# 1. On your Windows dev PC — copy these to prod:
#    production/images/02-backend.tar
#    production/images/03-frontend.tar
#    production/images/05-ai.tar
#    production/images/08-indicconformer.tar   (only if Hindi Large model not yet extracted)
#    production/scripts/*.sh  (LF-normalized when you run rebuild-patch-images.ps1)

# 2. On prod (example path)
cd /home/suvadip/Call-Analysis/Project/production

# 3. Load Docker images (3 containers only)
docker load -i images/02-backend.tar
docker load -i images/03-frontend.tar
docker load -i images/05-ai.tar

# 4. Extract IndicConformer models (skip if volumes/models/nemo/*.nemo already present)
bash scripts/extract-indicconformer.sh

# 5. Deploy (auto-fixes CRLF on scripts — no manual sed)
bash scripts/deploy-prod.sh
```

## After deploy

1. Login as **Super Admin** → **Settings** → **Bank Configuration**
2. Review defaults: banking terms, non-banking terms, multi-language glossary, taboo words
3. Click **Save configuration**
4. Process a **new call** — taboo hits appear on **Scoring** and **Compliance** tabs with audio seek

## Rebuild on dev (before copy)

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-patch-images.ps1
```
