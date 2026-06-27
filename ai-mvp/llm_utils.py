"""
Shared helpers for cleaning Qwen / vLLM outputs (thinking blocks, meta text, WPM).
"""

from __future__ import annotations

import re

# Qwen3 may emit , , or legacy  blocks.
THINK_BLOCK_RE = re.compile(
    r"<\s*(?:think|redacted_reasoning|reasoning)\s*>[\s\S]*?"
    r"<\s*/\s*(?:think|redacted_reasoning|reasoning)\s*>",
    re.I,
)
THINK_TAIL_RE = re.compile(
    r"<\s*(?:think|redacted_reasoning|reasoning)\s*>[\s\S]*$",
    re.I,
)
DIARIZED_LINE_RE = re.compile(
    r"^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:",
)
META_LINE_RE = re.compile(
    r"^(okay,? let's|first,? i'll|the user wants|translate only|output plain|"
    r"here is the|rules:|transcript:|note:|markdown|no notes|\*\*|#{1,3}\s|"
    r"you are a professional|do not change|sorry,? i don'?t see|"
    r"please provide the spoken|i don'?t see any text|no text to translate|"
    r"i cannot translate|unable to translate)",
    re.I,
)


def strip_llm_thinking(text: str) -> str:
    if not text:
        return ""
    cleaned = THINK_BLOCK_RE.sub("", text)
    cleaned = THINK_TAIL_RE.sub("", cleaned)
    cleaned = re.sub(
        r"<\s*/\s*(?:think|redacted_reasoning|reasoning)\s*>",
        "",
        cleaned,
        flags=re.I,
    )
    return cleaned.strip()


def is_meta_line(line: str) -> bool:
    s = (line or "").strip()
    if not s:
        return True
    if META_LINE_RE.match(s):
        return True
    if s.startswith("<") and "think" in s.lower():
        return True
    return False


def extract_diarized_transcript(text: str) -> str:
    """Keep only well-formed 'start - end (Speaker): text' lines."""
    lines: list[str] = []
    for raw in (text or "").splitlines():
        line = strip_llm_thinking(raw).strip()
        if not line or is_meta_line(line):
            continue
        if DIARIZED_LINE_RE.match(line):
            lines.append(line)
    return "\n".join(lines)


def count_speech_words(text: str) -> int:
    """Word count for WPM — diarized speech only, ignores LLM meta/thinking."""
    diarized = extract_diarized_transcript(text)
    body = diarized if diarized else strip_llm_thinking(text or "")
    clean = re.sub(
        r"^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]*\)\s*:\s*",
        "",
        body,
        flags=re.MULTILINE,
    )
    return len([w for w in clean.split() if w])
