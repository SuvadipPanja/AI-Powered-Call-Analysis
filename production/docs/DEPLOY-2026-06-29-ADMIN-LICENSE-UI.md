# Deploy — Admin License page upgrade (backend + frontend)

Date prepared: 2026-06-28 (night). Deploy: next morning.

## What this ships
An **industrial-grade Admin → License page** with new admin-visible features, plus the
small backend change that feeds those features. **Only `backend` + `frontend` change.**
`db`, `redis`, `ai`, `llm` are **untouched** — do not recreate them.

New on the License page (Admin Settings → License tab):
- **License edition badge** — `Ed25519 · v3` vs `AES · v2`, with the customer name in the hero.
- **Richer KPIs** — Days remaining · Concurrent users · AI modules count · Last verified.
- **Entitlements panel** — application feature chips, **AI pipeline module** chips
  (or "All modules"), max agents, max AI jobs, issued date.
- **Hardware Binding panel** — the bound **server fingerprint** (copyable) and/or allowed
  MAC(s), with a "Locked" indicator — shows admins this license only runs on this server.
- **Richer details modal** — edition, customer, license ID, concurrent users, AI modules,
  features, server fingerprint.

These read from the active license via the existing Super-Admin `/api/license-details`
endpoint, which now also returns the rich v3 fields. No new endpoints, no DB changes,
no `.env` changes.

### Also included in this backend image — rate-limit fix ("Too many requests")
The "Too many requests. Please slow down." banner that kept appearing (even with one
active user) is fixed permanently for 500+ concurrent agents:
- The `/api` budget is now counted **per logged-in user** (hashed session token), so one
  user can never consume another's budget — and shared NAT IPs no longer collide.
- Cheap, high-frequency polls are **exempt** from the global budget: upload-status
  polling (`/audio-status`, every 2s), `/recent-activity`, `/check-session`,
  `/verify-session`, and the session heartbeat. (Login and upload keep their own
  stricter limiters.)
- The default per-user budget was raised **300 → 1000 req/min** (env-tunable via
  `API_RATE_LIMIT_MAX`).

> **Instant mitigation without redeploying** (optional): on the current image you can
> already raise the number — add `API_RATE_LIMIT_MAX=2000` to `production/.env` and
> `docker compose up -d --force-recreate --no-deps backend`. The new image is the proper
> permanent fix (per-user keying + poll exemptions) and needs no `.env` change.

> Frontend roadmap items #5 (shared dashboard hooks) and #6 (AuthContext single source)
> were already implemented in earlier work and are verified present — nothing to deploy
> for those.

---

## Built & tested on the dev machine (already done for you)
- `npm run build` — compiled successfully (no new warnings).
- `sp-backend:prod` rebuilt **flattened (2 layers)** → no "mount options too long" risk.
- `node --check server.js` — syntax OK.
- Saved tars:
  - `production\docker-images\sp-backend.tar`  (~111 MB)
  - `production\docker-images\sp-frontend.tar` (~259 MB)

---

## 1) Copy from DEV → PROD
Copy these **two files** only (WinSCP / scp / USB), overwriting the old ones:

| From (dev) | To (prod) |
|------------|-----------|
| `production\docker-images\sp-backend.tar`  | `…/production/docker-images/sp-backend.tar` |
| `production\docker-images\sp-frontend.tar` | `…/production/docker-images/sp-frontend.tar` |

Prod project dir: `/home/suvadip/Call-Analysis/Project/production`

Nothing else changes — **do not** copy `.env`, compose, or DB files.

---

## 2) Run on the PROD server (air-gapped Linux)
```bash
cd /home/suvadip/Call-Analysis/Project/production

# Load the two refreshed images (offline)
docker load -i docker-images/sp-backend.tar
docker load -i docker-images/sp-frontend.tar

# Recreate ONLY backend + frontend (db/redis/ai/llm stay up)
docker compose up -d --force-recreate --no-deps backend frontend
```

---

## 3) Verify
```bash
# Both Up, recent "Created" time
docker ps --filter name=ai_call_backend --filter name=ai_call_frontend

# License still active (unchanged by this deploy)
bash scripts/license-deploy.sh status
# or:
curl -s http://10.64.194.130:5000/api/license-status | python3 -m json.tool
```

Then in the browser → **http://10.64.194.130:8081** → log in as Super Admin →
**Admin Settings → License**. Hard-refresh (Ctrl+Shift+R) to drop the old JS bundle.

You should see: the edition badge, the customer name, the Entitlements chips
(features + AI modules), and the Hardware Binding panel with the server fingerprint.

> If the Entitlements/Hardware panels show generic values ("Core features", "legacy MAC"),
> the active license is a **v2** key — that's expected. v3 keys (the ones from
> `tools/sign-license-v3.js`) show the full rich data.

---

## Rollback (non-destructive)
This deploy touches no DB/volumes. To roll back, reload the previous `sp-backend.tar` /
`sp-frontend.tar` you replaced (or rebuild from the prior commit) and re-run step 2.
