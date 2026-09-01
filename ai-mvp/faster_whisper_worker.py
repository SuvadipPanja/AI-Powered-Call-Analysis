"""
ASR via faster-whisper (CTranslate2) — same Whisper Large v3 weights, faster inference.
Supports Hindi, English, and Hinglish in a single model (no per-language NeMo routing).
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import torch

from config import (
    FASTER_WHISPER_BEAM_SIZE,
    FASTER_WHISPER_COMPUTE_TYPE,
    FASTER_WHISPER_CPU_THREADS,
    FASTER_WHISPER_DEVICE,
    FASTER_WHISPER_DOWNLOAD_ROOT,
    FASTER_WHISPER_MODEL_PATH,
    FASTER_WHISPER_MODEL_SIZE,
    FASTER_WHISPER_OFFLINE_ONLY,
    FASTER_WHISPER_USE_LANG_HINT,
    FASTER_WHISPER_VAD_FILTER,
    TRANSCRIPTION_RETRY_EMPTY,
    WHISPER_NO_SPEECH_THRESHOLD,
)

import logging

logger = logging.getLogger(__name__)

_model = None
_load_error: Optional[str] = None

_LANG_CODE = {
    "Hindi": "hi",
    "English": "en",
    "Bengali": "bn",
    "Tamil": "ta",
    "Telugu": "te",
    "Marathi": "mr",
    "Gujarati": "gu",
    "Kannada": "kn",
    "Malayalam": "ml",
    "Punjabi": "pa",
    "Odia": "or",
    "Assamese": "as",
    "Urdu": "ur",
}


def _resolve_device() -> str:
    if FASTER_WHISPER_DEVICE != "auto":
        return FASTER_WHISPER_DEVICE
    return "cuda" if torch.cuda.is_available() else "cpu"


def _resolve_compute_type(device: str) -> str:
    if FASTER_WHISPER_COMPUTE_TYPE != "auto":
        return FASTER_WHISPER_COMPUTE_TYPE
    return "float16" if device == "cuda" else "int8"


def _model_id() -> str:
    """Resolve the model to load, refusing anything that implies a download.

    A bare size string makes CTranslate2 reach out to HuggingFace. On the
    air-gapped prod host that blocks for minutes and then fails, which is how
    a missing model previously turned into a silent no-op referee.
    """
    if FASTER_WHISPER_MODEL_PATH:
        if Path(FASTER_WHISPER_MODEL_PATH).is_dir():
            return str(FASTER_WHISPER_MODEL_PATH)
        raise RuntimeError(
            f"FASTER_WHISPER_MODEL_PATH={FASTER_WHISPER_MODEL_PATH!r} is not a "
            "directory; refusing to fall back to a HuggingFace download. "
            "Extract the CTranslate2 bundle into volumes/models/."
        )
    if FASTER_WHISPER_OFFLINE_ONLY:
        raise RuntimeError(
            "FASTER_WHISPER_MODEL_PATH is unset and FASTER_WHISPER_OFFLINE_ONLY "
            "is true; refusing to download the model at runtime."
        )
    return FASTER_WHISPER_MODEL_SIZE


def _load():
    global _model, _load_error
    if _model is not None:
        return _model
    if _load_error:
        raise RuntimeError(_load_error)
    try:
        from faster_whisper import WhisperModel

        device = _resolve_device()
        compute_type = _resolve_compute_type(device)
        kwargs: dict = {
            "device": device,
            "compute_type": compute_type,
            "download_root": str(FASTER_WHISPER_DOWNLOAD_ROOT),
        }
        if device == "cpu" and FASTER_WHISPER_CPU_THREADS > 0:
            kwargs["cpu_threads"] = FASTER_WHISPER_CPU_THREADS
        _model = WhisperModel(_model_id(), **kwargs)
        logger.info(
            "faster-whisper loaded: model=%s device=%s compute=%s threads=%s",
            _model_id(),
            device,
            compute_type,
            kwargs.get("cpu_threads", "default"),
        )
        return _model
    except Exception as exc:
        _load_error = str(exc)
        raise RuntimeError(_load_error) from exc


def release_faster_whisper() -> None:
    global _model
    _model = None


def _run_transcribe(
    model,
    wav_path: Path,
    lang: Optional[str],
    *,
    no_speech_threshold: float,
    vad_filter: bool,
    initial_prompt: Optional[str] = None,
    beam_size: Optional[int] = None,
) -> tuple[str, str]:
    """Run faster-whisper transcription; returns (text, detected_language)."""
    segments, info = model.transcribe(
        str(wav_path),
        language=lang,
        beam_size=beam_size if beam_size else FASTER_WHISPER_BEAM_SIZE,
        vad_filter=vad_filter,
        no_speech_threshold=no_speech_threshold,
        condition_on_previous_text=False,
        initial_prompt=initial_prompt,
    )
    text = " ".join(seg.text.strip() for seg in segments).strip()
    detected = info.language or lang or "auto"
    return text, detected


def transcribe_chunk(
    wav_path: Path,
    language: str,
    initial_prompt: Optional[str] = None,
    beam_size: Optional[int] = None,
) -> tuple[str, str]:
    model = _load()
    device = _resolve_device()
    compute_type = _resolve_compute_type(device)

    lang = None
    if FASTER_WHISPER_USE_LANG_HINT:
        lang = _LANG_CODE.get(language)

    text, detected = _run_transcribe(
        model, wav_path, lang,
        no_speech_threshold=WHISPER_NO_SPEECH_THRESHOLD,
        vad_filter=FASTER_WHISPER_VAD_FILTER,
        initial_prompt=initial_prompt,
        beam_size=beam_size,
    )

    if not text and TRANSCRIPTION_RETRY_EMPTY:
        logger.info("Empty transcription for %s — retrying with relaxed settings", wav_path.name)
        text, detected = _run_transcribe(
            model, wav_path, lang,
            no_speech_threshold=max(0.1, WHISPER_NO_SPEECH_THRESHOLD - 0.2),
            vad_filter=False,
            initial_prompt=initial_prompt,
            beam_size=beam_size,
        )

    if not text and TRANSCRIPTION_RETRY_EMPTY:
        logger.info("Still empty for %s — retrying without language hint", wav_path.name)
        text, detected = _run_transcribe(
            model, wav_path, None,
            no_speech_threshold=0.1,
            vad_filter=False,
            initial_prompt=initial_prompt,
            beam_size=beam_size,
        )

    if not text:
        text = "[No speech detected]"

    engine = f"faster-whisper/{FASTER_WHISPER_MODEL_SIZE}/{detected}/{compute_type}"
    return text, engine


def faster_whisper_health() -> dict:
    try:
        _load()
        device = _resolve_device()
        compute_type = _resolve_compute_type(device)
        return {
            "ready": True,
            "model": _model_id(),
            "device": device,
            "compute_type": compute_type,
            "beam_size": FASTER_WHISPER_BEAM_SIZE,
            "lang_hint": FASTER_WHISPER_USE_LANG_HINT,
            "note": "Same Whisper Large v3 weights via CTranslate2 — recommended for Hindi/English/Hinglish",
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc)}
