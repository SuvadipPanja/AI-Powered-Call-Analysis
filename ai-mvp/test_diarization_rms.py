"""Tests for RMS-dominance stereo diarization timeline."""

from __future__ import annotations

import torch

from diarization_worker import (
    _build_rms_dominance_timeline,
    _filter_agent_segments,
    _merge_consecutive,
)


def _fill(ch: torch.Tensor, start: float, end: float, sr: int, level: float) -> None:
    s, e = int(start * sr), int(end * sr)
    ch[:, s:e] = level


def test_overlap_resolved_by_louder_channel():
    """Customer speech on customer channel must not inherit Agent label from agent VAD bleed."""
    sr = 16000
    duration = 12.0
    agent_ch = torch.zeros(1, int(duration * sr))
    customer_ch = torch.zeros(1, int(duration * sr))

    agent_segments = [(0.0, 10.0)]
    customer_segments = [(5.0, 8.0)]

    _fill(agent_ch, 0.0, 10.0, sr, 0.08)
    _fill(customer_ch, 5.0, 8.0, sr, 0.20)

    timeline = _build_rms_dominance_timeline(
        agent_segments,
        customer_segments,
        agent_ch,
        customer_ch,
        sr,
        total_duration=duration,
    )

    assert timeline, timeline
    speakers = [spk for spk, _, _ in timeline]
    assert "Customer" in speakers
    for spk, start, end in timeline:
        if spk == "Customer":
            assert start <= 5.1 and end >= 7.9, timeline
        if spk == "Agent" and end <= 5.1:
            assert end <= 5.2, timeline


def test_agent_bleed_segment_dropped():
    sr = 16000
    agent_ch = torch.zeros(1, sr * 10)
    customer_ch = torch.zeros(1, sr * 10)

    _fill(customer_ch, 2.0, 4.0, sr, 0.25)
    _fill(agent_ch, 2.0, 2.2, sr, 0.01)

    filtered = _filter_agent_segments([(2.0, 2.2)], agent_ch, customer_ch, sr)
    assert filtered == []


def test_legacy_merge_still_works_for_non_overlap():
    labeled = [
        ("Agent", 0.0, 3.0),
        ("Customer", 3.0, 6.0),
        ("Agent", 6.0, 9.0),
    ]
    merged = _merge_consecutive(labeled)
    assert merged == [("Agent", 0.0, 3.0), ("Customer", 3.0, 6.0), ("Agent", 6.0, 9.0)]
