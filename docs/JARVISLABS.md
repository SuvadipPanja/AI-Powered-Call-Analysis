# Jarvis Labs cloud GPU for NeMo ASR

Run NeMo transcription on a pay-per-minute RTX 3090 (~$0.29/hr, India region) while keeping the frontend, backend, and SQL Server on your Windows laptop.

## Architecture

```
[Laptop :3000/:5000 + SQL Server]
        │  multipart upload (audio bytes)
        ▼
[Jarvis VM :8000 NeMo Docker]
        │  HTTP callback (DB_ENABLED=false)
        ▼
[Laptop backend updates SQL]
```

Audio never has to exist on Jarvis before upload — the backend sends the file when `AI_MAIN_REMOTE=true`.

## 1. Sign up and create a GPU instance

1. Go to [jarvislabs.ai](https://jarvislabs.ai) and create an account.
2. **Region:** India (lowest latency from India; RTX 3090 is the cheapest option with enough VRAM for NeMo).
3. **Template:** Ubuntu 22.04 + CUDA (GPU enabled).
4. **GPU:** RTX 3090 (~$0.29/hr, billed per minute).
5. Note the **public IP** and SSH command from the dashboard.
6. **Stop the instance** when not testing — you only pay while it runs.

## 2. Copy project + models to Jarvis

From PowerShell on your laptop (replace `JARVIS_IP`):

```powershell
scp -r "C:\Project\AI-Powered Call Analysis project" jarvis@JARVIS_IP:~/ai-call-analysis
```

Models under `models/` are ~10 GB — use `rsync` with `--progress` if you have it, or copy models in a second pass.

Minimum paths on the VM:

- `ai-mvp/` (orchestrator code)
- `models/Whisper-large-v3/`
- `models/nemo/*.nemo`
- `docker-compose.jarvis.yml`
- `scripts/jarvislabs-setup.sh`

## 3. Networking: Tailscale (recommended)

Jarvis cannot reach your home SQL Server through NAT. Use **callback mode** (default) or Tailscale for direct SQL.

### Option A — Callback mode (simplest, no SQL on Jarvis)

1. Install [Tailscale](https://tailscale.com) on laptop and Jarvis VM (free tier).
2. Note your laptop Tailscale IP (e.g. `100.x.x.x`).
3. Allow port **5000** on the laptop firewall for Tailscale interface only.

### Option B — Direct SQL via Tailscale

1. Tailscale on both machines.
2. Expose SQL Server on TCP **1434** (you already use `SUVADIP\SQLEXPRESS01`).
3. On Jarvis set `DB_ENABLED=true` and `DB_SERVER=100.x.x.x,1434` in `.env.jarvis`.

Most users should start with **Option A**.

## 4. Start orchestrator on Jarvis

SSH into the VM:

```bash
chmod +x ~/ai-call-analysis/scripts/jarvislabs-setup.sh
PROJECT_DIR=~/ai-call-analysis bash ~/ai-call-analysis/scripts/jarvislabs-setup.sh
```

Edit `~/ai-call-analysis/.env.jarvis`:

```env
DB_ENABLED=false
BACKEND_CALLBACK_URL=http://100.x.x.x:5000/api/internal/transcription-callback
CALLBACK_SECRET=pick-a-long-random-string
```

Restart:

```bash
cd ~/ai-call-analysis
docker compose --env-file .env.jarvis -f docker-compose.jarvis.yml up --build -d
curl http://localhost:8000/health
```

First start loads NeMo models — allow several minutes.

## 5. Configure laptop backend

Edit `backend/.env`:

```env
AI_MAIN_URL=http://JARVIS_PUBLIC_IP:8000
AI_MAIN_REMOTE=true
CALLBACK_SECRET=pick-a-long-random-string
```

`CALLBACK_SECRET` must match `.env.jarvis` on Jarvis.

Restart backend (`node server.js` or your usual start script).

## 6. First test

1. Jarvis instance **running**, health OK: `curl http://JARVIS_IP:8000/health`
2. Laptop backend running on `:5000`, frontend on `:3000`
3. Upload a short audio file from the UI
4. Watch logs:
   - Laptop: `logs/Backend Log/python_script.log` — should show `remote GPU (multipart upload)`
   - Jarvis: `docker compose -f docker-compose.jarvis.yml logs -f`
5. Poll status in UI or `GET /api/audio-status/<filename>` — expect `Transcribed`

## Cost tips

| Action | Why |
|--------|-----|
| **Stop** Jarvis when done | Billing is per minute while instance runs |
| Test with **short** clips first | Faster iteration, less GPU time |
| Pre-warm once per session | First transcription loads models (~5–10 min) |
| Use callback mode | No VPN SQL tuning required |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Failed to communicate with AI-Main` | Check Jarvis public IP, port 8000 open in Jarvis firewall |
| Upload OK, status stuck `In Progress` | Callback failed — verify Tailscale, `BACKEND_CALLBACK_URL`, matching `CALLBACK_SECRET` |
| `File not found on laptop` | `AUDIO_UPLOAD_DIR` in backend `.env` must point to uploaded file |
| NeMo OOM | RTX 3090 24 GB is sufficient; restart container after failed load |
| SQL mode on Jarvis | `DB_ENABLED=true`, `DB_SERVER=<tailscale-ip>,1434`, SQL allows remote TCP |

## Env reference (Jarvis `docker-compose.jarvis.yml`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DB_ENABLED` | `false` | `false` = POST results to laptop; `true` = pyodbc to SQL |
| `BACKEND_CALLBACK_URL` | — | Laptop callback URL (required when `DB_ENABLED=false`) |
| `CALLBACK_SECRET` | — | Shared secret header `X-Callback-Secret` |
| `DB_SERVER` | — | SQL host when `DB_ENABLED=true` (e.g. Tailscale IP) |

## Laptop env reference

| Variable | Example | Purpose |
|----------|---------|---------|
| `AI_MAIN_URL` | `http://1.2.3.4:8000` | Jarvis orchestrator URL |
| `AI_MAIN_REMOTE` | `true` | Force multipart upload (also auto when URL is not localhost) |
| `CALLBACK_SECRET` | same as Jarvis | Validates `/api/internal/transcription-callback` |
