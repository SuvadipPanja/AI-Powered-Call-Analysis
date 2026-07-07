"""sp-ai-nemo — always-loaded NeMo ASR HTTP service (port 8020).

Thin HTTP wrapper around ai-mvp's nemo_worker (English parakeet-rnnt-1.1b +
Hindi stt_hi_conformer_ctc_medium) per production/docs/AI-STACK-SPEC.md §2/§3.
Models are loaded eagerly at import time and stay resident. Run under
gunicorn with --workers 1 (single model copy); request threads share the
models under per-language inference locks.
"""

from log_setup import init_service_logging

logger = init_service_logging("sp-ai-nemo")

import contextlib
import os
import tempfile
import threading
import time
from pathlib import Path

from flask import Flask, jsonify, request

from config import (
    BENGALI_MULTILINGUAL_FALLBACK,
    MULTILINGUAL_NEMO_MODEL_PATH,
    TRANSCRIPTION_RETRY_EMPTY,
)
from nemo_worker import _resolve_device, _resolve_model_for_language, transcribe_with_nemo

SERVICE_NAME = "sp-ai-nemo"
_START_TIME = time.time()

AI_SERVICE_THREADS = int(os.getenv("AI_SERVICE_THREADS", "4"))

# Raw env (NOT config.py) — used for /health reporting only. Actual model
# loading goes through nemo_worker, which resolves paths via config.
ENGLISH_MODEL_PATH_ENV = os.getenv("ENGLISH_NEMO_MODEL_PATH", "")
HINDI_MODEL_PATH_ENV = os.getenv("HINDI_NEMO_MODEL_PATH", "")


def _csv_env(name: str, default: str) -> list[str]:
    return [x.strip() for x in os.getenv(name, default).split(",") if x.strip()]


PRELOAD_LANGUAGES = _csv_env("AI_NEMO_PRELOAD_LANGUAGES", "English,Hindi")
REQUIRED_LANGUAGES = _csv_env("AI_NEMO_REQUIRED_LANGUAGES", "English")

# Load required languages first so an optional model failure can never shadow
# a required one. /transcribe accepts exactly these languages.
SUPPORTED_LANGUAGES: list[str] = []
for _lang in REQUIRED_LANGUAGES + PRELOAD_LANGUAGES:
    if _lang not in SUPPORTED_LANGUAGES:
        SUPPORTED_LANGUAGES.append(_lang)

# Uploads below this duration skip inference (contract: success + empty text).
MIN_AUDIO_SEC = 0.05

app = Flask(__name__)

_model_status: dict[str, str] = {}  # language -> "loaded" | "missing: <err>"
_load_errors: dict[str, str] = {}  # language -> startup load error string
_locks_by_model_path: dict[str, threading.Lock] = {}
_language_locks: dict[str, threading.Lock] = {}


def _preload_models() -> None:
    """Eager-load every supported language at import; record per-language status."""
    for language in SUPPORTED_LANGUAGES:
        started = time.time()
        try:
            logger.info("Eager-loading NeMo model for %s ...", language)
            _, model_path, _, engine = _resolve_model_for_language(language)
            # Languages backed by the same .nemo file share one inference lock.
            lock = _locks_by_model_path.setdefault(model_path or language, threading.Lock())
            _language_locks[language] = lock
            _model_status[language] = "loaded"
            logger.info(
                "NeMo model for %s ready in %.1fs (engine=%s)",
                language, time.time() - started, engine,
            )
        except Exception as exc:  # noqa: BLE001
            err = str(exc)
            _model_status[language] = f"missing: {err}"
            _load_errors[language] = err
            if language in REQUIRED_LANGUAGES:
                logger.error(
                    "Required NeMo model for %s failed to load: %s",
                    language, err, exc_info=True,
                )
            else:
                logger.warning("Optional NeMo model for %s failed to load: %s", language, err)


_preload_models()


def _ready() -> bool:
    return all(_model_status.get(lang) == "loaded" for lang in REQUIRED_LANGUAGES)


def _locks_for(language: str) -> list[threading.Lock]:
    """Inference locks to hold for `language`, deduped, in a fixed global order.

    Languages backed by the same .nemo file share one lock. Beyond the primary
    model, transcribe_with_nemo can also touch:
      * the English model — empty-result retry when TRANSCRIPTION_RETRY_EMPTY;
      * the multilingual model — Bengali quality fallback.
    Those locks are held too. Acquiring in a stable id() order prevents deadlock.
    """
    locks = {_language_locks[language]}
    if TRANSCRIPTION_RETRY_EMPTY and language != "English":
        english_lock = _language_locks.get("English")
        if english_lock is not None:
            locks.add(english_lock)
    if language == "Bengali" and BENGALI_MULTILINGUAL_FALLBACK:
        locks.add(_locks_by_model_path.setdefault(MULTILINGUAL_NEMO_MODEL_PATH, threading.Lock()))
    return sorted(locks, key=id)


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
    required_failures = [
        f"{lang}: {err}" for lang, err in _load_errors.items() if lang in REQUIRED_LANGUAGES
    ]
    optional_failures = [
        f"{lang}: {err}" for lang, err in _load_errors.items() if lang not in REQUIRED_LANGUAGES
    ]

    payload = {
        "ready": ready,
        "service": SERVICE_NAME,
        "models": dict(_model_status),
        "device": _resolve_device(),
        "error": "; ".join(required_failures) or None,
        "uptime_sec": round(time.time() - _START_TIME, 1),
        "threads": AI_SERVICE_THREADS,
        "supported_languages": list(SUPPORTED_LANGUAGES),
        "model_paths": {"English": ENGLISH_MODEL_PATH_ENV, "Hindi": HINDI_MODEL_PATH_ENV},
    }
    if optional_failures:
        payload["warning"] = "; ".join(optional_failures)
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
    if language not in SUPPORTED_LANGUAGES:
        return jsonify({"success": False, "message": "unsupported language"}), 400
    if _model_status.get(language) != "loaded":
        message = f"model for {language} not loaded ({_load_errors.get(language, 'unknown')})"
        return jsonify({"success": False, "message": message}), 503

    tmp_path: Path | None = None
    try:
        fd, tmp_name = tempfile.mkstemp(
            prefix="sp_ai_nemo_", suffix=Path(upload.filename).suffix or ".wav"
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
        with contextlib.ExitStack() as stack:
            for lock in _locks_for(language):
                stack.enter_context(lock)
            text, engine = transcribe_with_nemo(tmp_path, language)
        infer_ms = (time.time() - infer_start) * 1000.0

        logger.info(
            "[%s] lang=%s bytes=%d infer_ms=%.0f text_len=%d engine=%s",
            audio_id, language, wav_bytes, infer_ms, len(text or ""), engine,
        )
        return jsonify({"success": True, "text": text or "", "engine": engine})
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "[%s] transcribe failed lang=%s: %s", audio_id, language, exc, exc_info=True
        )
        return jsonify({"success": False, "message": str(exc)}), 500
    finally:
        if tmp_path is not None:
            with contextlib.suppress(OSError):
                tmp_path.unlink(missing_ok=True)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("AI_SERVICE_PORT", "8020")), threaded=True)
