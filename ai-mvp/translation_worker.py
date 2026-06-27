"""
Hindi → English translation via LLM for downstream scoring/enrichment.
Uses bank-configurable glossary and batch translation for quality + speed.
"""

from __future__ import annotations

import json
import re

from bank_config import get_bank_config
from config import TRANSLATION_ENABLED
from llm_utils import extract_diarized_transcript, is_meta_line, strip_llm_thinking
from prompts.translation import (
    TRANSLATION_BATCH_SIZE,
    translation_batch_prompt,
    translation_single_prompt,
    translation_system_prompt,
)
from scoring_worker import ollama_generate

LINE_RE = re.compile(
    r"^(\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:)(.*)$",
)
SPEAKER_RE = re.compile(r"\(([^)]+)\)")


def _speaker_from_prefix(prefix: str) -> str:
    m = SPEAKER_RE.search(prefix or "")
    return m.group(1).strip() if m else "Speaker"


def translation_enabled() -> bool:
    return TRANSLATION_ENABLED


def needs_translation(language: str) -> bool:
    lang = (language or "").strip().lower()
    return lang in (
        "hindi", "hi", "hinglish", "urdu",
        "bengali", "bn", "assamese", "as", "odia", "or", "marathi", "mr",
        "tamil", "ta", "telugu", "te", "gujarati", "gu", "punjabi", "pa",
        "malayalam", "ml", "kannada", "kn",
    )


def _is_translatable_speech(speech: str) -> bool:
    s = (speech or "").strip()
    if not s or s == "[No speech detected]":
        return False
    # Skip noise-only or ultra-short ASR hits (often cause Llama refusals).
    if len(s) < 2:
        return False
    if re.fullmatch(r"[\W\d_]+", s, flags=re.UNICODE):
        return False
    return True


def _clean_translation_line(raw: str) -> str:
    cleaned = strip_llm_thinking(raw).strip()
    if not cleaned:
        return ""
    m = LINE_RE.match(cleaned)
    if m:
        cleaned = m.group(2).strip()
    first = cleaned.split("\n")[0].strip()
    if is_meta_line(first):
        return ""
    return first


def _parse_batch_translations(raw: str, expected_keys: list[int]) -> dict[int, str]:
    cleaned = strip_llm_thinking(raw).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return {}

    translations = data.get("translations") if isinstance(data, dict) else None
    if not isinstance(translations, dict):
        if isinstance(data, dict):
            translations = data
        else:
            return {}

    out: dict[int, str] = {}
    for key in expected_keys:
        val = translations.get(str(key)) or translations.get(key)
        if val is None:
            continue
        text = _clean_translation_line(str(val))
        if text and not is_meta_line(text):
            out[key] = text
    return out


def _translate_batch(items: list[tuple[int, str, str]], config) -> dict[int, str]:
    if not items:
        return {}
    system = translation_system_prompt(config)
    prompt = translation_batch_prompt(items, config)
    raw = ollama_generate(prompt, system=system, json_mode=True)
    parsed = _parse_batch_translations(raw, [idx for idx, _, _ in items])
    if parsed:
        return parsed

    # Fallback: line-by-line for any missing entries
    fallback: dict[int, str] = {}
    for idx, speaker, speech in items:
        if idx in parsed:
            fallback[idx] = parsed[idx]
            continue
        raw_line = ollama_generate(translation_single_prompt(speech, speaker), system=system)
        text = _clean_translation_line(raw_line) or speech
        fallback[idx] = text
    return fallback


def _translate_speech(text: str, config, speaker: str | None = None) -> str:
    speech = (text or "").strip()
    if not _is_translatable_speech(speech):
        return speech
    system = translation_system_prompt(config)
    raw = ollama_generate(translation_single_prompt(speech, speaker), system=system)
    translated = _clean_translation_line(raw)
    return translated if translated else speech


def translate_transcript(transcript: str, source_language: str = "Hindi") -> str:
    if not translation_enabled() or not needs_translation(source_language):
        return transcript

    trimmed = (transcript or "").strip()
    if not trimmed:
        return transcript

    config = get_bank_config()
    ordered: list[tuple[str | None, str, int | None]] = []
    batch_items: list[tuple[int, str, str]] = []

    for raw_line in trimmed.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = LINE_RE.match(line)
        if match:
            prefix, speech = match.group(1), match.group(2).strip()
            if _is_translatable_speech(speech):
                idx = len(batch_items) + 1
                batch_items.append((idx, _speaker_from_prefix(prefix), speech))
                ordered.append((prefix, speech, idx))
            else:
                ordered.append((prefix, speech, None))
        elif not is_meta_line(line):
            ordered.append((None, line, None))

    translations: dict[int, str] = {}
    for start in range(0, len(batch_items), TRANSLATION_BATCH_SIZE):
        chunk = batch_items[start : start + TRANSLATION_BATCH_SIZE]
        translations.update(_translate_batch(chunk, config))

    out_lines: list[str] = []
    for prefix, speech, idx in ordered:
        if idx is not None and prefix is not None:
            translated = translations.get(idx)
            if not translated or is_meta_line(translated):
                translated = (
                    _translate_speech(speech, config, _speaker_from_prefix(prefix))
                    if _is_translatable_speech(speech)
                    else speech
                )
            out_lines.append(f"{prefix} {translated}".rstrip())
        elif prefix is not None:
            out_lines.append(f"{prefix} {speech}".rstrip())
        else:
            out_lines.append(speech)

    result = "\n".join(out_lines).strip()
    diarized = extract_diarized_transcript(result)
    return diarized if diarized else result
