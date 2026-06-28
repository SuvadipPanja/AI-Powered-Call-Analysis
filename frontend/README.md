# AI-Powered Call Analysis — Frontend

Production React app (Create React App) served as static files behind nginx in `sp-frontend.tar`.

## Environment variables (`REACT_APP_*`)

CRA embeds every `REACT_APP_*` variable into the **public JavaScript bundle at build time**.  
Do **not** put secrets here — anyone can read them in the browser.

Copy `.env.example` to `.env` for local dev, or `.env.production` for production builds.

| Variable | Required | Description | Local example | Production example |
|----------|----------|-------------|---------------|-------------------|
| `REACT_APP_API_BASE_URL` | Yes | Backend REST origin (no trailing slash) | `http://localhost:5000` | `https://calls.yourcompany.com` |
| `REACT_APP_WS_URL` | Yes | WebSocket origin for live chat / status | `ws://localhost:5000` | `wss://calls.yourcompany.com/ws` |
| `REACT_APP_ENV` | No | Label shown in logs / diagnostics | `development` | `production` |
| `REACT_APP_LOGIN_BACKGROUND_URL` | No | Login page background image path | `/images/background.jpg` | `/images/background.jpg` |
| `REACT_APP_LOG_DIR` | No | Reference only (not used in browser) | `/app/logs` | `/opt/call-analysis/logs/frontend` |

All variables are read through `src/utils/envConfig.js`.  
`REACT_APP_API_BASE_URL` and `REACT_APP_WS_URL` must be set or the app throws at startup.

### Production templates

Pre-filled examples live in the repo root:

- `deploy/env/frontend.env.production.example` — HTTPS + domain
- `deploy/env/frontend.env.production.ip.example` — IP-only HTTP
- `deploy/ready/<server-ip>/frontend.env.production` — server-specific copy

Keep **API URL**, **WS URL**, and nginx `CORS_ORIGIN` aligned to the same public origin.

## Local development

```powershell
cd frontend
copy .env.example .env
npm ci
npm start
```

App runs at http://localhost:3000 and proxies API calls to `REACT_APP_API_BASE_URL`.

## Tests

```powershell
npm run test:ci
```

Runs Jest with coverage (42+ unit/component tests). CI uses the same command before build.

## Production build (laptop)

Unset `CI` locally — CRA treats ESLint warnings as errors when `CI=true`.

```powershell
cd frontend
copy .env.production .env.production   # or create from deploy template
Remove-Item Env:CI -ErrorAction SilentlyContinue
$env:NODE_OPTIONS='--openssl-legacy-provider'
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

### Deploy on server

```bash
git pull origin main
cd production/docker-images
docker load -i sp-frontend.tar
cd ..
docker compose up -d --force-recreate frontend
```

## Rebuild checklist

1. Update `frontend/.env.production` if API/WS URLs changed
2. `npm ci && npm run test:ci && npm run build`
3. `docker build` → `docker save` → copy `sp-frontend.tar` to server
4. `docker load` + `docker compose up -d --force-recreate frontend`
5. Hard-refresh browser (assets are cache-busted by CRA hashes)

## GitHub Actions CI

Workflow template: `docs/ci-workflow.example.yml` (copy to `.github/workflows/ci.yml` when your GitHub token has `workflow` scope).
