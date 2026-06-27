"""
Production entrypoint: patch scoring_worker for vLLM/Qwen, then start orchestrator
in the same Python process so imports bind to the patched functions.
"""

from __future__ import annotations

import runpy
import sys

from bootstrap_prod_llm import main as bootstrap_llm


def main() -> None:
    bootstrap_llm()
    runpy.run_module("orchestrator", run_name="__main__")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as exc:
        print(f"[prod-llm] orchestrator failed: {exc}", file=sys.stderr)
        sys.exit(1)
