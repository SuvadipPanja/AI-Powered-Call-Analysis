# Deploy: Original-Language Transcript tab (backend + frontend)

Ships the new **Original** transcript tab (Hindi speaker-level view) + the backend
query fix. Only **backend** and **frontend** change — db, redis, qwen, ai are untouched.

**Prod:** 10.64.194.130 · shared host · **GPU 0 = other team — DO NOT TOUCH.**
This project is isolated as compose project `call-analysis-prod`; the commands below
only ever act on `ai_call_backend` + `ai_call_frontend`.

---

## 1) On the DEV/build machine (Windows, has internet)

```powershell
# From the project root:
powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-app-images.ps1
```

Produces:
- `production\images\02-backend.tar`
- `production\images\03-frontend.tar`

> The frontend host (`http://10.64.194.130:5000`) is baked from
> `frontend\.env.production`. If the prod IP ever changes, edit that file and re-run.

(Optional, to shrink transfer) gzip them:
```powershell
# Git Bash / WSL:  gzip -k production/images/02-backend.tar production/images/03-frontend.tar
```

---

## 2) Copy to prod (WinSCP / scp / USB)

| From (dev) | To (prod) |
|------------|-----------|
| `production\images\02-backend.tar`  | `.../production/images/02-backend.tar` |
| `production\images\03-frontend.tar` | `.../production/images/03-frontend.tar` |

Prod project dir (per existing runbook): `/home/suvadip/Call-Analysis/Project/production`

---

## 3) On the PROD server (air-gapped Linux)

```bash
cd /home/suvadip/Call-Analysis/Project/production

# Load the two updated images (offline — no docker pull)
docker load -i images/02-backend.tar
docker load -i images/03-frontend.tar

# Recreate ONLY backend + frontend. --no-deps = do NOT restart db/redis/qwen/ai.
# This is scoped to compose project 'call-analysis-prod' — the other team's
# containers (GPU 0) are a different project and are never affected.
docker compose -f docker-compose.prod.yml up -d --no-deps --force-recreate backend frontend
```

---

## 4) Verify

```bash
# Both should show "Up" / healthy, recent "Created" time:
docker ps --filter name=ai_call_backend --filter name=ai_call_frontend

# Backend serves the new fields (transcribeOutput / originalLanguage):
docker logs ai_call_backend --tail 20

# Other team + our AI stack untouched (qwen/ai still Up with old uptime):
docker ps --filter name=ai_call_qwen --filter name=ai_call_ai
```

Then in the browser: **http://10.64.194.130:8081** → open any call → the transcript
panel now has **3 tabs**: `Transcript` (English) · `Original` (Hindi, speaker-level) · `Summary`.

Hard-refresh (Ctrl+Shift+R) to bypass the browser cache of the old JS bundle.

---

## Rollback (if needed)

The previous images are still in Docker's local store under a different image ID.
If you tagged/saved the old ones, reload and recreate. Otherwise, rebuild from the
prior code commit. Backend/frontend recreate is non-destructive (no DB/volume changes),
so rollback is just re-running step 3 with the old tars.
