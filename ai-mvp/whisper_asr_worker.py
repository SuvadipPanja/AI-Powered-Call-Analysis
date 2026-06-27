"""
Laptop dev ASR — Whisper Large V3 per chunk (when NeMo unavailable on Windows).
Production server uses NeMo; set TRANSCRIBE_BACKEND=nemo on A5000.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import torch
from transformers import WhisperForConditionalGeneration, WhisperProcessor

from config import TRANSCRIPTION_RETRY_EMPTY, WHISPER_LANG_MODEL_PATH

import logging

logger = logging.getLogger(__name__)

_processor: Optional[WhisperProcessor] = None
_model: Optional[WhisperForConditionalGeneration] = None
_load_error: Optional[str] = None

_LANG_CODE = {"Hindi": "hi", "English": "en"}


def _device() -> str:
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load():
    global _processor, _model, _load_error
    if _model is not None:
        return _processor, _model
    if _load_error:
        raise RuntimeError(_load_error)
    if not WHISPER_LANG_MODEL_PATH.is_dir():
        _load_error = f"Whisper model not found: {WHISPER_LANG_MODEL_PATH}"
        raise RuntimeError(_load_error)
    try:
        path = str(WHISPER_LANG_MODEL_PATH)
        _processor = WhisperProcessor.from_pretrained(path)
        _model = WhisperForConditionalGeneration.from_pretrained(path).to(_device())
        return _processor, _model
    except Exception as exc:
        _load_error = str(exc)
        raise RuntimeError(_load_error) from exc


def transcribe_chunk(wav_path: Path, language: str) -> tuple[str, str]:
    from audio_io import load_audio

    processor, model = _load()
    lang_code = _LANG_CODE.get(language, "en")

    waveform, sample_rate = load_audio(wav_path)
    if waveform.dim() == 1:
        waveform = waveform.unsqueeze(0)
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)

    if sample_rate != 16000:
        import torchaudio

        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000

    inputs = processor(
        waveform.squeeze().numpy(),
        sampling_rate=sample_rate,
        return_tensors="pt",
    )
    input_features = inputs.input_features.to(model.device)

    forced_ids = processor.get_decoder_prompt_ids(language=lang_code, task="transcribe")
    generated = model.generate(
        input_features,
        forced_decoder_ids=forced_ids,
        max_new_tokens=448,
    )
    text = processor.batch_decode(generated, skip_special_tokens=True)[0].strip()

    if not text and TRANSCRIPTION_RETRY_EMPTY:
        logger.info("Empty transcription for %s — retrying without language constraint", wav_path.name)
        generated = model.generate(input_features, max_new_tokens=448)
        text = processor.batch_decode(generated, skip_special_tokens=True)[0].strip()

    if not text:
        text = "[No speech detected]"
    return text, f"whisper-large-v3/{lang_code}"


def whisper_asr_health() -> dict:
    try:
        _load()
        return {
            "ready": True,
            "model_path": str(WHISPER_LANG_MODEL_PATH),
            "device": _device(),
            "note": "Laptop dev fallback — use NeMo on GPU server for production",
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc)}
