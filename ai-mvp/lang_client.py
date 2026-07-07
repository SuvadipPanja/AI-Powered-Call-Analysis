"""HTTP client for the sp-ai-whisper-lang language-detection service.

Used by the controller when AI_DISTRIBUTED=true. Mirrors the contract in
production/docs/AI-STACK-SPEC.md §3. All failures raise RuntimeError so the
caller can fall back to in-process detection.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

AI_LANG_SERVICE_URL = os.getenv("AI_LANG_SERVICE_URL", "http://ai-whisper-lang:8010").rstrip("/")
AI_LANG_SERVICE_TIMEOUT_SEC = float(os.getenv("AI_LANG_SERVICE_TIMEOUT_SEC", "180"))


def lang_service_health() -> dict:
    try:
        resp = requests.get(f"{AI_LANG_SERVICE_URL}/health", timeout=5)
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "error": f"lang service unreachable: {exc}"}


def detect_language_remote(audio_path: Path, audio_id: str = "") -> str:
    """POST audio to the lang service; returns the detected language name.

    Raises RuntimeError on any transport/contract failure.
    """
    url = f"{AI_LANG_SERVICE_URL}/detect-language"
    try:
        with open(audio_path, "rb") as fh:
            resp = requests.post(
                url,
                files={"file": (audio_path.name, fh, "application/octet-stream")},
                data={"audio_id": audio_id},
                timeout=AI_LANG_SERVICE_TIMEOUT_SEC,
            )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"lang service request failed: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"lang service HTTP {resp.status_code}: {resp.text[:200]}")

    payload = resp.json()
    if not payload.get("success") or not payload.get("language"):
        raise RuntimeError(f"lang service error: {payload.get('message', 'no language')}")

    language = str(payload["language"]).strip()
    logger.info(
        "Remote language detection: %s (confidence=%s method=%s)",
        language, payload.get("confidence"), payload.get("method"),
    )
    return language
