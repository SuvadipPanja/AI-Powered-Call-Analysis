# AI-Powered Call Analysis — Frontend

Production React app (Create React App) served as static files behind nginx in `sp-frontend.tar`.

## Environment variables (`REACT_APP_*`)

CRA embeds every `REACT_APP_*` variable into the **public JavaScript bundle at build time**.  
Do **not** put secrets here — anyone can read them in the browser.

Copy `.env.example` to `.env` for local dev, or `.env.production` for production builds.

| Variable | Required | Description | Local example | Production (IP / same-origin) |
|----------|----------|-------------|---------------|-------------------------------|
| `REACT_APP_API_BASE_URL` | No* | Backend REST origin (no trailing slash). When empty, runtime uses `window.location.origin` (nginx proxies `/api/` → backend). | `http://localhost:5000` | Leave empty or `http://10.64.194.130:8081` |
| `REACT_APP_WS_URL` | No* | WebSocket origin for live chat / status. When empty, runtime uses `ws(s)://<hostname>:8080`. | `ws://localhost:8080` | Leave empty (uses port **8080** on server hostname) |
| `REACT_APP_ENV` | No | Label shown in logs / diagnostics | `development` | `production` |
| `REACT_APP_LOGIN_BACKGROUND_URL` | No | Login page background image path | `/images/background.jpg` | `/images/background.jpg` |
| `REACT_APP_LOG_DIR` | No | Reference only (not used in browser) | `/app/logs` | `/opt/call-analysis/logs/frontend` |

\*Recommended for local dev; **optional in Docker prod** when nginx serves the UI and proxies API on the same origin.

All variables are read through `src/utils/envConfig.js` (runtime getters with safe fallbacks).

### Production layout (typical on-prem)

| Service | Port | Notes |
|---------|------|-------|
| Frontend (nginx) | **8081** | Serves React static files; proxies `/api/` → `backend:5000` |
| Backend API | **5000** | Direct access optional for debugging |
| WebSocket | **8080** | Chat / live status (`REACT_APP_WS_URL` or auto `hostname:8080`) |

Example browser URL: `http://10.64.194.130:8081`

### Production templates

Pre-filled examples live in the repo root:

- `deploy/env/frontend.env.production.example` — HTTPS + domain
- `deploy/env/frontend.env.production.ip.example` — IP-only HTTP
- `deploy/ready/<server-ip>/frontend.env.production` — server-specific copy

Keep **API URL**, **WS URL**, nginx proxy, and backend `CORS_ORIGIN` aligned to the same public origin when not using same-origin proxy.

## Local development

```powershell
cd frontend
copy .env.example .env
npm ci
npm start
```

App runs at http://localhost:3000. Set `REACT_APP_API_BASE_URL=http://localhost:5000` in `.env`.

## Tests & lint

```powershell
npm run lint
npm run test:ci
```

Runs ESLint on `src/` and Jest with coverage (unit, component, and smoke tests).

## Production build (laptop)

Unset `CI` locally — CRA treats ESLint warnings as errors when `CI=true`.

```powershell
cd frontend
# optional: copy deploy template to .env.production
Remove-Item Env:CI -ErrorAction SilentlyContinue
$env:NODE_OPTIONS='--openssl-legacy-provider'
npm run lint
npm run test:ci
npm run build
```

Output: `frontend/build/` (static assets for nginx).

## Docker image + tar (prod deploy)

From the **project root**, after `npm run build`:

```powershell
docker build -t ai-powered-call-analysis-frontend:prod `
  -f production-build\docker\Dockerfile.frontend-static.patch frontend

docker tag ai-powered-call-analysis-frontend:prod sp-frontend:prod

docker save -o production\docker-images\sp-frontend.tar sp-frontend:prod
```

Requires base image `ai-powered-call-analysis-frontend:prod` already loaded once from your nginx image tar.

### Copy tar to server (Windows → Linux)

```powershell
scp "C:\Project\AI-Powered Call Analysis project\production\docker-images\sp-frontend.tar" `
  suvadip@10.64.194.130:/home/suvadip/Call-Analysis/Project/production/docker-images/
```

### Deploy on server

```bash
cd /home/suvadip/Call-Analysis/Project/production
docker load -i docker-images/sp-frontend.tar
docker compose up -d --force-recreate --no-deps frontend
```

Hard-refresh the browser after deploy (CRA asset hashes change each build).

## Rebuild checklist

1. Update `frontend/.env.production` if API/WS URLs changed (or rely on same-origin fallbacks)
2. `npm ci && npm run lint && npm run test:ci && npm run build`
3. `docker build` → `docker tag` → `docker save` → copy `sp-frontend.tar` to server
4. `docker load` + `docker compose up -d --force-recreate --no-deps frontend`
5. Hard-refresh browser (assets are cache-busted by CRA hashes)

## GitHub Actions CI

Workflow template: `docs/ci-workflow.example.yml` (copy to `.github/workflows/ci.yml` when your GitHub token has `workflow` scope).
