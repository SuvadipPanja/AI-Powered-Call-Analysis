"""Gated Whisper second-pass referee. No model imports."""

from __future__ import annotations

import re

_LINE_RE = re.compile(
    r"^\s*([\d.]+)\s*-\s*([\d.]+)\s*\(([^)]+)\)\s*:\s*(.*)$"
)

_SCRIPT_HIT_RE = re.compile(
    r"\b(?:icici|home\s+finance|housing\s+finance|"
    r"calling from|speaking with|am i speaking|"
    r"recorded)\b",
    re.I,
)
# Devanagari brand/compliance markers. No \b anchors: Whisper smears these
# into longer tokens ("अपारिकोर्ट" = आप…रिकॉर्ड, "क्वालिटेंट" = क्वालिटी एंड)
# and \b never fires between two Devanagari word characters.
_SCRIPT_HIT_DEVA_RE = re.compile(
    r"(?:आईसीआईसीआई|(?:होम|हाउसिंग)\s*फाइन|रिक[ॉो]र्[डट]|क्वालिट|कॉलिट|ट्रेनिंग)"
)
_DUE_DAY_RE = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\b",
    re.I,
)
_DUE_CONTEXT_RE = re.compile(
    r"(?:due\s+date|due\s+on|emi\s+date|तारीख|तारिख|देय)",
    re.I,
)


def _speech_words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z\u0900-\u097F]{2,}", text or "")


def opening_is_weak(text: str) -> bool:
    """Weak = no brand/compliance marker in either script.

    Word count is no evidence of quality: Seamless happily writes 15 fluent
    Devanagari words of the wrong company name. An opening that cannot prove
    RPC or the recording notice is always worth a second opinion.
    """
    blob = str(text or "").strip()
    if not blob:
        return True
    return not (
        _SCRIPT_HIT_RE.search(blob) or _SCRIPT_HIT_DEVA_RE.search(blob)
    )


def entities_need_second_pass(text: str) -> bool:
    blob = str(text or "")
    days = []
    for m in _DUE_DAY_RE.finditer(blob):
        day = int(m.group(1))
        if not 1 <= day <= 31:
            continue
        local = blob[max(0, m.start() - 28) : m.end() + 12]
        if _DUE_CONTEXT_RE.search(local) or re.search(
            r"\b(?:date of|today|already passed|tenth|twentieth)\b", local, re.I
        ):
            days.append(day)
    return len(set(days)) >= 2


_HAJI_MANGLE_RE = re.compile(r"\b(?:haji|iti|ici)\b", re.I)


def score_opening(text: str) -> int:
    t = text or ""
    score = 0
    if re.search(r"\bicici\b", t, re.I) or "आईसीआईसीआई" in t:
        score += 3
    if re.search(r"\b(?:home|housing)\s+finance\b", t, re.I) or re.search(
        r"(?:होम|हाउसिंग)\s*फाइन", t
    ):
        score += 3
    if re.search(r"\b(?:am i speaking|speaking with)\b", t, re.I):
        score += 2
    if re.search(r"\brecorded\b", t, re.I) or re.search(r"रिक[ॉो]र्[डट]", t):
        score += 2
    if re.search(r"क्वालिट|कॉलिट", t):
        score += 1
    if "ट्रेनिंग" in t:
        score += 1
    if re.search(r"\bcalling from\b", t, re.I):
        score += 1
    if re.search(r"\bgood morning\b", t, re.I):
        score += 1
    if re.search(r"\b(?:what'?s\s+up|they live together|from haji)\b", t, re.I):
        score -= 3
    if re.search(r"\b\w+\s+is speaking\b", t, re.I) and not re.search(
        r"\b(?:am i speaking|speaking with)\b", t, re.I
    ):
        score -= 2
    return score


def pick_opening(primary: str, secondary: str) -> str:
    prim = re.sub(r"\s+", " ", str(primary or "")).strip()
    sec = re.sub(r"\s+", " ", str(secondary or "")).strip()
    if not sec or sec == "[No speech detected]":
        return prim
    if (opening_is_weak(prim) or _HAJI_MANGLE_RE.search(prim)) and (
        re.search(r"\b(?:icici|home\s+finance|housing\s+finance)\b", sec, re.I)
        or _SCRIPT_HIT_DEVA_RE.search(sec)
    ):
        return sec
    if score_opening(sec) > score_opening(prim):
        return sec
    return prim


_LATER_AGENT_KEEP_RE = re.compile(r"\b(?:last number|\d{3,})\b", re.I)


def _is_opening_agent_row(speaker: str, start: float, text: str, opening_end_sec: float) -> bool:
    return (
        speaker == "Agent"
        and start < opening_end_sec
        and not _LATER_AGENT_KEEP_RE.search(text or "")
    )


def splice_second_pass_opening(
    lines: list[str],
    secondary_text: str,
    opening_end_sec: float,
) -> list[str]:
    parsed: list[tuple[float, float, str, str, str]] = []
    for raw in lines:
        match = _LINE_RE.match(raw)
        if not match:
            parsed.append((0.0, 0.0, "", raw, raw))
            continue
        start, end, speaker, text = match.groups()
        parsed.append((float(start), float(end), speaker, text, raw))

    agent_in = [
        row
        for row in parsed
        if _is_opening_agent_row(row[2], row[0], row[3], opening_end_sec)
    ]
    if not agent_in:
        return list(lines)
    primary_blob = " ".join(row[3] for row in agent_in)
    chosen = pick_opening(primary_blob, secondary_text)
    chosen_norm = re.sub(r"\s+", " ", chosen).strip()
    sec_norm = re.sub(r"\s+", " ", str(secondary_text or "")).strip()
    if chosen_norm != sec_norm or not sec_norm or opening_is_weak(sec_norm):
        return list(lines)

    win_start = min(row[0] for row in agent_in)
    # The secondary text covers the whole decode window, not just the short
    # primary rows it replaces. Stamping the row with the true window span
    # keeps the implied speech rate honest, otherwise the implausibility
    # referee flags its own splice and re-decodes it into junk.
    win_end = max(
        max(row[1] for row in agent_in), float(opening_end_sec)
    )
    spliced = f"{win_start:.1f} - {win_end:.1f} (Agent): {sec_norm}"
    out: list[str] = []
    emitted = False
    for start, _end, speaker, text, raw in parsed:
        if _is_opening_agent_row(speaker, start, text, opening_end_sec):
            if not emitted:
                out.append(spliced)
                emitted = True
            continue
        out.append(raw)
    return out


# A row is a hallucination suspect when the speaking rate it implies is
# physically impossible. Conversational Hindi/English on a PSTN line runs
# around 3 words/sec; Seamless answering a 1-second micro-turn with a whole
# invented sentence lands far above that.
_MIN_IMPLAUSIBLE_WORDS = 4
_WINDOW_MERGE_GAP_SEC = 2.0


def row_is_implausible(
    start: float,
    end: float,
    text: str,
    max_words_per_sec: float,
) -> bool:
    """True when this row packs more words than its duration can carry."""
    duration = float(end) - float(start)
    if duration <= 0:
        return False
    words = _speech_words(text)
    if len(words) < _MIN_IMPLAUSIBLE_WORDS:
        return False
    return (len(words) / duration) > float(max_words_per_sec)


def implausible_windows(
    lines: list[str],
    max_words_per_sec: float,
    max_windows: int,
) -> list[tuple[float, float, str]]:
    """Merged (start, end, speaker) spans worth a Whisper second opinion.

    Adjacent suspect rows from the same speaker within _WINDOW_MERGE_GAP_SEC
    collapse into one span, so a burst of micro-turn hallucinations becomes a
    single decode instead of one call per row.
    """
    suspects: list[tuple[float, float, str]] = []
    for line in lines or []:
        m = _LINE_RE.match(line)
        if not m:
            continue
        start, end, speaker, text = (
            float(m.group(1)),
            float(m.group(2)),
            m.group(3).strip(),
            m.group(4),
        )
        if row_is_implausible(start, end, text, max_words_per_sec):
            suspects.append((start, end, speaker))

    merged: list[tuple[float, float, str]] = []
    for start, end, speaker in suspects:
        if (
            merged
            and merged[-1][2] == speaker
            and start - merged[-1][1] <= _WINDOW_MERGE_GAP_SEC
        ):
            merged[-1] = (merged[-1][0], max(merged[-1][1], end), speaker)
        else:
            merged.append((start, end, speaker))
    return merged[: max(0, int(max_windows))]


# Rows that state the EMI due day. Only decoded when the call as a whole makes
# conflicting day claims (entities_need_second_pass), so clean calls cost zero.
_DUE_ROW_CONTEXT_RE = re.compile(r"तारीख|तारिख|due\s+(?:date|on)|ड्यू\s*डेट", re.I)
_DUE_ROW_DAY_RE = re.compile(
    r"\b(?:[1-9]|[12]\d|3[01])\b"
    r"|(?:दस|पंद्रह|उन्नीस|बीस|इक्कीस|बाईस|तेईस|चौबीस|पच्चीस|छब्बीस|सत्ताईस|अट्ठाईस|उनतीस|तीस)"
)


def due_conflict_windows(
    lines: list[str],
    max_windows: int,
    max_window_sec: float = 30.0,
) -> list[tuple[float, float, str]]:
    """Agent rows naming a due day, when the call's day claims conflict.

    Rows longer than ``max_window_sec`` are skipped: the GPU window decoder
    caps input at 30s and a truncated splice would silently drop the tail of
    a long turn.
    """
    if max_windows <= 0:
        return []
    rows: list[tuple[float, float, str, str]] = []
    for line in lines or []:
        m = _LINE_RE.match(line)
        if not m:
            continue
        rows.append(
            (float(m.group(1)), float(m.group(2)), m.group(3).strip(), m.group(4))
        )
    agent_text = " ".join(text for _s, _e, spk, text in rows if spk == "Agent")
    if not entities_need_second_pass(agent_text):
        return []
    windows: list[tuple[float, float, str]] = []
    for start, end, spk, text in rows:
        if spk != "Agent" or end <= start or end - start > max_window_sec:
            continue
        if _DUE_ROW_CONTEXT_RE.search(text) and _DUE_ROW_DAY_RE.search(text):
            windows.append((start, end, spk))
    return windows[: int(max_windows)]


def splice_window(
    lines: list[str],
    start_sec: float,
    end_sec: float,
    speaker: str,
    text: str,
) -> list[str]:
    """Replace that speaker's rows inside the span with one refereed row."""
    replacement = re.sub(r"\s+", " ", str(text or "")).strip()
    if not replacement:
        return list(lines)

    out: list[str] = []
    inserted = False
    for line in lines or []:
        m = _LINE_RE.match(line)
        if not m:
            out.append(line)
            continue
        start, end, row_speaker = float(m.group(1)), float(m.group(2)), m.group(3).strip()
        inside = (
            row_speaker == speaker
            and start >= start_sec - 1e-6
            and end <= end_sec + 1e-6
        )
        if inside:
            if not inserted:
                out.append(
                    f"{start_sec:.1f} - {end_sec:.1f} ({speaker}): {replacement}"
                )
                inserted = True
            continue
        out.append(line)
    return out if inserted else list(lines)
