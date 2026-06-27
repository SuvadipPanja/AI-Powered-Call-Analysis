"""
HTTP client for the sp-nemo IndicConformer ASR microservice (Sherpa-ONNX).

Used for Hindi/Bengali ASR instead of the in-container NeMo IndicConformer,
which fails to load on NVIDIA NeMo (KeyError: 'dir'). English keeps using the
in-container NeMo parakeet model, which loads fine.

All failures raise RuntimeError so the caller can fall back to faster-whisper.
"""

from __future__ import annotations

import logging
from pathlib import Path

import requests

from config import (
    SP_NEMO_ENABLED,
    SP_NEMO_TIMEOUT_SEC,
    SP_NEMO_URL,
)

logger = logging.getLogger(__name__)

_health_cache: dict | None = None


def sp_nemo_health(refresh: bool = False) -> dict:
    global _health_cache
    if not SP_NEMO_ENABLED:
        return {"ready": False, "error": "sp-nemo disabled (SP_NEMO_ENABLED=false)"}
    if _health_cache is not None and not refresh:
        return _health_cache
    try:
        resp = requests.get(f"{SP_NEMO_URL}/health", timeout=5)
        info = resp.json()
        _health_cache = info
        return info
    except Exception as exc:  # noqa: BLE001
        info = {"ready": False, "error": f"sp-nemo unreachable: {exc}"}
        _health_cache = info
        return info


def transcribe_with_sp_nemo(wav_path: Path, language: str) -> tuple[str, str]:
    """POST the wav to sp-nemo; returns (text, engine). Raises RuntimeError on failure."""
    if not SP_NEMO_ENABLED:
        raise RuntimeError("sp-nemo disabled")

    url = f"{SP_NEMO_URL}/transcribe"
    try:
        with open(wav_path, "rb") as fh:
            files = {"file": (wav_path.name, fh, "application/octet-stream")}
            data = {"lang": _lang_code(language)}
            resp = requests.post(url, files=files, data=data, timeout=SP_NEMO_TIMEOUT_SEC)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"sp-nemo request failed: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"sp-nemo HTTP {resp.status_code}: {resp.text[:200]}")

    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(f"sp-nemo error: {payload.get('message')}")

    text = (payload.get("text") or "").strip()
    engine = payload.get("engine", "sherpa-onnx/indicconformer-ctc")
    return text, engine


def _lang_code(language: str) -> str:
    return {
        "Hindi": "hi",
        "Bengali": "bn",
        "Assamese": "as",
        "Gujarati": "gu",
        "Kannada": "kn",
        "Marathi": "mr",
    }.get(language, language.lower()[:2])
