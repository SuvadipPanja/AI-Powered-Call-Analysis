"""sp-ai-diarization — hybrid stereo + Pyannote diarization HTTP service (port 8040)."""

from log_setup import init_service_logging

logger = init_service_logging("sp-ai-diarization")

import os
import tempfile
import time
from pathlib import Path

from flask import Flask, jsonify, request

from config import DIAR_BACKEND, DIAR_PYANNOTE_ENABLED
from diarization_worker import diarization_health, diarize
from pyannote_diarizer import pyannote_ready

SERVICE_NAME = "sp-ai-diarization"
_START_TIME = time.time()
AI_SERVICE_THREADS = int(os.getenv("AI_SERVICE_THREADS", "2"))

app = Flask(__name__)


@app.get("/health")
def health():
    pyannote = pyannote_ready() if DIAR_PYANNOTE_ENABLED else {"ready": False, "skipped": True}
    dia = diarization_health()
    ready = dia.get("ready", False)
    return jsonify(
        {
            "service": SERVICE_NAME,
            "ready": ready,
            "uptime_sec": round(time.time() - _START_TIME, 1),
            "backend": DIAR_BACKEND,
            "silero": dia,
            "pyannote": pyannote,
        }
    ), (200 if ready else 503)


@app.post("/diarize")
def diarize_endpoint():
    if "file" not in request.files:
        return jsonify(success=False, message="missing file"), 400

    upload = request.files["file"]
    suffix = Path(upload.filename or "audio.mp3").suffix or ".mp3"
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        upload.save(tmp.name)
        tmp.close()
        result = diarize(Path(tmp.name))
        segments = [
            {
                "speaker": c.speaker,
                "start_sec": round(c.start_sec, 3),
                "end_sec": round(c.end_sec, 3),
            }
            for c in result.chunks
        ]
        method = "unknown"
        meta_path = result.output_dir / "metadata.txt" if result.output_dir else None
        if meta_path and meta_path.exists():
            for line in meta_path.read_text(encoding="utf-8").splitlines():
                if line.startswith("Method:"):
                    method = line.split(":", 1)[1].split(",")[0].strip()
                    break
        return jsonify(
            success=True,
            status=result.status,
            is_stereo=result.is_stereo,
            method=method,
            chunk_count=len(segments),
            segments=segments,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("diarize failed")
        return jsonify(success=False, message=str(exc)), 500
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass
