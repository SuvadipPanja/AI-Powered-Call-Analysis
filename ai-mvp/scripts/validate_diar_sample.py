"""Validate diarization quality on the sample call — pass/fail gate before prod."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

SAMPLE = Path(
    r"C:\Project\AI-Powered Call Analysis project\production\Sample Calls"
    r"\3M5LS6PGFH673E5RFC3TC869RC3LSI73.mp3"
)

# Gate thresholds (tuned on sample call regression)
MAX_OVERLAPS = 0
MAX_OVERLAP_FLIPS = 0  # speaker change while timestamps overlap
MAX_SEGMENTS = 65


def main() -> int:
    from diarization_core import compute_metrics
    from diarization_worker import diarize

    if not SAMPLE.exists():
        print(f"FAIL: missing sample {SAMPLE}")
        return 1

    print(f"Sample: {SAMPLE.name}")
    result = diarize(SAMPLE)
    print(f"Status: {result.status}  chunks: {len(result.chunks)}")

    segments = [(c.speaker, c.start_sec, c.end_sec) for c in result.chunks]
    metrics = compute_metrics(segments)
    overlap_flips = sum(
        1
        for i in range(1, len(segments))
        if segments[i][0] != segments[i - 1][0]
        and segments[i][1] < segments[i - 1][2] - 0.01
    )
    print(
        f"Metrics: segments={metrics.segments} overlaps={metrics.overlaps} "
        f"flips={metrics.rapid_flips} overlap_flips={overlap_flips} "
        f"micro={metrics.micro_turns} "
        f"agent_sec={metrics.agent_secs:.1f} customer_sec={metrics.customer_secs:.1f} "
        f"score={metrics.score:.1f}"
    )

    ok = True
    if metrics.overlaps > MAX_OVERLAPS:
        print(f"FAIL: overlaps {metrics.overlaps} > {MAX_OVERLAPS}")
        ok = False
    if overlap_flips > MAX_OVERLAP_FLIPS:
        print(f"FAIL: overlap_flips {overlap_flips} > {MAX_OVERLAP_FLIPS}")
        ok = False
    if metrics.segments > MAX_SEGMENTS:
        print(f"FAIL: segments {metrics.segments} > {MAX_SEGMENTS}")
        ok = False

    print("\nFirst 20 segments:")
    for spk, start, end in segments[:20]:
        print(f"  {start:6.1f}-{end:6.1f}  {spk}")

    if ok:
        print("\nPASS — diarization gate OK for prod")
        return 0
    print("\nFAIL — diarization gate not met")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
