# Sheet 1 — Copy from DEV to PROD server

**Print this sheet. Use when transferring files from your Windows dev machine to Linux prod (`10.64.194.130`).**

Prod path on server: `/home/suvadip/Call-Analysis/Project/production`

---

## A. First-time full deploy (everything)

Copy the **entire** `production/` folder to the server:

```
production/
├── docs/
│   ├── COPY-TO-PROD.md          ← this file
│   ├── PROD-SERVER-STEPS.md     ← run steps on prod (Sheet 2)
│   └── STRUCTURE.md             ← layout reference
├── docker-compose.yml
├── .env                         ← secrets (do not share publicly)
├── .env.example                 ← template (includes PROFILE_PICS_DIR, BRANDING_DIR)
├── scripts/
│   ├── 01-create-folders.sh     ← creates volumes/* including profile_pictures + branding
│   ├── validate-prod-layout.sh  ← verifies folders, compose mounts, .env paths
│   ├── deploy.sh
│   └── deploy-prod.sh
├── docker-images/               ← Docker image tars (offline load)
│   ├── sp-db.tar
│   ├── sp-backend.tar
│   ├── sp-frontend.tar
│   ├── sp-aimvp.tar
│   ├── sp-llm.tar
│   └── sp-redis.tar
├── model-bundles/               ← model weight tars (extract → volumes/models/)
│   ├── 07-llama-awq.tar
│   ├── 09-seamless-m4t.tar
│   ├── 10-indiclid.tar
│   ├── 12-faster-whisper.tar
│   └── 13-whisper-large-v3.tar
├── license/license.lic
└── volumes/                     ← created on prod by 01-create-folders.sh if missing
    ├── profile_pictures/        ← user photos (host-persisted)
    ├── branding/                ← app logo (host-persisted)
    └── models/                  ← extracted weights (large; often already on prod)
```

**Transfer command example:**

```bash
scp -r production/ user@10.64.194.130:/home/suvadip/Call-Analysis/Project/
```

Or USB / shared drive — copy the whole `production` folder.

**On prod after copy:**

```bash
cd /home/suvadip/Call-Analysis/Project/production
./scripts/01-create-folders.sh
./scripts/validate-prod-layout.sh
./scripts/deploy.sh --with-up
```

---

## B. Patch deploy (smaller copy — prod already running)

If prod **already has** models and DB — copy **only what changed**:

| Copy this | Why |
|-----------|-----|
| `docker-images/sp-backend.tar` | Backend fix (profile pics, branding, API) |
| `docker-images/sp-frontend.tar` | UI changes |
| `docker-images/sp-aimvp.tar` | AI/scoring changes |
| `docker-compose.yml` | Volume mounts / env (if changed) |
| `scripts/*` | Deploy + validate scripts |
| `.env.example` | Reference for new env keys |
| `docs/PROD-SERVER-STEPS.md` | Updated steps |

**Always copy/update scripts when adding new host folders** (e.g. `profile_pictures`, `branding`) so a fresh prod server gets the same layout.

### Profile pictures / branding persistence fix

Copy from dev:

| Dev path | Prod path |
|----------|-----------|
| `production\docker-images\sp-backend.tar` | `.../production/docker-images/` |
| `production\docker-compose.yml` | `.../production/` |
| `production\scripts\01-create-folders.sh` | `.../production/scripts/` |
| `production\scripts\validate-prod-layout.sh` | `.../production/scripts/` |

On prod:

```bash
cd /home/suvadip/Call-Analysis/Project/production
./scripts/01-create-folders.sh
./scripts/validate-prod-layout.sh
docker load -i docker-images/sp-backend.tar
docker compose up -d --force-recreate backend
```

Users re-upload profile pics once (old files were inside the container layer).

---

## C. Build on DEV before copy

See `production-build/` scripts or:

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
.\production\scripts\rebuild-app-images.ps1
```

---

## D. File size reference

| Item | Approx size |
|------|-------------|
| `sp-backend.tar` | ~110 MB |
| `sp-frontend.tar` | ~120 MB |
| `sp-aimvp.tar` | ~5 GB |
| `sp-llm.tar` | ~9 GB |
| `sp-db.tar` | ~600 MB |
| `07-llama-awq.tar` | ~5 GB |
| Model bundles (ASR/LID) | varies |

---

## E. Checklist before leaving dev

- [ ] `docker-images/sp-*.tar` exist and are **new** (today’s date) if you changed code
- [ ] `docker-compose.yml` mounts `volumes/profile_pictures` and `volumes/branding`
- [ ] `.env.example` has `PROFILE_PICS_DIR` and `BRANDING_DIR`
- [ ] `scripts/01-create-folders.sh` and `validate-prod-layout.sh` copied
- [ ] `license/license.lic` matches server MAC in `.env`
- [ ] `docs/PROD-SERVER-STEPS.md` copied with bundle

---

## F. Do NOT copy to prod

- `production-build/` (build sources only)
- `ai-mvp/`, `backend/`, `frontend/` source (already inside image tars)
- `.git/`, `node_modules/`

---

## G. Legacy `images/` folder

Older bundles used `images/01-db.tar`, `docker-compose.prod.yml`, and service name `qwen`.  
Run `scripts/migrate-prod-layout.ps1` on dev to move to `docker-images/sp-*.tar`.  
Deploy scripts still accept legacy tars and auto-tag to `sp-*:prod`.
