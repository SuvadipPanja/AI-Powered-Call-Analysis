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

## Sprint 2 — Secrets & RBAC (week 2)

| # | Task |
|---|------|
| 2.1 | Scrub logs (tokens, security answers, WS broadcast off in prod) |
| 2.2 | Report/metrics RBAC by role (Agent sees own data only) |
| 2.3 | Global API rate limit |
| 2.4 | Remove legacy `/api/login` |
| 2.5 | `license.lic` out of git; deploy doc |
| 2.6 | Helmet CSP for any HTML responses |

## Sprint 3 — Scale & structure (week 3–4)

| # | Task |
|---|------|
| 3.1 | Split `server.js` into `routes/`, `services/` |
| 3.2 | Redis: session cache + rate limits |
| 3.3 | Redis/Bull queue: upload → AI pipeline |
| 3.4 | Cache hot reports (TTL) |
| 3.5 | Separate WebSocket process or sticky sessions |
| 3.6 | PM2 cluster or multi-container compose |
| 3.7 | `backend/README.md` ops guide |

## Sprint 4 — License & tamper resistance (week 5–6)

| # | Task |
|---|------|
| 4.1 | RSA-signed licenses (offline vendor key) |
| 4.2 | Hardware fingerprint binding |
| 4.3 | Docker entrypoint license gate |
| 4.4 | Integrity check on startup (config/hash manifest) |
| 4.5 | Immutable license audit log |
| 4.6 | Read-only grace period after expiry |

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
