"""Mandatory LLM entity normalization — numbers, amounts, dates, IDs in all languages.

Runs on native transcript AND on English translation (Transcript tab uses
translateOutput, which previously skipped cleanup entirely).
"""

from __future__ import annotations

import json
import logging
import re

from config import (
    TRANSCRIPT_ENTITY_ENABLED,
    TRANSCRIPT_ENTITY_FULL_CALL_MAX_LINES,
)
from llm_utils import is_meta_line, strip_llm_thinking
from prompts.transcript_entities import (
    ENTITY_BATCH_SIZE,
    ENTITY_FULL_CALL_MAX_LINES,
    entity_batch_prompt,
    entity_system_prompt,
)
from scoring_worker import ollama_generate
from transcript_format_worker import entity_fallback_line
from transcript_cleanup_worker import (
    LINE_RE,
    SPEAKER_RE,
    _digit_count,
    _is_correctable,
    _is_repetitive_line,
    _speaker_from_prefix,
)

logger = logging.getLogger(__name__)

# English + Indic number words (native script and roman)
_SPELL_NUM = re.compile(
    r"(?:"
    r"\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|"
    r"thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|"
    r"thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|lakh|"
    r"lac|crore|million|billion|double|triple|quadruple|oh|paise?|poisa|poysa)\b"
    r"|(?:"
    r"এক|দুই|তিন|চার|পাঁচ|পাচ|ছয়|সাত|আট|নয়|দশ|"
    r"একটা|একটি|টাকা|পয়সা|পৈসা|হাজার|লাখ|কোটি|"
    r"एक|दो|तीन|चार|पांच|पाँच|छह|सात|आठ|नौ|दस|"
    r"सौ|हजार|हाजार|लाख|करोड|रुपये|रुपया|पैसे|पैसा|"
    r"ஒன்று|இரண்டு|மூன்று|நான்கு|ஐந்து|"
    r"ఒకటి|రెండు|మూడు|నాలుగు|ఐదు"
    r"))",
    re.I | re.UNICODE,
)


def entity_normalize_enabled() -> bool:
    return TRANSCRIPT_ENTITY_ENABLED


def _line_has_spelled_numbers(text: str) -> bool:
    return bool(_SPELL_NUM.search(text or ""))


def _accept_entity_change(original: str, corrected: str) -> bool:
    """Entity pass: accept digit increases; reject invented long digit strings."""
    if corrected == original:
        return True
    if not corrected.strip():
        return False
    orig_d = _digit_count(original)
    new_d = _digit_count(corrected)
    if new_d > orig_d:
        if not _line_has_spelled_numbers(original) and (new_d - orig_d) >= 4:
            return False
        return True
    # Allow date format without digit increase in edge cases
    if re.search(r"\d", corrected) and _line_has_spelled_numbers(original):
        return True
    return False


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


def _normalize_batch(
    items: list[tuple[int, str, str]],
    language: str,
    originals: dict[int, str],
) -> dict[int, str]:
    if not items:
        return {}
    # Only send lines with spelled numbers + immediate neighbors for context
    target_indices = {
        idx for idx, _, text in items if _line_has_spelled_numbers(text)
    }
    if not target_indices:
        return {}

    system = entity_system_prompt(language)
    prompt = entity_batch_prompt(items, language)
    try:
        raw = ollama_generate(
            prompt, system=system, json_mode=True, max_tokens=2048, temperature=0.05,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Entity normalize LLM failed (%s): %s", language, exc)
        return {}

    parsed = _parse_corrections(raw, [idx for idx, _, _ in items])
    accepted: dict[int, str] = {}
    for idx, corrected in parsed.items():
        if idx not in target_indices:
            continue
        original = originals.get(idx, "")
        if _accept_entity_change(original, corrected):
            if corrected != original:
                accepted[idx] = corrected
                logger.info(
                    "Entity normalize line %s (%s): %r -> %r",
                    idx, language, original[:55], corrected[:55],
                )
    return accepted


def normalize_entities(transcript: str, language: str) -> str:
    """Normalize spoken numbers/amounts/dates; safe no-op on failure."""
    if not entity_normalize_enabled():
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
    full_max = TRANSCRIPT_ENTITY_FULL_CALL_MAX_LINES or ENTITY_FULL_CALL_MAX_LINES
    if len(batch_items) <= full_max:
        corrections.update(_normalize_batch(batch_items, language, originals))
    else:
        for start in range(0, len(batch_items), ENTITY_BATCH_SIZE):
            chunk = batch_items[start : start + ENTITY_BATCH_SIZE]
            corrections.update(_normalize_batch(chunk, language, originals))

    out_lines: list[str] = []
    fallback_count = 0
    for prefix, speech, idx in ordered:
        text = corrections.get(idx, speech) if idx else speech
        if idx and _line_has_spelled_numbers(text):
            fb = entity_fallback_line(text)
            if fb != text:
                fallback_count += 1
                logger.info(
                    "Entity fallback line %s (%s): %r -> %r",
                    idx, language, text[:55], fb[:55],
                )
                text = fb
        if prefix is not None:
            out_lines.append(f"{prefix} {text}".rstrip())
        else:
            out_lines.append(text)

    if not corrections and not fallback_count:
        return transcript

    total = len(corrections) + fallback_count
    if total:
        logger.info(
            "Entity normalize applied %d LLM + %d fallback lines for %s",
            len(corrections), fallback_count, language,
        )
    return "\n".join(out_lines).strip() or transcript
