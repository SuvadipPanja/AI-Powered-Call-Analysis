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
    DIARIZATION_OUTPUT_DIR,
    MIN_CHUNK_DURATION_SEC,
    MIN_CUSTOMER_SPEECH_DURATION_SEC,
    MIN_SPEECH_DURATION_MS,
    SILERO_THRESHOLD,
    WORK_DIR,
)

_silero_model = None
_silero_get_speech_ts = None
_load_error: Optional[str] = None


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
    global _silero_model, _silero_get_speech_ts, _load_error
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
        if not torch.cuda.is_available():
            model = model.float()
        get_speech_ts = utils[0]
        _silero_model = model
        _silero_get_speech_ts = get_speech_ts
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


def _merge_consecutive(
    segments: list[tuple[str, float, float]],
) -> list[tuple[str, float, float]]:
    if not segments:
        return []
    merged = []
    speaker, start, end = segments[0]
    for spk, seg_start, seg_end in segments[1:]:
        if spk == speaker:
            end = seg_end
        else:
            merged.append((speaker, start, end))
            speaker, start, end = spk, seg_start, seg_end
    merged.append((speaker, start, end))
    return merged


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
    for speaker, start, end in segments:
        duration = end - start
        pad = CHUNK_BOUNDARY_PAD_SEC
        if MIN_CHUNK_DURATION_SEC > 0 and duration < MIN_CHUNK_DURATION_SEC:
            pad = max(pad, CHUNK_PADDING_SEC, (MIN_CHUNK_DURATION_SEC - duration) / 2)
        if pad > 0:
            start = max(0.0, start - pad)
            end = min(total_duration, end + pad)
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
    customer_segments = _filter_customer_segments(
        customer_segments, agent_ch_raw, customer_ch_vad, sample_rate
    )

    labeled: list[tuple[str, float, float]] = []
    for start, end in agent_segments:
        labeled.append(("Agent", start, end))
    for start, end in customer_segments:
        labeled.append(("Customer", start, end))
    labeled.sort(key=lambda x: x[1])
    merged = _merge_consecutive(labeled)

    if not merged:
        return DiarizationResult(chunks=[], is_stereo=True, status="No speech detected")

    total_duration = waveform.shape[1] / sample_rate
    merged = _pad_short_segments(merged, total_duration)

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
            "agent_channel_index": AGENT_CHANNEL_INDEX,
            "customer_channel_index": CUSTOMER_CHANNEL_INDEX,
            "customer_crosstalk_suppress": CUSTOMER_CROSSTALK_SUPPRESS,
            "crosstalk_max_duration_sec": CROSSTALK_MAX_DURATION_SEC,
            "crosstalk_agent_rms_ratio": CROSSTALK_AGENT_RMS_RATIO,
            "min_customer_speech_sec": MIN_CUSTOMER_SPEECH_DURATION_SEC,
            "customer_vad_on_enhanced_channel": CUSTOMER_ENHANCE_ENABLED,
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc)}
