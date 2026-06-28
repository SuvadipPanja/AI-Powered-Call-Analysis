# Sprint 4 — License & Tamper Resistance

Banking-grade, air-gap-friendly license hardening. Everything here is
**backward compatible and opt-in**: the existing AES-256-GCM license keeps
working unchanged until you switch on enforcement.

## What changed

| Capability | Module | Activation |
|---|---|---|
| RSA-signed (v2) licenses | `services/licenseSecurity.js`, `services/licenseCodec.js` | `LICENSE_PUBLIC_KEY_PATH` (verify), `LICENSE_ENFORCE_SIGNATURE=true` (require) |
| Hardware fingerprint binding | `services/licenseSecurity.js` | automatic; license may carry `macAddress` and/or `fingerprint` |
| Read-only grace period | `middleware/licenseGuard.js` | `LICENSE_GRACE_DAYS=N` |
| Startup integrity check | `tools/build-integrity-manifest.js` | `LICENSE_INTEGRITY_CHECK=true` (+ `_ENFORCE`) |
| Immutable audit log | `services/licenseAudit.js`, `dbo.LicenseAuditLog` | automatic |
| Docker entrypoint gate | `tools/license-gate.js`, `license-entrypoint.sh` | `LICENSE_GATE_ENABLE=true` |

## Why it's safe to deploy now

- No new runtime dependencies — Node's built-in `crypto` only.
- A legacy AES license (no RSA wrapper) is detected and validated exactly as
  before. RSA checks only run when a v2 bundle is present (then a public key
  is **required** — fail closed).
- Enforcement flags all default to `false` / `0`.
- Runtime defaults to **locked** (`licenseState=expired`) until startup validation
  succeeds; any validation failure keeps the API restricted via `licenseGuard`.

---

## 1. RSA-signed licenses (4.1)

A **v2 license** is `base64( { v:2, license:<legacy-aes>, signature:<rsa-b64> } )`.
The inner `license` is the same AES-256-GCM string the backend already decodes,
so v2 licenses are self-contained. The RSA signature is made with the vendor's
**offline private key**; the server holds only the **public key** and therefore
cannot forge a license.

### Vendor: one-time key generation (offline machine)

```bash
node tools/generate-license-keypair.js ./license-keys
# → license-keys/license-private.pem   (KEEP OFFLINE, never commit)
# → license-keys/license-public.pem    (ship with backend)
```

### Vendor: issue a signed license

```bash
# Get the customer's fingerprint first (see §2), then:
LICENSE_SECRET_KEY=<32-char-secret> \
  node tools/sign-license.js \
    --payload payload.json \
    --private license-keys/license-private.pem \
    --out license.lic
```

`payload.json`:

```json
{
  "signature": "$Panja",
  "macAddress": "8C:84:74:6B:08:7E",
  "fingerprint": "<sha256 from tools/license-fingerprint.js>",
  "startDate": "2026-01-01",
  "endDate": "2027-01-01",
  "customer": "Acme Bank",
  "seats": 500
}
```

To sign an **existing** AES license without re-issuing it:

```bash
node tools/sign-license.js --wrap existing-license.txt \
  --private license-keys/license-private.pem --out license.lic
```

### Server: enable verification

```env
LICENSE_PUBLIC_KEY_PATH=/app/secrets/license-public.pem
# Once every deployed license is v2-signed:
LICENSE_ENFORCE_SIGNATURE=true
```

---

## 2. Hardware fingerprint (4.2)

```bash
# Run inside the backend container on the customer server:
node tools/license-fingerprint.js
```

Output includes `macAddresses`, `machineId`, and a composite `fingerprint`.
Put `fingerprint` (and/or `macAddress`) in the license payload. Validation
accepts whichever binding the license carries — legacy MAC-only licenses are
unaffected. `HOST_MAC` still overrides MAC detection for VM/container hosts.

---

## 3. Read-only grace period (4.6)

```env
LICENSE_GRACE_DAYS=7
```

- **active** → normal.
- **grace** (expired, within window) → GET requests allowed; mutating requests
  return `423 LICENSE_GRACE_READ_ONLY`. Login, logout, session checks, branding,
  and `upload-license` stay open so an admin can renew.
- **expired** (grace exhausted) → API blocked `403 LICENSE_EXPIRED` except
  recovery routes.

`GET /api/license-status` now returns `licenseState` and `graceRemaining`.

---

## 4. Startup integrity check (4.4)

The image build bakes `integrity-manifest.json` (sha256 of security-critical
files). At boot:

```env
LICENSE_INTEGRITY_CHECK=true     # warn on mismatch
LICENSE_INTEGRITY_ENFORCE=true   # refuse to start on mismatch
```

Regenerate the manifest after intentional changes:

```bash
node tools/build-integrity-manifest.js /app /app/integrity-manifest.json
```

---

## 5. Immutable audit log (4.5)

`dbo.LicenseAuditLog` is created by migrations. Events recorded:
`LICENSE_VALIDATED`, `LICENSE_UPLOAD`, `LICENSE_EXPIRED`, `LICENSE_GRACE`,
`INTEGRITY_CHECK` — with outcome, detail, actor, fingerprint, timestamp.
Writes are best-effort and never block validation.

```sql
SELECT TOP 100 * FROM dbo.LicenseAuditLog ORDER BY CreatedAt DESC;
```

---

## 6. Docker entrypoint gate (4.3)

Refuses to boot without a valid (or within-grace) license. Opt-in:

```yaml
# docker-compose.yml → backend service
entrypoint: ["/app/license-entrypoint.sh"]
command: ["node", "server.js"]
environment:
  LICENSE_GATE_ENABLE: "true"
```

Dev bypass: `LICENSE_GATE_DISABLE=true`.

---

## Rollout order (recommended)

1. Deploy this build with all flags **off** — verify nothing changes.
2. Turn on `LICENSE_GRACE_DAYS` and confirm grace/expiry behaviour.
3. Generate keypair, ship public key, re-issue licenses as v2, set
   `LICENSE_PUBLIC_KEY_PATH`.
4. After all licenses are v2: set `LICENSE_ENFORCE_SIGNATURE=true`.
5. Optionally enable `LICENSE_GATE_ENABLE` and `LICENSE_INTEGRITY_CHECK`.
