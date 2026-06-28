# Client Deployment & v3 License Runbook (world-class licensing)

This is the **single source of truth** for deploying the AI Call Analysis backend to a
new client server and binding it to an unforgeable, machine-locked license.

> v3 licenses are **Ed25519-signed**. They can only be created with the vendor
> private key on your laptop, and each license is bound to one server's hardware
> fingerprint. The server holds only the **public** key (baked into the image and
> integrity-locked) — it can verify but never forge.

---

## 0. One-time vendor setup (do once, ever)

On your **developer laptop only**:

```powershell
cd "C:\Project\AI-Powered Call Analysis project\backend"
node tools/gen-root-key.js ..\vendor-keys
```

Produces:

| File | Where it lives | Secret? |
|------|----------------|---------|
| `vendor-keys/vendor-root-private.pem` | **Laptop only.** Move to OS keychain / USB; never commit, never ship. | YES — passphrase-encrypted |
| `vendor-keys/vendor-root-public.pem` | Copied to `backend/keys/` and **baked into the image** | No (safe to expose) |

The public key is already baked at `backend/keys/vendor-root-public.pem` and wired
into the image via `LICENSE_PUBLIC_KEY_PATH=/app/keys/vendor-root-public.pem`. It is
in the integrity manifest, so swapping it is detectable.

> If you ever regenerate the key pair, you must rebuild the backend image (new
> public key) **and** re-issue every client's license. Treat the private key like
> a code-signing key.

`.gitignore` already excludes `*.pem`, so both keys are safe from commits. When
building from a fresh clone, force-add the public key (it is not secret):
`git add -f backend/keys/vendor-root-public.pem`.

---

## 1. Build the backend image (developer laptop)

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
# Full build of all images:
powershell -File production-build\_build-sp-images.ps1
```

The backend build **auto-flattens to 2 layers** (see "Why flatten" below), producing
`production\docker-images\sp-backend.tar`.

To rebuild **only** the backend after a code change (fast path):

```powershell
docker build --provenance=false -t sp-backend:prod -f production-build\docker\Dockerfile.backend.repatch .
docker save -o production\docker-images\sp-backend.tar sp-backend:prod
```

`Dockerfile.backend.repatch` copies the changed source onto the already-flat image,
rebuilds the integrity manifest, and re-flattens — staying at 2 layers.

> ### Why flatten?
> The patch Dockerfile does `FROM ai-call-backend:prod` + ~45 `COPY` steps, adding
> layers every build. After enough rebuilds the deployed image exceeds the host's
> overlayfs mount-options limit → **`failed to mount ...: mount options is too
> long`** and the container won't start. `Dockerfile.backend.flatten` collapses
> everything to a single layer. Always deploy the flattened tar.

---

## 2. Per-client deployment

### 2.1 Copy artifacts to the client server

| Local | Client server destination |
|-------|---------------------------|
| `production/docker-images/sp-backend.tar` (+ other `*.tar` on first install) | `<prod>/docker-images/` |
| `production/docker-compose.yml` | `<prod>/docker-compose.yml` |
| `production/.env` (edit per client — see below) | `<prod>/.env` |
| `production/scripts/` | `<prod>/scripts/` |

Key `.env` values per client:

```env
SA_PASSWORD=<strong sql password>
PUBLIC_HOST=<client server IP/host>
CORS_ORIGIN=http://<client host>:8081
# HOST_MAC / LICENSE_SECRET_KEY are NOT needed for v3 licenses.
```

The compose backend mounts (already configured):

```yaml
- ./license:/app/license            # read-write so uploads persist
- /etc/machine-id:/etc/machine-id:ro   # host identity for fingerprint
```

> Do **not** mount `/sys/class/dmi/id/product_uuid` as a file — it triggers the
> containerd "mount options is too long" bug. The container reads DMI ids from its
> own `/sys`; `/etc/machine-id` is the only mount needed.

### 2.2 First boot (fresh client → starts LOCKED)

```bash
cd <prod>
docker compose up -d                       # first install: brings up all services
# or backend only on an existing stack:
bash scripts/license-deploy.sh deploy
```

With no license installed the backend boots **locked** (`licenseState=expired`) and
the login page shows a recovery banner. This is correct and safe — login still works
(recovery mode) but every licensed feature is blocked.

### 2.3 Get the server fingerprint

```bash
bash scripts/license-deploy.sh fingerprint
```

Copy the `serverFingerprint` (64-hex). Aim for `4/4 strong identifiers`. This value
binds the license to this exact machine.

---

## 3. Issue a license (developer laptop)

### 3.1 Temporary 7-day trial (before the deal closes)

```powershell
cd "C:\Project\AI-Powered Call Analysis project\backend"
node tools/sign-license-v3.js `
  --private ..\vendor-keys\vendor-root-private.pem `
  --fingerprint <SERVER_FINGERPRINT> `
  --customer "Client Name (TRIAL)" `
  --days 7 `
  --users 50 --agents 60 `
  --features reports,audit,reva,ai-scoring `
  --ai-modules transcription,diarization,scoring --ai-jobs 4 `
  --out trial-7day.lic
```

`--days 7` sets expiry to 7 days from today. After expiry the system enters
read-only grace, then locks (configurable via `LICENSE_GRACE_DAYS`).

### 3.2 Final production license (after the deal)

```powershell
node tools/sign-license-v3.js `
  --private ..\vendor-keys\vendor-root-private.pem `
  --fingerprint <SERVER_FINGERPRINT> `
  --customer "Client Name" `
  --not-before 2026-07-01 --not-after 2027-07-01 `
  --users 500 --agents 600 `
  --features reports,audit,reva,ai-scoring `
  --ai-modules transcription,diarization,scoring --ai-jobs 8 `
  --out prod-license.lic
```

### 3.3 (Recommended) Verify the token locally before sending

```powershell
node -e "process.env.LICENSE_PUBLIC_KEY_PATH='keys/vendor-root-public.pem';const v=require('./services/licenseV3');const fs=require('fs');const raw=fs.readFileSync(process.argv[1],'utf8').trim();const r=v.verifyV3(raw);console.log('valid:',r.ok);console.log(JSON.stringify(v.evaluateV3(r.payload,{serverFingerprint:process.argv[2]}),null,2));" prod-license.lic <SERVER_FINGERPRINT>
```

Expect `valid: true` and `state: "active"`.

---

## 4. Install the license on the client

1. Open the `.lic` file, copy the **entire** token string.
2. Log in to the app as **Super Admin** (works even when locked).
3. **Admin Settings → License → paste → Activate License.**
4. Status flips to **Active** with the correct expiry. The token is written to
   `license/license.lic` and stored as the single active DB row.

The license **persists across restarts** (DB is the source of truth; the file is a
seed). Uploading a new license automatically removes all old license rows.

### Verify

```bash
bash scripts/license-deploy.sh status     # endDate / licenseState=active
bash scripts/license-deploy.sh rows       # expect rows = 1
# restart test:
docker compose restart backend && bash scripts/license-deploy.sh status
```

---

## 5. Switching an existing v2 server to v3 (clean slate)

If a server already ran a v2 (MAC/AES) license and you are moving it to v3:

```bash
cd <prod>
bash scripts/license-deploy.sh clean-slate        # wipes DB rows + file, reboots locked
# (add --yes to skip the confirmation prompt)
```

Then issue + upload a v3 license (sections 3–4). This avoids a stale v2 file
resurrecting on restart.

---

## 6. Renew / replace a license

Just issue a new v3 license (new dates) for the **same fingerprint** and upload it
via Admin → License. The old row is removed automatically. No downtime, no file
juggling. To revoke an old license id, pass `--revoke <oldLicenseId>` when signing
the replacement.

---

## 7. `license-deploy.sh` reference

```bash
bash scripts/license-deploy.sh deploy        # load tar + recreate backend + fingerprint + status
bash scripts/license-deploy.sh fingerprint   # print server fingerprint for signing
bash scripts/license-deploy.sh status        # current license status JSON
bash scripts/license-deploy.sh rows          # license row count (expect 1)
bash scripts/license-deploy.sh clean-slate   # wipe DB+file, reboot locked (--yes to skip prompt)
```

Env overrides: `DB_CONTAINER`, `BACKEND_CONTAINER`, `DB_NAME` (default
`call_analysis_db`), `SA_PASSWORD` (else read from `.env`), `PUBLIC_HOST`.

---

## 8. Troubleshooting (issues seen in the field)

| Symptom | Cause | Fix |
|--------|-------|-----|
| `failed to mount ...: mount options is too long` | Image has too many layers from repeated patch builds | Deploy the **flattened** tar (`_build-sp-images.ps1` does this; or use `Dockerfile.backend.flatten`) |
| `Error uploading license` banner, but status shows active | File write failed (read-only `./license` mount) after DB update | Ensure compose mounts `./license:/app/license` **without** `:ro` (already fixed); re-upload |
| After restart, license reverts to an old one | Stale `license.lic` file overriding | Fixed: DB is now source of truth. If still seen, run `clean-slate` then re-upload |
| Login blocked: "License expired. Please contact your administrator" | License guard blocked `check-login-availability` when locked | Fixed: recovery whitelist + recovery-mode login. Rebuild/redeploy backend |
| "Failed to load license data" on Admin → License | Guard blocked `license-history`/`license-details` when locked | Fixed: both whitelisted for recovery. Rebuild/redeploy backend |
| `Invalid object name 'CallAnalysisDB.dbo.Licenses'` | Wrong DB name | DB is `call_analysis_db` |
| `Login failed for user 'sa'` | `SA_PASSWORD` not in shell | Use `scripts/license-deploy.sh` (reads `.env`) or pass the password explicitly |
| Fingerprint strength < 4/4 | Some DMI ids unreadable in the VM | Still works on `machine-id`; optionally also bind `--allowed-macs`. Re-issue if the fingerprint value changes |
| `Hardware fingerprint mismatch` on upload | License signed for a different server | Re-run `fingerprint` on this server and sign a new license for that value |

---

## 9. Security properties (what this gives you)

- **Unforgeable** — licenses require the laptop-only Ed25519 private key; servers
  hold the public key only.
- **Machine-bound** — tied to the server hardware fingerprint; copying the `.lic`
  to another machine fails (`Hardware fingerprint mismatch`). No hardcoded MAC.
- **Tamper-evident** — public key + license logic + auth/RBAC files are in the
  startup integrity manifest (12 files); modifying any is detectable.
- **Fail-closed** — no/invalid/expired license boots locked; recovery login only.
- **Entitlements in the license** — `maxConcurrentUsers`, `maxAgents`, feature
  flags, and AI modules are signed into the token and enforced at runtime.
- **Grace, then lock** — expired licenses get a read-only grace window before full
  lock, so reporting survives a renewal gap.
