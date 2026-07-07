"""Unit tests for exclusive overlap diarization core."""

import torch

from diarization_core import (
    clip_exclusive_timeline,
    compute_metrics,
    merge_consecutive,
    resolve_vad_overlaps,
)


def test_resolve_vad_overlaps_no_overlap():
    sr = 16000
    agent_ch = torch.zeros(1, sr * 10)
    customer_ch = torch.zeros(1, sr * 10)
    agent_ch[:, : sr * 5] = 0.2
    customer_ch[:, sr * 5 : sr * 8] = 0.25

    segments = resolve_vad_overlaps(
        [(0.0, 5.0)],
        [(5.0, 8.0)],
        agent_ch,
        customer_ch,
        sr,
        10.0,
    )
    metrics = compute_metrics(segments)
    assert metrics.overlaps == 0
    assert any(s == "Agent" for s, _, _ in segments)
    assert any(s == "Customer" for s, _, _ in segments)


def test_clip_exclusive_removes_pad_overlap():
    raw = [
        ("Agent", 0.0, 10.0),
        ("Customer", 9.0, 12.0),
    ]
    clipped = clip_exclusive_timeline(raw)
    metrics = compute_metrics(clipped)
    assert metrics.overlaps == 0
    assert merge_consecutive(clipped)[0][2] <= 9.5
