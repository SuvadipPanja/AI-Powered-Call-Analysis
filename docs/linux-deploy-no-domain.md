# Linux production without a domain (IP-only)

Use this when you have a **Linux server** but **no DNS name** yet — typical for internal pilots, VPN, or LAN access.

**Replace `YOUR_SERVER_IP`** everywhere (e.g. `192.168.1.50` or your cloud private IP).

---

## Choose an access mode

| Mode | URL users open | SSL | Best for |
|------|----------------|-----|----------|
| **A — HTTP** | `http://YOUR_SERVER_IP` | None | Fastest pilot on trusted internal network |
| **B — Self-signed HTTPS** | `https://YOUR_SERVER_IP` | Browser warning once | Slightly better; still no domain needed |

Let's Encrypt **requires a domain** — skip certbot until you have one. You can add a free hostname later (DuckDNS, No-IP, Cloudflare) and switch to the main [nginx-ssl-setup.md](nginx-ssl-setup.md).

---

## Part 1 — Install (same as domain guide)

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx curl git build-essential python3-venv python3-pip ufw

curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Deploy app to `/opt/call-analysis`, install deps:

```bash
cd /opt/call-analysis/backend && npm ci
cd /opt/call-analysis/frontend && npm ci
```

---

## Part 2 — Environment files (IP templates)

```bash
cp deploy/env/backend.env.production.ip.example   backend/.env
cp deploy/env/frontend.env.production.ip.example  frontend/.env.production
cp deploy/env/ai-mvp.env.production.example       ai-mvp/.env
cp deploy/env/autoupload.env.production.example   AutoUpload/.env
```

Edit `backend/.env`:

1. Set `YOUR_SERVER_IP` in `PUBLIC_APP_URL` and `CORS_ORIGIN`
2. Set `HOST_MAC` — `ip link show | grep ether`
3. Generate and set `SERVICE_TOKEN`, `ORCHESTRATOR_SECRET`, `CALLBACK_SECRET`
4. Set database credentials

Edit `frontend/.env.production` — same IP in `REACT_APP_API_BASE_URL` and `REACT_APP_WS_URL`.

Edit `ai-mvp/.env` — match orchestrator secrets; keep `BACKEND_CALLBACK_URL=http://127.0.0.1:5000/...`

Build frontend:

```bash
cd /opt/call-analysis/frontend && npm run build
```

---

## Part 3 — Nginx (HTTP — Option A)

```bash
sudo cp /opt/call-analysis/deploy/nginx.conf.ip-http.example \
  /etc/nginx/sites-available/call-analysis

# Edit: replace YOUR_SERVER_IP if you want to restrict server_name (optional)
sudo ln -sf /etc/nginx/sites-available/call-analysis /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Firewall — allow HTTP only from your network if possible:

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw enable
```

Users open: **`http://YOUR_SERVER_IP`**

---

## Part 3b — Nginx (self-signed HTTPS — Option B)

Create a certificate (valid ~1 year):

```bash
sudo mkdir -p /etc/ssl/call-analysis
sudo openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout /etc/ssl/call-analysis/key.pem \
  -out /etc/ssl/call-analysis/cert.pem \
  -subj "/CN=YOUR_SERVER_IP"
```

```bash
sudo cp /opt/call-analysis/deploy/nginx.conf.ip-selfsigned.example \
  /etc/nginx/sites-available/call-analysis
sudo ln -sf /etc/nginx/sites-available/call-analysis /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

Update env for **HTTPS**:

- `backend/.env` → `CORS_ORIGIN=https://YOUR_SERVER_IP`
- Rebuild frontend with `REACT_APP_API_BASE_URL=https://...` and `REACT_APP_WS_URL=wss://.../ws`

```bash
sudo ufw allow 443/tcp
```

Users open: **`https://YOUR_SERVER_IP`** — accept the browser security warning once.

---

## Part 4 — Start backend and AI

```bash
cd /opt/call-analysis/backend
NODE_ENV=production node server.js
# Or use systemd — see docs/nginx-ssl-setup.md Part 7
```

```bash
cd /opt/call-analysis/ai-mvp
# after venv + pip install -r requirements.txt
python orchestrator.py
```

Ports **5000** and **8000** should stay on `127.0.0.1` only — nginx on port 80/443 is the entry point.

---

## Part 5 — Smoke test

```bash
curl -sI http://YOUR_SERVER_IP/api/license-status
curl -sI http://YOUR_SERVER_IP/
```

From a browser on another machine on the same network:

1. Open `http://YOUR_SERVER_IP` (or `https://...`)
2. Log in with a **non-default** password
3. DevTools → Network → WS → should connect to `ws://YOUR_SERVER_IP/ws`

---

## When you get a domain later

1. Point DNS A record to the server IP  
2. Switch to `deploy/env/*.production.example` (domain templates)  
3. Run `certbot --nginx -d your.domain.com`  
4. Rebuild frontend with `https://your.domain.com` URLs  
5. Update `CORS_ORIGIN` and restart backend  

---

## Limitations without a domain

- No trusted public SSL (unless self-signed + manual trust)
- Not suitable for open internet exposure on HTTP
- License `HOST_MAC` still required on this server
- Some browsers restrict mixed content if you mix HTTP/HTTPS — keep all URLs on the same scheme

## Related files

| File | Purpose |
|------|---------|
| `deploy/nginx.conf.ip-http.example` | HTTP on port 80 |
| `deploy/nginx.conf.ip-selfsigned.example` | HTTPS with self-signed cert |
| `deploy/env/backend.env.production.ip.example` | Backend env |
| `deploy/env/frontend.env.production.ip.example` | Frontend build env |
