#!/usr/bin/env python3
"""Smoke test for faster-whisper ASR backend."""

from __future__ import annotations

import os
import sys
import tempfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AI_MVP = ROOT / "ai-mvp"
sys.path.insert(0, str(AI_MVP))
os.chdir(AI_MVP)

from dotenv import load_dotenv

load_dotenv(AI_MVP / ".env")

SAMPLE_URL = (
    "https://github.com/SYSTRAN/faster-whisper/raw/master/tests/jfk.flac"
)


def main() -> int:
    print("=== faster-whisper smoke test ===\n")

    from faster_whisper_worker import faster_whisper_health, transcribe_chunk

    health = faster_whisper_health()
    print("Health:", health)
    if not health.get("ready"):
        print("\nFAIL: backend not ready")
        print("If HuggingFace download failed, run once:")
        print("  python scripts/download-faster-whisper-model.py")
        print("Then set FASTER_WHISPER_MODEL_PATH in ai-mvp/.env to models/faster-whisper-large-v3")
        return 1

    with tempfile.TemporaryDirectory() as tmp:
        sample = Path(tmp) / "jfk.flac"
        print(f"\nDownloading sample audio from {SAMPLE_URL} ...")
        urllib.request.urlretrieve(SAMPLE_URL, sample)
        print(f"Sample size: {sample.stat().st_size} bytes")

        print("\nTranscribing (first run may download large-v3 weights) ...")
        text, engine = transcribe_chunk(sample, "English")
        print(f"Engine: {engine}")
        print(f"Transcript: {text}")

        if not text or text == "[No speech detected]":
            print("\nFAIL: empty transcript")
            return 1

        if "nation" not in text.lower() and "ask" not in text.lower():
            print("\nWARN: unexpected transcript for JFK sample — check model/download")

    print("\n=== Pipeline health ===")
    from transcribe import transcription_health

    full = transcription_health()
    print(f"active_backend: {full.get('active_backend')}")
    print(f"ready: {full.get('ready')}")

    print("\nPASS: faster-whisper backend works")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
