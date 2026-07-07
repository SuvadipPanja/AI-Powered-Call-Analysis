# License deployment guide

**Never commit `license.lic` to git.** Each production server needs its own file, bound to that machine's MAC address.

---

## 1. Gather server facts

On the **production Linux host**:

```bash
ip link show | grep -i ether
# Example: 8c:84:74:6b:08:7e
```

Set in `production/.env`:

```env
HOST_MAC=8c:84:74:6b:08:7e
LICENSE_SECRET_KEY=exactly-32-characters-long!!
```

`LICENSE_SECRET_KEY` must match the key used when the license was encoded. Keep it only in `.env` on the server.

---

## 2. Generate `license.lic`

On a **trusted build machine** (not necessarily the prod server):

```bash
cd backend
LICENSE_SECRET_KEY=exactly-32-characters-long!! \
HOST_MAC=8c:84:74:6b:08:7e \
node generate-prod-license.js ../production/license/license.lic
```

Optional env vars for expiry/users: see `generate-prod-license.js`.

---

## 3. Deploy to prod

Copy **only the file**, not via git:

| Source | Destination on prod |
|--------|---------------------|
| `production/license/license.lic` | `/home/suvadip/Call-Analysis/Project/production/license/license.lic` |

Docker compose mounts `./license:/app/license:ro` into the backend container.

Verify after `docker compose up`:

```bash
docker logs ai_call_backend 2>&1 | grep -i license
# Expect: License validated successfully
```

---

## 4. Rotate / replace

1. Generate new `license.lic` with same `HOST_MAC` and `LICENSE_SECRET_KEY` (or new key if rotating).
2. Replace file on prod server.
3. `docker compose restart backend` (or `--force-recreate backend`).

Upload via Super Admin UI (`POST /api/upload-license`) also writes to `license/license.lic` inside the container mount.

---

## 5. Git hygiene

If `license.lic` was ever committed:

```bash
git rm --cached production/license/license.lic backend/license/license.lic 2>/dev/null || true
git rm --cached license/license.lic 2>/dev/null || true
```

`.gitignore` excludes `**/license/*.lic`.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| MAC mismatch | `HOST_MAC` in `.env` vs `ip link` on prod |
| Invalid signature | `LICENSE_SECRET_KEY` length (32) and value |
| No license file | `production/license/license.lic` exists and is readable |
| Container can't read | Host path mounted in compose `volumes: ./license:/app/license:ro` |
