"""
Production-only OpenAI-compatible LLM backend (vLLM — Llama AWQ or Qwen).
Used when LLM_BACKEND=openai — dev laptop keeps Ollama via bootstrap no-op.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from typing import Any

OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "http://llm:8001/v1").rstrip("/")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "local-dev")
OPENAI_MODEL = os.getenv(
    "OPENAI_MODEL",
    os.getenv("LLM_SERVED_NAME", "Meta-Llama-3.1-8B-Instruct"),
)
OPENAI_TIMEOUT_SEC = int(os.getenv("OPENAI_TIMEOUT_SEC", os.getenv("OLLAMA_TIMEOUT_SEC", "300")))
OPENAI_MAX_TOKENS = int(os.getenv("OPENAI_MAX_TOKENS", "2048"))
OPENAI_DISABLE_THINKING = os.getenv("OPENAI_DISABLE_THINKING", "true").lower() == "true"
OPENAI_TEMPERATURE = float(os.getenv("OPENAI_TEMPERATURE", "0.12"))


def _is_qwen_model(model: str) -> bool:
    m = (model or "").lower()
    return "qwen" in m


def _strip_thinking(text: str) -> str:
    try:
        from llm_utils import strip_llm_thinking
        return strip_llm_thinking(text)
    except ImportError:
        import re
        return re.sub(
            r"<\s*(?:think|redacted_reasoning)\s*>[\s\S]*?<\s*/\s*(?:think|redacted_reasoning)\s*>",
            "",
            text or "",
            flags=re.I,
        ).strip()


def openai_generate(
    prompt: str,
    system: str | None = None,
    *,
    json_mode: bool = False,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> str:
    messages: list[dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    payload: dict[str, Any] = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": OPENAI_TEMPERATURE if temperature is None else temperature,
        "top_p": 0.9,
        "max_tokens": OPENAI_MAX_TOKENS if max_tokens is None else max_tokens,
    }
    if json_mode:
        payload["response_format"] = {"type": "json_object"}
    if OPENAI_DISABLE_THINKING and _is_qwen_model(OPENAI_MODEL):
        payload["chat_template_kwargs"] = {"enable_thinking": False}

    data = json.dumps(payload).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {OPENAI_API_KEY}",
    }
    req = urllib.request.Request(
        f"{OPENAI_BASE_URL}/chat/completions",
        data=data,
        headers=headers,
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=OPENAI_TIMEOUT_SEC) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                choices = body.get("choices") or []
                if not choices:
                    raise RuntimeError("OpenAI response missing choices")
                message = choices[0].get("message") or {}
                content = (message.get("content") or "").strip()
                if not content:
                    raise RuntimeError("OpenAI response empty content")
                return _strip_thinking(content)
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            last_error = RuntimeError(f"LLM HTTP {exc.code}: {body[:300]}")
            if exc.code >= 500 and attempt < 2:
                time.sleep(4 * (attempt + 1))
                continue
            raise last_error from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"LLM request failed: {exc}") from exc

    if last_error:
        raise last_error
    raise RuntimeError("LLM request failed")


def openai_health() -> dict[str, Any]:
    from config import SCORING_ENABLED

    if not SCORING_ENABLED:
        return {"enabled": False, "ready": False, "model": OPENAI_MODEL, "backend": "openai"}
    try:
        req = urllib.request.Request(
            f"{OPENAI_BASE_URL}/models",
            headers={"Authorization": f"Bearer {OPENAI_API_KEY}"},
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read().decode("utf-8"))
        models = [m.get("id", "") for m in body.get("data", [])]
        ready = OPENAI_MODEL in models or any(
            OPENAI_MODEL.split("/")[-1] in m for m in models
        )
        return {
            "enabled": True,
            "ready": ready,
            "model": OPENAI_MODEL,
            "backend": "openai",
            "base_url": OPENAI_BASE_URL,
            "available_models": models[:8],
        }
    except Exception as exc:
        return {
            "enabled": True,
            "ready": False,
            "model": OPENAI_MODEL,
            "backend": "openai",
            "base_url": OPENAI_BASE_URL,
            "error": str(exc)[:200],
        }
