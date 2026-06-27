"""Load/save WAV without torchcodec (Windows-friendly)."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import torch


def load_audio(path: Path) -> tuple[torch.Tensor, int]:
    """Return waveform [channels, samples] float32 and sample rate."""
    try:
        import soundfile as sf

        data, sample_rate = sf.read(str(path), always_2d=True, dtype="float32")
        # soundfile: (samples, channels) -> torch (channels, samples)
        waveform = torch.from_numpy(data.T.copy())
        return waveform, int(sample_rate)
    except ImportError:
        import torchaudio

        return torchaudio.load(str(path), backend="soundfile")


def save_audio(path: Path, waveform: torch.Tensor, sample_rate: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    try:
        import soundfile as sf

        data = waveform.detach().cpu().numpy().T
        sf.write(str(path), np.clip(data, -1.0, 1.0), sample_rate)
    except ImportError:
        import torchaudio

        torchaudio.save(str(path), waveform, sample_rate, backend="soundfile")
