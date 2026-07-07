# Sprint 6–9 hardening deploy (single .env + Docker secrets + license runtime + AI gates)

## What changed in this release

- **Sprint 6:** Docker file-backed `secrets/*` + auto-generated `.env.container` (bootstrap from `.env`); secrets not in container `printenv`
- **Sprint 8:** periodic license re-validation (30 min), persisted CRL merge on upload
- **Sprint 9:** AI job concurrency cap, entitlement poll in ai-mvp, work tokens carry module list

---

## `.env` on prod — single file

Use **one** `production/.env` for:

| Use | Keys / file |
|-----|-------------|
| Compose interpolation | `SA_PASSWORD`, ports, `GPU_DEVICE_ID`, `CORS_ORIGIN`, … (from `.env`) |
| Backend `env_file` | `.env.container` — license flags, paths, queue tuning, `LICENSE_PUBLIC_KEY_PATH` (no secrets) |
| Bootstrap | Reads `.env` → writes `secrets/*` + `.env.container` |

**Important:** `LICENSE_PUBLIC_KEY_PATH=/app/keys/vendor-root-public.pem` must be set (empty overrides image default and breaks license verify).

After any secret change:

```bash
bash scripts/bootstrap-prod-secrets.sh
```

**Full copy list and prod commands:** [`PROD-FILES-AND-DEPLOY.md`](PROD-FILES-AND-DEPLOY.md)

---

## Legacy split `.env` (if prod still has `.env.secrets` / `.env.backend`)

Production now uses **one** `.env` only. If an older server was split, merge secret lines into `.env`, set `LICENSE_PUBLIC_KEY_PATH=/app/keys/vendor-root-public.pem`, remove duplicate keys, delete the split files, then run `bootstrap-prod-secrets.sh`. Details in [`PROD-FILES-AND-DEPLOY.md`](PROD-FILES-AND-DEPLOY.md#legacy-split-env).

---

## Copy DEV → PROD

### Images (required)
- `docker-images/sp-backend.tar`
- `docker-images/sp-frontend.tar`
- `docker-images/sp-aimvp.tar`

### Config + scripts (required)
- `docker-compose.yml`
- `scripts/bootstrap-prod-secrets.sh`
- `scripts/validate-prod-layout.sh`
- `scripts/deploy-sprint6-9-hotfix.sh`
- `scripts/lib/common.sh`
- `.env.example` (template only)

### Do NOT overwrite
- `.env` values (edit in place)
- `license/license.lic`
- `volumes/`

---

## Commands on PROD (fresh or hotfix)

```bash
cd /home/suvadip/Call-Analysis/Project/production

sed -i 's/\r$//' scripts/*.sh scripts/lib/*.sh
chmod +x scripts/*.sh

# First install: cp .env.example .env && nano .env

bash scripts/deploy-sprint6-9-hotfix.sh
```

### Verify secrets not in container env

```bash
docker exec ai_call_backend sh -c 'printenv | grep -E "LICENSE_SECRET|ORCHESTRATOR|SERVICE_TOKEN" || echo "OK: no secrets in env"'
docker logs ai_call_backend --tail 20
docker logs ai_call_ai --tail 20 | grep -i entitlement
```

---

## Optional enforcement (in `.env`)

When ready for stricter prod:

```bash
LICENSE_INTEGRITY_CHECK=true
LICENSE_ENFORCE_SIGNATURE=true
# LICENSE_GATE_ENABLE=true   # blocks docker start if license invalid
```

Then recreate backend: `docker compose up -d --force-recreate --no-deps backend`

---

## Dev rebuild

```powershell
powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-patch-images.ps1
```
