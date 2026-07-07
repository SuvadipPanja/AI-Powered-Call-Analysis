"""
Stereo channel diarization — same logic as old pipeline (Step 3).
Default: channel 0 = Agent, channel 1 = Customer (override via env).
Silero VAD per channel with crosstalk filtering on customer segments.
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np
import torch
import torchaudio

from diarization_core import build_hybrid_timeline, clip_exclusive_timeline, merge_consecutive
from audio_io import load_audio, save_audio
from config import (
    AGENT_CHANNEL_INDEX,
    CHUNK_BOUNDARY_PAD_SEC,
    CHUNK_PADDING_SEC,
    CROSSTALK_AGENT_RMS_RATIO,
    CROSSTALK_MAX_DURATION_SEC,
    CUSTOMER_CHANNEL_INDEX,
    CUSTOMER_CROSSTALK_SUPPRESS,
    CUSTOMER_ENHANCE_ENABLED,
    CUSTOMER_GAIN_DB,
    CUSTOMER_MIN_RMS,
    DIAR_BACKEND,
    DIAR_PYANNOTE_ENABLED,
    DIAR_RMS_DOMINANCE_ENABLED,
    DIAR_RMS_DOMINANCE_RATIO,
    DIAR_RMS_FRAME_MS,
    DIAR_SAME_SPEAKER_MERGE_GAP_SEC,
    DIAR_SANDWICH_MAX_DURATION_SEC,
    DIAR_SANDWICH_RMS_RATIO,
    DIAR_SUPPRESS_SANDWICHED_CROSSTALK,
    DIARIZATION_OUTPUT_DIR,
    MIN_CHUNK_DURATION_SEC,
    MIN_CUSTOMER_SPEECH_DURATION_SEC,
    MIN_SPEECH_DURATION_MS,
    SILERO_THRESHOLD,
    SILERO_VAD_DEVICE,
    WORK_DIR,
)

_silero_model = None
_silero_get_speech_ts = None
_silero_device: Optional[str] = None
_load_error: Optional[str] = None


def _resolve_silero_device() -> str:
    if SILERO_VAD_DEVICE == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if SILERO_VAD_DEVICE == "cuda":
        if not torch.cuda.is_available():
            raise RuntimeError(
                "SILERO_VAD_DEVICE=cuda but CUDA is not available "
                "(no GPU driver, CUDA runtime, or visible GPU device)"
            )
        return "cuda"
    if SILERO_VAD_DEVICE == "cpu":
        return "cpu"
    raise RuntimeError(
        f"Invalid SILERO_VAD_DEVICE={SILERO_VAD_DEVICE!r}; expected auto, cuda, or cpu"
    )


@dataclass
class DiarizedChunk:
    speaker: str
    start_sec: float
    end_sec: float
    wav_path: Path


@dataclass
class DiarizationResult:
    chunks: list[DiarizedChunk]
    is_stereo: bool
    status: str
    output_dir: Optional[Path] = None


def _load_silero():
    global _silero_model, _silero_get_speech_ts, _silero_device, _load_error
    if _silero_model is not None:
        return _silero_model, _silero_get_speech_ts
    if _load_error:
        raise RuntimeError(_load_error)
    try:
        model, utils = torch.hub.load(
            "snakers4/silero-vad",
            "silero_vad",
            trust_repo=True,
        )
        device = _resolve_silero_device()
        model = model.float().to(device)
        model.eval()
        get_speech_ts = utils[0]
        _silero_model = model
        _silero_get_speech_ts = get_speech_ts
        _silero_device = device
        return model, get_speech_ts
    except Exception as exc:
        _load_error = f"Failed to load Silero VAD: {exc}"
        raise RuntimeError(_load_error) from exc


def _enhance_customer_waveform(waveform: torch.Tensor, sample_rate: int = 16000) -> torch.Tensor:
    """Noise reduction + gain boost on customer channel (optional noisereduce)."""
    if not CUSTOMER_ENHANCE_ENABLED:
        return waveform
    samples = waveform.squeeze().numpy().astype(np.float32)
    if samples.size == 0:
        return waveform
    peak = np.max(np.abs(samples)) or 1.0
    samples_norm = samples / peak
    try:
        import noisereduce as nr

        samples_norm = nr.reduce_noise(y=samples_norm, sr=sample_rate)
    except ImportError:
        pass
    gain = 10 ** (CUSTOMER_GAIN_DB / 20.0)
    samples_norm = np.clip(samples_norm * gain, -1.0, 1.0)
    return torch.from_numpy(samples_norm).unsqueeze(0)


def _speech_segments(
    waveform: torch.Tensor,
    sample_rate: int = 16000,
) -> list[tuple[float, float]]:
    model, get_speech_ts = _load_silero()
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    wav = waveform.squeeze()
    if wav.numel() == 0:
        return []

    device = _silero_device or _resolve_silero_device()
    if device != "cpu":
        wav = wav.to(device)

    speech_ts = get_speech_ts(
        wav,
        model,
        sampling_rate=sample_rate,
        threshold=SILERO_THRESHOLD,
        min_speech_duration_ms=MIN_SPEECH_DURATION_MS,
    )
    return [(ts["start"] / sample_rate, ts["end"] / sample_rate) for ts in speech_ts]


def _segment_rms(
    waveform: torch.Tensor,
    start_sec: float,
    end_sec: float,
    sample_rate: int,
) -> float:
    start_sample = int(start_sec * sample_rate)
    end_sample = int(end_sec * sample_rate)
    if end_sample <= start_sample:
        return 0.0
    chunk = waveform[:, start_sample:end_sample]
    if chunk.numel() == 0:
        return 0.0
    return float(torch.sqrt(torch.mean(chunk ** 2)).item())


def _filter_customer_segments(
    customer_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
) -> list[tuple[float, float]]:
    """Drop micro customer VAD hits caused by agent bleed into the customer channel.

    Real customer replies (including short "ok"/"haan") are kept. Crosstalk suppression
    only applies to segments shorter than CROSSTALK_MAX_DURATION_SEC where the agent
    channel is much louder than the customer channel.
    """
    filtered: list[tuple[float, float]] = []
    for start, end in customer_segments:
        duration = end - start
        cust_rms = _segment_rms(customer_ch, start, end, sample_rate)

        if duration < MIN_CUSTOMER_SPEECH_DURATION_SEC and cust_rms < CUSTOMER_MIN_RMS:
            continue

        if CUSTOMER_CROSSTALK_SUPPRESS and duration <= CROSSTALK_MAX_DURATION_SEC:
            agent_rms = _segment_rms(agent_ch, start, end, sample_rate)
            if agent_rms > 0 and cust_rms > 0 and agent_rms > cust_rms * CROSSTALK_AGENT_RMS_RATIO:
                continue

        filtered.append((start, end))
    return filtered


def _filter_agent_segments(
    agent_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
) -> list[tuple[float, float]]:
    """Drop micro agent VAD hits caused by customer bleed into the agent channel."""
    filtered: list[tuple[float, float]] = []
    for start, end in agent_segments:
        duration = end - start
        agent_rms = _segment_rms(agent_ch, start, end, sample_rate)
        if duration <= CROSSTALK_MAX_DURATION_SEC:
            cust_rms = _segment_rms(customer_ch, start, end, sample_rate)
            if cust_rms > 0 and agent_rms > 0 and cust_rms > agent_rms * CROSSTALK_AGENT_RMS_RATIO:
                continue
        filtered.append((start, end))
    return filtered


def _in_segment(t: float, segments: list[tuple[float, float]]) -> bool:
    return any(start <= t and end >= t for start, end in segments)


def _build_rms_dominance_timeline(
    agent_segments: list[tuple[float, float]],
    customer_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
    *,
    total_duration: float,
) -> list[tuple[str, float, float]]:
    """Assign each voiced frame to Agent or Customer by channel RMS — no overlapping turns."""
    if not agent_segments and not customer_segments:
        return []

    frame_sec = max(DIAR_RMS_FRAME_MS, 20) / 1000.0
    min_seg_sec = max(MIN_SPEECH_DURATION_MS / 1000.0, frame_sec)
    all_segments = agent_segments + customer_segments
    start_bound = min(s for s, _ in all_segments)
    end_bound = min(total_duration, max(e for _, e in all_segments))

    frames: list[tuple[str, float, float]] = []
    t = max(0.0, start_bound)
    while t < end_bound:
        t_end = min(end_bound, t + frame_sec)
        in_agent = _in_segment(t, agent_segments)
        in_customer = _in_segment(t, customer_segments)
        if not in_agent and not in_customer:
            t = t_end
            continue

        a_rms = _segment_rms(agent_ch, t, t_end, sample_rate)
        c_rms = _segment_rms(customer_ch, t, t_end, sample_rate)
        if a_rms <= 0 and c_rms <= 0:
            t = t_end
            continue

        if a_rms >= c_rms * DIAR_RMS_DOMINANCE_RATIO:
            speaker = "Agent"
        elif c_rms >= a_rms * DIAR_RMS_DOMINANCE_RATIO:
            speaker = "Customer"
        elif in_agent and not in_customer:
            speaker = "Agent"
        elif in_customer and not in_agent:
            speaker = "Customer"
        else:
            speaker = "Agent" if a_rms >= c_rms else "Customer"

        frames.append((speaker, t, t_end))
        t = t_end

    if not frames:
        return []

    merged = _merge_consecutive(frames)
    return [
        (spk, start, end)
        for spk, start, end in merged
        if (end - start) >= min_seg_sec
    ]


def _merge_consecutive(
    segments: list[tuple[str, float, float]],
) -> list[tuple[str, float, float]]:
    if not segments:
        return []
    merged = []
    speaker, start, end = segments[0]
    for spk, seg_start, seg_end in segments[1:]:
        if spk == speaker:
            end = max(end, seg_end)
        else:
            merged.append((speaker, start, end))
            speaker, start, end = spk, seg_start, seg_end
    merged.append((speaker, start, end))
    return merged


def _suppress_sandwiched_crosstalk(
    labeled: list[tuple[str, float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
) -> list[tuple[str, float, float]]:
    """Remove a short opposite-speaker segment wedged between two turns of the SAME
    other speaker when it is really channel bleed (the other channel is louder).

    This is the main anti-oversplit guard: without it, a brief crosstalk blip in the
    customer channel splits one continuous agent turn into several transcript lines
    (and vice-versa). Genuine short replies where the speaker's OWN channel dominates
    are kept.
    """
    if not DIAR_SUPPRESS_SANDWICHED_CROSSTALK or len(labeled) < 3:
        return labeled

    keep = [True] * len(labeled)
    for i in range(1, len(labeled) - 1):
        spk, start, end = labeled[i]
        prev_spk = labeled[i - 1][0]
        next_spk = labeled[i + 1][0]
        if (end - start) > DIAR_SANDWICH_MAX_DURATION_SEC:
            continue
        # must be a single segment of one speaker between two turns of the OTHER speaker
        if not (prev_spk == next_spk and prev_spk != spk):
            continue
        own_ch = agent_ch if spk == "Agent" else customer_ch
        other_ch = customer_ch if spk == "Agent" else agent_ch
        own_rms = _segment_rms(own_ch, start, end, sample_rate)
        other_rms = _segment_rms(other_ch, start, end, sample_rate)
        if own_rms <= 0 or (other_rms > own_rms * DIAR_SANDWICH_RMS_RATIO):
            keep[i] = False
    return [seg for k, seg in zip(keep, labeled) if k]


def _merge_same_speaker_gap(
    segments: list[tuple[str, float, float]],
) -> list[tuple[str, float, float]]:
    """Join consecutive same-speaker turns separated only by a short pause."""
    if DIAR_SAME_SPEAKER_MERGE_GAP_SEC <= 0 or len(segments) < 2:
        return segments
    out = [segments[0]]
    for spk, start, end in segments[1:]:
        p_spk, p_start, p_end = out[-1]
        if spk == p_spk and (start - p_end) <= DIAR_SAME_SPEAKER_MERGE_GAP_SEC:
            out[-1] = (p_spk, p_start, max(p_end, end))
        else:
            out.append((spk, start, end))
    return out


def _resolve_vad_overlaps(
    agent_segments: list[tuple[float, float]],
    customer_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
    total_duration: float,
) -> list[tuple[str, float, float]]:
    """Build a non-overlapping Agent/Customer timeline from dual-channel VAD.

    When both channels' VAD cover the same interval, assign it to whichever
    channel has higher RMS — prevents agent/customer label flipping on bleed.
    """
    boundaries: set[float] = {0.0, total_duration}
    for start, end in agent_segments + customer_segments:
        boundaries.add(start)
        boundaries.add(end)
    points = sorted(boundaries)
    min_interval = max(MIN_SPEECH_DURATION_MS / 1000.0, 0.05)

    intervals: list[tuple[str, float, float]] = []
    for i in range(len(points) - 1):
        start, end = points[i], points[i + 1]
        if (end - start) < min_interval:
            continue
        in_agent = any(s <= start and e >= end for s, e in agent_segments)
        in_customer = any(s <= start and e >= end for s, e in customer_segments)
        if not in_agent and not in_customer:
            continue
        if in_agent and not in_customer:
            speaker = "Agent"
        elif in_customer and not in_agent:
            speaker = "Customer"
        else:
            a_rms = _segment_rms(agent_ch, start, end, sample_rate)
            c_rms = _segment_rms(customer_ch, start, end, sample_rate)
            if a_rms >= c_rms * DIAR_RMS_DOMINANCE_RATIO:
                speaker = "Agent"
            elif c_rms >= a_rms * DIAR_RMS_DOMINANCE_RATIO:
                speaker = "Customer"
            else:
                speaker = "Agent" if a_rms >= c_rms else "Customer"
        intervals.append((speaker, start, end))

    return _merge_consecutive(intervals)


def _absorb_micro_turns(
    segments: list[tuple[str, float, float]],
    min_sec: float = 0.35,
) -> list[tuple[str, float, float]]:
    """Merge a very short opposite-speaker blip sandwiched between two same-speaker turns."""
    if len(segments) < 3:
        return segments
    out = list(segments)
    changed = True
    while changed and len(out) >= 3:
        changed = False
        for i in range(1, len(out) - 1):
            spk, start, end = out[i]
            if (end - start) >= min_sec:
                continue
            prev_spk, prev_start, _ = out[i - 1]
            next_spk, _, next_end = out[i + 1]
            if prev_spk == next_spk != spk:
                out[i - 1] = (prev_spk, prev_start, next_end)
                del out[i : i + 2]
                changed = True
                break
    return out


def _pad_short_segments(
    segments: list[tuple[str, float, float]],
    total_duration: float,
) -> list[tuple[str, float, float]]:
    """Pad diarized segments (clamped to audio bounds), then re-merge consecutive
    same-speaker. Every segment gets at least CHUNK_BOUNDARY_PAD_SEC on each side so
    word onsets/offsets are not clipped; segments shorter than MIN_CHUNK_DURATION_SEC
    get extra padding to reach a usable ASR length."""
    if not segments:
        return segments

    padded = []
    for i, (speaker, start, end) in enumerate(segments):
        duration = end - start
        pad = CHUNK_BOUNDARY_PAD_SEC
        if MIN_CHUNK_DURATION_SEC > 0 and duration < MIN_CHUNK_DURATION_SEC:
            pad = max(pad, CHUNK_PADDING_SEC, (MIN_CHUNK_DURATION_SEC - duration) / 2)

        prev_end = segments[i - 1][2] if i > 0 else 0.0
        next_start = segments[i + 1][1] if i < len(segments) - 1 else total_duration

        if pad > 0:
            if start >= prev_end:
                gap_before = start - prev_end
                start = start - min(pad, gap_before)
            else:
                start = max(0.0, start - min(pad, start))

            if end <= next_start:
                gap_after = next_start - end
                end = end + min(pad, gap_after)
            else:
                end = min(total_duration, end + min(pad, total_duration - end))

        if end > start:
            padded.append((speaker, start, end))

    return _merge_consecutive(padded)


def _export_chunk(
    channel_wave: torch.Tensor,
    sample_rate: int,
    folder: Path,
    speaker: str,
    start_sec: float,
    end_sec: float,
) -> DiarizedChunk:
    start_sample = int(start_sec * sample_rate)
    end_sample = int(end_sec * sample_rate)
    chunk = channel_wave[:, start_sample:end_sample]
    name = f"{speaker}_{start_sec:.2f}_{end_sec:.2f}.wav"
    path = folder / name
    save_audio(path, chunk, sample_rate)
    return DiarizedChunk(speaker=speaker, start_sec=start_sec, end_sec=end_sec, wav_path=path)


def _select_channel(waveform: torch.Tensor, index: int) -> torch.Tensor:
    if index < 0 or index >= waveform.shape[0]:
        raise ValueError(f"Channel index {index} out of range for {waveform.shape[0]} channels")
    return waveform[index : index + 1]


def diarize(audio_path: Path) -> DiarizationResult:
    """
    Split stereo call audio into Agent and Customer speech chunks.
    Mono files return empty chunks with status Skipped (mono).
    """
    waveform, sample_rate = load_audio(audio_path)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000

    if waveform.shape[0] < 2:
        return DiarizationResult(chunks=[], is_stereo=False, status="Skipped (mono)")

    agent_ch_raw = _select_channel(waveform, AGENT_CHANNEL_INDEX)
    customer_ch_raw = _select_channel(waveform, CUSTOMER_CHANNEL_INDEX)
    customer_ch_export = _enhance_customer_waveform(customer_ch_raw, sample_rate)
    # Match legacy pipeline: VAD on enhanced customer channel for better quiet-speech detection.
    customer_ch_vad = customer_ch_export if CUSTOMER_ENHANCE_ENABLED else customer_ch_raw

    agent_segments = _speech_segments(agent_ch_raw, sample_rate)
    customer_segments = _speech_segments(customer_ch_vad, sample_rate)
    agent_segments = _filter_agent_segments(
        agent_segments, agent_ch_raw, customer_ch_vad, sample_rate
    )
    customer_segments = _filter_customer_segments(
        customer_segments, agent_ch_raw, customer_ch_vad, sample_rate
    )

    total_duration = waveform.shape[1] / sample_rate

    def _post(labeled: list[tuple[str, float, float]]) -> list[tuple[str, float, float]]:
        return _suppress_sandwiched_crosstalk(
            labeled, agent_ch_raw, customer_ch_vad, sample_rate
        )

    timeline = build_hybrid_timeline(
        agent_segments,
        customer_segments,
        agent_ch_raw,
        customer_ch_vad,
        sample_rate,
        total_duration,
        audio_path,
        post_process=_post,
    )
    merged = timeline.segments
    if not merged:
        return DiarizationResult(chunks=[], is_stereo=True, status="No speech detected")

    merged = _pad_short_segments(merged, total_duration)
    merged = clip_exclusive_timeline(merged)
    merged = _merge_same_speaker_gap(merged)
    merged = merge_consecutive(merged)

    stem = audio_path.stem
    out_root = DIARIZATION_OUTPUT_DIR / stem
    if out_root.exists():
        shutil.rmtree(out_root, ignore_errors=True)
    agent_dir = out_root / "Agent"
    customer_dir = out_root / "Customer"
    agent_dir.mkdir(parents=True, exist_ok=True)
    customer_dir.mkdir(parents=True, exist_ok=True)

    chunks: list[DiarizedChunk] = []
    metadata_lines: list[str] = []
    for speaker, start_sec, end_sec in merged:
        channel = agent_ch_raw if speaker == "Agent" else customer_ch_export
        folder = agent_dir if speaker == "Agent" else customer_dir
        chunk = _export_chunk(channel, sample_rate, folder, speaker, start_sec, end_sec)
        chunks.append(chunk)
        metadata_lines.append(
            f"Speaker: {speaker}, Chunk: {chunk.wav_path.name}, "
            f"Start: {start_sec:.2f}s, End: {end_sec:.2f}s"
        )

    meta_file = out_root / "metadata.txt"
    metadata_lines.append(
        f"Method: {timeline.method}, score={timeline.metrics.score:.1f}, "
        f"overlaps={timeline.metrics.overlaps}, flips={timeline.metrics.rapid_flips}"
    )
    meta_file.write_text("\n".join(metadata_lines) + "\n", encoding="utf-8")

    return DiarizationResult(
        chunks=chunks,
        is_stereo=True,
        status="Success",
        output_dir=out_root,
    )


def diarization_health() -> dict:
    try:
        _load_silero()
        return {
            "ready": True,
            "method": "stereo_channel_silero_vad_with_crosstalk_filter",
            "silero_device": _silero_device or _resolve_silero_device(),
            "agent_channel_index": AGENT_CHANNEL_INDEX,
            "customer_channel_index": CUSTOMER_CHANNEL_INDEX,
            "customer_crosstalk_suppress": CUSTOMER_CROSSTALK_SUPPRESS,
            "crosstalk_max_duration_sec": CROSSTALK_MAX_DURATION_SEC,
            "crosstalk_agent_rms_ratio": CROSSTALK_AGENT_RMS_RATIO,
            "min_customer_speech_sec": MIN_CUSTOMER_SPEECH_DURATION_SEC,
            "customer_vad_on_enhanced_channel": CUSTOMER_ENHANCE_ENABLED,
            "rms_dominance_enabled": DIAR_RMS_DOMINANCE_ENABLED,
            "rms_dominance_ratio": DIAR_RMS_DOMINANCE_RATIO,
            "backend": DIAR_BACKEND,
            "pyannote_enabled": DIAR_PYANNOTE_ENABLED,
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc)}
