"""HTTP client for the sp-ai-nemo and sp-ai-seamless-m4t ASR services.

Used by the controller when AI_DISTRIBUTED=true. Mirrors the contract in
production/docs/AI-STACK-SPEC.md §3. All failures raise RuntimeError so
transcribe.py can fall back exactly like the legacy sp-nemo client did.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

AI_NEMO_SERVICE_URL = os.getenv("AI_NEMO_SERVICE_URL", "http://ai-nemo:8020").rstrip("/")
AI_SEAMLESS_SERVICE_URL = os.getenv("AI_SEAMLESS_SERVICE_URL", "http://ai-seamless:8030").rstrip("/")
AI_ASR_SERVICE_TIMEOUT_SEC = float(os.getenv("AI_ASR_SERVICE_TIMEOUT_SEC", "300"))

_SERVICE_URLS = {
    "nemo": AI_NEMO_SERVICE_URL,
    "seamless": AI_SEAMLESS_SERVICE_URL,
}


def asr_service_health(service: str) -> dict:
    url = _SERVICE_URLS.get(service)
    if not url:
        return {"ready": False, "error": f"unknown ASR service '{service}'"}
    try:
        resp = requests.get(f"{url}/health", timeout=5)
        return resp.json()
    except Exception as exc:  # noqa: BLE001
        return {"ready": False, "error": f"{service} service unreachable: {exc}"}


def transcribe_remote(
    wav_path: Path,
    language: str,
    service: str,
    audio_id: str = "",
) -> tuple[str, str]:
    """POST a prepared chunk wav to an ASR service; returns (text, engine).

    ``service`` is "nemo" or "seamless". Raises RuntimeError on failure.
    """
    url = _SERVICE_URLS.get(service)
    if not url:
        raise RuntimeError(f"unknown ASR service '{service}'")

    try:
        with open(wav_path, "rb") as fh:
            resp = requests.post(
                f"{url}/transcribe",
                files={"file": (wav_path.name, fh, "application/octet-stream")},
                data={"lang": language, "audio_id": audio_id},
                timeout=AI_ASR_SERVICE_TIMEOUT_SEC,
            )
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"{service} ASR request failed: {exc}") from exc

    if resp.status_code != 200:
        raise RuntimeError(f"{service} ASR HTTP {resp.status_code}: {resp.text[:200]}")

    payload = resp.json()
    if not payload.get("success"):
        raise RuntimeError(f"{service} ASR error: {payload.get('message')}")

    text = (payload.get("text") or "").strip()
    engine = payload.get("engine", f"sp-ai-{service}")
    return text, engine
