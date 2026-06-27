"""Release loaded ML models between pipeline phases to free RAM for Ollama."""

from __future__ import annotations

import gc


def release_transcription_memory() -> None:
    try:
        import torch
    except ImportError:
        torch = None

    try:
        from faster_whisper_worker import release_faster_whisper

        release_faster_whisper()
    except Exception:
        pass

    try:
        from language_worker import release_language_model

        release_language_model()
    except Exception:
        pass

    gc.collect()
    if torch is not None and torch.cuda.is_available():
        torch.cuda.empty_cache()
