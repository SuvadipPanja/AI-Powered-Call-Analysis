# Ready-to-deploy configs for server **10.64.194.130** (no domain, HTTP)

## Copy to Linux server

Assuming app root is `/opt/call-analysis`:

```bash
# Env files
cp deploy/ready/10.64.194.130/backend.env              /opt/call-analysis/backend/.env
cp deploy/ready/10.64.194.130/frontend.env.production  /opt/call-analysis/frontend/.env.production

# Edit backend/.env — set DB_*, HOST_MAC, and generate 3 secrets:
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# ai-mvp + AutoUpload (from generic templates — secrets must match backend)
cp deploy/env/ai-mvp.env.production.example       /opt/call-analysis/ai-mvp/.env
cp deploy/env/autoupload.env.production.example /opt/call-analysis/AutoUpload/.env
# Edit ai-mvp/.env: ORCHESTRATOR_SECRET + CALLBACK_SECRET same as backend
# Edit AutoUpload/.env: SERVICE_TOKEN same as backend

# Build frontend
cd /opt/call-analysis/frontend && npm run build

# Nginx
sudo cp deploy/ready/10.64.194.130/nginx-http.conf /etc/nginx/sites-available/call-analysis
sudo ln -sf /etc/nginx/sites-available/call-analysis /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## Access URL

**http://10.64.194.130**

## Aligned settings (already set in these files)

| Setting | Value |
|---------|--------|
| `CORS_ORIGIN` | `http://10.64.194.130` |
| `REACT_APP_API_BASE_URL` | `http://10.64.194.130` |
| `REACT_APP_WS_URL` | `ws://10.64.194.130/ws` |

## Still required on server

1. `HOST_MAC` — `ip link show | grep ether`
2. Database credentials in `backend/.env`
3. Three unique secrets (SERVICE_TOKEN, ORCHESTRATOR_SECRET, CALLBACK_SECRET)
4. `LICENSE_SECRET_KEY` + license file for this server's MAC
5. Change default user passwords in SQL
6. Start backend + ai-mvp (keep ports 5000/8000 on localhost only)

Full guide: `docs/linux-deploy-no-domain.md`
