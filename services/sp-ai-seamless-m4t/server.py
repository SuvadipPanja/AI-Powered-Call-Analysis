"""sp-ai-seamless-m4t — always-loaded SeamlessM4T v2 ASR HTTP service (port 8030).

Thin HTTP wrapper around ai-mvp's seamless_worker (SeamlessM4Tv2ForSpeechToText)
per production/docs/AI-STACK-SPEC.md §2/§3. The model is loaded eagerly at
import time and stays resident. Run under gunicorn with --workers 1 (single
model copy); request threads share the model under one global inference lock.
"""

from log_setup import init_service_logging

logger = init_service_logging("sp-ai-seamless-m4t")

import contextlib
import os
import tempfile
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request

from config import SEAMLESS_M4T_ENABLED, SEAMLESS_M4T_MODEL_PATH
from seamless_worker import (
    DISPLAY_TO_SEAMLESS,
    _load,
    _resolve_device,
    _seamless_lang,
    transcribe_with_seamless,
)

SERVICE_NAME = "sp-ai-seamless-m4t"
MODEL_KEY = "seamless-m4t-v2"
_START_TIME = time.time()

AI_SERVICE_THREADS = int(os.getenv("AI_SERVICE_THREADS", "4"))

# Uploads below this duration skip inference (contract: success + empty text).
MIN_AUDIO_SEC = 0.05

app = Flask(__name__)

_model_lock = threading.Lock()  # single resident model — serialize GPU inference
_model_status: dict[str, str] = {}
_load_error: str | None = None


def _preload_model() -> None:
    """Eager-load SeamlessM4T v2 at import; required for /health ready."""
    global _load_error
    if not SEAMLESS_M4T_ENABLED:
        _load_error = "disabled via SEAMLESS_M4T_ENABLED=false"
        _model_status[MODEL_KEY] = f"missing: {_load_error}"
        logger.error("SeamlessM4T service started with SEAMLESS_M4T_ENABLED=false — not ready")
        return
    started = time.time()
    try:
        logger.info("Eager-loading SeamlessM4T v2 from %s ...", SEAMLESS_M4T_MODEL_PATH)
        _load()
        _model_status[MODEL_KEY] = "loaded"
        logger.info("SeamlessM4T v2 ready in %.1fs", time.time() - started)
    except Exception as exc:  # noqa: BLE001
        _load_error = str(exc)
        _model_status[MODEL_KEY] = f"missing: {_load_error}"
        logger.error("SeamlessM4T v2 failed to load: %s", exc, exc_info=True)


_preload_model()


def _ready() -> bool:
    return _model_status.get(MODEL_KEY) == "loaded"


def _probe_duration_sec(path: Path) -> float | None:
    """Audio duration from the file header; None when unreadable (let ASR decide)."""
    try:
        import soundfile as sf

        info = sf.info(str(path))
        if not info.frames or not info.samplerate:
            return 0.0
        return float(info.frames) / float(info.samplerate)
    except Exception:  # noqa: BLE001
        return None


@app.get("/health")
def health_endpoint():
    ready = _ready()
    payload = {
        "ready": ready,
        "service": SERVICE_NAME,
        "models": dict(_model_status),
        "device": _resolve_device(),
        "error": _load_error,
        "uptime_sec": round(time.time() - _START_TIME, 1),
        "threads": AI_SERVICE_THREADS,
        "supported_languages": sorted(DISPLAY_TO_SEAMLESS.keys()),
        "model_path": str(SEAMLESS_M4T_MODEL_PATH),
    }
    return jsonify(payload), (200 if ready else 503)


@app.post("/transcribe")
def transcribe_endpoint():
    upload = request.files.get("file")
    language = (request.form.get("lang") or "").strip()
    audio_id = (request.form.get("audio_id") or "").strip() or "-"

    if upload is None or not upload.filename:
        return jsonify({"success": False, "message": "missing multipart 'file'"}), 400
    if not language:
        return jsonify({"success": False, "message": "missing form field 'lang'"}), 400
    # Delegate language support to seamless_worker's own display→code map.
    if _seamless_lang(language) is None:
        return jsonify({"success": False, "message": "unsupported language"}), 400
    if not _ready():
        message = f"SeamlessM4T model not loaded ({_load_error or 'unknown'})"
        return jsonify({"success": False, "message": message}), 503

    tmp_path: Path | None = None
    try:
        fd, tmp_name = tempfile.mkstemp(
            prefix="sp_ai_seamless_", suffix=Path(upload.filename).suffix or ".wav"
        )
        os.close(fd)
        tmp_path = Path(tmp_name)
        upload.save(str(tmp_path))
        wav_bytes = tmp_path.stat().st_size
        duration = _probe_duration_sec(tmp_path)

        if wav_bytes == 0 or (duration is not None and duration < MIN_AUDIO_SEC):
            logger.info(
                "[%s] lang=%s bytes=%d dur=%.3fs -> empty/short audio, returning empty text",
                audio_id, language, wav_bytes, duration or 0.0,
            )
            return jsonify({"success": True, "text": "", "engine": f"{SERVICE_NAME}/empty-audio"})

        infer_start = time.time()
        with _model_lock:
            text, engine = transcribe_with_seamless(tmp_path, language)
        infer_ms = (time.time() - infer_start) * 1000.0

        logger.info(
            "[%s] lang=%s bytes=%d infer_ms=%.0f text_len=%d engine=%s",
            audio_id, language, wav_bytes, infer_ms, len(text or ""), engine,
        )
        return jsonify({"success": True, "text": text or "", "engine": engine})
    except RuntimeError as exc:
        # transcribe_with_seamless raises RuntimeError for unmapped languages.
        if "No SeamlessM4T language code" in str(exc):
            logger.info("[%s] unsupported language '%s'", audio_id, language)
            return jsonify({"success": False, "message": "unsupported language"}), 400
        logger.error("[%s] transcribe failed lang=%s: %s", audio_id, language, exc, exc_info=True)
        return jsonify({"success": False, "message": str(exc)}), 500
    except Exception as exc:  # noqa: BLE001
        logger.error("[%s] transcribe failed lang=%s: %s", audio_id, language, exc, exc_info=True)
        return jsonify({"success": False, "message": str(exc)}), 500
    finally:
        if tmp_path is not None:
            with contextlib.suppress(OSError):
                tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("AI_SERVICE_PORT", "8030")), threaded=True)
