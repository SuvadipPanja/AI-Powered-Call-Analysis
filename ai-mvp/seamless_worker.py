"""
SeamlessM4T v2 Large — ASR for non-Hindi/non-English Indian languages.

Uses SeamlessM4Tv2ForSpeechToText (same-language S2TT = transcription).
Offline prod: extract weights to volumes/models/seamless-m4t-v2-large/
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import torch

from config import (
    SEAMLESS_M4T_DEVICE,
    SEAMLESS_M4T_ENABLED,
    SEAMLESS_M4T_MODEL_PATH,
    TRANSCRIPTION_RETRY_EMPTY,
)

logger = logging.getLogger(__name__)

# Display language → SeamlessM4T ISO 639-3 code (see model README)
DISPLAY_TO_SEAMLESS: dict[str, str] = {
    "Assamese": "asm",
    "Bengali": "ben",
    "Gujarati": "guj",
    "Kannada": "kan",
    "Maithili": "mai",
    "Malayalam": "mal",
    "Marathi": "mar",
    "Manipuri": "mni",
    "Nepali": "npi",
    "Odia": "ory",
    "Punjabi": "pan",
    "Sanskrit": "san",
    "Sindhi": "snd",
    "Tamil": "tam",
    "Telugu": "tel",
    "Urdu": "urd",
    "English": "eng",
    "Hindi": "hin",
}

_processor = None
_model = None
_load_error: Optional[str] = None


def _resolve_device() -> str:
    if SEAMLESS_M4T_DEVICE in ("cpu", "cuda"):
        if SEAMLESS_M4T_DEVICE == "cuda" and not torch.cuda.is_available():
            return "cpu"
        return SEAMLESS_M4T_DEVICE
    return "cuda" if torch.cuda.is_available() else "cpu"


def _seamless_lang(language: str) -> str | None:
    lang = (language or "").strip()
    if lang in DISPLAY_TO_SEAMLESS:
        return DISPLAY_TO_SEAMLESS[lang]
    lower = lang.lower()
    for name, code in DISPLAY_TO_SEAMLESS.items():
        if name.lower() == lower:
            return code
    return None


def _load():
    global _processor, _model, _load_error
    if _model is not None:
        return _processor, _model
    if _load_error:
        raise RuntimeError(_load_error)
    if not SEAMLESS_M4T_MODEL_PATH.is_dir():
        _load_error = f"SeamlessM4T model not found: {SEAMLESS_M4T_MODEL_PATH}"
        raise RuntimeError(_load_error)
    if not (SEAMLESS_M4T_MODEL_PATH / "config.json").is_file():
        _load_error = f"SeamlessM4T config.json missing under {SEAMLESS_M4T_MODEL_PATH}"
        raise RuntimeError(_load_error)

    try:
        from transformers import AutoProcessor, SeamlessM4Tv2ForSpeechToText
    except ImportError as exc:
        _load_error = (
            "SeamlessM4Tv2ForSpeechToText requires transformers>=4.39 and sentencepiece. "
            f"Import error: {exc}"
        )
        raise RuntimeError(_load_error) from exc

    path = str(SEAMLESS_M4T_MODEL_PATH)
    device = _resolve_device()
    dtype = torch.float16 if device == "cuda" else torch.float32

    try:
        logger.info("Loading SeamlessM4T v2 from %s on %s (%s)", path, device, dtype)
        _processor = AutoProcessor.from_pretrained(path)
        _model = SeamlessM4Tv2ForSpeechToText.from_pretrained(path, torch_dtype=dtype)
        _model = _model.to(device)
        _model.eval()
        return _processor, _model
    except Exception as exc:
        _load_error = f"Failed to load SeamlessM4T: {exc}"
        raise RuntimeError(_load_error) from exc


def release_seamless_model() -> None:
    global _processor, _model
    _processor = None
    _model = None


def _load_audio_tensor(wav_path: Path) -> tuple[torch.Tensor, int]:
    from audio_io import load_audio

    waveform, sample_rate = load_audio(wav_path)
    if sample_rate != 16000:
        import torchaudio

        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)
    return waveform.squeeze(0), sample_rate


def _decode_tokens(processor, output_tokens) -> str:
    tokens = output_tokens[0]
    if hasattr(tokens, "tolist"):
        tokens = tokens.tolist()
    if tokens and isinstance(tokens[0], list):
        tokens = tokens[0]
    return processor.decode(tokens, skip_special_tokens=True).strip()


def _run_transcribe(processor, model, wav_path: Path, tgt_lang: str) -> str:
    audio, sample_rate = _load_audio_tensor(wav_path)
    device = _resolve_device()

    inputs = processor(
        audios=audio.numpy(),
        sampling_rate=sample_rate,
        return_tensors="pt",
    )
    inputs = {k: v.to(device) if hasattr(v, "to") else v for k, v in inputs.items()}

    with torch.inference_mode():
        output_tokens = model.generate(**inputs, tgt_lang=tgt_lang)

    return _decode_tokens(processor, output_tokens)


def probe_transcribe(processor, model, wav_path: Path, tgt_lang: str) -> str:
    """Short transcribe for language probing (same as ASR, no extra logic)."""
    try:
        return _run_transcribe(processor, model, wav_path, tgt_lang)
    except Exception as exc:
        logger.warning("SeamlessM4T probe %s failed: %s", tgt_lang, exc)
        return ""


def seamless_lid_ready() -> bool:
    if not SEAMLESS_M4T_ENABLED:
        return False
    health = seamless_m4t_health()
    return bool(health.get("ready"))


def transcribe_with_seamless(prepared_wav: Path, language: str) -> tuple[str, str]:
    tgt_lang = _seamless_lang(language)
    if not tgt_lang:
        raise RuntimeError(f"No SeamlessM4T language code for '{language}'")

    processor, model = _load()
    device = _resolve_device()
    engine = f"seamless-m4t-v2/{tgt_lang}/{device}"

    try:
        text = _run_transcribe(processor, model, prepared_wav, tgt_lang)
    except Exception as exc:
        logger.warning("SeamlessM4T transcribe failed for %s: %s", language, exc)
        text = ""

    if not text and TRANSCRIPTION_RETRY_EMPTY:
        logger.info("Empty SeamlessM4T result for %s — retrying once", prepared_wav.name)
        try:
            text = _run_transcribe(processor, model, prepared_wav, tgt_lang)
        except Exception as exc:
            logger.warning("SeamlessM4T retry failed: %s", exc)

    if not text:
        text = "[No speech detected]"
    return text, engine


def seamless_m4t_health() -> dict:
    info: dict = {
        "enabled": SEAMLESS_M4T_ENABLED,
        "model_path": str(SEAMLESS_M4T_MODEL_PATH),
        "device": _resolve_device(),
        "supported_languages": sorted(k for k in DISPLAY_TO_SEAMLESS if k not in ("English", "Hindi")),
    }

    if not SEAMLESS_M4T_ENABLED:
        info["ready"] = False
        info["note"] = "Disabled via SEAMLESS_M4T_ENABLED=false"
        return info

    if not SEAMLESS_M4T_MODEL_PATH.is_dir():
        info["ready"] = False
        info["error"] = f"Model directory missing: {SEAMLESS_M4T_MODEL_PATH}"
        return info

    weights = list(SEAMLESS_M4T_MODEL_PATH.glob("model-*.safetensors"))
    info["weight_shards"] = len(weights)
    if not weights:
        info["ready"] = False
        info["error"] = "No model-*.safetensors weights found (run extract-seamless-m4t.sh)"
        return info

    try:
        from transformers import SeamlessM4Tv2ForSpeechToText  # noqa: F401
    except ImportError as exc:
        info["ready"] = False
        info["error"] = f"transformers SeamlessM4Tv2 not available: {exc}"
        return info

    info["ready"] = True
    info["note"] = "SeamlessM4T v2 Large — ASR for Bengali, Tamil, Telugu, etc. (not Hindi/English)"
    return info
