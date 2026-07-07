"""
Phase 2c — audio tone analysis on diarization chunks.

Backends (TONE_BACKEND):
  emotion2vec — real speech-emotion recognition (angry/happy/neutral/sad/...)
                per chunk via funasr + emotion2vec+, MERGED with the librosa
                pitch/energy High/Medium/Low levels the UI already renders.
                Falls back to librosa-only when the model is unavailable.
  librosa     — pitch/energy heuristic only (previous behavior).
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any, Optional

import numpy as np

from config import (
    DIARIZATION_OUTPUT_DIR,
    EMOTION2VEC_DEVICE,
    EMOTION2VEC_MODEL_PATH,
    TONE_BACKEND,
    TONE_ENABLED,
)

logger = logging.getLogger(__name__)

_chunk_re = re.compile(
    r"^(Agent|Customer)_([\d.]+)_([\d.]+)\.wav$",
    re.IGNORECASE,
)

_model_error: Optional[str] = None

_e2v_model = None
_e2v_error: Optional[str] = None


def _load_emotion2vec():
    """Lazy-load emotion2vec+ via funasr; cache failures so a broken install
    degrades to librosa-only once instead of retrying on every chunk."""
    global _e2v_model, _e2v_error
    if _e2v_model is not None or _e2v_error is not None:
        return _e2v_model
    try:
        from funasr import AutoModel

        if not Path(EMOTION2VEC_MODEL_PATH).exists():
            raise FileNotFoundError(f"no model dir at {EMOTION2VEC_MODEL_PATH}")
        _e2v_model = AutoModel(
            model=EMOTION2VEC_MODEL_PATH,
            device=EMOTION2VEC_DEVICE,
            disable_update=True,
            log_level="ERROR",
        )
        logger.info("emotion2vec+ loaded from %s (%s)", EMOTION2VEC_MODEL_PATH, EMOTION2VEC_DEVICE)
    except Exception as exc:  # noqa: BLE001
        _e2v_error = str(exc)[:200]
        logger.warning("emotion2vec unavailable (%s) — tone falls back to librosa", _e2v_error)
    return _e2v_model


def _emotion_for_chunk(wav: Path) -> Optional[dict[str, Any]]:
    """Top emotion + scores for one diarized chunk, or None on any failure."""
    model = _load_emotion2vec()
    if model is None:
        return None
    try:
        res = model.generate(str(wav), granularity="utterance", extract_embedding=False)
        if not res:
            return None
        labels = res[0].get("labels") or []
        scores = res[0].get("scores") or []
        # funasr emotion2vec labels are bilingual ("生气/angry") — keep the English half.
        clean = [str(lbl).split("/")[-1].strip().lower() for lbl in labels]
        pairs = sorted(zip(clean, scores), key=lambda x: -float(x[1]))
        if not pairs:
            return None
        top_label, top_score = pairs[0]
        return {
            "emotion": top_label,
            "emotion_confidence": round(float(top_score), 3),
            "emotion_scores": {lbl: round(float(s), 3) for lbl, s in pairs[:5]},
        }
    except Exception as exc:  # noqa: BLE001
        logger.debug("emotion2vec failed on %s: %s", wav.name, exc)
        return None


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
    seg = {
        "start": start,
        "end": end,
        "tone_distribution": details.get("tone_distribution", {}),
        "dominant_tone": details.get("dominant_tone", "Medium"),
    }
    # Extra emotion2vec fields; additive so the existing UI keeps working.
    for k in ("emotion", "emotion_confidence", "emotion_scores"):
        if k in details:
            seg[k] = details[k]
    return {key: seg}


def analyze_tone(audio_file: str) -> dict[str, Any]:
    if not TONE_ENABLED:
        return {"status": "disabled", "results": {}}

    stem = Path(audio_file).stem
    chunk_root = DIARIZATION_OUTPUT_DIR / stem
    if not chunk_root.is_dir():
        return {"status": "skipped", "results": {}, "reason": "no diarization chunks"}

    use_emotion = TONE_BACKEND == "emotion2vec"

    results: dict[str, Any] = {"Agent": {}, "Customer": {}}
    overall_counts = {
        "Agent": {"High": 0, "Medium": 0, "Low": 0},
        "Customer": {"High": 0, "Medium": 0, "Low": 0},
    }
    # Confidence-weighted emotion tally per role (durations vary per chunk, but
    # confidence weighting already de-emphasizes uncertain short chunks).
    emotion_weights: dict[str, dict[str, float]] = {"Agent": {}, "Customer": {}}

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
            if use_emotion:
                emo = _emotion_for_chunk(wav)
                if emo:
                    details.update(emo)
                    w = emotion_weights[role]
                    w[emo["emotion"]] = w.get(emo["emotion"], 0.0) + float(
                        emo.get("emotion_confidence") or 0.5
                    )
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

    payload: dict[str, Any] = {**results, "Overall_Tone": overall_tone}

    if use_emotion:
        overall_emotion = {}
        for role in ("Agent", "Customer"):
            w = emotion_weights[role]
            overall_emotion[role] = max(w, key=w.get) if w else "unknown"
        if any(v != "unknown" for v in overall_emotion.values()):
            payload["Overall_Emotion"] = overall_emotion

    return {"status": "success", "results": payload}


def tone_health() -> dict[str, Any]:
    if not TONE_ENABLED:
        return {"enabled": False, "ready": False}
    try:
        import librosa  # noqa: F401
    except Exception as exc:
        return {"enabled": True, "ready": False, "error": str(exc)[:200]}

    info: dict[str, Any] = {
        "enabled": True,
        "ready": True,
        "method": "librosa_piptrack_energy",
        "backend": TONE_BACKEND,
    }
    if TONE_BACKEND == "emotion2vec":
        if _e2v_model is not None:
            info["method"] = "emotion2vec+librosa"
            info["emotion2vec"] = "loaded"
        elif _e2v_error is not None:
            info["emotion2vec"] = f"unavailable: {_e2v_error}"
        else:
            info["emotion2vec"] = "lazy (loads on first call)"
    return info
