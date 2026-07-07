"""SeamlessM4T short transcribe probes for language detection (HTTP → ai-seamless)."""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

AI_SEAMLESS_SERVICE_URL = os.getenv("AI_SEAMLESS_SERVICE_URL", "http://ai-seamless:8030").rstrip("/")
AI_ASR_SERVICE_TIMEOUT_SEC = float(os.getenv("AI_ASR_SERVICE_TIMEOUT_SEC", "300"))


def seamless_service_health() -> dict:
    try:
        resp = requests.get(f"{AI_SEAMLESS_SERVICE_URL}/health", timeout=5)
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "error": str(exc)}


def probe_transcribe_remote(audio_path: Path, language: str, audio_id: str = "") -> str:
    """POST audio to ai-seamless /transcribe with forced target language."""
    url = f"{AI_SEAMLESS_SERVICE_URL}/transcribe"
    with open(audio_path, "rb") as fh:
        resp = requests.post(
            url,
            files={"file": (audio_path.name, fh, "application/octet-stream")},
            data={"lang": language, "audio_id": audio_id or audio_path.stem},
            timeout=AI_ASR_SERVICE_TIMEOUT_SEC,
        )
    if resp.status_code != 200:
        raise RuntimeError(f"seamless probe HTTP {resp.status_code}: {resp.text[:200]}")
    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(payload.get("message", "seamless probe failed"))
    return str(payload.get("text") or "").strip()
