"""Whisper large-v3 window transcription that reuses the resident LID model.

sp-ai-whisper-lang already holds Whisper large-v3 in fp16 on the GPU for
language identification. This module borrows that same model object to
re-decode short, high-value windows. Not a primary ASR path.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path

logger = logging.getLogger(__name__)

WHISPER_WINDOW_LANG_CODES: dict[str, str] = {
    "English": "en",
    "Hindi": "hi",
    "Bengali": "bn",
    "Marathi": "mr",
    "Gujarati": "gu",
    "Tamil": "ta",
    "Telugu": "te",
    "Kannada": "kn",
    "Malayalam": "ml",
    "Punjabi": "pa",
    "Odia": "or",
    "Assamese": "as",
    "Urdu": "ur",
    "Nepali": "ne",
}

WHISPER_WINDOW_MAX_SEC = 30.0
_SAMPLE_RATE = 16000


def whisper_window_lang_code(language: str) -> str | None:
    return WHISPER_WINDOW_LANG_CODES.get((language or "").strip().title())


def _strip_prompt_echo(text: str, prompt: str) -> str:
    out = re.sub(r"\s+", " ", str(text or "")).strip()
    seed = re.sub(r"\s+", " ", str(prompt or "")).strip()
    if seed and out.lower().startswith(seed.lower()):
        out = out[len(seed):].strip()
    return out


def _load_16k_mono(audio_path: Path):
    import torch
    import torchaudio

    from audio_io import load_audio

    waveform, sample_rate = load_audio(Path(audio_path))
    if waveform.dim() == 2 and waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    if sample_rate != _SAMPLE_RATE:
        waveform = torchaudio.functional.resample(waveform, sample_rate, _SAMPLE_RATE)
    return waveform.squeeze(0).to(torch.float32).cpu().numpy()


def transcribe_window(
    audio_path: Path,
    language: str = "",
    initial_prompt: str = "",
) -> str:
    """Decode one window with the resident Whisper model. "" on any failure."""
    import torch

    from language_worker import load_lid_whisper

    processor, model, _tokenizer = load_lid_whisper()

    audio = _load_16k_mono(audio_path)
    if audio.size == 0:
        return ""
    cap = int(WHISPER_WINDOW_MAX_SEC * _SAMPLE_RATE)
    if audio.shape[0] > cap:
        audio = audio[:cap]

    device = next(model.parameters()).device
    dtype = next(model.parameters()).dtype
    features = processor(
        audio, sampling_rate=_SAMPLE_RATE, return_tensors="pt"
    ).input_features.to(device=device, dtype=dtype)

    kwargs: dict = {"task": "transcribe", "max_new_tokens": 220, "num_beams": 1}
    code = whisper_window_lang_code(language)
    if code:
        kwargs["language"] = code

    prompt = (initial_prompt or "").strip()
    if prompt:
        kwargs["prompt_ids"] = processor.get_prompt_ids(
            prompt, return_tensors="pt"
        ).to(device)

    with torch.inference_mode():
        generated = model.generate(features, **kwargs)

    decoded = processor.batch_decode(generated, skip_special_tokens=True)[0]
    return _strip_prompt_echo(decoded, prompt)
