"""Compare diarization on sample call — old vs RMS dominance."""
from __future__ import annotations

import importlib
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import config
import diarization_worker as dw

SAMPLE = Path(
    r"C:\Project\AI-Powered Call Analysis project\production\Sample Calls"
    r"\3M5LS6PGFH673E5RFC3TC869RC3LSI73.mp3"
)


def _row(chunk):
    if hasattr(chunk, "speaker"):
        return chunk.speaker, chunk.start_sec, chunk.end_sec
    return chunk[0], chunk[1], chunk[2]


def stats(chunks, label: str) -> None:
    rows = [_row(c) for c in chunks]
    flips = sum(
        1
        for i in range(1, len(rows))
        if rows[i][0] != rows[i - 1][0]
        and (rows[i][1] - rows[i - 1][2]) < 0.5
    )
    overlaps = sum(
        1
        for i in range(1, len(rows))
        if rows[i][1] < rows[i - 1][2] - 0.01
    )
    agent = sum(1 for spk, _, _ in rows if spk == "Agent")
    cust = sum(1 for spk, _, _ in rows if spk == "Customer")
    print(
        f"{label}: chunks={len(chunks)} agent={agent} cust={cust} "
        f"flips={flips} overlaps={overlaps}"
    )


def run_legacy_merge():
    """Original pre-fix: both VAD lists merged with no overlap resolution."""
    import torchaudio
    from audio_io import load_audio
    from diarization_worker import (
        _filter_agent_segments,
        _filter_customer_segments,
        _merge_consecutive,
        _merge_same_speaker_gap,
        _pad_short_segments,
        _select_channel,
        _speech_segments,
        _suppress_sandwiched_crosstalk,
        _enhance_customer_waveform,
    )

    waveform, sample_rate = load_audio(SAMPLE)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000
    agent_ch_raw = _select_channel(waveform, config.AGENT_CHANNEL_INDEX)
    customer_ch_raw = _select_channel(waveform, config.CUSTOMER_CHANNEL_INDEX)
    customer_ch_vad = (
        _enhance_customer_waveform(customer_ch_raw, sample_rate)
        if config.CUSTOMER_ENHANCE_ENABLED
        else customer_ch_raw
    )
    agent_segments = _speech_segments(agent_ch_raw, sample_rate)
    customer_segments = _speech_segments(customer_ch_vad, sample_rate)
    customer_segments = _filter_customer_segments(
        customer_segments, agent_ch_raw, customer_ch_vad, sample_rate
    )
    labeled = []
    for start, end in agent_segments:
        labeled.append(("Agent", start, end))
    for start, end in customer_segments:
        labeled.append(("Customer", start, end))
    labeled.sort(key=lambda x: x[1])
    labeled = _suppress_sandwiched_crosstalk(
        labeled, agent_ch_raw, customer_ch_vad, sample_rate
    )
    merged = _merge_consecutive(labeled)
    merged = _merge_same_speaker_gap(merged)
    total_duration = waveform.shape[1] / sample_rate
    merged = _pad_short_segments(merged, total_duration)
    return merged


def run_current():
    config.DIAR_RMS_DOMINANCE_ENABLED = False
    importlib.reload(dw)
    return dw.diarize(SAMPLE).chunks


if __name__ == "__main__":
    print("file:", SAMPLE.name, "exists:", SAMPLE.exists())
    legacy = run_legacy_merge()
    stats(legacy, "LEGACY (no overlap fix)")
    current = run_current()
    stats(current, "CURRENT (overlap resolve + gap pad)")
    print("--- first 15 CURRENT ---")
    for c in current[:15]:
        print(f"  {c.start_sec:6.1f}-{c.end_sec:6.1f}  {c.speaker}")
