# Backend — AI-Powered Call Analysis

Node.js + Express API for call upload, AI orchestration, reports, licensing, and WebSocket chat.

## Stack

| Component | Role |
|-----------|------|
| **Express** | HTTP API on port `5000` |
| **WebSocket** | Real-time chat on same HTTP server |
| **SQL Server** | Users, sessions, call results, reports |
| **Redis** (optional) | Rate-limit counters + report cache TTL |
| **AI orchestrator** | `AI_MAIN_URL` — GPU pipeline for transcription/scoring |

## Directory layout

```
backend/
├── server.js              # App bootstrap, most routes (being split — Sprint 3)
├── agentController.js     # Agent CRUD routes
├── uploadHandler.js       # Audio upload + AI trigger
├── middleware/
│   ├── auth.js            # Bearer token gate
│   ├── rbac.js            # Role checks
│   ├── sessionProof.js    # Session ownership
│   ├── rateLimit.js       # Global API rate limit (Redis-backed when available)
│   ├── reportScope.js     # Agent-scoped report access
│   └── reportCache.js     # TTL cache for dashboard/report GETs
├── routes/
│   ├── sessionRoutes.js   # check-session, heartbeat, multi-session
│   ├── bankSettingsRoutes.js
│   ├── queryCategoryRoutes.js
│   ├── autoUploadRoutes.js
│   └── auditRoutes.js
└── services/
    ├── redisClient.js     # REDIS_URL connection
    ├── cacheService.js    # Redis / in-memory TTL cache
    ├── rateLimitStore.js  # Shared rate-limit store
    └── dbMigrate.js       # Startup schema migrations
```

## Environment variables

Copy `backend/.env.example` or use `production/.env` in Docker.

| Variable | Required (prod) | Description |
|----------|-----------------|-------------|
| `CORS_ORIGIN` | Yes | Exact browser origin, e.g. `http://10.64.194.130:8081` |
| `LICENSE_SECRET_KEY` | Yes | 32-char license decode key |
| `HOST_MAC` | Yes | MAC address the license is bound to |
| `ORCHESTRATOR_SECRET` | Yes | AI pipeline auth |
| `CALLBACK_SECRET` | Yes | Transcription callback auth |
| `SERVICE_TOKEN` | Yes | Internal service auth |
| `API_AUTH_ENFORCE` | Yes | Set `true` in production |
| `REDIS_URL` | Recommended | e.g. `redis://redis:6379` in compose |
| `REPORT_CACHE_TTL_SEC` | No | Dashboard cache TTL (default `60`) |
| `API_RATE_LIMIT_MAX` | No | Requests per window (default `300`) |
| `API_RATE_LIMIT_WINDOW_MS` | No | Window size ms (default `60000`) |

## Local development

```bash
cd backend
npm install
cp .env.example .env   # edit DB + secrets
npm start              # http://localhost:5000
```

Frontend dev server (`npm start` in `frontend/`) proxies API calls to `:5000`.

## Production (Docker)

Images are built from the repo root:

```powershell
docker build -t ai-call-backend:prod -f production-build/docker/Dockerfile.backend.patch .
docker tag ai-call-backend:prod sp-backend:prod
docker save -o production/docker-images/sp-backend.tar sp-backend:prod
```

On the prod server:

```bash
cd production
docker load -i docker-images/sp-backend.tar
docker compose up -d --force-recreate backend
docker compose logs -f backend
```

Expected startup logs:

- `[INFO] Redis connected: redis://redis:6379` (or in-memory fallback)
- `[INFO] Database migrations OK: …`
- `[INFO] Server is running on http://localhost:5000`

## Health checks

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /system-monitor/health` | No | Liveness |
| `POST /api/check-session` | Body token | Session validation |
| `GET /api/license-status` | No | License state |

## Security sprints (status)

| Sprint | Focus | Status |
|--------|-------|--------|
| 1 | Auth, RBAC, audio, CORS | Done |
| 2 | Log scrubbing, rate limit, Helmet | Done |
| 3 | Redis, report cache, route split | In progress |
| 4 | Signed licenses, tamper resistance | Planned |

## Sprint 3 (status)

| Feature | Module |
|---------|--------|
| Report routes extracted | `routes/reportRoutes.js`, `services/reportHelpers.js` |
| Bull upload queue | `services/uploadQueue.js` |
| WebSocket hub + Redis pub/sub | `websocket/wsHub.js` |
| Multi-instance API | `production/docker-compose.scale.yml` + `nginx/scale-api.conf` |

### Scale backend (optional, 500+ agents)

```bash
cd production
docker compose -f docker-compose.yml -f docker-compose.scale.yml up -d --scale backend=2
```

Traffic hits `api-gateway:5000` with **ip_hash** sticky sessions for WebSocket. Chat messages fan out across instances via Redis pub/sub (`WS_REDIS_PUBSUB=true`).

### Upload queue

When `REDIS_URL` is set, uploads enqueue to Bull (`audio-upload` queue) instead of firing AI inline. Logs show `AI dispatch mode=bull` or `inline` if Redis/Bull unavailable.

## Sprint 3 roadmap (remaining)

- [ ] None — Sprint 3 complete; see Sprint 4 (signed licenses)

## Troubleshooting

**Backend exits on start — CORS**

Set `CORS_ORIGIN` in `production/.env` to match the URL users open in the browser (including port).

**401 on all API calls after deploy**

Users must log in again after frontend/backend session fixes. Check `ActiveSessions` in SQL.

**Reports slow**

Ensure Redis is running (`docker compose ps redis`) and `REDIS_URL=redis://redis:6379`. Cached responses include header `X-Cache: HIT`.

**Rate limit too aggressive**

Raise `API_RATE_LIMIT_MAX` in `.env` and recreate backend.
