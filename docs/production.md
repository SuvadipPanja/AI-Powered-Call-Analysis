# Production deployment checklist

Full server setup: **[nginx + SSL guide](nginx-ssl-setup.md)** (with domain)  
**No domain yet?** **[Linux IP-only deploy](linux-deploy-no-domain.md)**  
Env templates: **`deploy/env/`**

## Environment variables

Copy templates from `deploy/env/` → real `.env` files on the server:

| Template | Target on server |
|----------|------------------|
| `deploy/env/backend.env.production.example` | `backend/.env` (with domain) |
| `deploy/env/backend.env.production.ip.example` | `backend/.env` (**no domain — use server IP**) |
| `deploy/env/frontend.env.production.example` | `frontend/.env.production` (with domain) |
| `deploy/env/frontend.env.production.ip.example` | `frontend/.env.production` (**no domain**) |
| `deploy/env/ai-mvp.env.production.example` | `ai-mvp/.env` |
| `deploy/env/autoupload.env.production.example` | `AutoUpload/.env` |

| Variable | Where | Notes |
|----------|-------|-------|
| `NODE_ENV` | backend | Set to `production` |
| `CORS_ORIGIN` | backend | `https://your-domain.com` (exact, no wildcard) |
| `REACT_APP_API_BASE_URL` | frontend build | Same HTTPS origin |
| `REACT_APP_WS_URL` | frontend build | `wss://your-domain.com/ws` |
| `ORCHESTRATOR_SECRET` | backend + ai-mvp | Same 64-char hex in both files |
| `CALLBACK_SECRET` | backend + ai-mvp | Same 64-char hex in both files |
| `SERVICE_TOKEN` | backend + AutoUpload | Server-to-server upload auth |
| `LICENSE_SECRET_KEY` | backend | 32-char license decode key |
| `HOST_MAC` | backend | Production server MAC for license |
| `API_AUTH_ENFORCE` | backend | Keep `true` in production |
| `DB_*` | backend + ai-mvp | Production SQL Server credentials |

Generate secrets:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Never commit real `.env` files.

## Services

1. **Backend** — `NODE_ENV=production node server.js` (port 5000, localhost only)
2. **Frontend** — `npm run build`; nginx serves `frontend/build/` (see nginx guide)
3. **AI orchestrator** — `python orchestrator.py` (port 8000, internal only)
4. **Redis / Ollama** — if scoring or job queue is enabled

## Restart after env changes

```bash
sudo systemctl restart call-analysis-backend call-analysis-ai
# Rebuild frontend if REACT_APP_* changed:
cd frontend && npm run build && sudo systemctl reload nginx
```

## Reverse proxy + TLS

See **[docs/nginx-ssl-setup.md](nginx-ssl-setup.md)** and `deploy/nginx.conf.example`.

## Security notes

- Security question answers are bcrypt-hashed (case-insensitive). Plain-text answers in the DB are migrated on next successful login.
- Set `CORS_ORIGIN` to your public HTTPS domain — no wildcards.
- Keep orchestrator (port 8000) and backend (port 5000) on localhost; only nginx (443) is public.
- Change all default seed passwords before go-live.
