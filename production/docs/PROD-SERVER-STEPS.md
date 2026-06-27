# Sheet 2 — PROD server steps (offline, step by step)

**Server:** `10.64.194.130`  
**Path:** `/home/suvadip/Call-Analysis/Project/production`  
**GPU:** use **GPU 1 only** (GPU 0 = other team)  
**Web UI:** http://10.64.194.130:8081  

Run each step. Wait for each to finish before the next.

---

## STEP 1 — Go to production folder

```bash
cd /home/suvadip/Call-Analysis/Project/production
ls
```

You should see: `docker-compose.yml`, `docker-images/`, `model-bundles/`, `scripts/`, `.env`, `docs/`

---

## STEP 2 — Fix Windows line endings (scripts)

```bash
cd /home/suvadip/Call-Analysis/Project/production
sed -i 's/\r$//' deploy.sh scripts/*.sh scripts/lib/*.sh 2>/dev/null
chmod +x deploy.sh scripts/*.sh
```

Or run `./deploy.sh` — it auto-fixes line endings via `fix_script_line_endings`.

---

## STEP 3 — Create folders (includes profile pictures + branding)

```bash
./scripts/01-create-folders.sh
./scripts/validate-prod-layout.sh
```

This creates all host volumes, including:

| Host folder | Purpose |
|-------------|---------|
| `volumes/profile_pictures/` | User profile photos (persist across container restart) |
| `volumes/branding/` | Admin app logo (persist across container restart) |
| `volumes/chat/` | Chat dump exports |
| `volumes/audio/` | Call recordings |
| `volumes/batch/*` | Batch auto-upload |

---

## STEP 4 — Extract models (ONLY if volumes/models is empty)

**Skip** if models already exist under `volumes/models/`.

```bash
bash scripts/deploy-prod.sh   # extracts models + loads images + starts stack
```

Or manually extract from `model-bundles/` (see `docs/STRUCTURE.md`).

Verify:

```bash
ls volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ/config.json
ls volumes/models/seamless-m4t-v2-large/config.json
ls volumes/models/nemo/*.nemo
```

---

## STEP 5 — Load Docker images

```bash
./scripts/02-load-images.sh
```

After a patch deploy (backend/frontend/ai only):

```bash
cd docker-images
docker load -i sp-backend.tar    # or sp-frontend.tar / sp-aimvp.tar
cd ..
docker compose up -d --force-recreate backend   # or frontend / ai
```

**Service names in compose:** `db`, `redis`, `backend`, `frontend`, `llm`, `ai` — not `sp-aimvp` or `qwen`.

---

## STEP 6 — Check `.env` (important)

```bash
grep -E 'GPU_DEVICE_ID|PROFILE_PICS_DIR|BRANDING_DIR|LLM_MODEL_PATH' .env
```

Must include:

```
GPU_DEVICE_ID=1
COMPOSE_PROJECT_NAME=call-analysis-prod
DOCKER_NETWORK_NAME=call-analysis-prod-net
PROFILE_PICS_DIR=/app/assets/profile_pictures
BRANDING_DIR=/app/uploads/branding
LLM_MODEL_PATH=/models/Meta-Llama-3.1-8B-Instruct-AWQ
```

If missing, edit:

```bash
nano .env
# or re-run: ./scripts/01-create-folders.sh  (backfills PROFILE_PICS_DIR / BRANDING_DIR)
```

---

## STEP 7 — Stop old stack (if running)

```bash
docker compose down
```

(Data in Docker volumes is kept. Add `-v` only if you want to wipe DB.)

---

## STEP 8 — Start stack

```bash
docker compose up -d
# or: ./scripts/03-up.sh
```

Wait 1–3 minutes for DB first-time restore; a few minutes for `llm` health.

---

## STEP 9 — Check all containers

```bash
docker compose ps
```

**All should be `Up` — NOT `Restarting`:**

| Container | Expected |
|-----------|----------|
| ai_call_db | Up (healthy) |
| ai_call_redis | Up |
| ai_call_backend | Up |
| ai_call_frontend | Up |
| ai_call_llm | Up (healthy) |
| ai_call_ai | Up |

---

## STEP 10 — Check logs (if anything Restarting)

```bash
docker logs ai_call_backend --tail 30
docker logs ai_call_ai --tail 30
docker logs ai_call_llm --tail 50
docker logs ai_call_db --tail 20
```

Backend startup should log writable storage for profile pictures and branding.

---

## STEP 11 — Check GPU 1 (not GPU 0)

```bash
nvidia-smi -i 1
```

After a test upload, you should see python/vLLM on **GPU 1**.

---

## STEP 12 — Open application

- **http://10.64.194.130:8081** — login page  
- API: **http://10.64.194.130:5000**

(Port **8081**, not 80.)

---

## STEP 13 — First login setup

1. Login (change default passwords if needed)
2. Super Admin → **Auto Upload** settings:
   - Metadata path: `/app/data/batch_metadata`
   - Audio path: `/app/data/batch_audio`
3. Upload profile picture / app logo once — files stay in `volumes/profile_pictures/` and `volumes/branding/` after restarts
4. Upload one test call — watch live processing

---

## Quick commands later

```bash
cd /home/suvadip/Call-Analysis/Project/production

docker compose ps
docker compose logs -f backend
docker compose logs -f ai
docker compose logs -f llm
docker compose down
docker compose up -d
./scripts/backup-db.sh
./scripts/validate-prod-layout.sh
```

---

## If something fails

| Problem | Fix |
|---------|-----|
| `bash\r` error | Repeat STEP 2 |
| Backend Restarting | Check STEP 6 `.env` + load new `sp-backend.tar` |
| Profile pics lost after restart | Run STEP 3; confirm compose mounts `volumes/profile_pictures` |
| AI Restarting | Load new `sp-aimvp.tar` from dev |
| LLM Restarting | Llama AWQ must be in `volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ/` |
| CORS / login error | Browser URL must be `:8081`, `CORS_ORIGIN` in `.env` |

See `docs/DEPLOY-RECOVERY.md` for more detail.

---

## One-command prep (recommended)

```bash
./scripts/deploy.sh --with-up
```

Or full app refresh:

```bash
bash scripts/deploy-prod.sh
```

`deploy.sh` = folders + validate + extract models + load images + checks.
