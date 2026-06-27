# Prod deploy — copy from dev laptop and run (Jun 2026)

**Your directory only:** `/home/suvadip/Call-Analysis/Project/production`  
**Do NOT touch:** `ai_engine`, `local_ai_server`, `admin_ui` (other team)

---

## Copy from dev laptop (WinSCP)

| Dev laptop | Prod path |
|------------|-----------|
| `production\docker-compose.prod.yml` | `.../production/docker-compose.prod.yml` |
| `production\images\05-ai.tar` | `.../production/images/05-ai.tar` |
| `production\images\06-qwen-vllm.tar` | `.../production/images/06-qwen-vllm.tar` (if not already loaded) |

---

## On prod — run in order

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

# 1) YAML valid?
grep -c NEMO_DEVICE docker-compose.prod.yml   # must be 1
docker compose -f docker-compose.prod.yml config --quiet && echo "YAML OK"

# 2) Load OFFLINE images (do not pull from internet)
docker load -i images/06-qwen-vllm.tar
docker load -i images/05-ai.tar

# 3) STOP ai first — it holds ~17GB GPU and blocks qwen KV cache
docker stop ai_call_ai 2>/dev/null || true

# 4) Start qwen ALONE (must load GPU before ai)
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen

# 5) Wait until qwen healthy (2-5 min) — must NOT start ai until this passes
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  STATUS=$(docker inspect ai_call_qwen --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  echo "qwen health: $STATUS"
  [ "$STATUS" = "healthy" ] && break
  sleep 15
done

docker logs ai_call_qwen --tail 15
nvidia-smi -i 1

# 6) Test qwen API (must succeed before starting ai)
docker exec ai_call_qwen python3 -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8001/v1/models', timeout=10).read()[:150])"

# 7) NOW start ai + rest of stack
docker compose -f docker-compose.prod.yml up -d

# 7) Verify all ai_call_* containers
docker ps --filter name=ai_call_

# 8) AI health — expect: active_backend=nemo, LLM scoring ready
docker exec ai_call_ai curl -s http://127.0.0.1:8000/health | python3 -m json.tool | grep -E "active_backend|nemo|language_detection|LLM|ready|error" | head -25
```

---

## Success looks like

**qwen logs:** `Uvicorn running` or `Application startup complete` — no `Engine core initialization failed`

**nvidia-smi -i 1:** `VLLM::EngineCore` using ~12 GB

**ai health:**
- `"active_backend": "nemo"`
- `"language_detection": { "method": "faster-whisper-language-detection", "device": "cuda" }`
- scoring `ready: true`

**Upload test:**
```bash
tail -f volumes/logs/ai/orchestrator_$(date +%Y-%m-%d).log
```
Expect: `Processing` → `Transcribed` → `LLM scoring` → `Completed`

---

## If qwen still restarts

```bash
docker logs ai_call_qwen 2>&1 | tail -40
docker inspect ai_call_qwen --format 'RestartCount={{.RestartCount}}'
```

Confirm compose has `--enforce-eager` and `VLLM_USE_V1: "0"` under qwen, then recreate qwen again.

Lower GPU reservation in `.env`:
```
QWEN_GPU_MEMORY_UTIL=0.15
```

---

## If ai not running but qwen OK

```bash
docker compose -f docker-compose.prod.yml up -d ai --no-deps
```
