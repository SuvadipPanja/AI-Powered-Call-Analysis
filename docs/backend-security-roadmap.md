# Backend Security & Scale Roadmap

**Target:** Air-gapped on-prem, banking-grade security, 500+ agents + 10+ admin users.

Saved from security audit — implement in order.

---

## Sprint 1 — P0 Security (week 1) ✅ Implemented

| # | Task | Status |
|---|------|--------|
| 1.1 | Authenticate audio; `/api/audio/stream/:filename` + path sanitization | Done |
| 1.2 | RBAC on `agentController.js` mutations | Done |
| 1.3 | License admin uses `req.user` | Done |
| 1.4 | Session endpoints require matching token | Done |
| 1.5 | Profile picture self-or-elevated + file limits | Done |
| 1.6 | Fail prod start if `CORS_ORIGIN` empty | Done |
| 1.7 | Remove `?token=` from auth | Done |
| 1.8 | Remove hardcoded creds in `testConnection.js` | Done |

## Sprint 2 — Secrets & RBAC (week 2) ✅ Implemented

| # | Task | Status |
|---|------|--------|
| 2.1 | Scrub logs (tokens, security answers, WS broadcast off in prod) | Done |
| 2.2 | Report/metrics RBAC by role (Agent sees own data only) | Done |
| 2.3 | Global API rate limit | Done |
| 2.4 | Remove legacy `/api/login` | Done (410 Gone) |
| 2.5 | `license.lic` out of git; deploy doc | Done |
| 2.6 | Helmet CSP for any HTML responses | Done |

## Sprint 3 — Scale & structure (week 3–4) ✅ Implemented

| # | Task | Status |
|---|------|--------|
| 3.1 | Split `server.js` into `routes/`, `services/` | Done — reports + session extracted |
| 3.2 | Redis: session cache + rate limits | Done |
| 3.3 | Redis/Bull queue: upload → AI pipeline | Done — `uploadQueue.js` |
| 3.4 | Cache hot reports (TTL) | Done |
| 3.5 | Separate WebSocket process or sticky sessions | Done — `wsHub` + Redis pub/sub + nginx sticky |
| 3.6 | PM2 cluster or multi-container compose | Done — `docker-compose.scale.yml` |
| 3.7 | `backend/README.md` ops guide | Done |

## Sprint 4 — License & tamper resistance (week 5–6) ✅ Implemented

All items are **backward compatible and opt-in** — the existing AES-256-GCM
license keeps working until you switch on enforcement. Details: `docs/license-sprint4.md`.

| # | Task | Status |
|---|------|--------|
| 4.1 | RSA-signed licenses (offline vendor key) | Done — `services/licenseSecurity.js`, `tools/sign-license.js`, `tools/generate-license-keypair.js` (v2 bundle, verify with `LICENSE_PUBLIC_KEY[_PATH]`, enforce with `LICENSE_ENFORCE_SIGNATURE`) |
| 4.2 | Hardware fingerprint binding | Done — MAC + `/etc/machine-id` composite (`getHardwareFingerprint`, `verifyHardwareBinding`); `tools/license-fingerprint.js`; legacy MAC binding still honoured |
| 4.3 | Docker entrypoint license gate | Done — `tools/license-gate.js` + `production-build/docker/license-entrypoint.sh` (opt-in `LICENSE_GATE_ENABLE=true`) |
| 4.4 | Integrity check on startup (hash manifest) | Done — `tools/build-integrity-manifest.js` (baked at build) + startup `verifyIntegrity` (`LICENSE_INTEGRITY_CHECK` / `_ENFORCE`) |
| 4.5 | Immutable license audit log | Done — `dbo.LicenseAuditLog` table + `services/licenseAudit.js` (validate/upload/expire/grace/integrity events) |
| 4.6 | Read-only grace period after expiry | Done — `evaluateExpiry` + `middleware/licenseGuard.js` (`LICENSE_GRACE_DAYS`; GET allowed, mutations 423, recovery routes open) |

---

## Architecture target (500+ agents)

```
nginx (TLS, rate limit, WSS)
  ├── api × 2–4 (stateless Express)
  ├── ws × 1–2 (sticky)
  ├── worker × 1–2 (AI queue consumer)
  ├── redis (cache + queue)
  ├── ai-mvp (GPU)
  └── SQL Server (+ read replica for reports)
```

## Secrets checklist (prod)

- [ ] `LICENSE_SECRET_KEY` (32+ chars, unique)
- [ ] `SERVICE_TOKEN`
- [ ] `ORCHESTRATOR_SECRET`
- [ ] `CALLBACK_SECRET`
- [ ] `DB_PASSWORD` (least-privilege user)
- [ ] `HOST_MAC` (real NIC, not default)
- [ ] `CORS_ORIGIN` (exact prod URL, no wildcard)

---

*Update this doc as sprints complete.*
