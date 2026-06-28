# License Generation Guide (v3 — Ed25519, machine-bound)

How to create and install a v3 license for a client server. Licenses are signed
**only on the developer laptop** with the vendor private key, and each license is
bound to one server's hardware fingerprint.

> Full background + architecture: `docs/CLIENT-DEPLOYMENT-V3-LICENSE.md`.
> This file is the quick, copy-paste operational checklist.

---

## SHELL GOTCHA — read this first

The multi-line examples use the PowerShell backtick (`` ` ``) for line breaks.
**They only work in PowerShell, NOT in Command Prompt (cmd.exe).**

- In **Command Prompt**: paste the whole command on **ONE line** (no backticks).
- In **PowerShell**: the backtick line-continuation works as written.

If you see `'--fingerprint' is not recognized as an internal or external command`,
you pasted a multi-line PowerShell command into cmd.exe — put it on one line.

---

## Step 1 — Get the server fingerprint (on the client server)

```bash
cd ~/Call-Analysis/Project/production
docker exec ai_call_backend node /app/tools/print-server-id.js
# or:
bash scripts/license-deploy.sh fingerprint
```

Copy the 64-hex `serverFingerprint`. Aim for `4/4 strong identifiers`.

Example (this server): `073a88c4704e0ba951dde8b1b2c7b959362ddb85a17b33c3ab5e338760fe51d0`

---

## Step 2 — Sign the license (on the developer laptop)

### Command Prompt (cmd.exe) — single line

Production (1 year):

```cmd
node tools/sign-license-v3.js --private ..\vendor-keys\vendor-root-private.pem --fingerprint <SERVER_FP> --customer "Client Name" --not-before 2026-06-28 --not-after 2027-06-28 --users 500 --agents 600 --features reports,audit,reva,ai-scoring --ai-modules chunking,language-detection,diarization,transcription,translation,tone-analysis,scoring,sentiment,sentence-similarity --ai-jobs 8 --out v3-license.lic
```

Temporary 7-day trial (use before the deal closes):

```cmd
node tools/sign-license-v3.js --private ..\vendor-keys\vendor-root-private.pem --fingerprint <SERVER_FP> --customer "Client Name (TRIAL)" --days 7 --users 50 --agents 60 --features reports,audit,reva,ai-scoring --ai-modules chunking,language-detection,diarization,transcription,translation,tone-analysis,scoring,sentiment,sentence-similarity --ai-jobs 4 --out trial-7day.lic
```

Run from `C:\Project\AI-Powered Call Analysis project\backend`. Enter the private
key passphrase when prompted.

### PowerShell — multi-line (backticks OK)

```powershell
cd "C:\Project\AI-Powered Call Analysis project\backend"
node tools/sign-license-v3.js `
  --private ..\vendor-keys\vendor-root-private.pem `
  --fingerprint <SERVER_FP> `
  --customer "Client Name" `
  --not-before 2026-06-28 --not-after 2027-06-28 `
  --users 500 --agents 600 `
  --features reports,audit,reva,ai-scoring `
  --ai-modules chunking,language-detection,diarization,transcription,translation,tone-analysis,scoring,sentiment,sentence-similarity `
  --ai-jobs 8 `
  --out v3-license.lic
```

### Flags

| Flag | Meaning |
|------|---------|
| `--private` | Path to `vendor-root-private.pem` (laptop only) |
| `--fingerprint` | Server fingerprint from Step 1 (binds license to that machine) |
| `--customer` | Customer label shown in the admin panel |
| `--not-before` / `--not-after` | Validity window (`YYYY-MM-DD`) |
| `--days N` | Shortcut: expiry N days from today (e.g. `--days 7`). Ignored if `--not-after` is given |
| `--users` / `--agents` | Concurrent-user / agent caps (`0` = unlimited) |
| `--features` | Web feature flags |
| `--ai-modules` | AI pipeline modules (canonical names below). **Omit for ALL modules** |
| `--ai-jobs` | Max concurrent AI jobs (`0` = unlimited) |
| `--allowed-macs` | Optional MAC fallback binding |
| `--revoke` | Comma list of old licenseIds to revoke |
| `--out` | Output file (default `license.lic`) |

### Canonical AI module names (must match the pipeline)

```
chunking, language-detection, diarization, transcription, translation,
tone-analysis, scoring, sentiment, sentence-similarity
```

Defined in `backend/services/aiEntitlement.js` (CANONICAL_AI_MODULES). Omit
`--ai-modules` entirely to license all AI modules (unrestricted).

---

## Step 3 — (Optional) Verify locally before sending

```powershell
cd "C:\Project\AI-Powered Call Analysis project\backend"
node -e "process.env.LICENSE_PUBLIC_KEY_PATH='keys/vendor-root-public.pem';const v=require('./services/licenseV3');const fs=require('fs');const raw=fs.readFileSync(process.argv[1],'utf8').trim();const r=v.verifyV3(raw);console.log('valid:',r.ok);console.log(JSON.stringify(v.evaluateV3(r.payload,{serverFingerprint:process.argv[2]}),null,2));" v3-license.lic <SERVER_FP>
```

Expect `valid: true` and `state: "active"`.

---

## Step 4 — Install on the client

1. Open the `.lic` file, copy the **entire** token string.
2. Log in as **Super Admin** (works even if the system is locked — recovery mode).
3. **Admin Settings → License → paste → Activate License.**
4. Status flips to **Active** with the correct expiry. Uploading auto-replaces any
   previous license (single active row, DB is source of truth).

### Verify (on the server)

```bash
bash scripts/license-deploy.sh status     # licenseState=active, correct endDate
bash scripts/license-deploy.sh rows       # expect rows = 1
docker compose restart backend && bash scripts/license-deploy.sh status   # survives restart
```

---

## Renew / replace

Issue a new license for the **same fingerprint** (new dates) and upload it. The
old row is removed automatically. To revoke the old one explicitly, add
`--revoke <oldLicenseId>` when signing.

## Fresh client / switching from v2

```bash
bash scripts/license-deploy.sh clean-slate   # wipe DB rows + file, reboot locked
# add --yes to skip the confirmation prompt
```

Then sign + upload as above.

---

## NEVER commit / ship

- `vendor-keys/vendor-root-private.pem` — laptop only (passphrase-encrypted).
- Any `*.lic` token — generated per server.
  (`.gitignore` blocks `*.lic` and `vendor-keys/`.)
The **public** key (`backend/keys/vendor-root-public.pem`) IS baked into the image
and is safe to ship.
