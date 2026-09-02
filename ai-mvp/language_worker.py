"""
Language detection â€” Whisper Large V3 only (transformers native <|lang|> token).

Uses OpenAI Whisper's built-in language detection (first decoder token), NOT faster-whisper.
Script verification also uses the same Whisper v3 model with forced_decoder_ids.
"""

from __future__ import annotations

import logging
import math
import re
import uuid
from collections import defaultdict
from pathlib import Path
from typing import Optional

import torch
import torchaudio

from audio_io import load_audio, save_audio
from config import (
    LANG_BENGALI_PRIORITY_BONUS,
    LANG_CALL_CENTER_MODE,
    LANG_HINDI_CONFUSABLE_CODES,
    LANG_INDIC_ACOUSTIC_ENABLED,
    LANG_MAP_URDU_TO_HINDI,
    LANG_MAP_NEPALI_TO_HINDI,
    LANG_MAP_ASSAMESE_TO_BENGALI,
    LANG_RESTRICTED_CONFIDENT,
    LANG_DETECT_CONFIDENCE_MIN,
    LANG_DETECT_HIGH_CONFIDENCE,
    LANG_DETECT_MODE,
    LANG_DETECT_SAMPLE_SEC,
    LANG_DISAMBIGUATE_HI_BN,
    LANG_BENGALI_GUARD_ENABLED,
    LANG_BENGALI_GUARD_MIN_PROB,
    LANG_BENGALI_GUARD_MIN_ROMAN,
    LANG_DRAVIDIAN_CONFUSABLE_CODES,
    LANG_ENGLISH_GUARD_ENABLED,
    LANG_ENGLISH_GUARD_MIN_PROB,
    LANG_ENGLISH_GUARD_WORD_RATIO,
    LANG_ENGLISH_PLAUSIBILITY_MIN,
    LANG_FAST_PATH_HI_CONFIDENCE,
    LANG_FAST_PATH_BN_CONFIDENCE,
    LANG_HINDI_GUARD_ENABLED,
    LANG_HINDI_GUARD_MIN_PROB,
    LANG_HINDI_PRIORITY_BONUS,
    LANG_MIN_SCRIPT_CHARS,
    LANG_PRIMARY_LANGUAGES,
    LANG_PRIMARY_ONLY,
    LANG_SCRIPT_VERIFY,
    LANG_VERIFY_ALWAYS,
    LANG_VERIFY_ALWAYS_FOR_DRAVIDIAN,
    LANG_VERIFY_ALWAYS_FOR_ENGLISH,
    LANG_VERIFY_SAMPLE_SEC,
    INDICLID_ENABLED,
    INDICLID_MIN_SCORE,
    LANG_LID_MAX_TRANSCRIPT_TOKENS,
    LANG_LID_BACKEND,
    LANG_LID_FAST_MODE,
    LANG_DETECT_MULTI_CHANNEL,
    SEAMLESS_LID_ENABLED,
    SEAMLESS_LID_PROBE_LANGUAGES,
    SEAMLESS_LID_SAMPLE_SEC,
    LANG_DETECT_CHANNEL,
    LANG_DETECT_AGENT_CHANNEL_INDEX,
    LANG_DETECT_CUSTOMER_CHANNEL_INDEX,
    LANG_DETECT_VOICE_TRIM,
    LANG_HI_BN_FLIP_MARGIN,
    LANG_HI_BN_MIN_SCRIPT,
    LANG_REPETITION_MIN_UNIQUE,
    LANG_REPETITION_PENALTY,
    LANG_REGIONAL_ACOUSTIC_MARGIN,
    LANG_REGIONAL_DETECTION,
    LANG_REGIONAL_LANGUAGES,
    LANG_SCRIPT_FIRST_MIN_CHARS,
    LANG_VERIFY_TOPK,
    WHISPER_LANG_DEVICE,
    WHISPER_LANG_MODEL_PATH,
    WORK_DIR,
)

logger = logging.getLogger(__name__)


def _lid_log(msg: str, *args) -> None:
    """LID logs via print so they ALWAYS appear in docker logs (root logger has no INFO handler)."""
    try:
        text = msg % args if args else msg
    except Exception:
        text = msg
    try:
        print(f"[LID] {text}", flush=True)
    except UnicodeEncodeError:  # non-UTF8 console (Windows cp1252)
        print(f"[LID] {text}".encode("ascii", "replace").decode("ascii"), flush=True)
    logger.info(msg, *args)


WHISPER_CODE_TO_LANGUAGE: dict[str, str] = {
    "as": "Assamese",
    "bn": "Bengali",
    "brx": "Bodo",
    "doi": "Dogri",
    "en": "English",
    "gu": "Gujarati",
    "hi": "Hindi",
    "kn": "Kannada",
    "kok": "Konkani",
    "ks": "Kashmiri",
    "mai": "Maithili",
    "ml": "Malayalam",
    "mni": "Manipuri",
    "mr": "Marathi",
    "ne": "Nepali",
    "or": "Odia",
    "pa": "Punjabi",
    "sa": "Sanskrit",
    "sat": "Santali",
    "sd": "Sindhi",
    "ta": "Tamil",
    "te": "Telugu",
    "ur": "Urdu",
}

LANGUAGE_MAP = WHISPER_CODE_TO_LANGUAGE

# Whisper frequently confuses Hindi with these â€” always script-verify
DRAVIDIAN_MISLABEL_CODES = frozenset({"ta", "te", "kn", "ml"})
OTHER_MISLABEL_CODES = frozenset({"mr", "gu", "or", "pa", "as", "ur", "kok", "ne"})

SCRIPT_RES: dict[str, re.Pattern[str]] = {
    "devanagari": re.compile(r"[\u0900-\u097F]"),
    "bengali": re.compile(r"[\u0980-\u09FF]"),
    "tamil": re.compile(r"[\u0B80-\u0BFF]"),
    "telugu": re.compile(r"[\u0C00-\u0C7F]"),
    "kannada": re.compile(r"[\u0C80-\u0CFF]"),
    "malayalam": re.compile(r"[\u0D00-\u0D7F]"),
    "gujarati": re.compile(r"[\u0A80-\u0AFF]"),
    "gurmukhi": re.compile(r"[\u0A00-\u0A7F]"),
    "odia": re.compile(r"[\u0B00-\u0B7F]"),
    "latin": re.compile(r"[A-Za-z]"),
}

LANG_SCRIPT_KEYS: dict[str, tuple[str, ...]] = {
    "Hindi": ("devanagari",),
    "Marathi": ("devanagari",),
    "Nepali": ("devanagari",),
    "Sanskrit": ("devanagari",),
    "Hinglish": ("devanagari", "latin"),
    "Bengali": ("bengali",),
    "Assamese": ("bengali",),
    "Tamil": ("tamil",),
    "Telugu": ("telugu",),
    "Kannada": ("kannada",),
    "Malayalam": ("malayalam",),
    "Gujarati": ("gujarati",),
    "Punjabi": ("gurmukhi",),
    "Odia": ("odia",),
    "English": ("latin",),
}

BANKING_FALLBACK_PHRASES = {
    "Hindi": [
        "namaste", "shukriya", "account", "balance", "otp", "loan", "emi",
        "transaction", "customer", "dhanyawad", "kripya", "aapka", "haan", "ji",
    ],
    "English": [
        "hello", "thank you", "account", "balance", "otp", "loan", "emi",
        "transaction", "customer", "please", "credit card",
    ],
    "Bengali": [
        # Legacy AI/src/2nd step Language_Detection fallback_phrases + banking BN roman
        "nomoshkar", "namaskar", "dhonnobad", "dhanyabad", "dhonnobad", "apni keman",
        "apni kemon", "keman achhen", "kemon achhen", "apnar account", "account balance",
        "balance koto", "apnar otp", "otp din", "apni", "apnar", "apnader", "amar", "amader",
        "ami", "kemon", "achhen", "achen", "ache", "hoyeche", "hobe", "hocche", "korte",
        "korben", "korbo", "bolchi", "bolben", "bolun", "bolte", "sunun", "shunun", "janai",
        "janaben", "janaben", "dukhito", "shubho", "shubhechha", "ekhane", "ekhan", "taka",
        "joma", "somoy", "kothay", "keno", "kivabe", "balence", "balese", "benk", "somossa",
        "samasy", "problem ta", "loan er", "emi ta", "customer er", "number ta", "mobile ta",
        "registered", "verify kor", "confirm kor", "details ta", "statement ta",
    ],
}

# Romanized Hindi tokens when Whisper forced to English on Hindi audio
HINDI_ROMAN_HINTS = frozenset({
    "aap", "aapka", "aapki", "aapke", "aapko", "main", "mera", "meri", "kya", "kaise",
    "kripya", "dhanyawad", "dhanyavad", "shukriya", "namaste", "namaskar", "namaskaram",
    "pranam", "swagat", "sawagat", "ji", "haan", "han", "nahin", "nahi", "theek", "thik",
    "bataiye", "bataye", "batain", "suniye", "sunie", "samajh", "samjha", "samajhiye",
    "madad", "sahayata", "kripya", "dhanyawad", "shukriya", "sahab", "sahib",
})

# Display name â†’ native script key for minimum-script guard
LANG_TO_SCRIPT_KEY: dict[str, str] = {
    "Hindi": "devanagari",
    "Marathi": "devanagari",
    "Bengali": "bengali",
    "Assamese": "bengali",
    "Tamil": "tamil",
    "Telugu": "telugu",
    "Kannada": "kannada",
    "Malayalam": "malayalam",
    "Gujarati": "gujarati",
    "Punjabi": "gurmukhi",
    "Odia": "odia",
}

DRAVIDIAN_LANGUAGES = frozenset({"Tamil", "Telugu", "Kannada", "Malayalam"})

# Languages with an EXCLUSIVE script — the script alone identifies them reliably.
# (Devanagari is shared by Hindi/Marathi/Nepali; Bengali script by Bengali/Assamese,
#  so those are NOT here — they need acoustic disambiguation.)
UNIQUE_SCRIPT_TO_LANGUAGE: dict[str, str] = {
    "tamil": "Tamil",
    "telugu": "Telugu",
    "kannada": "Kannada",
    "malayalam": "Malayalam",
    "gujarati": "Gujarati",
    "gurmukhi": "Punjabi",
    "odia": "Odia",
}

# Whisper commonly confuses languages WITHIN the same script family — when verifying
# a detected language we also try its siblings so script scoring can pick correctly.
SCRIPT_SIBLINGS: dict[str, tuple[str, ...]] = {
    "Tamil": ("Telugu", "Kannada", "Malayalam"),
    "Telugu": ("Tamil", "Kannada", "Malayalam"),
    "Kannada": ("Tamil", "Telugu", "Malayalam"),
    "Malayalam": ("Tamil", "Telugu", "Kannada"),
    "Hindi": ("Marathi",),
    "Marathi": ("Hindi",),
    "Bengali": ("Assamese",),
    "Assamese": ("Bengali",),
}


def _script_first_language(text: str, min_chars: int) -> Optional[str]:
    """Return a unique-script language when its script clearly dominates the text.

    Bulletproof for Tamil/Telugu/Kannada/Malayalam/Gujarati/Punjabi/Odia, whose
    scripts appear in no other language. Returns None for shared scripts.
    """
    counts = _script_counts(text)
    native = {k: v for k, v in counts.items() if k != "latin" and v > 0}
    if not native:
        return None
    top_key = max(native, key=lambda k: native[k])
    top_count = native[top_key]
    if top_count < min_chars:
        return None
    total_native = sum(native.values())
    if total_native and (top_count / total_native) < 0.6:
        return None
    return UNIQUE_SCRIPT_TO_LANGUAGE.get(top_key)

# --- Whisper Large V3 (transformers) â€” sole language detection backend ---

_tw_processor = None
_tw_model = None
_tw_tokenizer = None
_tw_load_error: Optional[str] = None
BENGALI_ROMAN_HINTS = frozenset({
    "ami", "amader", "apni", "apnar", "apnader", "apnake", "amake", "amra", "apnara",
    "kemon", "keman", "achhen", "achen", "ache", "achhe", "hoyeche", "hocche", "hobe",
    "korte", "korbo", "korben", "korchi", "korechen", "janai", "janaben", "bolchi",
    "bolben", "bolun", "bolte", "sunun", "shunun", "shunben", "dhonnobad", "dhanyabad",
    "namaskar", "nomoshkar", "shubho", "shubhechha", "ekhane", "ekhan", "taka", "joma",
    "somoy", "kothay", "keno", "kivabe", "samasy", "somossa", "dukhito", "thik", "bhalo",
    "koto", "taar", "tar", "er", "eke", "dite", "pari", "parben", "lagbe", "chai",
    "jani", "bujhi", "mone", "hoy", "na", "ki", "ke", "kothay", "kokhon", "kivabe",
})

_COMMON_ENGLISH_WORDS = frozenset({
    "a", "an", "the", "i", "you", "we", "he", "she", "they", "it", "is", "are",
    "was", "were", "am", "be", "been", "have", "has", "had", "do", "does", "did",
    "will", "would", "can", "could", "should", "may", "might", "must", "not",
    "no", "yes", "hello", "hi", "hey", "thank", "thanks", "please", "sorry",
    "sir", "madam", "ma'am", "okay", "ok", "yes", "no", "help", "need", "want",
    "account", "balance", "bank", "card", "loan", "payment", "customer", "call",
    "credit", "debit", "transaction", "verify", "confirm", "application", "app",
    "check", "issue", "problem", "support", "service", "number", "name", "date",
    "time", "today", "tomorrow", "yesterday", "good", "morning", "afternoon",
    "evening", "how", "what", "when", "where", "why", "who", "which", "your",
    "my", "our", "their", "this", "that", "these", "those", "with", "from",
    "for", "and", "or", "but", "if", "then", "so", "to", "of", "in", "on", "at",
    "by", "about", "just", "also", "very", "well", "right", "mean", "know",
    "think", "see", "tell", "ask", "give", "get", "make", "take", "go", "come",
})


def _english_plausibility(text: str) -> float:
    """Fraction of tokens that look like real English (not phonetic Indic garbage)."""
    tokens = re.findall(r"[a-zA-Z']+", (text or "").lower())
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in _COMMON_ENGLISH_WORDS or (len(t) <= 2 and t.isalpha()))
    return hits / len(tokens)


# Language-neutral / banking terms that appear in BOTH English and romanized Indic
# speech — these must NOT count as evidence for an Indic language.
_ROMAN_SHARED_TERMS = frozenset({
    "account", "balance", "bank", "loan", "emi", "otp", "transaction",
    "customer", "problem", "sir", "madam", "card", "credit", "debit",
})

# Tokens that only appear when the speaker is genuinely using Hindi/Bengali
# (Whisper romanizes them when force-transcribing Indic audio as English).
_DISTINCTIVE_INDIC_ROMAN = frozenset(
    (HINDI_ROMAN_HINTS | BENGALI_ROMAN_HINTS) - _COMMON_ENGLISH_WORDS - _ROMAN_SHARED_TERMS
)


def _english_word_ratio_strict(text: str) -> float:
    """Fraction of multi-char tokens that are real common English words.

    Stricter than _english_plausibility (no <=2-char shortcut) so romanized Indic
    speech, which rarely contains English function words, scores low.
    """
    tokens = [t for t in re.findall(r"[a-zA-Z']+", (text or "").lower()) if len(t) >= 2]
    if not tokens:
        return 0.0
    hits = sum(1 for t in tokens if t in _COMMON_ENGLISH_WORDS)
    return hits / len(tokens)


def _distinctive_indic_roman_count(text: str) -> int:
    tokens = re.findall(r"[a-zA-Z']+", (text or "").lower())
    return sum(1 for t in tokens if t in _DISTINCTIVE_INDIC_ROMAN)


def _english_guard_confirms(processor, model, tokenizer, sample_path: Path) -> bool:
    """Force-transcribe as English; accept English only when the text is genuinely
    English (enough real English words AND no distinctive romanized Indic tokens).

    Rejects English when forced-Bengali transcription shows Bengali script or strong
    Bengali roman hints (common on Bengali banking calls mislabeled as English).
    """
    try:
        text = _sample_transcribe_whisper_v3(
            processor, model, tokenizer, sample_path, "en",
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
    except Exception as exc:
        _lid_log("English guard transcribe failed: %s", exc)
        return False

    # Cross-check: Bengali forced transcript beats phonetic English banking garbage.
    try:
        bn_text = _sample_transcribe_whisper_v3(
            processor, model, tokenizer, sample_path, "bn",
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
        bn_native = _script_counts(bn_text).get("bengali", 0)
        bn_roman = _bengali_roman_hint_count(bn_text)
        if bn_native >= LANG_HI_BN_MIN_SCRIPT:
            _lid_log(
                "English guard rejected — forced-bn has %d Bengali script chars",
                bn_native,
            )
            return False
        if bn_roman >= max(2, LANG_BENGALI_GUARD_MIN_ROMAN + 1):
            _lid_log(
                "English guard rejected — forced-bn has %d Bengali roman hints",
                bn_roman,
            )
            return False
        if _fallback_phrase_detection(bn_text) == "Bengali":
            _lid_log("English guard rejected — Bengali phrase fallback on forced-bn")
            return False
    except Exception as exc:
        _lid_log("English guard Bengali cross-check skipped: %s", exc)

    # Hindi/Hinglish cross-check (namaskar + Devanagari on forced-hi).
    try:
        hi_text = _sample_transcribe_whisper_v3(
            processor, model, tokenizer, sample_path, "hi",
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
        hi_native = _script_counts(hi_text).get("devanagari", 0)
        hi_roman = _hindi_roman_hint_count(hi_text)
        hi_lower = hi_text.lower()
        if hi_native >= LANG_HI_BN_MIN_SCRIPT:
            _lid_log("English guard rejected — forced-hi has %d Devanagari chars", hi_native)
            return False
        if hi_roman >= 1 or "namaskar" in hi_lower or "namaste" in hi_lower:
            _lid_log("English guard rejected — Hindi roman/script cues in forced-hi")
            return False
        if _fallback_phrase_detection(hi_text) == "Hindi":
            _lid_log("English guard rejected — Hindi phrase fallback on forced-hi")
            return False
    except Exception as exc:
        _lid_log("English guard Hindi cross-check skipped: %s", exc)

    ratio = _english_word_ratio_strict(text)
    indic = _distinctive_indic_roman_count(text)
    bn_roman_en = _bengali_roman_hint_count(text)
    uniq = _repetition_unique_ratio(text)
    confirms = (
        ratio >= LANG_ENGLISH_GUARD_WORD_RATIO
        and indic == 0
        and bn_roman_en == 0
        and uniq >= LANG_REPETITION_MIN_UNIQUE
    )
    _lid_log(
        "English guard: word_ratio=%.2f bn_roman=%d distinctive_indic=%d uniq=%.2f confirms=%s text=%r",
        ratio, bn_roman_en, indic, uniq, confirms, text[:80],
    )
    return confirms


def _bengali_guard_confirms(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    all_probs: dict[str, float] | None,
) -> bool:
    """Confirm Bengali before English guard can swallow the call.

    Uses forced-Bengali script, roman hints, and legacy banking phrase fallback
    (from AI/src/2nd step Language_Detection/language_detection.py).
    """
    try:
        bn_text = _sample_transcribe_whisper_v3(
            processor, model, tokenizer, sample_path, "bn",
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
    except Exception as exc:
        _lid_log("Bengali guard transcribe failed: %s", exc)
        return False

    native = _script_counts(bn_text).get("bengali", 0)
    bn_roman = _bengali_roman_hint_count(bn_text)
    phrase = _fallback_phrase_detection(bn_text)

    if native >= LANG_HI_BN_MIN_SCRIPT:
        _lid_log("Bengali guard confirmed — %d native script chars", native)
        return True
    if bn_roman >= LANG_BENGALI_GUARD_MIN_ROMAN:
        _lid_log("Bengali guard confirmed — %d roman hints", bn_roman)
        return True
    if phrase == "Bengali":
        _lid_log("Bengali guard confirmed — phrase fallback")
        return True

    # Open-ended Whisper snippet + phrase/IndicLID (legacy second signal).
    try:
        auto_text = _whisper_auto_transcribe_snippet(
            processor, model, sample_path, max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
        if _fallback_phrase_detection(auto_text) == "Bengali":
            _lid_log("Bengali guard confirmed — auto-transcript phrase fallback")
            return True
        if _bengali_roman_hint_count(auto_text) >= max(2, LANG_BENGALI_GUARD_MIN_ROMAN + 1):
            _lid_log("Bengali guard confirmed — auto-transcript roman hints")
            return True
    except Exception as exc:
        _lid_log("Bengali guard auto-transcript skipped: %s", exc)

    if all_probs:
        bn_p = all_probs.get("bn", 0.0)
        hi_p = all_probs.get("hi", 0.0)
        en_p = all_probs.get("en", 0.0)
        if bn_p >= LANG_BENGALI_GUARD_MIN_PROB and bn_p >= hi_p and bn_p > en_p and bn_roman >= 1:
            _lid_log(
                "Bengali guard confirmed — bn_prob=%.3f > en=%.3f with roman hint",
                bn_p, en_p,
            )
            return True

    _lid_log(
        "Bengali guard not confirmed (native=%d roman=%d phrase=%s)",
        native, bn_roman, phrase,
    )
    return False


def _english_guard_eligible(lang_code: str, all_probs: dict[str, float]) -> bool:
    """English guard only when English actually leads — not when bn/hi are stronger."""
    en_prob = all_probs.get("en", 0.0)
    bn_prob = all_probs.get("bn", 0.0)
    hi_prob = all_probs.get("hi", 0.0)
    if lang_code == "en":
        return True
    if en_prob < LANG_ENGLISH_GUARD_MIN_PROB:
        return False
    return en_prob > bn_prob and en_prob > hi_prob


def _regional_detection_enabled() -> bool:
    """Regional Tamil/Telugu/... confirm is off when the deployment is hi/bn/en only."""
    return LANG_REGIONAL_DETECTION and not LANG_PRIMARY_ONLY


def _hindi_guard_eligible(lang_code: str, all_probs: dict[str, float]) -> bool:
    hi_prob = all_probs.get("hi", 0.0)
    bn_prob = all_probs.get("bn", 0.0)
    en_prob = all_probs.get("en", 0.0)
    if lang_code == "hi":
        return True
    # Urdu/Nepali tokens on Hindi banking audio — always run Hindi guard.
    if LANG_CALL_CENTER_MODE and lang_code in LANG_HINDI_CONFUSABLE_CODES:
        return True
    if lang_code in LANG_DRAVIDIAN_CONFUSABLE_CODES and hi_prob >= LANG_HINDI_GUARD_MIN_PROB:
        return True
    if lang_code in LANG_HINDI_CONFUSABLE_CODES and hi_prob >= LANG_HINDI_GUARD_MIN_PROB:
        return True
    if hi_prob >= LANG_HINDI_GUARD_MIN_PROB and hi_prob >= bn_prob and hi_prob >= en_prob:
        return True
    return False


def _hindi_guard_confirms(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    all_probs: dict[str, float] | None,
) -> bool:
    try:
        hi_text = _sample_transcribe_whisper_v3(
            processor, model, tokenizer, sample_path, "hi",
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
    except Exception as exc:
        _lid_log("Hindi guard transcribe failed: %s", exc)
        return False

    native = _script_counts(hi_text).get("devanagari", 0)
    hi_roman = _hindi_roman_hint_count(hi_text)
    phrase = _fallback_phrase_detection(hi_text)

    if native >= LANG_HI_BN_MIN_SCRIPT:
        _lid_log("Hindi guard confirmed — %d Devanagari chars", native)
        return True
    if hi_roman >= 2:
        _lid_log("Hindi guard confirmed — %d Hindi roman hints", hi_roman)
        return True
    if phrase == "Hindi":
        _lid_log("Hindi guard confirmed — phrase fallback")
        return True

    if all_probs and all_probs.get("hi", 0.0) >= 0.20 and hi_roman >= 1:
        _lid_log("Hindi guard confirmed — hi_prob + roman hint")
        return True

    _lid_log(
        "Hindi guard not confirmed (native=%d roman=%d phrase=%s)",
        native, hi_roman, phrase,
    )
    return False


def _dravidian_mislabel_to_hindi(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    lang_code: str,
    detected: str,
    all_probs: dict[str, float],
) -> str | None:
    """Whisper top=ta/te/kn/ml on Hindi banking audio — re-probe as Hindi/Bengali."""
    if not LANG_CALL_CENTER_MODE:
        return None
    if lang_code not in LANG_DRAVIDIAN_CONFUSABLE_CODES:
        return None
    hi_p = all_probs.get("hi", 0.0)
    bn_p = all_probs.get("bn", 0.0)
    if hi_p < LANG_HINDI_GUARD_MIN_PROB and bn_p < LANG_BENGALI_GUARD_MIN_PROB:
        return None
    _lid_log(
        "Dravidian mislabel guard: Whisper=%r (%s) hi=%.3f bn=%.3f — re-probing hi/bn",
        lang_code, detected, hi_p, bn_p,
    )
    seed = "Bengali" if bn_p > hi_p else "Hindi"
    if lang_code == "bn":
        seed = "Bengali"
    return _disambiguate_hi_bn(processor, model, tokenizer, sample_path, seed)


def _bengali_guard_eligible(lang_code: str, all_probs: dict[str, float]) -> bool:
    bn_prob = all_probs.get("bn", 0.0)
    hi_prob = all_probs.get("hi", 0.0)
    en_prob = all_probs.get("en", 0.0)
    if lang_code == "bn":
        return True
    if bn_prob < LANG_BENGALI_GUARD_MIN_PROB:
        return False
    if bn_prob >= hi_prob and bn_prob >= en_prob:
        return True
    # Whisper top=en but Bengali mass is meaningful (common BN banking mislabel).
    if lang_code == "en" and bn_prob >= 0.18 and bn_prob > hi_prob:
        return True
    return False


def _bengali_roman_hint_count(text: str) -> int:
    tokens = re.findall(r"[a-zA-Z']+", (text or "").lower())
    return sum(1 for t in tokens if t in BENGALI_ROMAN_HINTS)


def _hindi_roman_hint_count(text: str) -> int:
    tokens = re.findall(r"[a-zA-Z']+", (text or "").lower())
    return sum(1 for t in tokens if t in HINDI_ROMAN_HINTS)


def _native_script_count(text: str, lang_name: str) -> int:
    key = LANG_TO_SCRIPT_KEY.get(lang_name)
    if not key:
        return 0
    return _script_counts(text).get(key, 0)


def language_code_for(name: str) -> str:
    target = (name or "").strip().lower()
    for code, lang in WHISPER_CODE_TO_LANGUAGE.items():
        if lang.lower() == target:
            return code
    return "en"


def _script_counts(text: str) -> dict[str, int]:
    return {key: len(rx.findall(text or "")) for key, rx in SCRIPT_RES.items()}


def _select_lid_channel(waveform: torch.Tensor, channel_override: str | None = None) -> torch.Tensor:
    """Pick agent/customer/mix channel for stereo calls; else mono mix."""
    channels = waveform.shape[0]
    if channels < 2:
        return waveform[:1]

    pick = (channel_override or LANG_DETECT_CHANNEL).strip().lower()
    if pick == "agent":
        idx = LANG_DETECT_AGENT_CHANNEL_INDEX
    elif pick in ("mix", "mono"):
        return torch.mean(waveform, dim=0, keepdim=True)
    else:  # customer (default)
        idx = LANG_DETECT_CUSTOMER_CHANNEL_INDEX

    if idx >= channels:
        idx = channels - 1
    selected = waveform[idx:idx + 1]

    # Guard: if chosen channel is near-silent, fall back to full mix
    if float(selected.abs().mean()) < 1e-4:
        logger.info("LID channel %d near-silent — using mono mix", idx)
        return torch.mean(waveform, dim=0, keepdim=True)
    return selected


def _voiced_segment(waveform: torch.Tensor, sample_rate: int, max_seconds: float) -> torch.Tensor:
    """Concatenate the loudest ~max_seconds of speech, dropping silence/turn gaps."""
    total = waveform.shape[1]
    max_samples = int(max_seconds * sample_rate)
    if total <= max_samples:
        return waveform

    frame = int(0.5 * sample_rate)
    mono = waveform.mean(dim=0)
    n_frames = total // frame
    if n_frames <= 1:
        return waveform[:, :max_samples]

    energies = []
    for i in range(n_frames):
        seg = mono[i * frame:(i + 1) * frame]
        energies.append((float(seg.pow(2).mean()), i))

    if not energies:
        return waveform[:, :max_samples]

    rms_values = sorted(e for e, _ in energies)
    median_rms = rms_values[len(rms_values) // 2]
    threshold = max(median_rms * 0.5, 1e-6)

    voiced = [i for e, i in energies if e >= threshold]
    if not voiced:
        return waveform[:, :max_samples]

    voiced.sort()
    pieces = [waveform[:, i * frame:(i + 1) * frame] for i in voiced]
    collected = torch.cat(pieces, dim=1)
    if collected.shape[1] > max_samples:
        collected = collected[:, :max_samples]
    return collected


def _prepare_detection_sample(
    audio_path: Path,
    max_seconds: float,
    channel: str | None = None,
) -> tuple[Path, bool]:
    """Build mono 16 kHz LID sample from the chosen channel, voiced-trimmed."""
    waveform, sample_rate = load_audio(audio_path)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000

    orig_channels = waveform.shape[0]
    pick = channel or LANG_DETECT_CHANNEL
    waveform = _select_lid_channel(waveform, channel)

    if LANG_DETECT_VOICE_TRIM:
        waveform = _voiced_segment(waveform, sample_rate, max_seconds)
    else:
        max_samples = int(max_seconds * sample_rate)
        if waveform.shape[1] > max_samples:
            waveform = waveform[:, :max_samples]

    _lid_log(
        "sample: channels=%d pick=%s dur=%.1fs voice_trim=%s",
        orig_channels, pick, waveform.shape[1] / sample_rate,
        LANG_DETECT_VOICE_TRIM,
    )

    if waveform.shape[1] < sample_rate * 2:
        return audio_path, False

    out = WORK_DIR / f"lid_{audio_path.stem}_{uuid.uuid4().hex[:8]}.wav"
    save_audio(out, waveform, sample_rate)
    return out, True


def _tw_device() -> str:
    if WHISPER_LANG_DEVICE in ("cpu", "cuda"):
        if WHISPER_LANG_DEVICE == "cuda" and not torch.cuda.is_available():
            return "cpu"
        return WHISPER_LANG_DEVICE
    return "cuda" if torch.cuda.is_available() else "cpu"


def _load_transformers_whisper():
    global _tw_processor, _tw_model, _tw_tokenizer, _tw_load_error
    if _tw_model is not None:
        return _tw_processor, _tw_model, _tw_tokenizer
    if _tw_load_error:
        raise RuntimeError(_tw_load_error)
    if not WHISPER_LANG_MODEL_PATH.is_dir():
        _tw_load_error = f"Whisper Large V3 not found: {WHISPER_LANG_MODEL_PATH}"
        raise RuntimeError(_tw_load_error)
    try:
        from transformers import (
            WhisperForConditionalGeneration,
            WhisperProcessor,
            WhisperTokenizer,
        )

        path = str(WHISPER_LANG_MODEL_PATH)
        device = _tw_device()
        dtype = torch.float16 if device == "cuda" else torch.float32
        _tw_processor = WhisperProcessor.from_pretrained(path)
        # Loading Whisper large-v3 with its default float32 dtype consumed
        # ~8.6 GiB on the production L40S. FP16 is native on this GPU, is faster,
        # and cuts the persistent language-model allocation roughly in half.
        _tw_model = WhisperForConditionalGeneration.from_pretrained(
            path,
            torch_dtype=dtype,
        )
        _tw_model = _tw_model.to(device)
        _tw_model.eval()
        _tw_tokenizer = WhisperTokenizer.from_pretrained(path)
        logger.info(
            "Whisper Large V3 LID loaded from %s on %s (%s)",
            path,
            device,
            dtype,
        )
        return _tw_processor, _tw_model, _tw_tokenizer
    except Exception as exc:
        _tw_load_error = f"Failed to load Whisper Large V3: {exc}"
        raise RuntimeError(_tw_load_error) from exc


def load_lid_whisper():
    """Public accessor for the resident Whisper large-v3 LID model.

    Returns ``(processor, model, tokenizer)``. Window decodes borrow this
    already-loaded object and must serialize GPU access themselves.
    """
    return _load_transformers_whisper()


def _input_features(processor, model, sample_path: Path):
    import torchaudio

    waveform, sample_rate = load_audio(sample_path)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
    if waveform.shape[0] > 1:
        waveform = torch.mean(waveform, dim=0, keepdim=True)
    inputs = processor(
        waveform.squeeze(0).numpy(),
        return_tensors="pt",
        sampling_rate=16000,
    )
    return inputs.input_features.to(device=model.device, dtype=model.dtype)


def _lang_token_id(tokenizer, lang_code: str) -> int | None:
    token = f"<|{lang_code}|>"
    tid = tokenizer.convert_tokens_to_ids(token)
    if tid is None or tid == tokenizer.unk_token_id:
        return None
    return tid


def _whisper_v3_detect_language(
    processor,
    model,
    tokenizer,
    sample_path: Path,
) -> tuple[str, float, dict[str, float]]:
    """
    Native Whisper Large V3 language detection â€” first decoder token is <|lang|>.
    Uses output_scores for per-language probabilities (Whisper's built-in LID).
    """
    input_features = _input_features(processor, model, sample_path)

    with torch.inference_mode():
        outputs = model.generate(
            input_features,
            max_new_tokens=1,
            return_dict_in_generate=True,
            output_scores=True,
        )

    sequences = outputs.sequences
    if sequences.shape[1] < 2:
        raise RuntimeError("Whisper LID did not emit a language token")

    lang_token_id = int(sequences[0, 1].item())
    lang_token_str = tokenizer.decode([lang_token_id])
    lang_code = "".join(filter(str.isalpha, lang_token_str))

    all_probs: dict[str, float] = {}
    probability = 0.0

    if outputs.scores:
        step_logits = outputs.scores[0][0]
        step_probs = torch.softmax(step_logits, dim=-1)
        probability = float(step_probs[lang_token_id].item())

        for code in WHISPER_CODE_TO_LANGUAGE:
            tid = _lang_token_id(tokenizer, code)
            if tid is not None:
                all_probs[code] = float(step_probs[tid].item())

    top5 = sorted(all_probs.items(), key=lambda x: -x[1])[:5]
    logger.info(
        "Whisper v3 LID: code=%r prob=%.3f token=%r top5=%s",
        lang_code,
        probability,
        lang_token_str,
        top5,
    )
    return lang_code, probability, all_probs


def _sample_transcribe_whisper_v3(
    processor,
    model,
    tokenizer,
    audio_path: Path,
    lang_code: str,
    *,
    max_new_tokens: int = 200,
) -> str:
    """Forced-language short transcribe via Whisper v3 (for script verification)."""
    input_features = _input_features(processor, model, audio_path)
    forced_ids = processor.get_decoder_prompt_ids(language=lang_code, task="transcribe")
    with torch.inference_mode():
        generated = model.generate(
            input_features,
            forced_decoder_ids=forced_ids,
            max_new_tokens=max_new_tokens,
        )
    return processor.batch_decode(generated, skip_special_tokens=True)[0].strip()


def _forced_transcribe_scored(
    processor,
    model,
    tokenizer,
    audio_path: Path,
    lang_code: str,
    *,
    max_new_tokens: int = 96,
) -> tuple[str, float]:
    """
    Forced-language transcribe returning (text, avg_token_logprob).
    Higher avg_logprob = better acoustic fit = more likely the true language.
    This is the reliable hi/bn discriminator (script counts cannot separate them).
    """
    input_features = _input_features(processor, model, audio_path)
    forced_ids = processor.get_decoder_prompt_ids(language=lang_code, task="transcribe")
    with torch.inference_mode():
        out = model.generate(
            input_features,
            forced_decoder_ids=forced_ids,
            max_new_tokens=max_new_tokens,
            return_dict_in_generate=True,
            output_scores=True,
        )
    text = processor.batch_decode(out.sequences, skip_special_tokens=True)[0].strip()

    avg_logprob = -10.0
    try:
        trans = model.compute_transition_scores(
            out.sequences, out.scores, normalize_logits=True
        )
        vals = [
            float(v)
            for v in trans[0].tolist()
            if v != 0.0 and not math.isinf(v) and not math.isnan(v)
        ]
        if vals:
            avg_logprob = sum(vals) / len(vals)
    except Exception as exc:
        logger.debug("compute_transition_scores failed for %s: %s", lang_code, exc)
    return text, avg_logprob


def _normalize_call_center_language(lang: str) -> str:
    """Map confusable mislabels (Urdu/Nepali→Hindi, Assamese→Bengali) for banking deployments."""
    if not LANG_CALL_CENTER_MODE or not lang:
        return lang
    if LANG_MAP_URDU_TO_HINDI and lang == "Urdu":
        _lid_log("call-center normalize: Urdu → Hindi")
        return "Hindi"
    if LANG_MAP_NEPALI_TO_HINDI and lang == "Nepali":
        _lid_log("call-center normalize: Nepali → Hindi")
        return "Hindi"
    if LANG_MAP_ASSAMESE_TO_BENGALI and lang == "Assamese":
        _lid_log("call-center normalize: Assamese → Bengali")
        return "Bengali"
    return lang


def _resolve_language(code: str, probability: float = 1.0) -> str:
    lang = WHISPER_CODE_TO_LANGUAGE.get(code)
    if lang:
        return _normalize_call_center_language(lang)
    if code:
        logger.warning("Unsupported Whisper language code %r (prob=%.2f)", code, probability)
        return code.upper()
    return "Unknown"


def _score_language_from_text(text: str, lang_name: str) -> float:
    if not text:
        return -100.0
    counts = _script_counts(text)
    score = 0.0

    primary = LANG_SCRIPT_KEYS.get(lang_name, ())
    for key in primary:
        if key in counts:
            score += counts[key] * 4.0

    # Penalize strong evidence for other Indic scripts
    penalties = {
        "Hindi": ("bengali", "tamil", "telugu", "kannada", "malayalam", "gujarati", "gurmukhi", "odia"),
        "Bengali": ("devanagari", "tamil", "telugu", "kannada", "malayalam"),
        "Tamil": ("devanagari", "bengali", "telugu", "kannada", "malayalam"),
        "Telugu": ("devanagari", "bengali", "tamil", "kannada", "malayalam"),
        "Kannada": ("devanagari", "bengali", "tamil", "telugu", "malayalam"),
        "Malayalam": ("devanagari", "bengali", "tamil", "telugu", "kannada"),
        "English": ("devanagari", "bengali", "tamil", "telugu"),
    }
    for key in penalties.get(lang_name, ()):
        if counts.get(key, 0) > 0:
            score -= counts[key] * 2.5

    tokens = [t for t in re.split(r"\s+", text.strip()) if len(t) >= 2]
    score += min(len(tokens) * 2, 24)

    lower = text.lower()

    if lang_name == "Hindi":
        score += LANG_HINDI_PRIORITY_BONUS
        score += sum(2 for p in BANKING_FALLBACK_PHRASES["Hindi"] if p in lower)
        score += _hindi_roman_hint_count(text) * 6

    if lang_name == "Bengali":
        score += LANG_BENGALI_PRIORITY_BONUS
        score += sum(2 for p in BANKING_FALLBACK_PHRASES["Bengali"] if p in lower)
        # Romanized Bengali in forced-English output â†’ strong Bengali signal
        score += _bengali_roman_hint_count(text) * 6

    if lang_name == "English":
        plaus = _english_plausibility(text)
        score *= max(plaus, 0.15)
        if plaus < LANG_ENGLISH_PLAUSIBILITY_MIN:
            score -= 60
        score -= _bengali_roman_hint_count(text) * 8
        score -= _hindi_roman_hint_count(text) * 8
        score += sum(1 for p in BANKING_FALLBACK_PHRASES["English"] if p in lower)

    # Dravidian languages need real native script â€” not latin garbage
    if lang_name in DRAVIDIAN_LANGUAGES:
        native = _native_script_count(text, lang_name)
        if native < LANG_MIN_SCRIPT_CHARS:
            score -= 80
        else:
            score += native * 2

    return score


def _apply_result_guards(
    best_name: str,
    best_score: float,
    results: list[tuple[str, float, str]],
) -> str:
    """Reject weak Tamil/English guesses; prefer hi/bn/en for call-center audio.

    With regional detection on, a confidently-scored regional language (real native
    script) is allowed to win instead of being forced back to hi/bn/en.
    """
    primary = set(LANG_PRIMARY_LANGUAGES)
    if LANG_REGIONAL_DETECTION:
        primary = primary | LANG_REGIONAL_LANGUAGES

    def pick_best(candidates: set[str]) -> str | None:
        filtered = [(n, s, t) for n, s, t in results if n in candidates]
        if not filtered:
            return None
        name, score, _ = max(filtered, key=lambda x: x[1])
        return name if score > -50 else None

    # English without plausible English text â†’ hi or bn
    if best_name == "English":
        snippet = next((t for n, _, t in results if n == "English"), "")
        if _english_plausibility(snippet) < LANG_ENGLISH_PLAUSIBILITY_MIN:
            alt = pick_best({"Hindi", "Bengali"})
            if alt:
                logger.info("LID guard: rejected weak English â†’ %s", alt)
                return alt

    # Tamil/Telugu/etc without enough native script â†’ hi/bn/en
    if best_name in DRAVIDIAN_LANGUAGES:
        snippet = next((t for n, _, t in results if n == best_name), "")
        if _native_script_count(snippet, best_name) < LANG_MIN_SCRIPT_CHARS:
            alt = pick_best(primary or {"Hindi", "Bengali", "English"})
            if alt:
                logger.info(
                    "LID guard: rejected weak %s (script=%d) â†’ %s",
                    best_name,
                    _native_script_count(snippet, best_name),
                    alt,
                )
                return alt
        if LANG_CALL_CENTER_MODE:
            hi_row = next(((n, s, t) for n, s, t in results if n == "Hindi"), None)
            dr_row = next(((n, s, t) for n, s, t in results if n == best_name), None)
            if hi_row and dr_row and hi_row[1] >= dr_row[1] - 15:
                logger.info(
                    "LID guard: rejected %s (score=%.1f) — Hindi competitive (%.1f)",
                    best_name, dr_row[1], hi_row[1],
                )
                return "Hindi"

    return best_name


def _needs_script_verification(whisper_code: str, probability: float) -> bool:
    if not LANG_SCRIPT_VERIFY:
        return False
    # Never trust Whisper English on Indian call-center audio without verification
    if LANG_VERIFY_ALWAYS:
        return True
    if LANG_VERIFY_ALWAYS_FOR_ENGLISH and whisper_code == "en":
        return True
    if probability < LANG_DETECT_HIGH_CONFIDENCE:
        return True
    if LANG_VERIFY_ALWAYS_FOR_DRAVIDIAN and whisper_code in DRAVIDIAN_MISLABEL_CODES:
        return True
    if whisper_code in OTHER_MISLABEL_CODES:
        return True
    if whisper_code in ("hi", "bn"):
        return True
    return False


def _verification_candidates(whisper_code: str, all_probs: dict[str, float] | None) -> list[tuple[str, str]]:
    """Build ordered list of (iso_code, display_name) to script-verify."""
    seen: set[str] = set()
    ordered: list[tuple[str, str]] = []

    def add(code: str) -> None:
        if not code or code in seen:
            return
        name = WHISPER_CODE_TO_LANGUAGE.get(code)
        if not name:
            return
        seen.add(code)
        ordered.append((code, name))

    add("hi")
    add("bn")
    if whisper_code != "en":
        add("en")
    add(whisper_code)
    if whisper_code == "en":
        add("en")

    if not LANG_CALL_CENTER_MODE:
        if all_probs:
            for code, _prob in sorted(all_probs.items(), key=lambda x: -x[1])[:6]:
                add(code)
        for code in ("mr", "gu", "ta", "te", "kn", "ml"):
            add(code)

    return ordered


def _verify_by_script(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    whisper_code: str,
    whisper_prob: float,
    all_probs: dict[str, float] | None,
) -> str:
    candidates = _verification_candidates(whisper_code, all_probs)
    best_name = WHISPER_CODE_TO_LANGUAGE.get(whisper_code, "Unknown")
    best_score = -999.0
    results: list[tuple[str, float, str]] = []

    verify_sample, is_temp = _prepare_detection_sample(sample_path, LANG_VERIFY_SAMPLE_SEC)
    try:
        for code, name in candidates:
            try:
                text = _sample_transcribe_whisper_v3(
                    processor, model, tokenizer, verify_sample, code
                )
            except Exception as exc:
                logger.warning("Verify transcribe failed lang=%s: %s", code, exc)
                continue
            score = _score_language_from_text(text, name)
            results.append((name, score, text[:80]))
            if score > best_score:
                best_score = score
                best_name = name
    finally:
        if is_temp and verify_sample.exists():
            verify_sample.unlink(missing_ok=True)

    for name, score, snippet in results:
        logger.info("LID script verify %s score=%.1f snippet=%r", name, score, snippet)

    best_name = _apply_result_guards(best_name, best_score, results)

    if best_name != WHISPER_CODE_TO_LANGUAGE.get(whisper_code):
        logger.info(
            "Language corrected %s (whisper=%s prob=%.3f) â†’ %s (script score=%.1f)",
            WHISPER_CODE_TO_LANGUAGE.get(whisper_code, whisper_code),
            whisper_code,
            whisper_prob,
            best_name,
            best_score,
        )
    return _disambiguate_hi_bn(processor, model, tokenizer, sample_path, best_name)


def _repetition_unique_ratio(text: str) -> float:
    """Unique-word ratio. Low = repetitive garbage (often forced wrong language)."""
    tokens = [t for t in re.split(r"\s+", (text or "").strip()) if len(t) >= 2]
    if len(tokens) < 4:
        return 1.0
    return len(set(tokens)) / len(tokens)


def _effective_logprob(logprob: float, text: str) -> tuple[float, float]:
    """Apply repetition penalty to log-prob. Returns (effective_lp, unique_ratio)."""
    uniq = _repetition_unique_ratio(text)
    penalty = 0.0
    if uniq < LANG_REPETITION_MIN_UNIQUE:
        penalty = (LANG_REPETITION_MIN_UNIQUE - uniq) * 2.0 * LANG_REPETITION_PENALTY
    return logprob - penalty, uniq


def _disambiguate_hi_bn(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    candidate: str,
) -> str:
    """
    Hindi vs Bengali. Whisper's detected token (`candidate`) is trusted as the default;
    we only FLIP to the other language when its forced-transcription acoustic fit
    (avg token log-prob, penalized for repetition) clearly beats the detected one.
    Script counts CANNOT separate hi/bn (forcing a language always yields its script).
    """
    if not LANG_DISAMBIGUATE_HI_BN or candidate not in ("Hindi", "Bengali"):
        return candidate

    verify_sample, is_temp = _prepare_detection_sample(sample_path, LANG_VERIFY_SAMPLE_SEC)
    info: dict[str, dict] = {}
    try:
        for code, name in (("bn", "Bengali"), ("hi", "Hindi")):
            try:
                text, lp = _forced_transcribe_scored(
                    processor, model, tokenizer, verify_sample, code,
                    max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
                )
                script_key = "bengali" if name == "Bengali" else "devanagari"
                native = _script_counts(text).get(script_key, 0)
                eff_lp, uniq = _effective_logprob(lp, text)
                info[name] = {
                    "logprob": lp, "eff_lp": eff_lp, "uniq": uniq,
                    "native": native, "text": text,
                }
                _lid_log(
                    "hi/bn probe %s: raw_lp=%.4f eff_lp=%.4f uniq=%.2f native=%d text=%r",
                    name, lp, eff_lp, uniq, native, text[:80],
                )
            except Exception as exc:
                _lid_log("hi/bn probe failed for %s: %s", code, exc)
    finally:
        if is_temp and verify_sample.exists():
            verify_sample.unlink(missing_ok=True)

    if "Bengali" not in info or "Hindi" not in info:
        _lid_log("hi/bn: incomplete probes — keeping Whisper token %s", candidate)
        return candidate

    bn = info["Bengali"]
    hi = info["Hindi"]
    bn_valid = bn["native"] >= LANG_HI_BN_MIN_SCRIPT
    hi_valid = hi["native"] >= LANG_HI_BN_MIN_SCRIPT

    other = "Hindi" if candidate == "Bengali" else "Bengali"
    seed_info = info[candidate]
    other_info = info[other]
    other_valid = other_info["native"] >= LANG_HI_BN_MIN_SCRIPT
    seed_valid = seed_info["native"] >= LANG_HI_BN_MIN_SCRIPT

    # If the detected language couldn't even produce its own script but the other did, flip.
    if other_valid and not seed_valid:
        _lid_log(
            "hi/bn FLIP %s→%s (detected produced no valid script: %d < %d)",
            candidate, other, seed_info["native"], LANG_HI_BN_MIN_SCRIPT,
        )
        return other

    # Trust Whisper's token; flip only when the alternative clearly fits better.
    margin = other_info["eff_lp"] - seed_info["eff_lp"]
    if other_valid and margin > LANG_HI_BN_FLIP_MARGIN:
        _lid_log(
            "hi/bn FLIP %s→%s (other eff_lp=%.4f beats seed eff_lp=%.4f by %.4f > %.2f)",
            candidate, other, other_info["eff_lp"], seed_info["eff_lp"],
            margin, LANG_HI_BN_FLIP_MARGIN,
        )
        return other

    _lid_log(
        "hi/bn KEEP %s (seed eff_lp=%.4f vs other eff_lp=%.4f, margin=%.4f <= %.2f)",
        candidate, seed_info["eff_lp"], other_info["eff_lp"], margin, LANG_HI_BN_FLIP_MARGIN,
    )
    return candidate


def _verify_indic_acoustic_with_details(
    audio_path: Path,
    candidate: str,
) -> tuple[str, dict]:
    """Run the final word-independent Indic acoustic decision gate.

    Whisper/wordmatch remains the primary detector.  The acoustic worker can
    promote a regional label only on strong multi-window evidence; shadow mode,
    mixed evidence, and model failures preserve the normalized upstream result.
    """
    if not LANG_INDIC_ACOUSTIC_ENABLED:
        return candidate, {
            "enabled": False,
            "upstream": candidate,
            "final": candidate,
            "decision_source": "upstream",
            "decision_confidence": None,
        }
    try:
        from acoustic_lid_worker import verify_acoustic_language

        decision, details = verify_acoustic_language(audio_path, candidate)
        _lid_log("acoustic indic candidate=%s decision=%s details=%s",
                 candidate, decision, details)
        if decision:
            return decision, details
    except Exception as exc:
        _lid_log("acoustic indic failed (%s) — preserving %s", exc, candidate)
        return candidate, {
            "enabled": True,
            "upstream": candidate,
            "final": candidate,
            "decision_source": "upstream-error",
            "decision_confidence": None,
            "error": str(exc),
        }
    return candidate, {
        "enabled": True,
        "upstream": candidate,
        "final": candidate,
        "decision_source": "upstream",
        "decision_confidence": None,
    }


def _verify_indic_acoustic(audio_path: Path, candidate: str) -> str:
    return _verify_indic_acoustic_with_details(audio_path, candidate)[0]


def _whisper_auto_transcribe_snippet(
    processor,
    model,
    sample_path: Path,
    *,
    max_new_tokens: int = 256,
) -> str:
    """Open-ended Whisper v3 transcribe — text fed to IndicLID."""
    input_features = _input_features(processor, model, sample_path)
    with torch.inference_mode():
        generated = model.generate(input_features, max_new_tokens=max_new_tokens)
    return processor.batch_decode(generated, skip_special_tokens=True)[0].strip()


def _fallback_phrase_detection(transcription: str) -> str:
    """Banking phrase + roman hint fallback (from legacy language_detection service)."""
    lower = (transcription or "").lower()
    if len(lower) < 4:
        return "Unknown"

    shared = _ROMAN_SHARED_TERMS | {"account", "balance", "loan", "emi", "otp", "transaction", "customer"}
    best_lang = "Unknown"
    best_score = 0.0
    for language, phrases in BANKING_FALLBACK_PHRASES.items():
        score = 0.0
        for p in phrases:
            if p not in lower:
                continue
            score += 1.0 if p in shared else 2.5
        if score > best_score:
            best_score = score
            best_lang = language
    if best_score >= 2.0:
        logger.info("LID phrase fallback: %s (score=%.1f)", best_lang, best_score)
        return best_lang

    bn_roman = _bengali_roman_hint_count(transcription)
    hi_roman = _hindi_roman_hint_count(transcription)
    if bn_roman >= 2 and bn_roman > hi_roman:
        logger.info("LID roman fallback: Bengali (bn=%d hi=%d)", bn_roman, hi_roman)
        return "Bengali"
    if hi_roman >= 2 and hi_roman > bn_roman:
        logger.info("LID roman fallback: Hindi (hi=%d bn=%d)", hi_roman, bn_roman)
        return "Hindi"
    return "Unknown"


def _lid_from_text_hints(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    all_probs: dict[str, float] | None,
) -> str | None:
    """One short Whisper pass → phrase fallback + IndicLID (fast)."""
    try:
        text = _whisper_auto_transcribe_snippet(
            processor, model, sample_path, max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS
        )
    except Exception as exc:
        logger.warning("Short LID transcript failed: %s", exc)
        return None

    if not text:
        return None

    phrase = _fallback_phrase_detection(text)
    if phrase != "Unknown":
        return phrase

    if INDICLID_ENABLED:
        try:
            from indiclid_worker import indiclid_ready, predict_text_language
            if indiclid_ready():
                display, score, code, engine = predict_text_language(text)
                logger.info(
                    "IndicLID fast: %s score=%.3f code=%s engine=%s",
                    display, score, code, engine,
                )
                if display != "Unknown" and score >= INDICLID_MIN_SCORE:
                    return display
        except Exception as exc:
            logger.debug("IndicLID fast path skipped: %s", exc)

    if all_probs:
        hi_p = all_probs.get("hi", 0.0)
        bn_p = all_probs.get("bn", 0.0)
        if bn_p > hi_p and bn_p > 0.15:
            return "Bengali"
        if hi_p > bn_p and hi_p > 0.15:
            return "Hindi"
    return None


def _hi_bn_probable(lang_code: str, all_probs: dict[str, float] | None) -> bool:
    if lang_code in ("hi", "bn"):
        return True
    if not all_probs:
        return False
    hi_p = all_probs.get("hi", 0.0)
    bn_p = all_probs.get("bn", 0.0)
    return max(hi_p, bn_p) > 0.18 and (hi_p + bn_p) > 0.32


def _verify_by_script_lite(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    whisper_code: str,
    whisper_prob: float,
    all_probs: dict[str, float] | None,
) -> str:
    """hi/bn/en verify, widened with regional candidates (top-k probable + script
    siblings) so Tamil/Telugu/Kannada/Malayalam/Gujarati/Punjabi/Odia are resolved."""
    candidates = [("hi", "Hindi"), ("bn", "Bengali")]
    if whisper_code == "en" or (all_probs and all_probs.get("en", 0) > 0.25):
        candidates.append(("en", "English"))
    if whisper_code not in ("hi", "bn", "en"):
        name = WHISPER_CODE_TO_LANGUAGE.get(whisper_code)
        if name:
            candidates.append((whisper_code, name))

    # Widen to regional languages so a mislabeled regional call can still be found.
    if _regional_detection_enabled():
        if all_probs:
            for code, _p in sorted(all_probs.items(), key=lambda x: -x[1])[:LANG_VERIFY_TOPK]:
                name = WHISPER_CODE_TO_LANGUAGE.get(code)
                if name and name in LANG_REGIONAL_LANGUAGES:
                    candidates.append((code, name))
        detected_name = WHISPER_CODE_TO_LANGUAGE.get(whisper_code)
        for sib in SCRIPT_SIBLINGS.get(detected_name, ()):
            if sib in LANG_REGIONAL_LANGUAGES:
                candidates.append((language_code_for(sib), sib))

    # Dedupe by code, preserve order.
    _seen: set[str] = set()
    candidates = [(c, n) for c, n in candidates if not (c in _seen or _seen.add(c))]

    best_name = WHISPER_CODE_TO_LANGUAGE.get(whisper_code, "Unknown")
    best_score = -999.0
    results: list[tuple[str, float, str]] = []

    verify_sample, is_temp = _prepare_detection_sample(sample_path, LANG_VERIFY_SAMPLE_SEC)
    try:
        for code, name in candidates:
            try:
                text = _sample_transcribe_whisper_v3(
                    processor, model, tokenizer, verify_sample, code,
                    max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
                )
            except Exception as exc:
                logger.warning("Lite verify transcribe failed lang=%s: %s", code, exc)
                continue
            score = _score_language_from_text(text, name)
            results.append((name, score, text[:80]))
            if score > best_score:
                best_score = score
                best_name = name
    finally:
        if is_temp and verify_sample.exists():
            verify_sample.unlink(missing_ok=True)

    for name, score, snippet in results:
        logger.info("LID lite verify %s score=%.1f snippet=%r", name, score, snippet)

    best_name = _apply_result_guards(best_name, best_score, results)
    if best_name in ("Hindi", "Bengali"):
        return _disambiguate_hi_bn(processor, model, tokenizer, sample_path, best_name)
    return best_name


def _confirm_regional(
    processor,
    model,
    tokenizer,
    sample_path: Path,
    code: str,
    name: str,
) -> Optional[str]:
    """Forced-transcribe in `name` and accept it only when BOTH hold:

    1. it yields enough of its OWN native script, AND
    2. its acoustic fit (repetition-penalized avg log-prob) is not clearly worse
       than forced-Hindi on the same sample.

    (2) matters because forcing Whisper to a language ALWAYS yields that
    language's script — script presence alone is self-fulfilling and used to let
    Hindi calls be confirmed as Telugu/Tamil. Hindi is the call-center prior for
    such mislabels, so it is the acoustic reference.
    """
    verify_sample, is_temp = _prepare_detection_sample(sample_path, LANG_VERIFY_SAMPLE_SEC)
    try:
        try:
            text, lp = _forced_transcribe_scored(
                processor, model, tokenizer, verify_sample, code,
                max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
            )
        except Exception as exc:
            _lid_log("regional confirm failed for %s: %s", name, exc)
            return None

        eff_lp, uniq = _effective_logprob(lp, text)
        native = _native_script_count(text, name)
        sf = _script_first_language(text, LANG_SCRIPT_FIRST_MIN_CHARS)
        _lid_log(
            "regional confirm %s: native=%d script_first=%s eff_lp=%.4f uniq=%.2f text=%r",
            name, native, sf, eff_lp, uniq, text[:80],
        )
        if sf != name and native < LANG_SCRIPT_FIRST_MIN_CHARS:
            return None

        # Acoustic sanity vs Hindi (skip when confirming a primary language itself).
        if LANG_CALL_CENTER_MODE and name not in LANG_PRIMARY_LANGUAGES:
            try:
                hi_text, hi_lp = _forced_transcribe_scored(
                    processor, model, tokenizer, verify_sample, "hi",
                    max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
                )
                hi_eff, hi_uniq = _effective_logprob(hi_lp, hi_text)
                margin = hi_eff - eff_lp
                _lid_log(
                    "regional acoustic check %s eff_lp=%.4f vs Hindi eff_lp=%.4f "
                    "(uniq=%.2f) margin=%.4f limit=%.2f",
                    name, eff_lp, hi_eff, hi_uniq, margin, LANG_REGIONAL_ACOUSTIC_MARGIN,
                )
                if margin > LANG_REGIONAL_ACOUSTIC_MARGIN:
                    _lid_log(
                        "regional %s REJECTED — Hindi fits the audio clearly better "
                        "(likely a Whisper LID mislabel)",
                        name,
                    )
                    return None
            except Exception as exc:
                _lid_log("regional acoustic check failed (%s) — keeping %s", exc, name)

        return name
    finally:
        if is_temp and verify_sample.exists():
            verify_sample.unlink(missing_ok=True)


def _detect_language_whisper_native(audio_path: Path) -> str:
    """Whisper Large V3's built-in LID only (<|lang|> token probabilities).

    No remaps, no guards, no forced-transcribe verification. The probability
    mass is restricted to LANG_REGIONAL_LANGUAGES so impossible languages
    (for this deployment) can never win. Robustness comes from the lang
    service's multi-window vote calling this once per window.
    """
    processor, model, tokenizer = _load_transformers_whisper()
    sample_path, is_temp = _prepare_detection_sample(audio_path, LANG_DETECT_SAMPLE_SEC)
    try:
        lang_code, probability, all_probs = _whisper_v3_detect_language(
            processor, model, tokenizer, sample_path
        )
        allowed = {
            code: name
            for code, name in WHISPER_CODE_TO_LANGUAGE.items()
            if name in (
                LANG_PRIMARY_LANGUAGES
                if LANG_PRIMARY_ONLY
                else LANG_REGIONAL_LANGUAGES
            )
        }
        restricted = {c: all_probs.get(c, 0.0) for c in allowed}
        total = sum(restricted.values())
        if total <= 0:
            detected = _resolve_language(lang_code, probability)
            _lid_log("native LID: no allowed-language mass — raw token %s", detected)
            return detected

        best_code = max(restricted, key=lambda c: restricted[c])
        renorm = restricted[best_code] / total
        _lid_log(
            "native LID: %s (raw token=%r p=%.3f; allowed-renorm p=%.3f; top3=%s)",
            allowed[best_code], lang_code, probability, renorm,
            sorted(
                ((allowed[c], round(p / total, 3)) for c, p in restricted.items()),
                key=lambda x: -x[1],
            )[:3],
        )
        return allowed[best_code]
    finally:
        if is_temp and sample_path.exists():
            sample_path.unlink(missing_ok=True)


def _detect_language_fast(audio_path: Path, channel: str | None = None) -> str:
    """Fast LID: Whisper token (~1s) → hi/bn disambiguation → optional text hints."""
    processor, model, tokenizer = _load_transformers_whisper()
    sample_path, is_temp = _prepare_detection_sample(
        audio_path, LANG_DETECT_SAMPLE_SEC, channel=channel,
    )
    try:
        lang_code, probability, all_probs = _whisper_v3_detect_language(
            processor, model, tokenizer, sample_path
        )
        detected = _resolve_language(lang_code, probability)
        _lid_log(
            "fast LID: whisper code=%r prob=%.3f resolved=%s hi=%.3f bn=%.3f en=%.3f ta=%.3f te=%.3f",
            lang_code, probability, detected,
            all_probs.get("hi", 0.0), all_probs.get("bn", 0.0), all_probs.get("en", 0.0),
            all_probs.get("ta", 0.0), all_probs.get("te", 0.0),
        )

        # Urdu/Nepali Whisper tokens → Hindi immediately (Hindustani banking speech).
        if LANG_CALL_CENTER_MODE and lang_code in LANG_HINDI_CONFUSABLE_CODES:
            if LANG_MAP_URDU_TO_HINDI and lang_code == "ur":
                _lid_log("fast path: Urdu token → Hindi (Hindustani banking)")
                return "Hindi"
            if LANG_MAP_NEPALI_TO_HINDI and lang_code == "ne":
                _lid_log("fast path: Nepali token → Hindi (Hindustani banking)")
                return "Hindi"

        # Fast path: confident Hindi/Bengali token — skip heavy guard transcribes.
        # The call-level acoustic hi/mr verifier runs once at the public entry point.
        if lang_code == "hi" and probability >= LANG_FAST_PATH_HI_CONFIDENCE:
            _lid_log("fast path: confident Hindi token (p=%.3f)", probability)
            return "Hindi"
        if lang_code == "bn" and probability >= LANG_FAST_PATH_BN_CONFIDENCE:
            _lid_log("fast path: confident Bengali token (p=%.3f)", probability)
            return "Bengali"

        # Bengali guard (runs FIRST): Bengali banking calls often get forced-English
        # romanization full of account/balance/please — legacy AI/src used multi-chunk
        # voting + phrase fallback to keep these as Bengali.
        if LANG_BENGALI_GUARD_ENABLED and _bengali_guard_eligible(lang_code, all_probs):
            if _bengali_guard_confirms(processor, model, tokenizer, sample_path, all_probs):
                disambig = _disambiguate_hi_bn(
                    processor, model, tokenizer, sample_path, "Bengali",
                )
                _lid_log("Bengali guard final result: %s", disambig)
                return disambig

        # Hindi guard: blocks Hindi mislabeled as Telugu/Tamil/Kannada/Malayalam.
        if LANG_HINDI_GUARD_ENABLED and _hindi_guard_eligible(lang_code, all_probs):
            if _hindi_guard_confirms(processor, model, tokenizer, sample_path, all_probs):
                disambig = _disambiguate_hi_bn(
                    processor, model, tokenizer, sample_path, "Hindi",
                )
                _lid_log("Hindi guard final result: %s", disambig)
                return disambig

        # English guard: only when English actually leads the probability mass.
        en_prob = all_probs.get("en", 0.0)
        if LANG_ENGLISH_GUARD_ENABLED and _english_guard_eligible(lang_code, all_probs):
            if _english_guard_confirms(processor, model, tokenizer, sample_path):
                _lid_log(
                    "English guard confirmed English (code=%r en_prob=%.3f) — skipping hi/bn remap",
                    lang_code, en_prob,
                )
                return "English"

        # Bengali vs Hindi — highest priority for call-center (fixes BN mislabeled as HI)
        if _hi_bn_probable(lang_code, all_probs):
            seed = "Bengali" if all_probs.get("bn", 0) >= all_probs.get("hi", 0) else "Hindi"
            if lang_code == "bn":
                seed = "Bengali"
            elif lang_code == "hi":
                seed = "Hindi"
            disambig = _disambiguate_hi_bn(processor, model, tokenizer, sample_path, seed)
            _lid_log("hi/bn final result: %s (seed=%s)", disambig, seed)
            return disambig

        # Hindi mislabeled as Urdu/Nepali — same spoken language (Hindustani).
        # In a Hindi/Bengali/English call center, re-probe via hi/bn seeded as Hindi.
        if (
            LANG_CALL_CENTER_MODE
            and lang_code in LANG_HINDI_CONFUSABLE_CODES
            and detected not in LANG_PRIMARY_LANGUAGES
        ):
            _lid_log(
                "call-center remap: Whisper code=%r (%s) is Hindustani-confusable — "
                "re-probing hi/bn seeded as Hindi",
                lang_code, detected,
            )
            disambig = _disambiguate_hi_bn(processor, model, tokenizer, sample_path, "Hindi")
            _lid_log("hi/bn final result: %s (seed=Hindi, was %s)", disambig, detected)
            return disambig

        # Whisper top=Tamil/Telugu/... on Hindi banking audio — force hi/bn re-probe.
        dravidian_fix = _dravidian_mislabel_to_hindi(
            processor, model, tokenizer, sample_path, lang_code, detected, all_probs,
        )
        if dravidian_fix:
            _lid_log("Dravidian mislabel guard final: %s (was %s)", dravidian_fix, detected)
            return dravidian_fix

        # Regional unique-script languages (Tamil/Telugu/...): only when enabled for
        # this deployment (LANG_PRIMARY_ONLY=false).
        if (
            _regional_detection_enabled()
            and detected in UNIQUE_SCRIPT_TO_LANGUAGE.values()
            and detected in LANG_REGIONAL_LANGUAGES
        ):
            confirmed = _confirm_regional(
                processor, model, tokenizer, sample_path, lang_code, detected
            )
            if confirmed:
                _lid_log("regional direct: %s confirmed by native script", confirmed)
                return confirmed
            _lid_log("regional %s not confirmed — widening verification", detected)

        if probability < LANG_DETECT_HIGH_CONFIDENCE or detected in ("Unknown", "English"):
            alt = _lid_from_text_hints(processor, model, tokenizer, sample_path, all_probs)
            if alt and alt != "Unknown":
                if alt in ("Hindi", "Bengali"):
                    return _disambiguate_hi_bn(processor, model, tokenizer, sample_path, alt)
                return alt

        if _needs_script_verification(lang_code, probability):
            return _verify_by_script_lite(
                processor, model, tokenizer, sample_path, lang_code, probability, all_probs
            )

        return detected
    finally:
        if is_temp and sample_path.exists():
            sample_path.unlink(missing_ok=True)


def _score_lid_transcript(text: str, lang_name: str) -> float:
    """Score a forced-transcribe snippet for LID probe voting."""
    if not (text or "").strip():
        return 0.0
    score = float(_native_script_count(text, lang_name)) * 2.0
    if lang_name == "Hindi":
        score += _hindi_roman_hint_count(text) * 3.0
        if "namaskar" in text.lower() or "namaste" in text.lower():
            score += 4.0
    elif lang_name == "Bengali":
        score += _bengali_roman_hint_count(text) * 3.0
    elif lang_name == "English":
        score += _english_plausibility(text) * 10.0
        score += _english_word_ratio_strict(text) * 8.0
    if _fallback_phrase_detection(text) == lang_name:
        score += 5.0
    if INDICLID_ENABLED:
        try:
            from indiclid_worker import indiclid_ready, predict_text_language
            if indiclid_ready():
                display, il_score, _, _ = predict_text_language(text)
                if display == lang_name and il_score >= INDICLID_MIN_SCORE:
                    score += il_score * 6.0
        except Exception:
            pass
    return score


def _detect_language_indiclid_first(audio_path: Path) -> str | None:
    """Whisper short snippets on agent channel → IndicLID text classifier."""
    if not INDICLID_ENABLED:
        return None
    try:
        from indiclid_worker import indiclid_ready, predict_text_language
        if not indiclid_ready():
            return None
    except Exception:
        return None

    processor, model, tokenizer = _load_transformers_whisper()
    sample_path, is_temp = _prepare_detection_sample(
        audio_path, LANG_DETECT_SAMPLE_SEC, channel="agent",
    )
    try:
        best_lang: str | None = None
        best_score = 0.0
        for code, lang_name in (("hi", "Hindi"), ("bn", "Bengali"), ("en", "English")):
            try:
                text = _sample_transcribe_whisper_v3(
                    processor, model, tokenizer, sample_path, code,
                    max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
                )
            except Exception as exc:
                _lid_log("IndicLID-first transcribe %s failed: %s", code, exc)
                continue
            if not text:
                continue
            display, score, _, engine = predict_text_language(text)
            _lid_log(
                "IndicLID-first forced-%s: display=%s score=%.3f engine=%s text=%r",
                code, display, score, engine, text[:70],
            )
            if display != "Unknown" and score >= INDICLID_MIN_SCORE and score > best_score:
                best_score = score
                best_lang = display
        return best_lang
    finally:
        if is_temp and sample_path.exists():
            sample_path.unlink(missing_ok=True)


def _detect_language_seamless_probe(audio_path: Path) -> str | None:
    """Probe ai-seamless with forced Hindi/Bengali/English; pick best-scoring transcript."""
    if not SEAMLESS_LID_ENABLED:
        return None
    try:
        from seamless_lid_client import probe_transcribe_remote, seamless_service_health
        health = seamless_service_health()
        if not health.get("ready"):
            _lid_log("Seamless LID skipped — service not ready: %s", health.get("error"))
            return None
    except Exception as exc:
        _lid_log("Seamless LID import/health failed: %s", exc)
        return None

    sample_path, is_temp = _prepare_detection_sample(
        audio_path, SEAMLESS_LID_SAMPLE_SEC, channel="agent",
    )
    try:
        best_lang: str | None = None
        best_score = -1.0
        for lang in SEAMLESS_LID_PROBE_LANGUAGES:
            try:
                text = probe_transcribe_remote(sample_path, lang, audio_path.stem)
                score = _score_lid_transcript(text, lang)
                _lid_log("Seamless LID probe %s score=%.1f text=%r", lang, score, text[:70])
                if score > best_score:
                    best_score = score
                    best_lang = lang
            except Exception as exc:
                _lid_log("Seamless LID probe %s failed: %s", lang, exc)
        if best_lang and best_score >= 3.0:
            _lid_log("Seamless LID winner: %s (score=%.1f)", best_lang, best_score)
            return best_lang
        return None
    finally:
        if is_temp and sample_path.exists():
            sample_path.unlink(missing_ok=True)


def _detect_language_multi_channel(audio_path: Path, *, include_mix: bool = True) -> str:
    """Run Whisper LID on agent + customer (+ optional mix); agent weighted highest."""
    channel_weights: tuple[tuple[str, float], ...] = (
        ("agent", 2.5),
        ("customer", 1.0),
    )
    if include_mix:
        channel_weights = channel_weights + (("mix", 0.5),)
    scores: dict[str, float] = defaultdict(float)
    for ch, weight in channel_weights:
        try:
            lang = _detect_language_fast(audio_path, channel=ch)
            scores[lang] += weight
            _lid_log("multi-channel %s → %s (weight=%.1f)", ch, lang, weight)
        except Exception as exc:
            _lid_log("multi-channel %s failed: %s", ch, exc)
    if not scores:
        return _detect_language_fast(audio_path)
    winner = max(scores, key=lambda k: scores[k])
    _lid_log("multi-channel winner: %s scores=%s", winner, dict(scores))
    return winner


def _detect_language_ensemble_fast(audio_path: Path) -> str:
    """GPU-friendly LID: agent channel first; expand only when ambiguous."""
    agent_lang = _detect_language_fast(audio_path, channel="agent")
    if agent_lang in ("Hindi", "Bengali", "Marathi"):
        _lid_log("fast ensemble: agent Indic → %s (skip slow probes)", agent_lang)
        return agent_lang

    if agent_lang == "English":
        cust_lang = _detect_language_fast(audio_path, channel="customer")
        if cust_lang in ("Hindi", "Bengali"):
            _lid_log(
                "fast ensemble: customer %s overrides agent English (Hinglish call)",
                cust_lang,
            )
            return cust_lang
        if cust_lang == "English":
            _lid_log("fast ensemble: agent+customer English")
            return "English"

    # Ambiguous — agent+customer vote only (no mix channel, no Seamless unless still tied).
    if LANG_DETECT_MULTI_CHANNEL:
        whisper_lang = _detect_language_multi_channel(audio_path, include_mix=False)
    else:
        whisper_lang = agent_lang

    if whisper_lang in ("Hindi", "Bengali", "Marathi"):
        _lid_log("fast ensemble: two-channel vote → %s", whisper_lang)
        return whisper_lang
    if whisper_lang in ("Urdu", "Nepali"):
        mapped = _normalize_call_center_language(whisper_lang)
        _lid_log("fast ensemble: %s → %s", whisper_lang, mapped)
        return mapped
    if whisper_lang == "English" and agent_lang in ("Hindi", "Bengali", "Marathi"):
        return agent_lang

    if whisper_lang not in ("Unknown", "English"):
        return whisper_lang

    if INDICLID_ENABLED:
        indic_lang = _detect_language_indiclid_first(audio_path)
        if indic_lang and indic_lang != "Unknown":
            _lid_log("fast ensemble: IndicLID fallback → %s", indic_lang)
            return indic_lang

    if SEAMLESS_LID_ENABLED:
        seamless_lang = _detect_language_seamless_probe(audio_path)
        if seamless_lang:
            _lid_log("fast ensemble: Seamless fallback → %s", seamless_lang)
            return seamless_lang

    fallback = agent_lang if agent_lang != "Unknown" else whisper_lang
    return fallback if fallback != "Unknown" else "Hindi"


def _ensemble_tiebreak(scores: dict[str, float]) -> str:
    """Prefer Indic over English when votes are close (common on Hinglish calls)."""
    if not scores:
        return "Hindi"
    winner = max(scores, key=lambda k: scores[k])
    en_score = scores.get("English", 0.0)
    hi_score = scores.get("Hindi", 0.0)
    bn_score = scores.get("Bengali", 0.0)
    indic_best = max(hi_score, bn_score)
    if winner == "English" and indic_best > 0 and (en_score - indic_best) < 1.5:
        indic_winner = "Hindi" if hi_score >= bn_score else "Bengali"
        _lid_log(
            "ensemble tiebreak: English=%.1f vs Indic=%.1f → %s",
            en_score, indic_best, indic_winner,
        )
        return indic_winner
    return winner


def _detect_language_ensemble(audio_path: Path) -> str:
    """Vote across Whisper, IndicLID, and Seamless — fast mode skips slow probes when clear."""
    if LANG_LID_FAST_MODE:
        return _detect_language_ensemble_fast(audio_path)

    scores: dict[str, float] = defaultdict(float)

    if LANG_DETECT_MULTI_CHANNEL:
        whisper_lang = _detect_language_multi_channel(audio_path)
    else:
        whisper_lang = _detect_language_fast(audio_path)
    scores[whisper_lang] += 3.0
    _lid_log("ensemble whisper → %s (+3.0)", whisper_lang)

    indic_lang = _detect_language_indiclid_first(audio_path)
    if indic_lang:
        scores[indic_lang] += 2.0
        _lid_log("ensemble indiclid → %s (+2.0)", indic_lang)

    seamless_lang = _detect_language_seamless_probe(audio_path)
    if seamless_lang:
        scores[seamless_lang] += 2.5
        _lid_log("ensemble seamless → %s (+2.5)", seamless_lang)

    winner = _ensemble_tiebreak(scores)
    _lid_log("ensemble final: %s (scores=%s)", winner, dict(scores))
    return _normalize_call_center_language(winner)


def _restricted_probs(all_probs: dict[str, float]) -> dict[str, float]:
    """Fold confusable-language mass into the deployment languages and renormalize.

    Only LANG_PRIMARY_LANGUAGES can appear in the result, so mislabels like
    Tamil/Telugu/Kannada simply lose their probability mass instead of winning.
    Urdu/Nepali mass counts toward Hindi (same spoken language, Hindustani);
    Assamese mass counts toward Bengali (same script, close acoustics).
    """
    out: dict[str, float] = {}
    if "Hindi" in LANG_PRIMARY_LANGUAGES:
        hi = all_probs.get("hi", 0.0)
        hi += sum(all_probs.get(c, 0.0) for c in LANG_HINDI_CONFUSABLE_CODES)
        out["Hindi"] = hi
    if "Bengali" in LANG_PRIMARY_LANGUAGES:
        bn = all_probs.get("bn", 0.0)
        if LANG_MAP_ASSAMESE_TO_BENGALI:
            bn += all_probs.get("as", 0.0)
        out["Bengali"] = bn
    if "English" in LANG_PRIMARY_LANGUAGES:
        out["English"] = all_probs.get("en", 0.0)
    for name in LANG_PRIMARY_LANGUAGES:
        if name not in out:
            out[name] = all_probs.get(language_code_for(name), 0.0)

    total = sum(out.values())
    if total <= 0:
        return {k: 1.0 / len(out) for k in out} if out else {}
    return {k: v / total for k, v in out.items()}


def _detect_language_restricted(audio_path: Path, channel: str | None = None) -> str:
    """Closed-set LID — the result is ALWAYS one of LANG_PRIMARY_LANGUAGES.

    Whisper's open-set LID mislabels Indic telephone audio as Tamil/Telugu/
    Assamese/Urdu/etc. Instead of patching each mislabel after the fact, the
    decision space is restricted up front:

      1. Whisper LID probabilities are folded (ur/ne→hi, as→bn) and
         renormalized over the deployment languages only.
      2. An English winner must survive the strict English guard (forced-en
         transcript must look like real English, not romanized Indic).
      3. A Hindi/Bengali winner below the confidence gate is settled by the
         forced-decode acoustic probe (_disambiguate_hi_bn).
    """
    processor, model, tokenizer = _load_transformers_whisper()
    sample_path, is_temp = _prepare_detection_sample(
        audio_path, LANG_DETECT_SAMPLE_SEC, channel=channel,
    )
    try:
        lang_code, probability, all_probs = _whisper_v3_detect_language(
            processor, model, tokenizer, sample_path
        )
        rprobs = _restricted_probs(all_probs or {})
        if not rprobs:
            return _resolve_language(lang_code, probability)

        best = max(rprobs, key=lambda k: rprobs[k])
        best_p = rprobs[best]
        _lid_log(
            "restricted LID: raw=%r p=%.3f → %s %s",
            lang_code, probability, best,
            {k: round(v, 3) for k, v in sorted(rprobs.items(), key=lambda x: -x[1])},
        )

        if best == "English":
            indic = [k for k in rprobs if k != "English"]
            # Overwhelming English mass on the raw token too — trust it directly.
            if best_p >= 0.92 and lang_code == "en" and probability >= 0.80:
                _lid_log("restricted: overwhelming English (renorm=%.3f raw=%.3f)", best_p, probability)
                return "English"
            if not indic:
                return "English"
            if _english_guard_confirms(processor, model, tokenizer, sample_path):
                return "English"
            best = max(indic, key=lambda k: rprobs[k])
            best_p = rprobs[best]
            _lid_log("restricted: English rejected by guard → %s (p=%.3f)", best, best_p)

        if best in ("Hindi", "Bengali"):
            other = "Bengali" if best == "Hindi" else "Hindi"
            other_p = rprobs.get(other, 0.0)
            if other_p <= 0.0:
                return best
            if best_p >= LANG_RESTRICTED_CONFIDENT and other_p < best_p * 0.5:
                _lid_log("restricted: confident %s (p=%.3f vs %s=%.3f)", best, best_p, other, other_p)
                return best
            result = _disambiguate_hi_bn(processor, model, tokenizer, sample_path, best)
            _lid_log("restricted: hi/bn probe → %s (seed=%s)", result, best)
            return result

        return best
    finally:
        if is_temp and sample_path.exists():
            sample_path.unlink(missing_ok=True)


def _sample_transcribe_auto(audio_path: Path, *, max_new_tokens: int = 110) -> str:
    """Whisper v3 AUTO-mode transcribe — decoder picks the language itself and
    writes in that language's native script. This is far more reliable on
    telephone audio than the <|lang|> token probabilities (which are noise),
    because the decoder conditions on the full audio while generating."""
    processor, model, tokenizer = _load_transformers_whisper()
    input_features = _input_features(processor, model, audio_path)
    with torch.inference_mode():
        generated = model.generate(
            input_features,
            task="transcribe",
            max_new_tokens=max_new_tokens,
        )
    return processor.batch_decode(generated, skip_special_tokens=True)[0].strip()


def _detect_language_wordmatch(audio_path: Path) -> str:
    """Word-match LID (legacy AI/src idea): transcribe first agent+customer
    chunks, score per-language word dictionaries, max match wins. Falls back
    to the restricted backend when there is not enough word evidence."""
    from wordmatch_lid import detect_language_wordmatch

    processor, model, tokenizer = _load_transformers_whisper()

    def _forced(path: Path, code: str) -> str:
        return _sample_transcribe_whisper_v3(
            processor, model, tokenizer, path, code,
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )

    try:
        result, _debug = detect_language_wordmatch(
            audio_path, _sample_transcribe_auto, _forced,
        )
    except Exception as exc:
        _lid_log("wordmatch backend failed (%s) — restricted fallback", exc)
        return _detect_language_restricted(audio_path)

    if result and result != "Unknown":
        return result
    _lid_log("wordmatch inconclusive — restricted fallback")
    return _detect_language_restricted(audio_path)


def detect_language_upstream(audio_path: Path, max_seconds: int = 30) -> str:
    """Run the existing Whisper/wordmatch pipeline without acoustic promotion."""
    if LANG_DETECT_MODE == "whisper-native":
        result = _detect_language_whisper_native(audio_path)
    else:
        backend = LANG_LID_BACKEND
        if backend == "wordmatch":
            result = _detect_language_wordmatch(audio_path)
        elif backend == "restricted":
            result = _detect_language_restricted(audio_path)
        elif backend == "ensemble":
            result = _detect_language_ensemble(audio_path)
        elif backend == "seamless":
            result = _detect_language_seamless_probe(audio_path) or _detect_language_fast(audio_path)
        elif backend == "indiclid":
            result = _detect_language_indiclid_first(audio_path) or _detect_language_fast(audio_path)
        elif backend == "whisper":
            if LANG_DETECT_MULTI_CHANNEL:
                result = _detect_language_multi_channel(audio_path)
            else:
                result = _detect_language_fast(audio_path)
        else:
            result = _detect_language_fast(audio_path)

    return _normalize_call_center_language(result)


def finalize_language_acoustically(audio_path: Path, candidate: str) -> str:
    """Apply the final call-level acoustic gate without post-decision remaps."""
    return _verify_indic_acoustic(audio_path, candidate)


def finalize_language_acoustically_with_details(
    audio_path: Path,
    candidate: str,
) -> tuple[str, dict]:
    """Apply the final acoustic gate and return auditable decision metadata."""
    return _verify_indic_acoustic_with_details(audio_path, candidate)


def detect_language(audio_path: Path, max_seconds: int = 30) -> str:
    """LID entry point with a final whole-audio Indic acoustic decision."""
    result = detect_language_upstream(audio_path, max_seconds=max_seconds)
    # Deliberately do not normalize again after this call.  A decisive acoustic
    # Assamese/Nepali/Urdu winner must bypass the upstream call-center folds.
    return finalize_language_acoustically(audio_path, result)


def release_language_model() -> None:
    global _tw_processor, _tw_model, _tw_tokenizer
    _tw_processor = None
    _tw_model = None
    _tw_tokenizer = None


def language_health() -> dict:
    indic = {}
    try:
        from indiclid_worker import indiclid_health
        indic = indiclid_health()
    except Exception as exc:
        indic = {"ready": False, "error": str(exc)}

    seamless = {}
    try:
        from seamless_lid_client import seamless_service_health
        seamless = seamless_service_health()
    except Exception as exc:
        seamless = {"ready": False, "error": str(exc)}

    acoustic_indic = {}
    try:
        from acoustic_lid_worker import acoustic_lid_health
        acoustic_indic = acoustic_lid_health()
    except Exception as exc:
        acoustic_indic = {"ready": False, "error": str(exc)}

    try:
        _load_transformers_whisper()
        method = f"lid-{LANG_LID_BACKEND}"
        if LANG_LID_BACKEND == "wordmatch":
            method = "wordmatch(agent+customer chunks, 12-language dictionaries)"
        if LANG_LID_BACKEND == "restricted":
            method = "whisper-v3-restricted({})".format(
                "/".join(sorted(LANG_PRIMARY_LANGUAGES))
            )
        if LANG_LID_BACKEND == "ensemble":
            parts = ["whisper-v3"]
            if LANG_DETECT_MULTI_CHANNEL:
                parts.append("multi-channel")
            if indic.get("ready"):
                parts.append("indiclid")
            if SEAMLESS_LID_ENABLED and seamless.get("ready"):
                parts.append("seamless-probe")
            method = "+".join(parts)
        return {
            "ready": True,
            "method": method,
            "lid_backend": LANG_LID_BACKEND,
            "lid_fast_mode": LANG_LID_FAST_MODE,
            "multi_channel": LANG_DETECT_MULTI_CHANNEL,
            "seamless_lid": SEAMLESS_LID_ENABLED,
            "model_path": str(WHISPER_LANG_MODEL_PATH),
            "device": _tw_device(),
            "indiclid": indic,
            "seamless": seamless,
            "acoustic_indic": acoustic_indic,
            # Temporary compatibility key for older health consumers.
            "acoustic_hi_mr": acoustic_indic,
            "supported_languages": list(WHISPER_CODE_TO_LANGUAGE.values()),
            "script_verify": LANG_SCRIPT_VERIFY,
            "verify_always": LANG_VERIFY_ALWAYS,
            "call_center_mode": LANG_CALL_CENTER_MODE,
            "marathi_detection": LANG_INDIC_ACOUSTIC_ENABLED,
            "indic_acoustic_detection": LANG_INDIC_ACOUSTIC_ENABLED,
            "regional_detection": LANG_REGIONAL_DETECTION,
            "regional_languages": sorted(LANG_REGIONAL_LANGUAGES),
            "primary_languages": sorted(LANG_PRIMARY_LANGUAGES),
            "detect_sample_sec": LANG_DETECT_SAMPLE_SEC,
            "verify_sample_sec": LANG_VERIFY_SAMPLE_SEC,
            "min_script_chars": LANG_MIN_SCRIPT_CHARS,
            "detect_channel": LANG_DETECT_CHANNEL,
            "note": "Ensemble LID: Whisper v3 + agent-weighted multi-channel + IndicLID + Seamless probe",
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc), "method": "none"}
