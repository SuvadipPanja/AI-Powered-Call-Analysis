"""
AI4Bharat IndicLID wrapper — text-based LID for 22 Indic languages + English.

Audio pipeline: Whisper v3 short transcript → IndicLID on text → display language.
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Optional

from config import (
    INDICLID_BERT_TOKENIZER_PATH,
    INDICLID_ENABLED,
    INDICLID_MODEL_DIR,
    INDICLID_ROMAN_THRESHOLD,
)

logger = logging.getLogger(__name__)

_model = None
_load_error: Optional[str] = None

# IndicLID code → pipeline display name (prefer native script codes)
INDICLID_CODE_TO_DISPLAY: dict[str, str] = {
    "asm_Beng": "Assamese", "asm_Latn": "Assamese",
    "ben_Beng": "Bengali", "ben_Latn": "Bengali",
    "brx_Deva": "Bodo", "brx_Latn": "Bodo",
    "doi_Deva": "Dogri", "doi_Latn": "Dogri",
    "eng_Latn": "English",
    "guj_Gujr": "Gujarati", "guj_Latn": "Gujarati",
    "hin_Deva": "Hindi", "hin_Latn": "Hindi",
    "kan_Knda": "Kannada", "kan_Latn": "Kannada",
    "kas_Arab": "Kashmiri", "kas_Deva": "Kashmiri", "kas_Latn": "Kashmiri",
    "kok_Deva": "Konkani", "kok_Latn": "Konkani",
    "mai_Deva": "Maithili", "mai_Latn": "Maithili",
    "mal_Mlym": "Malayalam", "mal_Latn": "Malayalam",
    "mni_Beng": "Manipuri", "mni_Meti": "Manipuri", "mni_Latn": "Manipuri",
    "mar_Deva": "Marathi", "mar_Latn": "Marathi",
    "nep_Deva": "Nepali", "nep_Latn": "Nepali",
    "ori_Orya": "Odia", "ori_Latn": "Odia",
    "pan_Guru": "Punjabi", "pan_Latn": "Punjabi",
    "san_Deva": "Sanskrit", "san_Latn": "Sanskrit",
    "sat_Olch": "Santali",
    "snd_Arab": "Sindhi", "snd_Latn": "Sindhi",
    "tam_Tamil": "Tamil", "tam_Latn": "Tamil",
    "tel_Telu": "Telugu", "tel_Latn": "Telugu",
    "urd_Arab": "Urdu", "urd_Latn": "Urdu",
    "other": "Unknown",
}


def _ensure_indiclid_path() -> None:
    pkg = Path(__file__).resolve().parent / "indiclid"
    if str(pkg.parent) not in sys.path:
        sys.path.insert(0, str(pkg.parent))


def _load():
    global _model, _load_error
    if _model is not None:
        return _model
    if _load_error:
        raise RuntimeError(_load_error)
    if not INDICLID_ENABLED:
        _load_error = "IndicLID disabled (INDICLID_ENABLED=false)"
        raise RuntimeError(_load_error)
    if not INDICLID_MODEL_DIR.is_dir():
        _load_error = f"IndicLID model dir missing: {INDICLID_MODEL_DIR}"
        raise RuntimeError(_load_error)

    try:
        _ensure_indiclid_path()
        from indiclid.IndicLID import IndicLID

        tok = INDICLID_BERT_TOKENIZER_PATH if INDICLID_BERT_TOKENIZER_PATH.is_dir() else None
        _model = IndicLID(
            INDICLID_MODEL_DIR,
            bert_tokenizer_path=tok,
            roman_lid_threshold=INDICLID_ROMAN_THRESHOLD,
        )
        logger.info("IndicLID loaded from %s", INDICLID_MODEL_DIR)
        return _model
    except Exception as exc:
        _load_error = str(exc)
        raise RuntimeError(_load_error) from exc


def indiclid_ready() -> bool:
    if not INDICLID_ENABLED:
        return False
    ftn = INDICLID_MODEL_DIR / "indiclid-ftn" / "model_baseline_roman.bin"
    return ftn.is_file()


def display_language_from_indiclid(code: str) -> str:
    return INDICLID_CODE_TO_DISPLAY.get(code, "Unknown")


def predict_text_language(text: str) -> tuple[str, float, str, str]:
    """
    Run IndicLID on transcript text.
    Returns (display_language, score, indiclid_code, engine).
    """
    cleaned = (text or "").strip()
    if len(cleaned) < 4:
        return "Unknown", 0.0, "other", "none"

    model = _load()
    code, score, engine = model.predict(cleaned)
    display = display_language_from_indiclid(code)
    logger.info(
        "IndicLID text=%r → code=%s display=%s score=%.3f engine=%s",
        cleaned[:80], code, display, score, engine,
    )
    return display, score, code, engine


def indiclid_health() -> dict:
    info: dict = {
        "enabled": INDICLID_ENABLED,
        "model_dir": str(INDICLID_MODEL_DIR),
        "tokenizer_path": str(INDICLID_BERT_TOKENIZER_PATH),
    }
    if not INDICLID_ENABLED:
        info["ready"] = False
        info["note"] = "Disabled via INDICLID_ENABLED=false"
        return info
    if not indiclid_ready():
        info["ready"] = False
        info["error"] = "Weights missing — run extract-indiclid.sh"
        return info
    try:
        _load()
        info["ready"] = True
        info["note"] = "AI4Bharat IndicLID on Whisper v3 transcript snippet"
        return info
    except Exception as exc:
        info["ready"] = False
        info["error"] = str(exc)
        return info


def release_indiclid() -> None:
    global _model
    _model = None
