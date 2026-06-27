"""Audio preprocessing for NeMo ASR (16 kHz mono)."""

from __future__ import annotations

import uuid
from pathlib import Path

import torch
import torchaudio

from audio_io import load_audio, save_audio
from config import (
    AGENT_CHANNEL_INDEX,
    ASR_CHUNK_MIN_VOICED_SEC,
    ASR_CHUNK_SILENCE_ABS_FLOOR,
    ASR_CHUNK_SILENCE_REL_THRESHOLD,
    ASR_CHUNK_TRIM_MARGIN_SEC,
    CUSTOMER_CHANNEL_INDEX,
    CUSTOMER_ENHANCE_ENABLED,
    WORK_DIR,
)


def format_duration(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def prepare_mono_wav(source_path: Path, target_sample_rate: int = 16000) -> tuple[Path, float]:
    """Convert any supported audio to 16 kHz mono WAV; return path and duration seconds."""
    waveform, sample_rate = load_audio(source_path)
    if sample_rate != target_sample_rate:
        waveform = torchaudio.transforms.Resample(sample_rate, target_sample_rate)(waveform)
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)

    duration_seconds = waveform.shape[1] / target_sample_rate
    out_path = WORK_DIR / f"{source_path.stem}_{uuid.uuid4().hex[:8]}_16k.wav"
    save_audio(out_path, waveform, target_sample_rate)
    return out_path, duration_seconds


def _enhance_customer_waveform(waveform: torch.Tensor) -> torch.Tensor:
    if not CUSTOMER_ENHANCE_ENABLED:
        return waveform
    import numpy as np
    from config import CUSTOMER_GAIN_DB

    samples = waveform.squeeze().numpy().astype(np.float32)
    if samples.size == 0:
        return waveform
    peak = np.max(np.abs(samples)) or 1.0
    samples_norm = samples / peak
    try:
        import noisereduce as nr

        samples_norm = nr.reduce_noise(y=samples_norm, sr=16000)
    except ImportError:
        pass
    gain = 10 ** (CUSTOMER_GAIN_DB / 20.0)
    samples_norm = np.clip(samples_norm * gain, -1.0, 1.0)
    return torch.from_numpy(samples_norm).unsqueeze(0)


def reexport_stereo_chunk_with_padding(
    source_path: Path,
    *,
    speaker: str,
    start_sec: float,
    end_sec: float,
    pad_sec: float,
) -> Path:
    """Re-slice stereo call audio with extra context — helps IndicConformer on short turns."""
    waveform, sample_rate = load_audio(source_path)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000

    if waveform.shape[0] < 2:
        ch = waveform[:1]
    else:
        idx = AGENT_CHANNEL_INDEX if speaker == "Agent" else CUSTOMER_CHANNEL_INDEX
        if idx < 0 or idx >= waveform.shape[0]:
            idx = 0
        ch = waveform[idx : idx + 1]
        if speaker == "Customer":
            ch = _enhance_customer_waveform(ch)

    total_sec = waveform.shape[1] / sample_rate
    start = max(0.0, start_sec - pad_sec)
    end = min(total_sec, end_sec + pad_sec)
    start_sample = int(start * sample_rate)
    end_sample = max(start_sample + 1, int(end * sample_rate))
    chunk = ch[:, start_sample:end_sample]

    out_path = WORK_DIR / f"{source_path.stem}_{speaker}_{uuid.uuid4().hex[:8]}_pad.wav"
    save_audio(out_path, chunk, sample_rate)
    return out_path


def trim_silence_for_asr(
    wav_path: Path,
    *,
    frame_ms: int = 20,
    margin_sec: float = ASR_CHUNK_TRIM_MARGIN_SEC,
    rel_threshold: float = ASR_CHUNK_SILENCE_REL_THRESHOLD,
    abs_floor: float = ASR_CHUNK_SILENCE_ABS_FLOOR,
    min_voiced_sec: float = ASR_CHUNK_MIN_VOICED_SEC,
) -> tuple[Path, bool, bool]:
    """Trim leading/trailing dead air from an ASR chunk.

    Returns ``(path, did_trim, is_silent)``:
      - ``is_silent=True``  → chunk has no usable speech (caller should skip it);
        ``path`` is the unchanged input.
      - ``did_trim=False``  → nothing worth trimming; ``path`` is the unchanged input.
      - ``did_trim=True``   → ``path`` is a NEW temp wav with edges trimmed (keeping
        ``margin_sec`` so word onsets/offsets survive). Caller owns the temp file.

    A small margin is always kept, so this never clips real speech; it only removes
    the trailing silence that makes Whisper/SeamlessM4T hallucinate a continuation.
    """
    waveform, sr = load_audio(wav_path)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    mono = waveform.mean(dim=0)
    n = int(mono.shape[0])
    if n == 0:
        return wav_path, False, True

    frame = max(1, int(frame_ms / 1000.0 * sr))
    n_frames = n // frame
    if n_frames < 2:
        # Too short to analyse — keep as-is (likely a brief ack like "ji"/"haan").
        return wav_path, False, False

    frames = mono[: n_frames * frame].reshape(n_frames, frame)
    rms = torch.sqrt(torch.mean(frames ** 2, dim=1))
    peak = float(rms.max().item())
    if peak < abs_floor:
        return wav_path, False, True

    threshold = max(abs_floor, peak * rel_threshold)
    voiced = (rms >= threshold).nonzero(as_tuple=False).flatten()
    if voiced.numel() == 0:
        return wav_path, False, True

    first = int(voiced[0].item())
    last = int(voiced[-1].item())
    voiced_dur = (last - first + 1) * frame / sr
    if min_voiced_sec > 0 and voiced_dur < min_voiced_sec:
        return wav_path, False, True

    margin = int(margin_sec * sr)
    start = max(0, first * frame - margin)
    end = min(n, (last + 1) * frame + margin)

    # Nothing meaningful at the edges → don't bother re-exporting.
    if start <= margin and end >= n - margin:
        return wav_path, False, False

    trimmed = waveform[:, start:end]
    out_path = WORK_DIR / f"{wav_path.stem}_{uuid.uuid4().hex[:8]}_trim.wav"
    save_audio(out_path, trimmed, sr)
    return out_path, True, False
