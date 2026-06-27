"""
Phase 2c integration test — creates synthetic stereo audio, runs workers, reports results.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torchaudio

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()

from config import AUDIO_UPLOAD_DIR, DIARIZATION_OUTPUT_DIR
from diarization_worker import diarize
from enrichment_worker import enrich_call, enrichment_health
from script_worker import analyze_script_compliance
from sentiment_worker import analyze_sentiment
from tone_worker import analyze_tone

SAMPLE_TRANSCRIPT = """0.0 - 2.5 (Agent): Good morning, thank you for calling UCO Bank. How may I assist you today?
2.5 - 8.0 (Customer): I am frustrated with a delay on my account balance update.
8.0 - 15.0 (Agent): I understand your concern. May I verify your account number please?
15.0 - 22.0 (Customer): Yes, my account number is 1234567890.
22.0 - 30.0 (Agent): Thank you. Your balance is fifty thousand rupees. Is there anything else I can help you with?
30.0 - 32.0 (Customer): No, thank you.
32.0 - 35.0 (Agent): Thank you for calling UCO Bank. Have a nice day."""


def _make_stereo_speech_wav(path: Path, duration_sec: float = 35.0) -> None:
    """Burst noise segments on L/R to trigger Silero VAD (agent left, customer right)."""
    sr = 16000
    n = int(duration_sec * sr)
    wav = torch.zeros(2, n)
    segments = [
        (0.0, 2.5, 0),
        (2.5, 8.0, 1),
        (8.0, 15.0, 0),
        (15.0, 22.0, 1),
        (22.0, 30.0, 0),
        (30.0, 32.0, 1),
        (32.0, 35.0, 0),
    ]
    for start, end, ch in segments:
        s = int(start * sr)
        e = int(end * sr)
        length = e - s
        if length <= 0:
            continue
        # Speech-like band-limited noise
        noise = torch.randn(length) * 0.25
        t = torch.linspace(0, 1, length)
        mod = 0.5 + 0.5 * torch.sin(2 * np.pi * 4 * t)
        wav[ch, s:e] = noise * mod
    path.parent.mkdir(parents=True, exist_ok=True)
    import soundfile as sf

    sf.write(str(path), wav.T.numpy(), sr)


def main() -> int:
    print("=== Phase 2c Test Report ===\n")
    health = enrichment_health()
    print("Health:", json.dumps(health, indent=2))

    errors = []
    for name, block in [
        ("tone", health.get("tone", {})),
        ("sentiment", health.get("sentiment", {})),
        ("script", health.get("script", {})),
    ]:
        if block.get("enabled") and not block.get("ready"):
            errors.append(f"{name}: {block.get('error', 'not ready')}")

    test_file = "phase2c-integration-test.wav"
    audio_path = AUDIO_UPLOAD_DIR / test_file
    print(f"\n1. Creating synthetic stereo audio: {audio_path}")
    _make_stereo_speech_wav(audio_path)

    print("2. Running diarization...")
    t0 = time.time()
    dia = diarize(audio_path)
    print(f"   Status: {dia.status}, chunks: {len(dia.chunks)}, stereo: {dia.is_stereo}")
    print(f"   Time: {time.time() - t0:.1f}s")
    if dia.chunks:
        print(f"   Chunk dir: {dia.output_dir}")

    print("\n3. Sentiment worker (transformer)...")
    t0 = time.time()
    sentiment = analyze_sentiment(SAMPLE_TRANSCRIPT, "English")
    print(f"   Lines: {len(sentiment)}, time: {time.time() - t0:.1f}s")
    if sentiment:
        print(f"   Sample: {sentiment[0]}")

    print("\n4. Script compliance worker (MiniLM)...")
    t0 = time.time()
    script = analyze_script_compliance(SAMPLE_TRANSCRIPT, "English")
    print(f"   Score: {script}%, time: {time.time() - t0:.1f}s")

    print("\n5. Tone worker (librosa on chunks)...")
    t0 = time.time()
    tone = analyze_tone(test_file)
    print(f"   Status: {tone.get('status')}, time: {time.time() - t0:.1f}s")
    agent_segs = tone.get("results", {}).get("Agent", {})
    print(f"   Agent segments: {len(agent_segs)}")
    if agent_segs:
        first_key = next(iter(agent_segs))
        print(f"   Sample segment: {first_key} -> {agent_segs[first_key]}")

    print("\n6. Full enrich_call()...")
    t0 = time.time()
    enriched = enrich_call(test_file, SAMPLE_TRANSCRIPT, "English")
    print(f"   Time: {time.time() - t0:.1f}s")
    print(f"   Sentiment lines: {len(enriched.sentiment)}")
    print(f"   Script: {enriched.script_compliance}%")
    print(f"   Tone status: {enriched.tone_analysis.get('status')}")

    # Pass/fail criteria
    print("\n=== Results ===")
    checks = {
        "sentiment_lines_gt_0": len(enriched.sentiment) > 0,
        "script_score_gt_0": float(enriched.script_compliance) > 0,
        "tone_has_segments_or_skipped": (
            enriched.tone_analysis.get("status") in ("success", "skipped")
        ),
        "sentiment_model_ready": health.get("sentiment", {}).get("ready", False),
        "script_model_ready": health.get("script", {}).get("ready", False),
        "tone_librosa_ready": health.get("tone", {}).get("ready", False),
    }
    if dia.chunks:
        checks["diarization_chunks_gt_0"] = len(dia.chunks) > 0
        checks["tone_success_with_chunks"] = enriched.tone_analysis.get("status") == "success"

    for name, ok in checks.items():
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")

    failed = [k for k, v in checks.items() if not v]
    if failed:
        print(f"\nFailed checks: {failed}")
        if errors:
            print("Startup errors:", errors)
        return 1
    print("\nAll Phase 2c checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
