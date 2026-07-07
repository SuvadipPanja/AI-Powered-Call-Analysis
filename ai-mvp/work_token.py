"""Sprint 9 — verify backend-issued HMAC work tokens (HS256 JWT subset)."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any


def _b64url_decode(segment: str) -> bytes:
    pad = "=" * (-len(segment) % 4)
    return base64.urlsafe_b64decode(segment + pad)


def _parse_json(segment: str) -> dict[str, Any] | None:
    try:
        raw = _b64url_decode(segment)
        data = json.loads(raw.decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None


def verify_work_token(token: str, audio_file: str) -> tuple[bool, str]:
    secret = (os.getenv("ORCHESTRATOR_SECRET") or "").strip()
    if not secret:
        return True, "no-secret-configured"

    if os.getenv("AI_WORK_TOKEN_ENFORCE", "true").lower() == "false":
        return True, "enforcement-disabled"

    if not token:
        return False, "missing-token"

    parts = token.split(".")
    if len(parts) != 3:
        return False, "malformed-token"

    header_b64, payload_b64, sig_b64 = parts
    header = _parse_json(header_b64)
    payload = _parse_json(payload_b64)
    if not header or not payload:
        return False, "invalid-json"

    if header.get("alg") != "HS256":
        return False, "unsupported-alg"

    signing_input = f"{header_b64}.{payload_b64}".encode("utf-8")
    expected = hmac.new(secret.encode("utf-8"), signing_input, hashlib.sha256).digest()
    try:
        provided = _b64url_decode(sig_b64)
    except ValueError:
        return False, "invalid-signature"

    if not hmac.compare_digest(expected, provided):
        return False, "bad-signature"

    now = int(time.time())
    exp = int(payload.get("exp") or 0)
    if exp and now > exp:
        return False, "expired"

    if payload.get("aud") != "ai-mvp":
        return False, "bad-audience"

    if payload.get("sub") != audio_file:
        return False, "subject-mismatch"

    return True, "ok"


def extract_bearer_token(req) -> str:
    auth = (req.headers.get("Authorization") or "").strip()
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return (req.headers.get("X-AI-Work-Token") or "").strip()
