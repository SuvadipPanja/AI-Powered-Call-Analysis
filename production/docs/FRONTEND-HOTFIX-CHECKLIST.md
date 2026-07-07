# Frontend hotfix — verify, copy, deploy

Use this **every time** the agent (or you) changes `frontend/**`. Do not skip verification.

---

## 1. Verify on dev

```powershell
cd "C:\Project\AI-Powered Call Analysis project\frontend"
npm test -- --watchAll=false
npm run build
```

Local container (needs Docker Desktop):

```powershell
docker build -t sp-frontend:prod `
  -f "..\production-build\docker\Dockerfile.frontend-static.patch" .
docker rm -f sp-frontend-local 2>$null
docker run -d --name sp-frontend-local --add-host backend:host-gateway -p 8099:80 sp-frontend:prod
```

Open **http://localhost:8099** — check the screens you changed (login, upload/processing, admin, reports).

```powershell
docker rm -f sp-frontend-local
```

---

## 2. Build tar (sp name only)

```powershell
docker save -o "..\production\docker-images\sp-frontend.tar" sp-frontend:prod
```

Check size (~350–380 MB). Image must list **only** `sp-frontend:prod`:

```powershell
docker image inspect sp-frontend:prod --format "{{json .RepoTags}}"
```

---

## 3. Copy to prod

**One file:**

| From (dev) | To (prod) |
|------------|-----------|
| `production\docker-images\sp-frontend.tar` | `/home/suvadip/Call-Analysis/Project/production/docker-images/sp-frontend.tar` |

```powershell
scp "C:\Project\AI-Powered Call Analysis project\production\docker-images\sp-frontend.tar" `
  suvadip@10.64.194.130:/home/suvadip/Call-Analysis/Project/production/docker-images/
```

---

## 4. Deploy on prod

```bash
cd /home/suvadip/Call-Analysis/Project/production
docker load -i docker-images/sp-frontend.tar
bash scripts/deploy-frontend-hotfix.sh
```

---

## 5. Confirm

```bash
docker compose ps frontend
docker images | grep sp-frontend
```

- Container: **`sp_frontend`**
- Image: **`sp-frontend:prod`**
- Browser: **Ctrl+Shift+R** on `http://10.64.194.130:8081`

---

## Do NOT (frontend hotfix)

- Rebuild or replace `sp-aimvp.tar`, `sp-llm.tar`
- Change `AI/src/**` or NeMo/Whisper model paths
- `docker compose up` full stack unless planned maintenance

AI keeps running; only the nginx static UI container is recreated.
