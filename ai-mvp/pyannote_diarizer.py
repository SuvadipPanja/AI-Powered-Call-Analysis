"""Pyannote speaker-diarization-3.1 (offline / air-gap capable)."""

from __future__ import annotations

import logging
import os
import tempfile
from pathlib import Path
from typing import Any

import yaml

from config import (
    DIAR_PYANNOTE_EXCLUSIVE,
    DIAR_PYANNOTE_NUM_SPEAKERS,
    PYANNOTE_DEVICE,
    PYANNOTE_MODEL_PATH,
)

logger = logging.getLogger(__name__)

_PIPELINE = None
_load_error: str | None = None
_offline_config_path: Path | None = None

_WEIGHTS_NAME = "pytorch_model.bin"


def _resolve_model_dir(raw: str) -> Path | None:
    """Resolve PYANNOTE_MODEL_PATH to the pipeline model directory."""
    text = (raw or "").strip()
    if not text:
        return None
    path = Path(text)
    if path.is_file():
        if path.name == "config.yaml":
            return path.parent
        return None
    return path if path.is_dir() else None


def _model_path() -> Path | None:
    return _resolve_model_dir(PYANNOTE_MODEL_PATH)


def _weights_file(model_ref: str, pipeline_dir: Path) -> Path | None:
    """Map hub id, directory, or file ref to a local pytorch_model.bin."""
    ref = (model_ref or "").strip()
    if not ref:
        return None

    path = Path(ref)
    if path.is_file():
        return path
    if path.is_dir():
        candidate = path / _WEIGHTS_NAME
        return candidate if candidate.is_file() else None

    # Hugging Face id, e.g. pyannote/segmentation-3.0
    if "/" in ref and not ref.startswith(("/", "\\")):
        name = ref.rsplit("/", 1)[-1]
        candidate = pipeline_dir.parent / name / _WEIGHTS_NAME
        if candidate.is_file():
            return candidate

    # Absolute directory path without trailing bin
    candidate = Path(ref) / _WEIGHTS_NAME
    return candidate if candidate.is_file() else None


def _offline_pipeline_config(model_dir: Path) -> Path:
    """Build a temp config.yaml with local .bin paths for sub-models."""
    global _offline_config_path

    source = model_dir / "config.yaml"
    if not source.is_file():
        raise FileNotFoundError(f"Missing pipeline config: {source}")

    cfg = yaml.safe_load(source.read_text(encoding="utf-8")) or {}
    params = cfg.setdefault("pipeline", {}).setdefault("params", {})
    changed = False

    for key in ("segmentation", "embedding"):
        ref = params.get(key)
        if not isinstance(ref, str):
            continue
        weights = _weights_file(ref, model_dir)
        if weights is None:
            raise FileNotFoundError(
                f"Offline weights not found for {key}={ref!r} "
                f"(expected {_WEIGHTS_NAME} under {model_dir.parent})"
            )
        resolved = str(weights)
        if params[key] != resolved:
            params[key] = resolved
            changed = True

    if not changed:
        seg = params.get("segmentation", "")
        emb = params.get("embedding", "")
        if (
            isinstance(seg, str)
            and isinstance(emb, str)
            and seg.endswith(".bin")
            and emb.endswith(".bin")
            and Path(seg).is_file()
            and Path(emb).is_file()
        ):
            return source

    if _offline_config_path and _offline_config_path.is_file() and not changed:
        return _offline_config_path

    fd, temp_name = tempfile.mkstemp(
        prefix="pyannote-offline-",
        suffix=".yaml",
        dir="/tmp" if os.path.isdir("/tmp") else None,
    )
    os.close(fd)
    out = Path(temp_name)
    out.write_text(yaml.safe_dump(cfg, sort_keys=False), encoding="utf-8")
    _offline_config_path = out
    logger.info("Offline Pyannote config: %s", out)
    return out


def _load_pipeline():
    global _PIPELINE, _load_error
    if _PIPELINE is not None:
        return _PIPELINE
    if _load_error:
        raise RuntimeError(_load_error)

    model_dir = _model_path()
    if model_dir is None:
        _load_error = f"PYANNOTE_MODEL_PATH missing or invalid: {PYANNOTE_MODEL_PATH!r}"
        raise RuntimeError(_load_error)

    try:
        os.environ["HF_HUB_OFFLINE"] = "1"
        from pyannote.audio import Pipeline
        import torch

        config_path = _offline_pipeline_config(model_dir)
        logger.info("Loading Pyannote pipeline from %s", config_path)
        pipeline = Pipeline.from_pretrained(str(config_path))
        device = PYANNOTE_DEVICE
        if device == "auto":
            device = "cuda" if torch.cuda.is_available() else "cpu"
        if device.startswith("cuda") and torch.cuda.is_available():
            pipeline = pipeline.to(torch.device(device))
        else:
            pipeline = pipeline.to(torch.device("cpu"))
        _PIPELINE = pipeline
        return _PIPELINE
    except Exception as exc:
        _load_error = f"Pyannote load failed: {exc}"
        logger.error(_load_error)
        raise RuntimeError(_load_error) from exc


def pyannote_ready() -> dict[str, Any]:
    try:
        _load_pipeline()
        return {
            "ready": True,
            "model_path": str(_model_path()),
            "config_path": str(_offline_config_path) if _offline_config_path else None,
            "device": PYANNOTE_DEVICE,
            "exclusive": DIAR_PYANNOTE_EXCLUSIVE,
            "offline": os.environ.get("HF_HUB_OFFLINE") == "1",
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc), "model_path": str(PYANNOTE_MODEL_PATH)}


def _annotation_to_segments(annotation) -> list[tuple[str, float, float]]:
    out: list[tuple[str, float, float]] = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        out.append((str(speaker), float(turn.start), float(turn.end)))
    out.sort(key=lambda x: x[1])
    return merge_segments(out)


def merge_segments(segments: list[tuple[str, float, float]]) -> list[tuple[str, float, float]]:
    if not segments:
        return []
    merged: list[tuple[str, float, float]] = []
    spk, start, end = segments[0]
    for s, a, b in segments[1:]:
        if s == spk and a <= end + 0.05:
            end = max(end, b)
        else:
            merged.append((spk, start, end))
            spk, start, end = s, a, b
    merged.append((spk, start, end))
    return merged


def diarize_with_pyannote(
    audio_path: Path,
    *,
    num_speakers: int = DIAR_PYANNOTE_NUM_SPEAKERS,
    sample_rate: int = 16000,
) -> list[tuple[str, float, float]]:
    """Return [(speaker_label, start_sec, end_sec), ...] using exclusive diarization when available."""
    pipeline = _load_pipeline()
    kwargs: dict[str, Any] = {}
    if num_speakers > 0:
        kwargs["num_speakers"] = num_speakers
    else:
        kwargs["min_speakers"] = 2
        kwargs["max_speakers"] = 2

    output = pipeline(str(audio_path), **kwargs)

    annotation = output
    if DIAR_PYANNOTE_EXCLUSIVE:
        exclusive = getattr(output, "exclusive_speaker_diarization", None)
        if exclusive is not None:
            annotation = exclusive

    return _annotation_to_segments(annotation)
