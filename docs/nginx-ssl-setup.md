# Nginx + SSL setup (Ubuntu Server 22.04 / 24.04)

Step-by-step guide to put **AI Call Analysis** behind HTTPS on a Linux production server.

**Assumptions**

- Domain: `calls.YOUR_COMPANY.com` (replace with yours)
- App installed at: `/opt/call-analysis`
- Ubuntu Server with root/sudo access
- Ports 80 and 443 open in your cloud firewall

---

## Part 1 — Server preparation

### 1.1 Install system packages

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx certbot python3-certbot-nginx \
  curl git build-essential python3-venv python3-pip \
  ufw
```

### 1.2 Install Node.js 20

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should print v20.x
```

### 1.3 Install SQL Server client tools (if DB is remote)

Use your organisation’s SQL Server connection (Azure SQL, on-prem, etc.). Ensure the app server can reach `DB_SERVER:1433`.

### 1.4 Create app user and directories

```bash
sudo useradd -r -m -d /opt/call-analysis -s /bin/bash callapp || true
sudo mkdir -p /opt/call-analysis/{data,logs,AutoUpload/{audio,metadata,logs}}
sudo chown -R callapp:callapp /opt/call-analysis
```

### 1.5 Deploy application code

Copy or clone the project to `/opt/call-analysis` (exclude `node_modules`, `.env`, and `code backup/`).

```bash
cd /opt/call-analysis/backend && sudo -u callapp npm ci
cd /opt/call-analysis/frontend && sudo -u callapp npm ci
```

---

## Part 2 — Production environment files

Copy templates from `deploy/env/` and fill in real values:

```bash
cp deploy/env/backend.env.production.example    backend/.env
cp deploy/env/frontend.env.production.example   frontend/.env.production
cp deploy/env/ai-mvp.env.production.example     ai-mvp/.env
cp deploy/env/autoupload.env.production.example AutoUpload/.env
```

Generate three secrets (run three times, use different outputs):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set `HOST_MAC` to this server’s MAC:

```bash
ip link show | grep -i ether
```

**Rotate all default user passwords** in SQL Server before go-live.

---

## Part 3 — Build frontend

```bash
cd /opt/call-analysis/frontend
sudo -u callapp npm run build
# Output: frontend/build/
```

---

## Part 4 — Nginx configuration

### 4.1 Copy site config

```bash
sudo cp /opt/call-analysis/deploy/nginx.conf.example \
  /etc/nginx/sites-available/call-analysis
```

Edit the file — replace every `YOUR_DOMAIN` with `calls.YOUR_COMPANY.com` and set the static root:

```nginx
root /opt/call-analysis/frontend/build;
```

Enable the site:

```bash
sudo ln -sf /etc/nginx/sites-available/call-analysis /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

### 4.2 DNS

Create an **A record** pointing `calls.YOUR_COMPANY.com` → your server’s public IP. Wait for DNS propagation before requesting SSL.

---

## Part 5 — SSL with Let’s Encrypt

```bash
sudo certbot --nginx -d calls.YOUR_COMPANY.com
```

Certbot updates nginx automatically and sets up auto-renewal.

Verify renewal timer:

```bash
sudo systemctl status certbot.timer
```

Test renewal (dry run):

```bash
sudo certbot renew --dry-run
```

---

## Part 6 — Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

**Do not** expose port 8000 (orchestrator) or 5000 (backend) publicly — nginx is the only public entry point.

---

## Part 7 — Systemd services (recommended)

### 7.1 Backend

```bash
sudo tee /etc/systemd/system/call-analysis-backend.service << 'EOF'
[Unit]
Description=AI Call Analysis Backend
After=network.target

[Service]
Type=simple
User=callapp
WorkingDirectory=/opt/call-analysis/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

### 7.2 AI orchestrator

```bash
sudo tee /etc/systemd/system/call-analysis-ai.service << 'EOF'
[Unit]
Description=AI Call Analysis Orchestrator
After=network.target call-analysis-backend.service

[Service]
Type=simple
User=callapp
WorkingDirectory=/opt/call-analysis/ai-mvp
ExecStart=/opt/call-analysis/ai-mvp/.venv/bin/python orchestrator.py
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

Create the Python venv first if needed:

```bash
cd /opt/call-analysis/ai-mvp
sudo -u callapp python3 -m venv .venv
sudo -u callapp .venv/bin/pip install -r requirements.txt
```

### 7.3 Start services

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now call-analysis-backend
sudo systemctl enable --now call-analysis-ai
sudo systemctl status call-analysis-backend call-analysis-ai
```

---

## Part 8 — Smoke test

| Check | Command / action |
|-------|------------------|
| HTTPS loads | Open `https://calls.YOUR_COMPANY.com` |
| API health | `curl -sI https://calls.YOUR_COMPANY.com/api/license-status` |
| Login | Super Admin login with **new** password |
| WebSocket | Browser devtools → Network → WS → should connect to `wss://.../ws` |
| Upload | Test one audio upload from admin or AutoUpload |
| License panel | Admin Settings → License shows history |

---

## Part 9 — Windows Server alternative (brief)

If you must run on **Windows Server** instead of Linux:

1. Use **IIS** with URL Rewrite + ARR as reverse proxy, or install nginx for Windows.
2. Use **win-acme** (https://www.win-acme.com/) for Let’s Encrypt certificates.
3. Paths in `.env` use Windows style, e.g. `E:\call-analysis\...`
4. Run backend as a Windows Service (NSSM) or scheduled task.
5. Set `DB_USE_WINDOWS_AUTH=true` if SQL Server uses integrated auth.

Nginx on Linux is the recommended production path for this project.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| CORS error in browser | `CORS_ORIGIN` mismatch | Set to exact `https://calls.YOUR_COMPANY.com` |
| WebSocket fails | Wrong `REACT_APP_WS_URL` | Must be `wss://calls.YOUR_COMPANY.com/ws`; rebuild frontend |
| 401 on API | Missing session token | Re-login; check `API_AUTH_ENFORCE=true` |
| 401 on AutoUpload | `SERVICE_TOKEN` mismatch | Same token in backend + AutoUpload `.env` |
| License invalid | Wrong `HOST_MAC` | Set server MAC in backend `.env` |
| 502 Bad Gateway | Backend not running | `sudo systemctl status call-analysis-backend` |

---

## Related files

- Env templates: `deploy/env/`
- Nginx config: `deploy/nginx.conf.example`
- Checklist: `docs/production.md`
