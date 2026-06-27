# AI MVP — Phase 2a (NeMo ASR)

Uses the **same models as the original production AI pipeline**, not faster-whisper.

## Pipeline

| Step | Component | Purpose |
|------|-----------|---------|
| 1 | **Diarization** (Silero VAD) | Split stereo: left=Agent, right=Customer |
| 2 | **Whisper Large V3** | Detect Hindi vs English |
| 3 | **NeMo Hindi** (`stt_hi_conformer_ctc_medium`) | Transcribe Hindi chunks |
| 3 | **NeMo English** (`parakeet-rnnt-1.1b`) | Transcribe English chunks |

Output chunks saved under `data/diarization_output/Chunk/<audio_name>/Agent|Customer/`.

**Requires stereo call audio** (agent on left, customer on right). Mono files fall back to single `(Call)` transcript.

## Run NeMo on laptop (WSL — preferred)

Models are already on disk under `models/`. WSL uses `ai-mvp/.venv-wsl` (nemo_toolkit 2.7.3) — **no Docker image pull**.

```powershell
# From project root (foreground; models load ~2–5 min on CPU)
.\scripts\start-nemo-wsl.ps1

# Background
.\scripts\start-nemo-wsl.ps1 -Background
```

Health: `GET http://localhost:8000/health` → `transcription.active_backend: "nemo"`, `ready: true`  
Backend `AI_MAIN_URL` stays `http://localhost:8000`.

## Run NeMo via Docker (GPU server, or laptop only if image cached)

Uses `Dockerfile.gpu` with base image `nvcr.io/nvidia/nemo:23.04` (~10GB). **Models are mounted from `models/`** — the web pull is only the missing Docker base image, not your `.nemo` files.

```powershell
# Only if nvcr.io/nvidia/nemo:23.04 is already local, or you accept first-time download
.\scripts\start-nemo-docker.ps1 -Gpu
```

Or manually: `docker compose -f docker-compose.nemo.yml [-f docker-compose.nemo.gpu.yml] up --build -d`

## Install native (GPU server only — optional)

```bash
cd ai-mvp
pip install -r requirements-nemo.txt
```

## Model files

Copy from your old server or download from NVIDIA NGC:

```
models/nemo/stt_hi_conformer_ctc_medium.nemo
models/nemo/parakeet-rnnt-1.1b.nemo
```

With local `.nemo` files present, NeMo uses `restore_from()` — no HuggingFace download. `HF_HUB_OFFLINE=1` is set in WSL/Docker startup scripts.

Whisper Large V3 for language detection is already at:

```
models/Whisper-large-v3/
```

## Config (`.env`)

```env
WHISPER_LANG_MODEL_PATH=C:/Project/AI-Powered Call Analysis project/models/Whisper-large-v3
HINDI_NEMO_MODEL_PATH=C:/Project/AI-Powered Call Analysis project/models/nemo/stt_hi_conformer_ctc_medium.nemo
ENGLISH_NEMO_MODEL_PATH=C:/Project/AI-Powered Call Analysis project/models/nemo/parakeet-rnnt-1.1b.nemo
NEMO_DEVICE=cuda
```

## Run

```powershell
python orchestrator.py
```

Check: `GET http://localhost:8000/health` → `transcription.ready: true`

## Laptop full-flow test (without NeMo)

NeMo **cannot install on native Windows** (Python 3.13). To test the complete pipeline on your laptop:

```env
TRANSCRIBE_BACKEND=whisper-large-v3
```

Runs: diarize → lang detect → Whisper Large V3 per Agent/Customer chunk (full flow, not production quality).

## Real NeMo on laptop CPU

Use **WSL** (`.\scripts\start-nemo-wsl.ps1`) when `.venv-wsl` is set up. CPU mode is slow (~5–15 min per call). Avoid Docker on laptop unless `nvcr.io/nvidia/nemo:23.04` is already cached.

## Production

NeMo on **A5000 GPU**: `docker compose -f docker-compose.gpu.yml up --build -d` or `start-nemo-docker.ps1 -Gpu`.
