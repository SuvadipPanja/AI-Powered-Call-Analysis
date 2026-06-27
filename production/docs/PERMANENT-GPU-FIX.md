# Permanent GPU ASR fix — Path B (now) + Path A (cuDNN-9, later)

**Root cause of the repeating crash:** the AI image is built on `nvcr.io/nvidia/nemo:23.04`
which ships **cuDNN 8**. NeMo ASR on GPU loads `libcudnn_ops.so.9` and crashes
(`Cannot load symbol cudnnCreateTensorDescriptor`). No env/compose tweak fixes this —
only a new image on a **cuDNN-9 base** (Path A) makes NeMo run on GPU.

`faster-whisper` never hit this crash because CTranslate2 **bundles its own cuDNN 9**
(pip wheel), independent of the system. That is why Path B is safe today.

---

## PATH B — stable GPU pipeline NOW (no rebuild, no internet)

Uses faster-whisper on GPU for BOTH transcription and language detection. NeMo is
disabled until Path A is ready.

Already changed in repo: `production/docker-compose.prod.yml` `ai` service now has
`TRANSCRIBE_BACKEND: faster-whisper` and `WHISPER_LANG_DEVICE: cpu`.

### Copy to prod (WinSCP)

| Dev laptop | Prod path |
|------------|-----------|
| `production\docker-compose.prod.yml` | `.../production/docker-compose.prod.yml` |

(No image copy needed — the existing `ai-call-orchestrator:prod` already has faster-whisper.)

### On prod — run in order

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

# 0) YAML valid?
docker compose -f docker-compose.prod.yml config --quiet && echo "YAML OK"

# 1) qwen-first order (it must grab GPU before ai). Stop ai if running.
docker stop ai_call_ai 2>/dev/null || true
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen

# 2) Wait until qwen healthy (2-5 min)
for i in $(seq 1 20); do
  S=$(docker inspect ai_call_qwen --format '{{.State.Health.Status}}' 2>/dev/null || echo starting)
  echo "qwen health: $S"; [ "$S" = "healthy" ] && break; sleep 15
done

# 3) Start ai + rest
docker compose -f docker-compose.prod.yml up -d

# 4) Verify — expect active_backend=faster-whisper, language_detection device cuda/cpu, no crash
docker exec ai_call_ai curl -s http://127.0.0.1:8000/health | python3 -m json.tool | grep -iE "active_backend|faster|language|ready" | head
```

Then upload one call. It should reach **Transcribed -> Translating -> scoring -> Complete**
with NO container restart. faster-whisper large-v3 runs on GPU (fast).

---

## Fix Docker internet on the dev laptop (required for Path A build)

Docker is routing all pulls/pip through a proxy `http.docker.internal:3128` that is
failing (registry blob `EOF`, pip `SSL EOF`). Your browser works because it connects
directly. Fix Docker to connect directly too:

1. Docker Desktop -> **Settings** -> **Resources** -> **Proxies**.
2. Turn **OFF** "Manual proxy configuration" (or set the correct corporate proxy if one exists).
3. **Apply & Restart**.
4. Verify the build network works:

```powershell
docker pull hello-world
```

If `hello-world` pulls cleanly, Path A can be built.

---

## PATH A — permanent cuDNN-9 image (NeMo on GPU) — BUILT & VERIFIED

Built on a **slim** base (NOT the 90 GB NeMo container). The fix: torch cu124 wheels
bundle cuDNN 9.1, which NeMo uses on GPU.

- Base: `nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04`
- Dockerfile: `ai-mvp/Dockerfile.gpu-cudnn9`
- Verified in image: `torch 2.4.0+cu124 | cudnn 90100`, `nemo 2.0.0` imports, ASRModel OK,
  all app modules import.
- Pinned deps (NeMo-2.0.0-era, so it loads models cleanly):
  `pytorch-lightning 2.3.3 · transformers 4.44.2 · huggingface_hub 0.24.6 ·
  tokenizers 0.19.1 · numpy 1.26.4 · setuptools<81 · datasets 2.21.0 · pyarrow 17.0.0`
- Image size: **~16.8 GB** -> `production/images/05-ai.tar`
- Compose already set to `TRANSCRIBE_BACKEND: nemo`, `NEMO_DEVICE: cuda`.

This SAME image also contains faster-whisper, so Path B is an instant env-only fallback.

### (Re)build on dev — only if you change code

```powershell
cd "C:\Project\AI-Powered Call Analysis project"
docker build -t ai-orchestrator-gpu-base:prod -f ai-mvp/Dockerfile.gpu-cudnn9 ai-mvp
docker build -t ai-call-orchestrator:prod -f production-build/docker/Dockerfile.orchestrator.prod .
docker save ai-call-orchestrator:prod -o production\images\05-ai.tar
```

### Deploy to prod (ONE final tar copy)

| Dev laptop | Prod path |
|------------|-----------|
| `production\images\05-ai.tar` (~16.8 GB) | `.../production/images/05-ai.tar` |
| `production\docker-compose.prod.yml` | `.../production/docker-compose.prod.yml` |

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

docker load -i images/05-ai.tar
docker stop ai_call_ai 2>/dev/null || true
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen
for i in $(seq 1 20); do S=$(docker inspect ai_call_qwen --format '{{.State.Health.Status}}' 2>/dev/null || echo starting); echo "qwen: $S"; [ "$S" = "healthy" ] && break; sleep 15; done
docker compose -f docker-compose.prod.yml up -d
docker exec ai_call_ai curl -s http://127.0.0.1:8000/health | python3 -m json.tool | grep -iE "nemo|active_backend|ready"
```

Expect `active_backend: nemo`, `nemo_asr.ready: true`, NO cuDNN error. Upload one call;
watch it reach Complete:

```bash
docker logs -f ai_call_ai 2>&1 | grep -iE "Accepted|Processing|Transcrib|scoring|Complete|Error|cudnn"
```

### If NeMo misbehaves on GPU (instant fallback, no rebuild)

Edit `docker-compose.prod.yml` `ai` service: `TRANSCRIBE_BACKEND: faster-whisper`, then:
```bash
docker compose -f docker-compose.prod.yml up -d --force-recreate ai
```
faster-whisper runs on GPU from the same image (its own bundled cuDNN 9).
