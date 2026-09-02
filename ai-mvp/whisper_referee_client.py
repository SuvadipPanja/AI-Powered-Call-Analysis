"""HTTP client for the GPU Whisper referee on sp-ai-whisper-lang."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

AI_LANG_SERVICE_URL = os.getenv(
    "AI_LANG_SERVICE_URL", "http://ai-whisper-lang:8010"
).rstrip("/")
WHISPER_REFEREE_TIMEOUT_SEC = float(os.getenv("WHISPER_REFEREE_TIMEOUT_SEC", "45"))


def whisper_referee_health() -> dict:
    """Ready only when the lang service advertises the window model."""
    try:
        resp = requests.get(f"{AI_LANG_SERVICE_URL}/health", timeout=5)
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "error": str(exc), "url": AI_LANG_SERVICE_URL}
    models = payload.get("models") or {}
    return {
        "ready": bool(payload.get("ready")) and models.get("whisper-window") == "loaded",
        "error": payload.get("error"),
        "service": payload.get("service"),
        "device": payload.get("device"),
        "url": AI_LANG_SERVICE_URL,
    }


def transcribe_window_remote(
    wav_path: Path,
    language: str = "",
    initial_prompt: str = "",
    audio_id: str = "",
) -> str:
    path = Path(wav_path)
    if not path.is_file():
        logger.warning("Referee window missing on disk: %s", path)
        return ""
    try:
        with open(path, "rb") as fh:
            resp = requests.post(
                f"{AI_LANG_SERVICE_URL}/transcribe-window",
                files={"file": (path.name, fh, "application/octet-stream")},
                data={
                    "lang": language or "",
                    "prompt": initial_prompt or "",
                    "audio_id": audio_id or "",
                },
                timeout=WHISPER_REFEREE_TIMEOUT_SEC,
            )
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Referee window decode failed for %s: %s", path.name, exc)
        return ""
    if not payload.get("success"):
        logger.warning(
            "Referee window decode rejected for %s: %s",
            path.name,
            payload.get("message"),
        )
        return ""
    return str(payload.get("text") or "").strip()
