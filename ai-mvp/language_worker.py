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
from pathlib import Path
from typing import Optional

import torch
import torchaudio

from audio_io import load_audio, save_audio
from config import (
    LANG_BENGALI_PRIORITY_BONUS,
    LANG_CALL_CENTER_MODE,
    LANG_HINDI_CONFUSABLE_CODES,
    LANG_DETECT_CONFIDENCE_MIN,
    LANG_DETECT_HIGH_CONFIDENCE,
    LANG_DETECT_SAMPLE_SEC,
    LANG_DISAMBIGUATE_HI_BN,
    LANG_ENGLISH_PLAUSIBILITY_MIN,
    LANG_HINDI_PRIORITY_BONUS,
    LANG_MIN_SCRIPT_CHARS,
    LANG_PRIMARY_LANGUAGES,
    LANG_SCRIPT_VERIFY,
    LANG_VERIFY_ALWAYS,
    LANG_VERIFY_ALWAYS_FOR_DRAVIDIAN,
    LANG_VERIFY_ALWAYS_FOR_ENGLISH,
    LANG_VERIFY_SAMPLE_SEC,
    INDICLID_ENABLED,
    INDICLID_MIN_SCORE,
    LANG_LID_MAX_TRANSCRIPT_TOKENS,
    LANG_DETECT_CHANNEL,
    LANG_DETECT_AGENT_CHANNEL_INDEX,
    LANG_DETECT_CUSTOMER_CHANNEL_INDEX,
    LANG_DETECT_VOICE_TRIM,
    LANG_HI_BN_FLIP_MARGIN,
    LANG_HI_BN_MIN_SCRIPT,
    LANG_REPETITION_MIN_UNIQUE,
    LANG_REPETITION_PENALTY,
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
    print(f"[LID] {text}", flush=True)
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
        "namaskar", "nomoshkar", "dhonnobad", "dhanyabad", "apni", "apnar", "amar", "ami",
        "kemon", "achhen", "ache", "balance", "balence", "balese", "account", "ekhane",
        "bank", "benk", "loan", "transaction", "customer", "shubho", "bolchi", "bolun",
        "sunun", "korben", "korte", "hoyeche", "janaben", "dukhito",
    ],
}

# Romanized Hindi tokens when Whisper forced to English on Hindi audio
HINDI_ROMAN_HINTS = frozenset({
    "aap", "aapka", "aapki", "aapke", "main", "mera", "meri", "kya", "kaise",
    "kripya", "dhanyawad", "dhanyavad", "shukriya", "namaste", "ji", "haan",
    "nahin", "nahi", "theek", "thik", "sir", "madam", "ji", "bataiye", "bataye",
    "samajh", "samjha", "problem", "account", "balance", "bank", "loan", "emi",
    "otp", "transaction", "customer", "madam", "sahab",
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
    "ami", "apni", "apnar", "amader", "apnader", "kemon", "achhen", "ache",
    "hoyeche", "hobe", "korte", "korben", "janai", "bolchi", "bolben", "sunun",
    "dhonnobad", "namaskar", "shubho", "bank", "benk", "balese", "balence",
    "ekhane", "ekhan", "samasy", "dukhito", "janaben", "bolun", "thik",
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


def _select_lid_channel(waveform: torch.Tensor) -> torch.Tensor:
    """Pick the customer channel for stereo calls; else mono mix."""
    channels = waveform.shape[0]
    if channels < 2:
        return waveform[:1]

    if LANG_DETECT_CHANNEL == "agent":
        idx = LANG_DETECT_AGENT_CHANNEL_INDEX
    elif LANG_DETECT_CHANNEL in ("mix", "mono"):
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


def _prepare_detection_sample(audio_path: Path, max_seconds: float) -> tuple[Path, bool]:
    """Build mono 16 kHz LID sample from the customer channel, voiced-trimmed."""
    waveform, sample_rate = load_audio(audio_path)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000

    orig_channels = waveform.shape[0]
    waveform = _select_lid_channel(waveform)

    if LANG_DETECT_VOICE_TRIM:
        waveform = _voiced_segment(waveform, sample_rate, max_seconds)
    else:
        max_samples = int(max_seconds * sample_rate)
        if waveform.shape[1] > max_samples:
            waveform = waveform[:, :max_samples]

    _lid_log(
        "sample: channels=%d pick=%s dur=%.1fs voice_trim=%s",
        orig_channels, LANG_DETECT_CHANNEL, waveform.shape[1] / sample_rate,
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
        _tw_processor = WhisperProcessor.from_pretrained(path)
        _tw_model = WhisperForConditionalGeneration.from_pretrained(path)
        if _tw_device() == "cpu":
            _tw_model = _tw_model.float()
        _tw_model = _tw_model.to(_tw_device())
        _tw_model.eval()
        _tw_tokenizer = WhisperTokenizer.from_pretrained(path)
        logger.info("Whisper Large V3 LID loaded from %s on %s", path, _tw_device())
        return _tw_processor, _tw_model, _tw_tokenizer
    except Exception as exc:
        _tw_load_error = f"Failed to load Whisper Large V3: {exc}"
        raise RuntimeError(_tw_load_error) from exc


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
    return inputs.input_features.to(model.device)


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


def _resolve_language(code: str, probability: float = 1.0) -> str:
    lang = WHISPER_CODE_TO_LANGUAGE.get(code)
    if lang:
        return lang
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

    best_lang = "Unknown"
    best_hits = 0
    for language, phrases in BANKING_FALLBACK_PHRASES.items():
        hits = sum(1 for p in phrases if p in lower)
        if hits > best_hits:
            best_hits = hits
            best_lang = language
    if best_hits >= 2:
        logger.info("LID phrase fallback: %s (hits=%d)", best_lang, best_hits)
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
    if LANG_REGIONAL_DETECTION:
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
    """Forced-transcribe in `name`; accept it only if it yields enough of its OWN
    native script. Reliable for unique-script regional languages."""
    verify_sample, is_temp = _prepare_detection_sample(sample_path, LANG_VERIFY_SAMPLE_SEC)
    try:
        text = _sample_transcribe_whisper_v3(
            processor, model, tokenizer, verify_sample, code,
            max_new_tokens=LANG_LID_MAX_TRANSCRIPT_TOKENS,
        )
    except Exception as exc:
        _lid_log("regional confirm failed for %s: %s", name, exc)
        return None
    finally:
        if is_temp and verify_sample.exists():
            verify_sample.unlink(missing_ok=True)

    native = _native_script_count(text, name)
    sf = _script_first_language(text, LANG_SCRIPT_FIRST_MIN_CHARS)
    _lid_log("regional confirm %s: native=%d script_first=%s text=%r", name, native, sf, text[:80])
    # Accept when the detected language's own script dominates the transcription.
    if sf == name or native >= LANG_SCRIPT_FIRST_MIN_CHARS:
        return name
    return None


def _detect_language_fast(audio_path: Path) -> str:
    """Fast LID: Whisper token (~1s) → hi/bn disambiguation → optional text hints."""
    processor, model, tokenizer = _load_transformers_whisper()
    sample_path, is_temp = _prepare_detection_sample(audio_path, LANG_DETECT_SAMPLE_SEC)
    try:
        lang_code, probability, all_probs = _whisper_v3_detect_language(
            processor, model, tokenizer, sample_path
        )
        detected = _resolve_language(lang_code, probability)
        _lid_log(
            "fast LID: whisper code=%r prob=%.3f resolved=%s hi=%.3f bn=%.3f en=%.3f",
            lang_code, probability, detected,
            all_probs.get("hi", 0.0), all_probs.get("bn", 0.0), all_probs.get("en", 0.0),
        )

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

        # Regional unique-script languages (Tamil/Telugu/Kannada/Malayalam/Gujarati/
        # Punjabi/Odia): confirm the Whisper guess directly via forced-transcribe +
        # native-script check. This wins before the call-center guard can drop it.
        if (
            LANG_REGIONAL_DETECTION
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


def detect_language(audio_path: Path, max_seconds: int = 30) -> str:
    """Fast LID: Whisper token + hi/bn script disambiguation + text hints."""
    return _detect_language_fast(audio_path)


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

    try:
        _load_transformers_whisper()
        method = "whisper-v3-fast+indiclid-hints" if indic.get("ready") else "whisper-v3-fast-lid"
        return {
            "ready": True,
            "method": method,
            "model_path": str(WHISPER_LANG_MODEL_PATH),
            "device": _tw_device(),
            "indiclid": indic,
            "supported_languages": list(WHISPER_CODE_TO_LANGUAGE.values()),
            "script_verify": LANG_SCRIPT_VERIFY,
            "verify_always": LANG_VERIFY_ALWAYS,
            "call_center_mode": LANG_CALL_CENTER_MODE,
            "regional_detection": LANG_REGIONAL_DETECTION,
            "regional_languages": sorted(LANG_REGIONAL_LANGUAGES),
            "primary_languages": sorted(LANG_PRIMARY_LANGUAGES),
            "detect_sample_sec": LANG_DETECT_SAMPLE_SEC,
            "verify_sample_sec": LANG_VERIFY_SAMPLE_SEC,
            "min_script_chars": LANG_MIN_SCRIPT_CHARS,
            "note": "Fast Whisper LID token; hi/bn script disambiguation; IndicLID on one short snippet",
        }
    except Exception as exc:
        return {"ready": False, "error": str(exc), "method": "none"}

    """Run Whisper LID; prefer detect_language() for full probability table when available."""
    all_probs: dict[str, float] | None = None
    lang_code = ""
    probability = 0.0
