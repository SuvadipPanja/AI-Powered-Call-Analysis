"""LLM post-correction of native-language ASR transcripts.

Runs AFTER transcription and BEFORE translation. Sends the diarized native
transcript to the LLM (Llama via the OpenAI-compatible backend) to fix obvious
speech-to-text errors in-script. Conservative by design: on any failure it
returns the original transcript unchanged, so it can never make things worse
than the raw ASR output.
"""

from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher

from config import (
    TRANSCRIPT_CLEANUP_CONTEXT_MIN_SIMILARITY,
    TRANSCRIPT_CLEANUP_ENABLED,
    TRANSCRIPT_CLEANUP_ENTITY_MIN_SIMILARITY,
    TRANSCRIPT_CLEANUP_FULL_CALL_MAX_LINES,
    TRANSCRIPT_CLEANUP_LANGUAGES,
    TRANSCRIPT_CLEANUP_MIN_SIMILARITY,
)
from llm_utils import is_meta_line, strip_llm_thinking
from prompts.transcript_cleanup import (
    CLEANUP_BATCH_SIZE,
    CLEANUP_FULL_CALL_MAX_LINES,
    cleanup_batch_prompt,
    cleanup_system_prompt,
)
from scoring_worker import ollama_generate

logger = logging.getLogger(__name__)

LINE_RE = re.compile(r"^(\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:)(.*)$")
SPEAKER_RE = re.compile(r"\(([^)]+)\)")
_BN_RE = re.compile(r"[\u0980-\u09FF]")
_HI_RE = re.compile(r"[\u0900-\u097F]")
_WORD_RE = re.compile(r"\w+", flags=re.UNICODE)
_STOP = frozenset({
    "a", "an", "the", "i", "you", "we", "he", "she", "it", "they", "my", "your",
    "is", "are", "was", "were", "am", "be", "to", "of", "in", "on", "at", "for",
    "and", "or", "but", "so", "if", "that", "this", "yes", "no", "ok", "okay",
    "sir", "madam", "please", "thank", "thanks", "hello", "hi", "may", "can",
    "me", "know", "tell", "want", "like", "as", "do", "did", "have", "has",
})
_MONTHS = (
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
)
_DATE_NORM_RE = re.compile(
    r"\b\d{1,2}\s+(?:"
    + "|".join(_MONTHS)
    + r")\s+\d{2,4}\b",
    re.I,
)
_DECIMAL_RUPEE_RE = re.compile(r"\d+\.\d{2}\s*rupees?", re.I)
_INDIAN_AMOUNT_RE = re.compile(r"[₹]?\d{1,2}(?:,\d{2})+(?:\s*rupees?)?", re.I)
_SPELL_NUM_RE = re.compile(
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|"
    r"thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|"
    r"crore|double|triple|quadruple|oh)\b",
    re.I,
)


def cleanup_enabled() -> bool:
    return TRANSCRIPT_CLEANUP_ENABLED


def cleanup_supported(language: str) -> bool:
    return (language or "").strip() in TRANSCRIPT_CLEANUP_LANGUAGES


def _speaker_from_prefix(prefix: str) -> str:
    m = SPEAKER_RE.search(prefix or "")
    return m.group(1).strip() if m else "Speaker"


def _is_correctable(speech: str) -> bool:
    s = (speech or "").strip()
    if not s or s == "[No speech detected]":
        return False
    if len(s) < 2:
        return False
    if re.fullmatch(r"[\W\d_]+", s, flags=re.UNICODE):
        return False
    return True


def _repetition_unique_ratio(text: str) -> float:
    words = _WORD_RE.findall(text or "")
    if len(words) < 4:
        return 1.0
    return len(set(words)) / len(words)


def _is_repetitive_line(speech: str) -> bool:
    return _repetition_unique_ratio(speech) < 0.35


def _native_script_ratio(text: str, language: str) -> float:
    letters = _WORD_RE.findall(text or "")
    if not letters:
        return 1.0
    if language == "Bengali":
        native = len(_BN_RE.findall(text))
    elif language == "Hindi":
        native = len(_HI_RE.findall(text))
    else:
        return 1.0
    return native / max(len("".join(letters)), 1)


def _digit_count(text: str) -> int:
    return sum(c.isdigit() for c in text or "")


def _has_spelled_numbers(text: str) -> bool:
    return bool(_SPELL_NUM_RE.search(text or ""))


def _is_entity_normalization(original: str, corrected: str) -> bool:
    """True when correction converts spoken entities to numeric readable form."""
    orig_d = _digit_count(original)
    new_d = _digit_count(corrected)
    if new_d > orig_d:
        added = new_d - orig_d
        spelled_tokens = len(_SPELL_NUM_RE.findall(original))
        # Require enough spoken number words to justify a long digit string
        if added >= 6 and spelled_tokens < max(3, added // 2):
            return False
        return True
    if _DATE_NORM_RE.search(corrected) and not _DATE_NORM_RE.search(original):
        return True
    if _DECIMAL_RUPEE_RE.search(corrected) and not _DECIMAL_RUPEE_RE.search(original):
        return True
    if _INDIAN_AMOUNT_RE.search(corrected) and not _INDIAN_AMOUNT_RE.search(original):
        return True
    return False


def _token_words(text: str) -> set[str]:
    return {
        w.lower()
        for w in _WORD_RE.findall(text or "")
        if len(w) > 2 and w.lower() not in _STOP
    }


def _context_supports_correction(
    original: str,
    corrected: str,
    context_lines: list[str],
) -> bool:
    """True when new terms in the correction appear in adjacent turns."""
    orig = _token_words(original)
    corr = _token_words(corrected)
    new_terms = corr - orig
    if not new_terms:
        return False
    context_blob = " ".join(context_lines).lower()
    hits = sum(1 for t in new_terms if t in context_blob)
    return hits >= min(2, len(new_terms))


def _accept_correction(
    original: str,
    corrected: str,
    language: str,
    context_lines: list[str] | None = None,
) -> bool:
    if corrected == original:
        return True
    if not corrected.strip():
        return False

    ratio = SequenceMatcher(None, original, corrected).ratio()
    contextual = bool(context_lines) and _context_supports_correction(
        original, corrected, context_lines,
    )
    entity = _is_entity_normalization(original, corrected)
    min_sim = TRANSCRIPT_CLEANUP_MIN_SIMILARITY
    max_len_delta = 0.35
    if entity:
        min_sim = min(min_sim, TRANSCRIPT_CLEANUP_ENTITY_MIN_SIMILARITY)
        max_len_delta = 0.65
    elif contextual:
        min_sim = min(min_sim, TRANSCRIPT_CLEANUP_CONTEXT_MIN_SIMILARITY)
        max_len_delta = 0.55

    if ratio < min_sim:
        return False

    orig_len = max(len(original), 1)
    if abs(len(corrected) - len(original)) / orig_len > max_len_delta:
        return False

    orig_script = _native_script_ratio(original, language)
    new_script = _native_script_ratio(corrected, language)
    if not entity and orig_script >= 0.25 and new_script < orig_script - 0.12:
        return False

    return True


def _parse_corrections(raw: str, expected_keys: list[int]) -> dict[int, str]:
    cleaned = strip_llm_thinking(raw).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return {}

    corrections = data.get("corrections") if isinstance(data, dict) else None
    if not isinstance(corrections, dict):
        corrections = data if isinstance(data, dict) else None
    if not isinstance(corrections, dict):
        return {}

    out: dict[int, str] = {}
    for key in expected_keys:
        val = corrections.get(str(key)) or corrections.get(key)
        if val is None:
            continue
        text = strip_llm_thinking(str(val)).strip()
        text = text.split("\n")[0].strip()
        if text and not is_meta_line(text):
            out[key] = text
    return out


def _correct_batch(
    items: list[tuple[int, str, str]],
    language: str,
    originals: dict[int, str],
) -> dict[int, str]:
    if not items:
        return {}
    system = cleanup_system_prompt(language)
    prompt = cleanup_batch_prompt(items, language)
    try:
        raw = ollama_generate(
            prompt, system=system, json_mode=True, max_tokens=2048,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Transcript cleanup LLM call failed (%s): %s", language, exc)
        return {}

    parsed = _parse_corrections(raw, [idx for idx, _, _ in items])
    context_by_idx = {idx: text for idx, _, text in items}
    accepted: dict[int, str] = {}
    for idx, corrected in parsed.items():
        original = originals.get(idx, "")
        others = [t for i, t in context_by_idx.items() if i != idx]
        if _accept_correction(original, corrected, language, others):
            if corrected != original:
                accepted[idx] = corrected
                logger.info(
                    "Transcript cleanup accepted line %s: %r -> %r",
                    idx, original[:60], corrected[:60],
                )
        else:
            logger.info(
                "Transcript cleanup rejected line %s (%s): too different from ASR",
                idx,
                language,
            )
    return accepted


def cleanup_transcript(transcript: str, language: str) -> str:
    """Return a corrected native transcript; falls back to the original on any issue."""
    if not cleanup_enabled() or not cleanup_supported(language):
        return transcript
    trimmed = (transcript or "").strip()
    if not trimmed:
        return transcript

    ordered: list[tuple[str | None, str, int | None]] = []
    batch_items: list[tuple[int, str, str]] = []
    originals: dict[int, str] = {}

    for raw_line in trimmed.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = LINE_RE.match(line)
        if match:
            prefix, speech = match.group(1), match.group(2).strip()
            if _is_correctable(speech) and not _is_repetitive_line(speech):
                idx = len(batch_items) + 1
                batch_items.append((idx, _speaker_from_prefix(prefix), speech))
                originals[idx] = speech
                ordered.append((prefix, speech, idx))
            else:
                ordered.append((prefix, speech, None))
        else:
            ordered.append((None, line, None))

    if not batch_items:
        return transcript

    corrections: dict[int, str] = {}
    full_call_max = TRANSCRIPT_CLEANUP_FULL_CALL_MAX_LINES or CLEANUP_FULL_CALL_MAX_LINES
    if len(batch_items) <= full_call_max:
        corrections.update(_correct_batch(batch_items, language, originals))
    else:
        for start in range(0, len(batch_items), CLEANUP_BATCH_SIZE):
            chunk = batch_items[start : start + CLEANUP_BATCH_SIZE]
            corrections.update(_correct_batch(chunk, language, originals))

    if not corrections:
        logger.info("Transcript cleanup produced no accepted corrections for %s", language)
        return transcript

    out_lines: list[str] = []
    for prefix, speech, idx in ordered:
        corrected = corrections.get(idx) if idx is not None else None
        text = corrected if corrected else speech
        if prefix is not None:
            out_lines.append(f"{prefix} {text}".rstrip())
        else:
            out_lines.append(text)

    logger.info(
        "Transcript cleanup accepted %d/%d lines for %s",
        len(corrections),
        len(batch_items),
        language,
    )
    return "\n".join(out_lines).strip() or transcript
