# Production environment templates

Replace `YOUR_COMPANY.com` with your real domain everywhere before deploy.

| File | Copy to (on server) | When to apply |
|------|---------------------|---------------|
| `backend.env.production.example` | `/opt/call-analysis/backend/.env` | Before `npm start` |
| `frontend.env.production.example` | `/opt/call-analysis/frontend/.env.production` | Before `npm run build` |
| `ai-mvp.env.production.example` | `/opt/call-analysis/ai-mvp/.env` | Before starting orchestrator |
| `autoupload.env.production.example` | `/opt/call-analysis/AutoUpload/.env` | Before starting AutoUpload |

## Secret checklist (generate unique values)

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Secret | Files that must match |
|--------|------------------------|
| `ORCHESTRATOR_SECRET` | `backend/.env` + `ai-mvp/.env` |
| `CALLBACK_SECRET` | `backend/.env` + `ai-mvp/.env` |
| `SERVICE_TOKEN` | `backend/.env` + `AutoUpload/.env` |

## Domain mapping (example)

| Setting | Example value |
|---------|---------------|
| Public URL | `https://calls.acme.com` |
| `CORS_ORIGIN` | `https://calls.acme.com` |
| `REACT_APP_API_BASE_URL` | `https://calls.acme.com` |
| `REACT_APP_WS_URL` | `wss://calls.acme.com/ws` |
| `API_BASE_URL` (AutoUpload) | `http://127.0.0.1:5000` (internal) |
| `AI_MAIN_URL` (backend) | `http://127.0.0.1:8000` (internal) |

See [nginx + SSL setup](../../docs/nginx-ssl-setup.md) for full server configuration.
