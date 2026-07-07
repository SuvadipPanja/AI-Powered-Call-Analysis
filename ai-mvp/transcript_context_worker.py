"""Full-call contextual LLM cleanup — names, honorifics, garbled ASR phrases.

Uses the entire Agent+Customer conversation in one LLM request (or overlapping
windows with full-call context) so cross-turn evidence drives fixes.
Numeric entities are handled by transcript_entity_worker — this pass is the
semantic 'brain' only.
"""

from __future__ import annotations

import json
import logging
import re
from difflib import SequenceMatcher

from config import (
    TRANSCRIPT_CONTEXT_BATCH_OVERLAP,
    TRANSCRIPT_CONTEXT_BATCH_SIZE,
    TRANSCRIPT_CONTEXT_ENABLED,
    TRANSCRIPT_CONTEXT_EVIDENCE_MIN_SIMILARITY,
    TRANSCRIPT_CONTEXT_FULL_CALL_MAX_LINES,
    TRANSCRIPT_CONTEXT_LANGUAGES,
    TRANSCRIPT_CONTEXT_MIN_SIMILARITY,
    TRANSCRIPT_CLEANUP_ENABLED,
    TRANSCRIPT_CLEANUP_LANGUAGES,
)
from llm_utils import is_meta_line, strip_llm_thinking
from prompts.transcript_context import (
    CONTEXT_BATCH_OVERLAP as _DEFAULT_OVERLAP,
    CONTEXT_BATCH_SIZE as _DEFAULT_BATCH,
    CONTEXT_FULL_CALL_MAX_LINES as _DEFAULT_FULL_MAX,
    context_batch_prompt,
    context_system_prompt,
)
from scoring_worker import ollama_generate
from transcript_cleanup_worker import (
    LINE_RE,
    SPEAKER_RE,
    _digit_count,
    _is_correctable,
    _is_repetitive_line,
    _token_words,
)

logger = logging.getLogger(__name__)

_GARBLED_MARKERS = re.compile(
    r"\b(?:icon\s+pattern|big\s+papa|big\s+babu|big\s+dada|teacher|"
    r"mister\s+police|finared|manual\s+good\s+name|manual\s+data|bursar|"
    r"bulkkit|fulkit|postcard\s+number)\b",
    re.I,
)
_BANKING_PHRASE = re.compile(
    r"\b(?:account\s+balance|mobile\s+number|registered\s+mobile|date\s+of\s+birth|"
    r"good\s+name|reward\s+points|credit\s+card|account\s+value)\b",
    re.I,
)
_AGENT_PHRASE_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bmanual\s+good\s+name\b", re.I), "may I know your name"),
    (re.compile(r"\bmanual\s+data\s+bursar\b", re.I), "date of birth"),
    (re.compile(r"\bdate\s+of\s+bursar\b", re.I), "date of birth"),
    (re.compile(r"\bicon\s+pattern\b", re.I), "account balance"),
    (re.compile(r"\bpostcard\s+number\b", re.I), "mobile number"),
]
_HONORIFIC_GARBAGE = re.compile(
    r"\b(?:big\s+papa|big\s+babu|big\s+dada|teacher)\b",
    re.I,
)


def context_cleanup_enabled() -> bool:
    return TRANSCRIPT_CONTEXT_ENABLED or TRANSCRIPT_CLEANUP_ENABLED


def context_cleanup_supported(language: str) -> bool:
    langs = TRANSCRIPT_CONTEXT_LANGUAGES or TRANSCRIPT_CLEANUP_LANGUAGES
    return (language or "").strip() in langs


def _speaker_from_prefix(prefix: str) -> str:
    m = SPEAKER_RE.search(prefix or "")
    return m.group(1).strip() if m else "Speaker"


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
        text = strip_llm_thinking(str(val)).strip().split("\n")[0].strip()
        if text and not is_meta_line(text):
            out[key] = text
    return out


def _context_supports_correction(
    original: str,
    corrected: str,
    full_context: list[str],
) -> bool:
    """True when new terms in the correction appear elsewhere in the full call."""
    orig = _token_words(original)
    corr = _token_words(corrected)
    new_terms = {t for t in (corr - orig) if len(t) > 2}
    if not new_terms:
        return False
    blob = " ".join(full_context).lower()
    hits = sum(1 for t in new_terms if t.lower() in blob)
    if hits >= 1:
        return True
    # Banking phrase swap: agent confirms phrase elsewhere in call
    if _looks_like_garbled(original) and _BANKING_PHRASE.search(corrected):
        return _BANKING_PHRASE.search(blob) is not None
    return False


def _looks_like_garbled(original: str) -> bool:
    return bool(_GARBLED_MARKERS.search(original or ""))


def _reject_digit_invention(
    original: str,
    corrected: str,
    full_context: list[str],
) -> bool:
    """True when correction invents a long digit string not supported by the call."""
    orig_d = _digit_count(original)
    new_d = _digit_count(corrected)
    if new_d <= orig_d + 5:
        return False
    context_d = max((_digit_count(c) for c in full_context), default=0)
    return new_d > context_d + 2


def _accept_context_fix(
    original: str,
    corrected: str,
    full_context: list[str],
) -> bool:
    if corrected == original:
        return True
    if not corrected.strip():
        return False
    if _reject_digit_invention(original, corrected, full_context):
        return False

    ratio = SequenceMatcher(None, original.lower(), corrected.lower()).ratio()
    orig_len = max(len(original), 1)
    len_delta = abs(len(corrected) - len(original)) / orig_len

    if _looks_like_garbled(original):
        if ratio >= TRANSCRIPT_CONTEXT_EVIDENCE_MIN_SIMILARITY and len_delta <= 0.85:
            return True
        if _BANKING_PHRASE.search(corrected) and _BANKING_PHRASE.search(
            " ".join(full_context).lower()
        ):
            return len_delta <= 0.75

    if _context_supports_correction(original, corrected, full_context):
        if ratio >= TRANSCRIPT_CONTEXT_EVIDENCE_MIN_SIMILARITY and len_delta <= 0.70:
            return True

    if ratio >= TRANSCRIPT_CONTEXT_MIN_SIMILARITY and len_delta <= 0.60:
        return True

    return False


def _deterministic_context_fixes(
    batch_items: list[tuple[int, str, str]],
    originals: dict[int, str],
    full_speeches: list[str],
) -> dict[int, str]:
    """Evidence-based fixes before LLM — known ASR garbage with cross-turn support."""
    blob = " ".join(full_speeches).lower()
    accepted: dict[int, str] = {}

    for idx, speaker, text in batch_items:
        cur = originals.get(idx, text)
        new_text = cur

        if speaker == "Customer" and re.search(r"\bicon\s+pattern\b", cur, re.I):
            if _BANKING_PHRASE.search(blob):
                new_text = re.sub(r"\bicon\s+pattern\b", "account balance", cur, count=1, flags=re.I)

        if speaker == "Customer" and "postcard number" in cur.lower():
            if "mobile" in blob:
                new_text = re.sub(
                    r"\bpostcard\s+number\b", "mobile number", new_text, count=1, flags=re.I,
                )

        if speaker == "Customer" and _HONORIFIC_GARBAGE.search(cur):
            new_text = _HONORIFIC_GARBAGE.sub("sir", new_text)

        if speaker == "Agent":
            for pat, repl in _AGENT_PHRASE_FIXES:
                new_text = pat.sub(repl, new_text)

        if new_text != cur and _accept_context_fix(cur, new_text, full_speeches):
            accepted[idx] = new_text
            logger.info(
                "Context cleanup deterministic line %s: %r -> %r",
                idx, cur[:55], new_text[:55],
            )

    return accepted


def _correct_context_batch(
    all_items: list[tuple[int, str, str]],
    edit_items: list[tuple[int, str, str]],
    language: str,
    originals: dict[int, str],
    full_speeches: list[str],
) -> dict[int, str]:
    if not edit_items:
        return {}
    system = context_system_prompt(language)
    prompt = context_batch_prompt(all_items, edit_items, language)
    try:
        raw = ollama_generate(
            prompt,
            system=system,
            json_mode=True,
            max_tokens=2048,
            temperature=0.05,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Context cleanup LLM failed (%s): %s", language, exc)
        return {}

    parsed = _parse_corrections(raw, [idx for idx, _, _ in edit_items])
    accepted: dict[int, str] = {}
    for idx, corrected in parsed.items():
        original = originals.get(idx, "")
        if _accept_context_fix(original, corrected, full_speeches):
            if corrected != original:
                accepted[idx] = corrected
                logger.info(
                    "Context cleanup line %s (%s): %r -> %r",
                    idx, language, original[:55], corrected[:55],
                )
        else:
            logger.info(
                "Context cleanup rejected line %s (%s): insufficient evidence",
                idx, language,
            )
    return accepted


def context_cleanup_transcript(transcript: str, language: str) -> str:
    """Full-call contextual cleanup; safe no-op on failure."""
    if not context_cleanup_enabled() or not context_cleanup_supported(language):
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

    full_speeches = [text for _, _, text in batch_items]
    corrections: dict[int, str] = {}

    # Step 0: deterministic cross-turn fixes (no LLM)
    det = _deterministic_context_fixes(batch_items, originals, full_speeches)
    if det:
        originals.update(det)
        batch_items = [(idx, sp, originals[idx]) for idx, sp, _ in batch_items]
        full_speeches = [text for _, _, text in batch_items]
        corrections.update(det)

    full_max = TRANSCRIPT_CONTEXT_FULL_CALL_MAX_LINES or _DEFAULT_FULL_MAX
    batch_size = TRANSCRIPT_CONTEXT_BATCH_SIZE or _DEFAULT_BATCH
    overlap = TRANSCRIPT_CONTEXT_BATCH_OVERLAP or _DEFAULT_OVERLAP

    if len(batch_items) <= full_max:
        corrections.update(
            _correct_context_batch(
                batch_items, batch_items, language, originals, full_speeches,
            )
        )
    else:
        step = max(1, batch_size - overlap)
        for start in range(0, len(batch_items), step):
            chunk = batch_items[start : start + batch_size]
            if not chunk:
                break
            corrections.update(
                _correct_context_batch(
                    batch_items, chunk, language, originals, full_speeches,
                )
            )

    if not corrections:
        logger.info("Context cleanup produced no accepted corrections for %s", language)
        return transcript

    out_lines: list[str] = []
    for prefix, speech, idx in ordered:
        text = corrections.get(idx, speech) if idx else speech
        if prefix is not None:
            out_lines.append(f"{prefix} {text}".rstrip())
        else:
            out_lines.append(text)

    logger.info(
        "Context cleanup accepted %d/%d lines for %s (full-call=%s)",
        len(corrections),
        len(batch_items),
        language,
        len(batch_items) <= full_max,
    )
    return "\n".join(out_lines).strip() or transcript
