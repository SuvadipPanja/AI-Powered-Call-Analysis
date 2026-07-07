"""HTTP client for sp-ai-diarization service (port 8040)."""

from __future__ import annotations

import logging
from pathlib import Path

import requests

from config import AI_DIAR_SERVICE_TIMEOUT_SEC, AI_DIAR_SERVICE_URL

logger = logging.getLogger(__name__)


def diar_service_health() -> dict:
    try:
        resp = requests.get(f"{AI_DIAR_SERVICE_URL}/health", timeout=5)
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "error": str(exc)}


def diarize_remote(audio_path: Path, audio_id: str = "") -> dict:
    """POST audio to diarization service; returns JSON payload with segments."""
    try:
        with open(audio_path, "rb") as fh:
            resp = requests.post(
                f"{AI_DIAR_SERVICE_URL}/diarize",
                files={"file": (audio_path.name, fh, "application/octet-stream")},
                data={"audio_id": audio_id},
                timeout=AI_DIAR_SERVICE_TIMEOUT_SEC,
            )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"diarization service request failed: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"diarization HTTP {resp.status_code}: {resp.text[:300]}")

    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(payload.get("message") or "diarization failed")
    return payload
