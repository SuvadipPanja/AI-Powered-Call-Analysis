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
    TRANSCRIPT_CLEANUP_ENABLED,
    TRANSCRIPT_CLEANUP_LANGUAGES,
    TRANSCRIPT_CLEANUP_MIN_SIMILARITY,
)
from llm_utils import is_meta_line, strip_llm_thinking
from prompts.transcript_cleanup import (
    CLEANUP_BATCH_SIZE,
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


def _accept_correction(original: str, corrected: str, language: str) -> bool:
    if corrected == original:
        return True
    if not corrected.strip():
        return False

    ratio = SequenceMatcher(None, original, corrected).ratio()
    if ratio < TRANSCRIPT_CLEANUP_MIN_SIMILARITY:
        return False

    orig_len = max(len(original), 1)
    if abs(len(corrected) - len(original)) / orig_len > 0.35:
        return False

    orig_script = _native_script_ratio(original, language)
    new_script = _native_script_ratio(corrected, language)
    if orig_script >= 0.25 and new_script < orig_script - 0.12:
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
        raw = ollama_generate(prompt, system=system, json_mode=True)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Transcript cleanup LLM call failed (%s): %s", language, exc)
        return {}

    parsed = _parse_corrections(raw, [idx for idx, _, _ in items])
    accepted: dict[int, str] = {}
    for idx, corrected in parsed.items():
        original = originals.get(idx, "")
        if _accept_correction(original, corrected, language):
            if corrected != original:
                accepted[idx] = corrected
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
