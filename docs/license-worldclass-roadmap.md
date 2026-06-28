# World-Class License System — Roadmap (Sprint 5 → Sprint 9)

Builds on Sprint 4 (RSA verify, fingerprint, grace, integrity, audit). This is the
**plan only** — no code yet. Goal: a banking-grade, air-gapped, anti-tamper license
that is **issued exclusively from your dev laptop**, **bound to one server**, controls
**concurrent users** and **ai-mvp**, detects **clock tampering**, and exposes **no
forgeable secret** to the client.

---

## 0. Threat model (read first — sets honest expectations)

The client runs your Docker images on **their** hardware with **root**. Therefore:

| Claim | Reality |
|-------|---------|
| "No secret visible to client" | True **only for asymmetric private keys** (they never ship). Anything inside the image the client can eventually read. So the license **trust anchor must be a public key** (safe to expose) — not a symmetric secret. |
| "Only my laptop can create a license" | Achieved by keeping the **private signing key off all shipped artifacts** + binding the signing tool to the laptop hardware + optional hardware token (YubiKey). |
| "Client cannot forge / patch it out" | We can make tampering **economically and technically impractical** (native addon, bytecode, self-integrity, multi-point cross-checks), but a determined attacker with root on an interpreted runtime can never be made *mathematically* impossible. Banking-grade = raise cost + legal + audit, not perfection. |

**Design principle:** *Verify with public key everywhere; sign with private key only on the laptop; fail closed; cross-check in multiple independent places.*

---

## Key & trust hierarchy (the foundation)

```
Vendor Root Key (Ed25519)         ← PRIVATE on your laptop ONLY (HW token / encrypted keychain)
        │ signs
        ├── License tokens (v3)    ← shipped to each customer, bound to their server
        └── Public key (LICENSE_PUBLIC_KEY) ← baked into backend + ai-mvp images (verify only)
```

- **Ed25519** (or RSA-4096) asymmetric. **Remove `LICENSE_SECRET_KEY`** from the trust path
  (keep only as legacy fallback during migration, then delete).
- Private key options (pick one, strongest first):
  1. **Hardware token (YubiKey / PIV)** — signing physically requires the device. Cannot be copied.
  2. **OS keychain + passphrase** — encrypted at rest, decrypted only on your laptop.
  3. Encrypted PEM + laptop-fingerprint lock on the signing CLI.

---

## License token v3 (signed JSON / JWS-style)

```jsonc
{
  "v": 3,
  "licenseId": "uuid",
  "customer": "Acme Bank",
  "issuedAt": "2026-06-28T00:00:00Z",
  "notBefore": "2026-07-01T00:00:00Z",
  "notAfter":  "2027-07-01T00:00:00Z",
  "hardware": {
    "serverFingerprint": "sha256(macs + machine-id + product_uuid + disk-serial)",
    "allowedMacs": ["8C:84:74:6B:08:7E"]
  },
  "limits": {
    "maxConcurrentUsers": 500,
    "maxAgents": 600,
    "features": ["reports", "audit", "reva", "ai-scoring"]
  },
  "ai": { "enabledModules": ["transcription","diarization","scoring"], "maxConcurrentJobs": 8 },
  "revocation": { "crl": ["revoked-license-id-1"] },
  "issuerKeyId": "vendor-2026",
  "signature": "ed25519(base64)"   // over the canonical JSON minus this field
}
```

Self-contained, offline-verifiable, no server callback needed (air-gap friendly).

---

## Sprint 5 — Asymmetric core + runtime fingerprint (no hardcode)

**Outcome:** licenses are signed only by your laptop; server computes its own fingerprint at boot; `HOST_MAC` hardcoding removed in prod.

| # | Task | Files |
|---|------|-------|
| 5.1 | Ed25519 key pair generator (laptop) | `backend/tools/gen-root-key.js` |
| 5.2 | v3 token signer (laptop-only) + verifier (shared) | `tools/sign-license-v3.js`, `services/licenseV3.js` |
| 5.3 | Runtime server fingerprint: MACs + `/etc/machine-id` + `/sys/class/dmi/id/product_uuid` + disk serial — **computed at container start, nothing hardcoded** | `services/hardwareId.js` |
| 5.4 | Remove `HOST_MAC` requirement in prod; allow override **only** when `NODE_ENV!=production` (dev) | `server.js`, compose env |
| 5.5 | Fingerprint helper tool the client runs once → sends you the value to mint a license | `tools/print-server-id.js` |
| 5.6 | Backward-compat: accept v2 (Sprint 4) and legacy during migration window | `services/licenseV3.js` |

**Laptop → server flow:**
1. Client runs `docker exec ... node tools/print-server-id.js` → sends you `serverFingerprint`.
2. You run on your laptop: `sign-license-v3 --fingerprint <X> --users 500 --until 2027-07-01`.
3. License only verifies on that exact server (fingerprint mismatch → rejected).

---

## Sprint 6 — Secret hygiene: nothing forgeable in the client

**Outcome:** the only thing in the image is the **public** key; all runtime secrets via **Docker secrets**; probing reveals nothing useful.

| # | Task | Notes |
|---|------|-------|
| 6.1 | Migrate DB password, `SERVICE_TOKEN`, `ORCHESTRATOR_SECRET`, `CALLBACK_SECRET` to **Docker secrets** (`/run/secrets/*`), not env | compose `secrets:` |
| 6.2 | Generate per-install secrets at first boot via `crypto.randomBytes`, store in a Docker volume the client can't meaningfully read/alter without detection | entrypoint |
| 6.3 | **Delete `LICENSE_SECRET_KEY`** from the trust path once all licenses are v3 | server, env |
| 6.4 | Public key embedded + integrity-hashed (Sprint 4 manifest extended to cover the key) | manifest |
| 6.5 | Redact all license internals from API/logs; `license-status` returns *state only*, never payload/secrets | already mostly done |
| 6.6 | "Client probing fails": any tamper/secret-extraction attempt → fail closed + audit event, no useful error detail | guard |

---

## Sprint 7 — Anti-tamper hardening (raise the cost)

**Outcome:** verification logic + public key are not trivially editable; tampering is detected and self-disabling.

| # | Task | Tech |
|---|------|------|
| 7.1 | Move verify + public key into a **native N-API addon** (Rust `napi-rs` or C++) | compiled `.node` |
| 7.2 | **Bytecode-compile** the JS that loads the addon (`bytenode` / V8 snapshot) so source isn't readable | build step |
| 7.3 | **Self-integrity at runtime**: addon verifies its own hash + key + critical JS against a vendor-signed manifest | extends Sprint 4 |
| 7.4 | **Multi-point cross-checks**: public key fingerprint stored in ≥3 files; mismatch → lockdown | guard |
| 7.5 | Obfuscate + strip remaining JS; remove source maps in prod image | build |
| 7.6 | Optional: docker image label signed + verified at entrypoint (image tamper) | entrypoint |

> Honesty: 7.1–7.5 don't make patching *impossible*, they make it require a skilled
> reverse engineer and lots of time — the banking-grade deterrence bar.

---

## Sprint 8 — Time-tamper + real-time control + concurrent users

**Outcome:** clock rollback/VM-snapshot rollback detected; license state pushed live; seat limits enforced atomically; kill switch.

| # | Task | How |
|---|------|-----|
| 8.1 | **Monotonic time high-water mark**: persist last-seen time (HMAC'd with per-install secret) in **DB + file + Redis**; on each heartbeat compare wall clock; `now < highWater - skew` ⇒ **clock tampering ⇒ lockdown** | `services/timeGuard.js` |
| 8.2 | **VM snapshot/rollback detection**: incrementing signed boot counter + nonce; regression ⇒ lockdown | timeGuard |
| 8.3 | **Periodic re-validation**: re-verify license every N min + on privileged actions; not just at boot | scheduler |
| 8.4 | **Real-time push**: broadcast `licenseState` over the existing WebSocket hub; clients lock UI instantly on revoke/expiry/grace | `wsHub.js` |
| 8.5 | **Concurrent users from license**: move `maxConcurrentUsers` into v3 token; enforce **atomically** in `authGate` (DB tx / Redis counter); over-limit ⇒ refuse + WS-disconnect oldest | `auth.js`, `miscRoutes` |
| 8.6 | **Kill switch / revocation (CRL)**: license carries revoked IDs; uploading a newer license can revoke old; revoked ⇒ immediate lockdown + audit | guard |
| 8.7 | All events to `LicenseAuditLog` (tamper, rollback, seat-exceeded, revoke) | audit |

---

## Sprint 9 — ai-mvp under license control

**Outcome:** the AI pipeline refuses to process unless the backend proves a valid license; AI entitlements come from the license.

| # | Task | How |
|---|------|-----|
| 9.1 | Bake the **public key** into the ai-mvp image; verify the mounted license on startup + periodically | ai-mvp |
| 9.2 | Backend issues **short-lived signed "work tokens"** per AI job (install key); ai-mvp verifies before processing | backend + ai-mvp |
| 9.3 | If license invalid/expired/over-limit ⇒ backend **stops issuing** work tokens ⇒ ai-mvp idles | orchestrator |
| 9.4 | `ai.enabledModules` / `maxConcurrentJobs` from the license enforced in the orchestrator | ai-mvp |
| 9.5 | ai-mvp ↔ backend heartbeat; lost license ⇒ both lock | both |

---

## Laptop-only issuance — exactly how "only my laptop" is guaranteed

1. **Private key never leaves the laptop** (ideally a YubiKey: signing is a physical operation).
2. Signing CLI **binds to the laptop fingerprint** — refuses to run on other hardware even if copied.
3. Encrypted key store + passphrase — a stolen file is useless without the passphrase + laptop.
4. The image has **only the public key** → mathematically cannot create a valid signature.
5. Result: someone on other hardware "creating a similar license" produces a signature the
   server's public key **rejects**. There is no symmetric secret to steal anymore.

---

## Migration path (keeps your live 2031 license working)

```
Phase A (Sprint 5): images verify v3 AND v2 AND legacy. Issue your first v3 license. No downtime.
Phase B (Sprint 6): switch enforcement to v3-only flag once the v3 license is installed & verified.
Phase C: delete LICENSE_SECRET_KEY + legacy decode. Symmetric secret gone for good.
```

Every sprint ends with: rebuild `sp-backend.tar` (and `sp-aimvp.tar` for Sprint 9), deploy, verify via `/api/license-status` + audit log.

---

---

## Sprint 5 — IMPLEMENTED (core libs + vendor tools)

Decisions locked: **Ed25519**, **passphrase-encrypted private key (OS-keychain friendly)**,
**Rust napi addon deferred to Sprint 7**, **`HOST_MAC` hardcoding removed in prod** (next wiring step).

| File | Purpose |
|------|---------|
| `backend/services/hardwareId.js` | Runtime server/VM fingerprint from host identifiers (machine-id, DMI product_uuid, board/disk serial). MAC is best-effort only (container MAC ≠ host MAC). |
| `backend/services/licenseV3.js` | Ed25519 sign/verify + canonical JSON + `evaluateV3` (hardware binding, expiry/grace via `LICENSE_GRACE_DAYS`, CRL, limits). Offline, no symmetric secret. |
| `backend/tools/gen-root-key.js` | Laptop: generate Ed25519 root pair; private key AES-256-CBC + passphrase. |
| `backend/tools/sign-license-v3.js` | Laptop-only: mint a v3 license bound to a server fingerprint + user/agent/AI limits. |
| `backend/tools/print-server-id.js` | Customer runs inside container → returns `serverFingerprint` to send to vendor. |

Self-test verified: valid verify ✓, tampered token rejected ✓, wrong key rejected ✓,
wrong-server rejected ✓, grace/expired states correct ✓.

### Required read-only mounts (for accurate host fingerprint in Docker)

```yaml
# docker-compose.yml → backend (and ai-mvp in Sprint 9)
volumes:
  - /etc/machine-id:/etc/machine-id:ro
# DMI product_uuid is exposed via /sys on most hosts automatically.
```

### v3 issuance flow

```
1. Customer:  docker exec ai_call_backend node tools/print-server-id.js   → sends serverFingerprint
2. You (laptop, one-time):  node tools/gen-root-key.js                     → vendor-root-{private,public}.pem
3. Bake vendor-root-public.pem into images; set LICENSE_PUBLIC_KEY_PATH
4. You (laptop, per customer):
     node tools/sign-license-v3.js --private vendor-keys/vendor-root-private.pem \
       --fingerprint <X> --customer "Acme" --users 500 --agents 600 \
       --not-after 2027-07-01 --features reports,audit,reva,ai-scoring \
       --ai-modules transcription,diarization,scoring --ai-jobs 8 --out license.lic
5. Customer installs license.lic via the existing upload-license flow.
```

### Remaining Sprint 5 wiring (next step, additive — keeps live v2 license working)

- [ ] `server.js` `decodeLicense`/validation: detect v3 (`licenseV3.isV3Token`) → verify+evaluate path; else fall back to v2/legacy.
- [ ] Surface `limits.maxConcurrentUsers` from v3 into the existing `check-login-availability` (replaces `payload.users`).
- [ ] Remove `HOST_MAC` requirement in prod; keep dev-only override behind `NODE_ENV!=production`.
- [ ] Add `/etc/machine-id:ro` mount to compose; copy new files in `Dockerfile.backend.patch`; rebuild `sp-backend.tar`.

---

## What I need from you to continue

- **Key custody preference:** (a) YubiKey/hardware token (strongest), (b) OS keychain + passphrase, or (c) encrypted PEM + laptop lock.
- **Algorithm:** Ed25519 (recommended, small & fast) or RSA-4096 (familiar).
- **Native addon language for Sprint 7:** Rust (`napi-rs`) or C++ — or defer 7.1 and start with bytecode-only.
- Confirm you want me to **remove `HOST_MAC`** hardcoding in prod (dev override stays).
```
