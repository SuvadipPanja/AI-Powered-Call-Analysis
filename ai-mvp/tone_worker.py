"""
Phase 2c — audio tone analysis via librosa on diarization chunks.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Optional

import numpy as np

from config import DIARIZATION_OUTPUT_DIR, TONE_ENABLED

_chunk_re = re.compile(
    r"^(Agent|Customer)_([\d.]+)_([\d.]+)\.wav$",
    re.IGNORECASE,
)

_model_error: Optional[str] = None


def _classify_tone(value: float) -> str:
    if value < 150:
        return "Low"
    if value < 600:
        return "Medium"
    return "High"


def _analyze_chunk(chunk_path: Path) -> dict[str, Any]:
    import librosa

    y, sr = librosa.load(str(chunk_path), sr=None)
    frame_length = int(0.025 * sr)
    hop_length = int(0.010 * sr)
    pitches, _magnitudes = librosa.piptrack(
        y=y, sr=sr, hop_length=hop_length, fmin=50, fmax=500
    )
    energy = np.array(
        [
            float(np.sum(y[i : i + frame_length] ** 2))
            for i in range(0, max(len(y) - frame_length + 1, 1), hop_length)
        ]
    )
    pitch_values = [
        float(np.max(pitches[:, i])) if np.any(pitches[:, i] > 0) else 0.0
        for i in range(pitches.shape[1])
    ]
    combined = [max(p, e) for p, e in zip(pitch_values, energy)]
    tones = [_classify_tone(v) for v in combined]
    counts = {
        "High": tones.count("High"),
        "Medium": tones.count("Medium"),
        "Low": tones.count("Low"),
    }
    dominant = max(counts, key=counts.get)
    # Legacy UI expects frame counts (High/Medium/Low integers), not 0–1 proportions.
    return {"dominant_tone": dominant, "tone_distribution": counts, "tone_counts": counts}


def _parse_chunk_times(filename: str) -> tuple[float, float]:
    match = _chunk_re.match(filename)
    if match:
        return float(match.group(2)), float(match.group(3))
    return 0.0, 0.0


def _to_resultpage_segment(
    start: float, end: float, details: dict[str, Any]
) -> dict[str, Any]:
    key = f"{start:.2f} - {end:.2f}"
    return {
        key: {
            "start": start,
            "end": end,
            "tone_distribution": details.get("tone_distribution", {}),
            "dominant_tone": details.get("dominant_tone", "Medium"),
        }
    }


def analyze_tone(audio_file: str) -> dict[str, Any]:
    if not TONE_ENABLED:
        return {"status": "disabled", "results": {}}

    stem = Path(audio_file).stem
    chunk_root = DIARIZATION_OUTPUT_DIR / stem
    if not chunk_root.is_dir():
        return {"status": "skipped", "results": {}, "reason": "no diarization chunks"}

    results: dict[str, Any] = {"Agent": {}, "Customer": {}}
    overall_counts = {
        "Agent": {"High": 0, "Medium": 0, "Low": 0},
        "Customer": {"High": 0, "Medium": 0, "Low": 0},
    }

    for role in ("Agent", "Customer"):
        folder = chunk_root / role
        if not folder.is_dir():
            continue
        for wav in sorted(folder.glob("*.wav")):
            start, end = _parse_chunk_times(wav.name)
            try:
                details = _analyze_chunk(wav)
            except Exception as exc:
                details = {
                    "dominant_tone": "Medium",
                    "tone_distribution": {"High": 0, "Medium": 100, "Low": 0},
                    "error": str(exc)[:120],
                }
            segment = _to_resultpage_segment(start, end, details)
            results[role].update(segment)
            for tone, count in details.get("tone_counts", {}).items():
                overall_counts[role][tone] += count

    overall_tone = {}
    for role in ("Agent", "Customer"):
        counts = overall_counts[role]
        if sum(counts.values()) == 0:
            overall_tone[role] = "Unknown"
        else:
            overall_tone[role] = max(counts, key=counts.get)

    return {
        "status": "success",
        "results": {**results, "Overall_Tone": overall_tone},
    }


def tone_health() -> dict[str, Any]:
    if not TONE_ENABLED:
        return {"enabled": False, "ready": False}
    try:
        import librosa  # noqa: F401

        return {"enabled": True, "ready": True, "method": "librosa_piptrack_energy"}
    except Exception as exc:
        return {"enabled": True, "ready": False, "error": str(exc)[:200]}
