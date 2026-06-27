"""
NeMo ASR — IndicConformer Large (Hindi, Bengali) + Parakeet (English)
+ optional IndicConformer 600M multilingual for other Indian languages.

Offline prod: place .nemo files under volumes/models/nemo/
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

import torch

try:
    from huggingface_hub import ModelFilter  # noqa: F401
except ImportError:
    import huggingface_hub as _hf_hub

    class _ModelFilter:
        def __init__(self, **kwargs: object) -> None:
            pass

    _hf_hub.ModelFilter = _ModelFilter  # type: ignore[attr-defined]

from config import (
    BENGALI_MULTILINGUAL_FALLBACK,
    BENGALI_NEMO_MODEL_NAME,
    BENGALI_NEMO_MODEL_PATH,
    ENGLISH_NEMO_MODEL_NAME,
    ENGLISH_NEMO_MODEL_PATH,
    HINDI_NEMO_FALLBACK_PATH,
    HINDI_NEMO_MODEL_NAME,
    HINDI_NEMO_MODEL_PATH,
    MULTILINGUAL_NEMO_MODEL_NAME,
    MULTILINGUAL_NEMO_MODEL_PATH,
    NEMO_DECODER,
    NEMO_DEVICE,
    NEMO_DUAL_DECODER,
    NEMO_DUAL_DECODER_LANGUAGES,
    TRANSCRIPTION_RETRY_EMPTY,
)

import logging
import re

logger = logging.getLogger(__name__)

BENGALI_SCRIPT_RE = re.compile(r"[\u0980-\u09FF]")
DEVANAGARI_SCRIPT_RE = re.compile(r"[\u0900-\u097F]")
LATIN_RE = re.compile(r"[A-Za-z]")

# Display language → NeMo language_id (IndicConformer multilingual)
LANGUAGE_NEMO_ID: dict[str, str] = {
    "Assamese": "as",
    "Bengali": "bn",
    "Bodo": "brx",
    "Dogri": "doi",
    "Gujarati": "gu",
    "Hindi": "hi",
    "Kannada": "kn",
    "Konkani": "kok",
    "Kashmiri": "ks",
    "Maithili": "mai",
    "Malayalam": "ml",
    "Manipuri": "mni",
    "Marathi": "mr",
    "Nepali": "ne",
    "Odia": "or",
    "Punjabi": "pa",
    "Sanskrit": "sa",
    "Santali": "sat",
    "Sindhi": "sd",
    "Tamil": "ta",
    "Telugu": "te",
    "Urdu": "ur",
    "English": "en",
}

_model_cache: dict[str, object] = {}
_load_error: Optional[str] = None


def _resolve_device() -> str:
    if NEMO_DEVICE == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    return NEMO_DEVICE


def _is_indicconformer(path: str) -> bool:
    return "indicconformer" in (path or "").lower()


def _restore_with_tokenizer_dir_fix(local_path: str):
    """
    IndicConformer hybrid .nemo files fail on some NeMo versions with
    `KeyError: 'dir'` inside _setup_monolingual_tokenizer because the restored
    config's `tokenizer` section is missing the extracted tokenizer `dir`.

    Workaround: extract the .nemo, point tokenizer.dir at the extracted folder
    (which holds tokenizer.model / vocab / spe_tokenizer files), and restore with
    the patched config via SaveRestoreConnector.
    """
    import tarfile
    import tempfile

    from omegaconf import OmegaConf, open_dict
    from nemo.collections.asr.models import ASRModel
    from nemo.core.connectors.save_restore_connector import SaveRestoreConnector

    extract_dir = tempfile.mkdtemp(prefix="nemo_fix_")
    with tarfile.open(local_path, "r:*") as tar:
        tar.extractall(extract_dir)

    cfg_path = None
    for name in ("model_config.yaml", "./model_config.yaml"):
        candidate = os.path.join(extract_dir, name)
        if os.path.isfile(candidate):
            cfg_path = candidate
            break
    if cfg_path is None:
        raise RuntimeError("model_config.yaml not found inside .nemo archive")

    cfg = OmegaConf.load(cfg_path)
    tok_cfg = cfg.get("tokenizer", None)
    if tok_cfg is not None:
        with open_dict(cfg):
            tok_type = str(tok_cfg.get("type", "")).lower()
            # Monolingual BPE/WPE tokenizer needs a `dir`.
            if tok_type in ("bpe", "wpe", "") and not tok_cfg.get("dir"):
                cfg.tokenizer.dir = extract_dir
            # Aggregate tokenizer needs each sub-lang `dir`.
            if tok_type == "agg" and "langs" in tok_cfg:
                for lang_key in list(tok_cfg["langs"].keys()):
                    if not cfg.tokenizer.langs[lang_key].get("dir"):
                        cfg.tokenizer.langs[lang_key].dir = extract_dir
        OmegaConf.save(cfg, cfg_path)

    connector = SaveRestoreConnector()
    connector.model_extracted_dir = extract_dir
    logger.info("Retrying NeMo load with patched tokenizer.dir for %s", local_path)
    return ASRModel.restore_from(
        restore_path=local_path,
        override_config_path=cfg_path,
        save_restore_connector=connector,
    )


def _load_asr_model(local_path: str, pretrained_name: str):
    from nemo.collections.asr.models import ASRModel

    if local_path and os.path.isfile(local_path):
        try:
            model = ASRModel.restore_from(local_path)
        except Exception as exc:  # noqa: BLE001
            # Only attempt recovery for the specific tokenizer 'dir' failure.
            is_dir_key_error = isinstance(exc, KeyError) and "dir" in str(exc)
            if is_dir_key_error:
                logger.warning("NeMo restore hit KeyError('dir') — attempting tokenizer fix")
                model = _restore_with_tokenizer_dir_fix(local_path)
            else:
                raise
    else:
        model = ASRModel.from_pretrained(pretrained_name)

    device = _resolve_device()
    if device == "cuda" and torch.cuda.is_available():
        model = model.cuda()
    else:
        model = model.cpu().float()
    return model


def _get_cached(key: str, loader):
    global _load_error
    if key in _model_cache:
        return _model_cache[key]
    if _load_error:
        raise RuntimeError(_load_error)
    try:
        model = loader()
        _model_cache[key] = model
        return model
    except Exception as exc:
        _load_error = str(exc)
        raise RuntimeError(_load_error) from exc


def get_hindi_model():
    def _load():
        for path, name in (
            (HINDI_NEMO_MODEL_PATH, HINDI_NEMO_MODEL_NAME),
            (HINDI_NEMO_FALLBACK_PATH, HINDI_NEMO_MODEL_NAME),
        ):
            if path and os.path.isfile(path):
                logger.info("Loading Hindi ASR from %s", path)
                return _load_asr_model(path, name)
        raise FileNotFoundError(
            f"Hindi NeMo model not found at {HINDI_NEMO_MODEL_PATH} "
            f"or fallback {HINDI_NEMO_FALLBACK_PATH}"
        )

    return _get_cached("hindi", _load)


def get_english_model():
    return _get_cached(
        "english",
        lambda: _load_asr_model(ENGLISH_NEMO_MODEL_PATH, ENGLISH_NEMO_MODEL_NAME),
    )


def get_bengali_model():
    return _get_cached(
        "bengali",
        lambda: _load_asr_model(BENGALI_NEMO_MODEL_PATH, BENGALI_NEMO_MODEL_NAME),
    )


def get_multilingual_model():
    if not MULTILINGUAL_NEMO_MODEL_PATH or not os.path.isfile(MULTILINGUAL_NEMO_MODEL_PATH):
        raise FileNotFoundError(
            f"Multilingual IndicConformer not found at {MULTILINGUAL_NEMO_MODEL_PATH}"
        )

    return _get_cached(
        "multilingual",
        lambda: _load_asr_model(MULTILINGUAL_NEMO_MODEL_PATH, MULTILINGUAL_NEMO_MODEL_NAME),
    )


def _engine_label(model_path: str, language: str) -> str:
    base = Path(model_path).stem if model_path else "nemo"
    return f"nemo/{base}/{language}"


def _score_transcript(text: str, language: str) -> float:
    """Heuristic quality score — higher is better."""
    if not text or text == "[No speech detected]":
        return -1000.0
    score = float(len(text.strip()))
    score -= text.count("\ufffd") * 50
    score -= text.count("�") * 50

    if language == "Bengali":
        bn = len(BENGALI_SCRIPT_RE.findall(text))
        dev = len(DEVANAGARI_SCRIPT_RE.findall(text))
        score += bn * 1.5
        score -= dev * 2.0
        if bn == 0:
            score -= 40
    elif language == "Hindi":
        dev = len(DEVANAGARI_SCRIPT_RE.findall(text))
        bn = len(BENGALI_SCRIPT_RE.findall(text))
        score += dev * 1.5
        score -= bn * 2.0

    # Prefer some word-like tokens over random phonetic fragments
    tokens = [t for t in re.split(r"\s+", text.strip()) if len(t) >= 2]
    score += min(len(tokens) * 3, 30)
    return score


def _run_transcribe(
    model,
    wav_path: Path,
    *,
    language_id: str | None,
    model_path: str,
    decoder: str | None = None,
) -> str:
    """Transcribe one wav; supports IndicConformer hybrid and legacy NeMo models."""
    dec = (decoder or NEMO_DECODER).lower()
    if hasattr(model, "cur_decoder"):
        model.cur_decoder = dec

    transcribe_kwargs: dict = {"batch_size": 1}
    if language_id and _is_indicconformer(model_path):
        transcribe_kwargs["language_id"] = language_id

    if dec == "ctc" and hasattr(model, "cur_decoder"):
        model.cur_decoder = "ctc"
        transcribe_kwargs["logprobs"] = False

    result = model.transcribe([str(wav_path)], **transcribe_kwargs)[0]
    if isinstance(result, (list, tuple)):
        result = result[0]
    return (result if isinstance(result, str) else str(result)).strip()


def _transcribe_best_decoder(
    model,
    wav_path: Path,
    *,
    language_id: str | None,
    model_path: str,
    language: str,
) -> tuple[str, str]:
    """Run RNNT + CTC for IndicConformer and return the higher-quality transcript."""
    if not _is_indicconformer(model_path):
        text = _run_transcribe(model, wav_path, language_id=language_id, model_path=model_path)
        return text, NEMO_DECODER

    use_dual = NEMO_DUAL_DECODER and language in NEMO_DUAL_DECODER_LANGUAGES
    if not use_dual and NEMO_DECODER != "best":
        text = _run_transcribe(model, wav_path, language_id=language_id, model_path=model_path)
        return text, NEMO_DECODER

    candidates: list[tuple[str, str, float]] = []
    for dec in ("rnnt", "ctc"):
        try:
            text = _run_transcribe(
                model, wav_path, language_id=language_id, model_path=model_path, decoder=dec
            )
            candidates.append((text, dec, _score_transcript(text, language)))
        except Exception as exc:
            logger.warning("NeMo %s decode failed for %s: %s", dec, language, exc)

    if not candidates:
        return "", NEMO_DECODER

    best_text, best_dec, best_score = max(candidates, key=lambda x: x[2])
    logger.info(
        "NeMo dual-decoder %s: picked %s (score=%.1f) from %d candidates",
        language, best_dec, best_score, len(candidates),
    )
    return best_text, f"{best_dec}+best"


def _resolve_model_for_language(language: str) -> tuple[object, str, str | None, str]:
    """Return (model, model_path, language_id, engine_key)."""
    lang = (language or "").strip()

    if lang == "English":
        path = ENGLISH_NEMO_MODEL_PATH
        return get_english_model(), path, None, _engine_label(path, "English")

    if lang == "Hindi":
        path = HINDI_NEMO_MODEL_PATH if os.path.isfile(HINDI_NEMO_MODEL_PATH) else HINDI_NEMO_FALLBACK_PATH
        return get_hindi_model(), path, "hi", _engine_label(path, "Hindi")

    if lang == "Bengali":
        if os.path.isfile(BENGALI_NEMO_MODEL_PATH):
            return get_bengali_model(), BENGALI_NEMO_MODEL_PATH, "bn", _engine_label(BENGALI_NEMO_MODEL_PATH, "Bengali")
        logger.warning("Bengali model missing — falling back to multilingual")
        lang_id = LANGUAGE_NEMO_ID.get("Bengali", "bn")

    else:
        lang_id = LANGUAGE_NEMO_ID.get(lang)

    if lang_id and os.path.isfile(MULTILINGUAL_NEMO_MODEL_PATH):
        return (
            get_multilingual_model(),
            MULTILINGUAL_NEMO_MODEL_PATH,
            lang_id,
            _engine_label(MULTILINGUAL_NEMO_MODEL_PATH, lang),
        )

    raise RuntimeError(
        f"No NeMo ASR model for language '{language}'. "
        f"Add IndicConformer multilingual at {MULTILINGUAL_NEMO_MODEL_PATH} "
        f"or a dedicated .nemo for this language."
    )


def transcribe_with_nemo(prepared_wav: Path, language: str) -> tuple[str, str]:
    # Hindi/Bengali -> external sp-nemo (Sherpa-ONNX IndicConformer). The
    # in-container NeMo IndicConformer fails with KeyError: 'dir'; sp-nemo avoids
    # NeMo entirely. English and others continue with in-container NeMo below.
    from config import SP_NEMO_ENABLED, SP_NEMO_LANGUAGES

    if SP_NEMO_ENABLED and language in SP_NEMO_LANGUAGES:
        from sp_nemo_client import sp_nemo_health, transcribe_with_sp_nemo

        health = sp_nemo_health()
        if not health.get("ready"):
            # Not reachable -> let caller fall back to faster-whisper for the run.
            logger.warning(
                "sp-nemo not ready for %s (%s) — falling back to faster-whisper",
                language, health.get("error", "unknown"),
            )
            raise RuntimeError(f"sp-nemo not ready: {health.get('error')}")

        # sp-nemo IS the hi/bn ASR. Return its result directly — including an EMPTY
        # result (silent chunk). Never fall through to the in-container NeMo
        # IndicConformer, which is broken for hi/bn (KeyError: 'dir').
        try:
            text, engine = transcribe_with_sp_nemo(prepared_wav, language)
        except Exception as exc:  # noqa: BLE001
            logger.warning("sp-nemo failed for %s (%s) — falling back", language, exc)
            raise RuntimeError(f"sp-nemo failed: {exc}") from exc
        return (text or ""), engine

    model, model_path, language_id, engine = _resolve_model_for_language(language)

    decoder_suffix = ""
    try:
        text, decoder_suffix = _transcribe_best_decoder(
            model, prepared_wav, language_id=language_id, model_path=model_path, language=language
        )
    except Exception as exc:
        logger.warning("NeMo transcribe failed (%s): %s", language, exc)
        text = ""

    if language == "Bengali" and BENGALI_MULTILINGUAL_FALLBACK and _score_transcript(text, language) < 25:
        if os.path.isfile(MULTILINGUAL_NEMO_MODEL_PATH):
            try:
                multi_model = get_multilingual_model()
                alt_text, alt_dec = _transcribe_best_decoder(
                    multi_model,
                    prepared_wav,
                    language_id="bn",
                    model_path=MULTILINGUAL_NEMO_MODEL_PATH,
                    language=language,
                )
                if _score_transcript(alt_text, language) > _score_transcript(text, language):
                    text = alt_text
                    decoder_suffix = f"multi-{alt_dec}"
                    engine = _engine_label(MULTILINGUAL_NEMO_MODEL_PATH, language)
            except Exception as exc:
                logger.warning("Bengali multilingual fallback failed: %s", exc)

    if decoder_suffix:
        engine = f"{engine}/{decoder_suffix}"

    if not text and TRANSCRIPTION_RETRY_EMPTY and language != "English":
        logger.info("Empty NeMo result for %s — retrying with English parakeet", prepared_wav.name)
        try:
            en_model, en_path, _, en_engine = _resolve_model_for_language("English")
            text = _run_transcribe(en_model, prepared_wav, language_id=None, model_path=en_path)
            engine = f"{en_engine}+fallback"
        except Exception:
            pass

    if not text:
        text = "[No speech detected]"
    return text, engine


def nemo_health() -> dict:
    hindi_primary = os.path.isfile(HINDI_NEMO_MODEL_PATH)
    hindi_fallback = os.path.isfile(HINDI_NEMO_FALLBACK_PATH)
    english_exists = os.path.isfile(ENGLISH_NEMO_MODEL_PATH)
    bengali_exists = os.path.isfile(BENGALI_NEMO_MODEL_PATH)
    multi_exists = os.path.isfile(MULTILINGUAL_NEMO_MODEL_PATH)

    info: dict = {
        "device": _resolve_device(),
        "decoder": NEMO_DECODER,
        "hindi_model_path": HINDI_NEMO_MODEL_PATH,
        "hindi_fallback_path": HINDI_NEMO_FALLBACK_PATH,
        "english_model_path": ENGLISH_NEMO_MODEL_PATH,
        "bengali_model_path": BENGALI_NEMO_MODEL_PATH,
        "multilingual_model_path": MULTILINGUAL_NEMO_MODEL_PATH,
        "hindi_primary_exists": hindi_primary,
        "hindi_fallback_exists": hindi_fallback,
        "english_model_file_exists": english_exists,
        "bengali_model_file_exists": bengali_exists,
        "multilingual_model_file_exists": multi_exists,
        "supported_languages": list(LANGUAGE_NEMO_ID.keys()),
    }

    if not english_exists or (not hindi_primary and not hindi_fallback):
        info["ready"] = False
        info["error"] = "Required NeMo models missing (English + Hindi)"
        return info

    try:
        import nemo  # noqa: F401
    except ImportError:
        info["ready"] = False
        info["error"] = "nemo_toolkit not installed in AI container"
        return info

    info["ready"] = True
    info["dual_decoder"] = NEMO_DUAL_DECODER
    info["dual_decoder_languages"] = sorted(NEMO_DUAL_DECODER_LANGUAGES)
    info["bengali_multilingual_fallback"] = BENGALI_MULTILINGUAL_FALLBACK
    info["note"] = "IndicConformer Large (hi/bn) + dual RNNT/CTC + optional 600M multi fallback"
    if not bengali_exists:
        info["warning"] = "Bengali IndicConformer not present — Bengali calls need 08-indicconformer.tar"
    if not multi_exists:
        info["warning_multi"] = "Multilingual model not present — only Hindi/English/Bengali ASR"
    return info
