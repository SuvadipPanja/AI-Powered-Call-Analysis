"""
Production bootstrap: patch scoring_worker to use OpenAI-compatible vLLM (Qwen).
No-op when LLM_BACKEND is not 'openai' (dev laptop / base GPU image unchanged).
"""

from __future__ import annotations

import os
import sys


def main() -> None:
    backend = os.getenv("LLM_BACKEND", "ollama").strip().lower()
    if backend != "openai":
        print(f"[prod-llm] LLM_BACKEND={backend!r} — keeping Ollama (dev/default).")
        return

    import scoring_worker
    from llm_openai_backend import openai_generate, openai_health

    scoring_worker.ollama_generate = openai_generate
    scoring_worker.ollama_health = openai_health

    base = os.getenv("OPENAI_BASE_URL", "http://qwen:8001/v1")
    model = os.getenv("OPENAI_MODEL", os.getenv("QWEN_MODEL", "Qwen3-4B"))
    print(f"[prod-llm] Patched LLM backend -> OpenAI-compatible @ {base} model={model}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"[prod-llm] bootstrap failed: {exc}", file=sys.stderr)
        sys.exit(1)
