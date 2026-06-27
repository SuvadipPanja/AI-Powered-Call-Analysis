"""Unit tests for customer segment filtering and timeline merge behaviour."""

from __future__ import annotations

import sys
from pathlib import Path

import torch

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from diarization_worker import _filter_customer_segments, _merge_consecutive


def _build_timeline(agent_segments, customer_segments):
    labeled = [("Agent", s, e) for s, e in agent_segments]
    labeled += [("Customer", s, e) for s, e in customer_segments]
    labeled.sort(key=lambda x: x[1])
    return _merge_consecutive(labeled)


def test_regression_call_000028_timeline():
    """Segments from legacy metadata for MNDE...000028 — must not collapse to 3 chunks."""
    sr = 16000
    duration = 75.0
    agent_ch = torch.zeros(1, int(duration * sr))
    customer_ch = torch.zeros(1, int(duration * sr))

    agent_segments = [
        (1.25, 5.63),
        (6.59, 6.88),
        (12.80, 25.95),
        (26.18, 55.65),
        (56.42, 59.77),
        (60.58, 75.06),
    ]
    customer_segments = [
        (5.92, 8.48),
        (9.31, 12.25),
        (23.17, 23.45),
        (56.19, 56.83),
        (60.35, 61.18),
    ]

    # Give each customer segment measurable energy so RMS gates pass.
    for start, end in customer_segments:
        s, e = int(start * sr), int(end * sr)
        customer_ch[:, s:e] = 0.05
    for start, end in agent_segments:
        s, e = int(start * sr), int(end * sr)
        agent_ch[:, s:e] = 0.08

    filtered = _filter_customer_segments(customer_segments, agent_ch, customer_ch, sr)
    merged = _build_timeline(agent_segments, filtered)

    assert len(filtered) >= 4, f"filtered too aggressively: {filtered}"
    assert len(merged) >= 8, f"timeline collapsed: {merged}"
    assert all(end - start < 50 for _, start, end in merged if _ == "Agent"), merged
    print(f"filtered={len(filtered)} merged={len(merged)}")
    for row in merged:
        print(f"  {row[0]}: {row[1]:.2f}-{row[2]:.2f}")


def test_micro_bleed_suppressed():
    """Short agent-bleed hit on customer channel should be dropped."""
    sr = 16000
    agent_ch = torch.zeros(1, sr * 10)
    customer_ch = torch.zeros(1, sr * 10)

    # Agent loud, customer barely bleeds — 0.2s micro segment
    agent_ch[:, int(2 * sr): int(4 * sr)] = 0.2
    customer_ch[:, int(2 * sr): int(2.2 * sr)] = 0.01

    filtered = _filter_customer_segments([(2.0, 2.2)], agent_ch, customer_ch, sr)
    assert filtered == [], f"expected bleed suppression, got {filtered}"


if __name__ == "__main__":
    test_micro_bleed_suppressed()
    test_regression_call_000028_timeline()
    print("PASS")
