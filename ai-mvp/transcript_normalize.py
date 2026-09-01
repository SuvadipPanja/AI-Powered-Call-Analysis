"""Deterministic pre-analysis transcript normalization.

Runs BEFORE LLM cleanup / translation, for EVERY language. It removes recording
noise that hurts both readability and downstream scoring/intelligence:

  * standalone filler tokens ("mm", "hmm", "uh", "um", "erm", ...)
  * immediately-repeated words ("basically basically" -> "basically",
    "yes yes yes" -> "yes")
  * turns that are left empty / filler-only after cleaning (optionally dropped)

It is language-agnostic and conservative: tokens are ONLY ever dropped whole,
never rewritten or re-joined, so complex scripts (Bengali/Devanagari combining
marks), hyphenated words, numbers like 9,000 and contractions stay byte-exact.
The output can only be shorter than (or equal to) the input.
"""

from __future__ import annotations

import re

from config import (
    TRANSCRIPT_NORMALIZE_DROP_FILLER_TURNS,
    TRANSCRIPT_NORMALIZE_ENABLED,
)

# Line shape produced by transcription: "0.00 - 2.00 (Agent): text"
_LINE_RE = re.compile(r"^(\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:)(.*)$")

# Pure filler / hesitation tokens (no semantic content). Case-insensitive.
# NOTE: meaningful acknowledgements (yes/no/ok/haan/ji/accha) are intentionally
# NOT here — only remove noise.
_FILLER_TOKENS = frozenset({
    "mm", "mmm", "mmmm", "mhm", "mhmm", "mm-hmm", "mmhmm", "hmm", "hmmm", "hmmmm",
    "hm", "uh", "uhh", "uhhh", "uh-huh", "uhhuh", "um", "umm", "ummm", "uhm",
    "er", "err", "erm", "ah", "ahh", "ahem", "eh", "huh", "hmp", "mhh",
    # Devanagari hesitations emitted by Indic ASR on noisy telephony audio.
    "अह", "उह", "उम", "अम", "हम्म", "हम्मम", "ह्म्म", "अं", "आं", "एह",
})

# ---------------------------------------------------------------------------
# ASR artifact scrubbing — non-speech event tags and unintelligible markers.
#
# Noisy telephony audio makes Whisper-family models hallucinate bracketed
# event tags ("[गुर्राते हुए]", "[music]") and makes SeamlessM4T emit "(())"
# unintelligible markers. None of these are speech; left in place they pollute
# the UI transcript AND downstream detectors (RPC/ZTP/foul). Tags are removed
# only when their content matches a known non-speech vocabulary so legitimate
# bracketed text like "[EMI amount]" or "[No speech detected]" is never touched.
# ---------------------------------------------------------------------------

# SeamlessM4T unintelligible markers: "(())", "(( ... ))".
_UNINTELLIGIBLE_RE = re.compile(r"\(\(\s*[^()]*\s*\)\)")

# Candidate bracketed tags (short, single-line).
_BRACKET_TAG_RE = re.compile(r"\[[^\[\]\n]{1,60}\]")

# Non-speech vocabulary (substring match, lowercased): English + Devanagari.
_NOISE_TAG_WORDS = (
    "music", "संगीत", "म्यूज़िक", "म्यूजिक",
    "laugh", "हंसते", "हँसते", "हंसी", "हँसी",
    "cough", "खांसते", "खाँसते", "खांसी", "खाँसी",
    "growl", "snarl", "गुर्राते", "गुर्राहट",
    "noise", "शोर", "आवाज़ें", "static",
    "inaudible", "unintelligible", "अस्पष्ट", "अश्रव्य",
    "silence", "मौन", "खामोशी",
    "background", "बैकग्राउंड",
    "breathing", "साँस", "सांस",
    "crying", "sobbing", "रोते",
    "applause", "clapping", "ताली",
    "sigh", "आह भरते",
    "beep", "बीप", "ringing", "घंटी",
    "humming", "गुनगुना",
    "murmur", "बड़बड़",
    "whisper", "फुसफुस",
    "speaking in", "foreign language",
)


def _is_noise_tag(tag: str) -> bool:
    inner = tag[1:-1].strip().lower()
    if not inner:
        return True  # empty "[]" is never speech
    return any(word in inner for word in _NOISE_TAG_WORDS)


# Seamless echoes the diarization speaker label into the text it returns. The
# transcript row already carries "(Agent):" structurally, so an inline copy is
# pure noise that leaks into evidence quotes and coaching text.
_INLINE_SPEAKER_TAG_RE = re.compile(r"\[\s*(?:agent|customer)\s*\]", re.I)


def scrub_asr_artifacts(text: str) -> str:
    """Remove hallucinated non-speech tags and unintelligible markers.

    Safe for every language lane: only whole markers are removed, real words
    are never rewritten. Used on transcript turns and on the compliance
    opening evidence before detectors read them.
    """
    if not text:
        return text
    cleaned = _UNINTELLIGIBLE_RE.sub(" ", text)
    cleaned = _INLINE_SPEAKER_TAG_RE.sub(" ", cleaned)
    cleaned = _BRACKET_TAG_RE.sub(
        lambda m: " " if _is_noise_tag(m.group(0)) else m.group(0),
        cleaned,
    )
    cleaned = cleaned.replace("♪", " ").replace("♫", " ")
    return re.sub(r"\s{2,}", " ", cleaned).strip()

# ASCII/Indic sentence punctuation stripped from token EDGES to build the
# comparison key. Fixed list on purpose: a Unicode \W class would also strip
# Bengali/Devanagari combining marks and corrupt the comparison.
_EDGE_PUNCT = ".,!?;:()[]{}\"'`~\u2013\u2014\u2026%\u0964\u0965-"


def _core(token: str) -> str:
    """Comparison key for a whitespace token: edge punctuation off, lowercased."""
    return token.strip(_EDGE_PUNCT).lower()


def _strip_fillers_and_repeats(text: str) -> str:
    """Drop filler tokens and immediately-repeated words; never edits tokens."""
    tokens = (text or "").split()
    if not tokens:
        return ""

    kept: list[str] = []
    prev_core: str | None = None
    for tok in tokens:
        core = _core(tok)
        if core:
            if core in _FILLER_TOKENS:
                continue  # drop hesitation noise ("mm", "uh", "mm-hmm", ...)
            if core == prev_core:
                continue  # collapse immediate duplicate ("yes yes" -> "yes")
            prev_core = core
        # punctuation-only tokens are kept verbatim and don't affect repeats
        kept.append(tok)

    return " ".join(kept).strip(" -")


def _has_content(text: str) -> bool:
    for tok in (text or "").split():
        core = _core(tok)
        if core and core not in _FILLER_TOKENS and any(ch.isalnum() for ch in core):
            return True
    return False


def normalize_transcript(transcript: str) -> str:
    """Return a filler/repeat-cleaned transcript; safe no-op on empty/disabled."""
    if not TRANSCRIPT_NORMALIZE_ENABLED:
        return transcript
    trimmed = (transcript or "").strip()
    if not trimmed:
        return transcript

    out_lines: list[str] = []
    for raw_line in trimmed.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            continue
        match = _LINE_RE.match(line)
        if not match:
            out_lines.append(line)
            continue

        prefix, speech = match.group(1), match.group(2).strip()
        speech = scrub_asr_artifacts(speech)
        cleaned = _strip_fillers_and_repeats(speech)

        if not cleaned or not _has_content(cleaned):
            if TRANSCRIPT_NORMALIZE_DROP_FILLER_TURNS:
                continue  # whole turn was filler/noise → drop it
            out_lines.append(f"{prefix} [No speech detected]".rstrip())
            continue

        out_lines.append(f"{prefix} {cleaned}".rstrip())

    return "\n".join(out_lines).strip() or transcript
