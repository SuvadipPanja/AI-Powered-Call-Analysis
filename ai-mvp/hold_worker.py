"""Detect agent hold episodes from diarized call transcripts.

Hybrid approach (high precision):
  1. Phrase anchor — Agent explicitly asks customer to hold / wait
     (English + Hindi/Hinglish + 10 regional Indian languages).
  2. Silence gap — Long gap (≥18s) after Agent speech (language-agnostic).

Dual-transcript mode (stronger): run detection on original + English transcripts
and merge episodes so regional hold phrases are not lost in translation.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any

from config import (
    HOLD_DETECTION_ENABLED,
    HOLD_MAX_EPISODE_SEC,
    HOLD_MIN_GAP_AFTER_PHRASE_SEC,
    HOLD_MIN_SILENCE_GAP_SEC,
)

_log = logging.getLogger(__name__)

LINE_RE = re.compile(
    r"^\s*([\d.]+)\s*-\s*([\d.]+)\s*\((Agent|Customer)\)\s*:(.*)$",
    re.I | re.M,
)

# --- Tier 1: explicit hold / wait (12 call-center languages) ----------------
_HOLD_PHRASE_PARTS: tuple[str, ...] = (
    # English
    r"please\s+(?:hold|wait|be\s+on\s+hold)",
    r"kindly\s+(?:hold|wait)",
    r"hold\s+(?:the\s+)?(?:line|on)",
    r"hold\s+on|on\s+hold|be\s+on\s+hold|remain\s+on\s+hold",
    r"one\s+moment|just\s+a\s+(?:moment|minute|sec(?:ond)?)",
    r"(?:give|bear)\s+me\s+(?:a\s+)?(?:moment|minute|second|sec(?:ond)?)",
    r"wait(?:ing)?(?:\s+(?:for\s+a\s+)?(?:moment|minute|second|while|please))?",
    r"hold\s+music|music\s+(?:on\s+)?hold",
    r"(?:can i|may i|shall i|let me)\s+(?:put|keep|place)",
    r"put(?:ting)?\s+(?:your\s+)?call\s+on\s+hold",
    r"(?:your\s+)?call\s+(?:on|to)\s+hold",
    # Hindi / Hinglish (roman)
    r"line\s+(?:pe|par)\s+(?:hold|ruko|rahiye|bane\s+rahiye)",
    r"hold\s+kariye|hold\s+kar(?:iye|o|lo)",
    r"(?:thoda|thodi)\s+(?:rukiye|ruk(?:ie|iye|o))",
    r"rukiye|ruk(?:ie|iye)\s*(?:ga|gi|ge)?",
    r"ek\s+(?:minute|min|second|sec|moment)",
    # Hindi / Marathi — Devanagari
    r"[\u0900-\u097F]{0,12}(?:प्रतीक्ष|रुक(?:ie|iye|o|ें|ie)?|एक\s*मिन|होल्ड|लाइन\s*प|कृपया\s*प्र)",
    # Bengali + Assamese (shared script cues)
    r"[\u0980-\u09FF]{0,12}(?:অপেক্ষ|এক\s*মিন|লাইন|অপেক্ষা\s*ক|অপেক্ষা\s*কৰ)",
    # Tamil
    r"[\u0B80-\u0BFF]{0,12}(?:காத்த|நிமிட|நிமிடம்|ஹோல்ட|காத்திர)",
    # Telugu
    r"[\u0C00-\u0C7F]{0,12}(?:వేచ|నిమిష|హోల్డ|ఒక\s*నిమ)",
    # Kannada
    r"[\u0C80-\u0CFF]{0,12}(?:ಕಾಯ|ನಿಮಿಷ|ಹೋಲ್ಡ|ಒಂದು\s*ನಿಮ)",
    # Malayalam
    r"[\u0D00-\u0D7F]{0,12}(?:കാത്ത|മിനിട|ഹോൾഡ|ഒരു\s*മിന)",
    # Gujarati
    r"[\u0A80-\u0AFF]{0,12}(?:રાહ\s*જ|મિનિટ|હોલ્ડ|એક\s*મિન)",
    # Punjabi (Gurmukhi)
    r"[\u0A00-\u0A7F]{0,12}(?:ਇੰਤਜ|ਮਿੰਟ|ਹੋਲਡ|ਇੱਕ\s*ਮਿ)",
    # Odia
    r"[\u0B00-\u0B7F]{0,12}(?:ଅପେକ୍ଷ|ମିନିଟ|ହୋଲ୍ଡ|ଗୋଟିଏ\s*ମି)",
    # Romanized regional (ASR latin output)
    r"ap(?:ekha|ekkha|ekhya)|ek\s+min(?:ute|it)?",
    r"kathir(?:ungal|ikk|ungal)?|nimish(?:am)?|or\s+nimish",
    r"vechi(?:yandi)?|nimish(?:am)?|oka\s+nimish",
    r"kay(?:iri|i)|nimish|ondu\s+nimish",
    r"kathirikk|minut|oru\s+minut",
    r"rah\s+j(?:uo|o)|ek\s+min(?:it)?",
    r"intzaar|ik\s+min(?:ut)?",
    r"apekha|min(?:it|it)",
)

HOLD_PHRASE_RE = re.compile(
    "|".join(f"(?:{p})" for p in _HOLD_PHRASE_PARTS),
    re.I | re.UNICODE,
)

# Agent returning from hold — not a new hold start.
_RETURN_FROM_HOLD_PARTS: tuple[str, ...] = (
    r"thank\s+you\s+for\s+(?:holding|waiting)",
    r"thanks\s+for\s+(?:holding|waiting)",
    r"sorry\s+for\s+(?:the\s+)?(?:wait|delay)",
    r"thank\s+you\s+for\s+being\s+on\s+hold",
    r"[\u0900-\u097F]{0,8}(?:प्रतीक्षा\s*के\s*लिए\s*धन्यवाद|होल्ड\s*के\s*लिए)",
    r"[\u0980-\u09FF]{0,8}(?:অপেক্ষার\s*জন্য\s*ধন্যবাদ|অপেক্ষা\s*কৰাৰ\s*বাবে)",
    r"[\u0B80-\u0BFF]{0,8}(?:காத்திருப்பதற்கு\s*நன்றி)",
    r"[\u0C00-\u0C7F]{0,8}(?:వేచి\s*ఉన్నందుకు\s*ధన్యవాద)",
)

RETURN_FROM_HOLD_RE = re.compile(
    "|".join(f"(?:{p})" for p in _RETURN_FROM_HOLD_PARTS),
    re.I | re.UNICODE,
)

CLOSING_RE = re.compile(
    r"(?:have\s+a\s+(?:nice|good)\s+day|goodbye|bye|call\s+back|anything\s+else|"
    r"thank\s+you\s+for\s+calling)",
    re.I,
)

STATED_HOLD_MINUTES_RE = re.compile(
    r"(?:for\s+)?(\d+)\s*(?:minutes?|mins?|min\.?)\b",
    re.I,
)
STATED_HOLD_SECONDS_RE = re.compile(
    r"(?:for\s+)?(\d+)\s*(?:seconds?|secs?|sec\.?)\b",
    re.I,
)

# Brief customer replies right after a hold request — not the end of hold.
_HOLD_ACK_WORDS = frozenset(
    "yes yeah yep yup ok okay sure fine hmm hm huh absolutely right correct "
    "alright ji haan han theek thik achha acha theekhai okaysir".split()
)

# Brief agent politeness right after asking to hold — not a return from hold.
_HOLD_SETUP_AGENT_RE = re.compile(
    r"^(?:thank\s+you(?:\s+sir|\s+madam|\s+ma'?am|\s+ji)?|thanks(?:\s+sir|\s+madam|\s+ma'?am|\s+ji)?|"
    r"thank\s+you\s+for\s+speaking|ok(?:ay)?\s+sir|please\s+wait|one\s+moment|"
    r"please\s+stay\s+on\s+the\s+line|bear\s+with\s+me)\b",
    re.I,
)
_HOLD_END_SUBSTANCE_RE = re.compile(
    r"\?|(?:\b(?:balance|account|card|active|verified|request|complete|issue|update|"
    r"reward|points?|cashback|otp|submit|proof|know\s+that|available|eligible)\b)",
    re.I,
)


@dataclass
class Utterance:
    start: float
    end: float
    speaker: str
    text: str


@dataclass
class HoldEvent:
    start_sec: float
    end_sec: float
    duration_sec: float
    trigger: str  # phrase | silence_gap

    def to_dict(self) -> dict[str, Any]:
        return {
            "start_sec": round(self.start_sec, 2),
            "end_sec": round(self.end_sec, 2),
            "duration_sec": round(self.duration_sec, 2),
            "trigger": self.trigger,
        }


def hold_detection_enabled() -> bool:
    return HOLD_DETECTION_ENABLED


def _parse_utterances(transcript: str) -> list[Utterance]:
    out: list[Utterance] = []
    for m in LINE_RE.finditer(transcript or ""):
        text = (m.group(4) or "").strip()
        if not text or text == "[No speech detected]":
            continue
        try:
            start = float(m.group(1))
            end = float(m.group(2))
        except ValueError:
            continue
        if end <= start:
            end = start + 0.5
        speaker = m.group(3).strip().title()
        out.append(Utterance(start, end, speaker, text))
    out.sort(key=lambda u: u.start)
    return out


def _merge_events(events: list[HoldEvent]) -> list[HoldEvent]:
    if not events:
        return []
    events = sorted(events, key=lambda e: e.start_sec)
    merged: list[HoldEvent] = [events[0]]
    for ev in events[1:]:
        prev = merged[-1]
        if ev.start_sec <= prev.end_sec + 1.0:
            end = max(prev.end_sec, ev.end_sec)
            trigger = prev.trigger
            if ev.trigger == "phrase" or prev.trigger == "phrase":
                trigger = "phrase"
            merged[-1] = HoldEvent(prev.start_sec, end, end - prev.start_sec, trigger)
        else:
            merged.append(ev)
    return merged


def _next_speech_start(
    utts: list[Utterance], idx: int, total_duration_sec: float | None
) -> float:
    for j in range(idx + 1, len(utts)):
        nxt = utts[j]
        if len(nxt.text.strip()) >= 2:
            return nxt.start
    if total_duration_sec and total_duration_sec > utts[idx].end:
        return total_duration_sec
    if idx + 1 < len(utts):
        return utts[idx + 1].start
    return utts[idx].end + HOLD_MIN_GAP_AFTER_PHRASE_SEC


def _stated_hold_seconds(text: str) -> float | None:
    m = STATED_HOLD_MINUTES_RE.search(text or "")
    if m:
        return float(m.group(1)) * 60.0
    m = STATED_HOLD_SECONDS_RE.search(text or "")
    if m:
        return float(m.group(1))
    return None


def _is_hold_acknowledgment(text: str) -> bool:
    """Short customer consent after hold request — does not end the hold episode."""
    raw = (text or "").strip()
    if not raw:
        return False
    norm = re.sub(r"[^\w\s'-]", " ", raw.lower())
    words = [w for w in norm.split() if w]
    if not words or len(words) > 8:
        return False
    content = [w for w in words if w not in ("sir", "madam", "maam", "ma'am", "ji")]
    if not content:
        return True
    if len(content) <= 4 and all(
        w in _HOLD_ACK_WORDS or w.rstrip("s") in _HOLD_ACK_WORDS for w in content
    ):
        return True
    joined = " ".join(words)
    return bool(
        re.match(
            r"^(?:hmm|hm|uh[\-\s]?huh)(?:\s*,?\s*)?(?:absolutely|ok|okay|yes|sure)?"
            r"(?:\s+sir|\s+ma'?am)?\.?$",
            joined,
        )
    )


def _is_hold_setup_agent_line(text: str) -> bool:
    """Agent line immediately after hold request that is politeness, not resuming service."""
    raw = (text or "").strip()
    if not raw or _is_return_from_hold(raw):
        return False
    if _HOLD_END_SUBSTANCE_RE.search(raw):
        return False
    if len(raw.split()) > 20:
        return False
    return bool(_HOLD_SETUP_AGENT_RE.search(raw))


def _next_hold_end_sec(
    utts: list[Utterance],
    idx: int,
    total_duration_sec: float | None,
) -> float:
    """Hold ends when the agent resumes — skip brief customer/agent hold-setup lines."""
    hold_start = utts[idx].end
    for j in range(idx + 1, len(utts)):
        nxt = utts[j]
        if nxt.speaker == "Customer" and _is_hold_acknowledgment(nxt.text):
            continue
        if nxt.speaker == "Agent" and _is_hold_setup_agent_line(nxt.text):
            continue
        if nxt.speaker == "Agent":
            return nxt.start
        if nxt.speaker == "Customer":
            return nxt.start
    if total_duration_sec and total_duration_sec > hold_start:
        return total_duration_sec
    return hold_start + HOLD_MIN_GAP_AFTER_PHRASE_SEC


def _has_hold_phrase(text: str) -> bool:
    return bool(HOLD_PHRASE_RE.search(text or ""))


def _is_return_from_hold(text: str) -> bool:
    return bool(RETURN_FROM_HOLD_RE.search(text or ""))


def detect_hold_events(
    transcript: str,
    *,
    total_duration_sec: float | None = None,
    phrase_texts: list[str] | None = None,
) -> list[HoldEvent]:
    """Return hold episodes detected in a diarized transcript.

    When ``phrase_texts`` is provided (dual-transcript mode), phrase detection
    checks every aligned text variant for each agent utterance while silence-gap
    detection still uses the primary transcript timeline.
    """
    utts = _parse_utterances(transcript)
    if len(utts) < 2:
        return []

    events: list[HoldEvent] = []

    for i, utt in enumerate(utts):
        if utt.speaker != "Agent":
            continue

        phrase_candidates = [utt.text]
        if phrase_texts and i < len(phrase_texts):
            alt = (phrase_texts[i] or "").strip()
            if alt and alt not in phrase_candidates:
                phrase_candidates.append(alt)

        if any(_is_return_from_hold(t) for t in phrase_candidates):
            continue

        # --- Tier 1: explicit hold phrase (any aligned transcript variant) ---
        if any(_has_hold_phrase(t) for t in phrase_candidates):
            hold_start = utt.end
            hold_end = _next_hold_end_sec(utts, i, total_duration_sec)
            duration = hold_end - hold_start
            stated = _stated_hold_seconds(utt.text)
            min_dur = HOLD_MIN_GAP_AFTER_PHRASE_SEC
            if stated and stated >= min_dur:
                min_dur = 3.0
            if duration >= min_dur and duration <= HOLD_MAX_EPISODE_SEC:
                events.append(HoldEvent(hold_start, hold_end, duration, "phrase"))
            elif any(_has_hold_phrase(t) for t in phrase_candidates):
                _log.info(
                    "hold phrase at %.1fs rejected: duration=%.1fs min=%.1fs max=%.1fs end=%.1fs",
                    utt.end, duration, min_dur, HOLD_MAX_EPISODE_SEC, hold_end,
                )
            continue

        # --- Tier 2: long silence after agent (implicit hold) ---
        if i + 1 >= len(utts):
            continue
        nxt = utts[i + 1]
        if CLOSING_RE.search(utt.text):
            continue
        gap = nxt.start - utt.end
        if gap >= HOLD_MIN_SILENCE_GAP_SEC:
            duration = min(gap, HOLD_MAX_EPISODE_SEC)
            if duration >= HOLD_MIN_SILENCE_GAP_SEC:
                events.append(
                    HoldEvent(utt.end, utt.end + duration, duration, "silence_gap")
                )

    return _merge_events(events)


def _align_agent_phrase_texts(
    primary: list[Utterance], secondary: list[Utterance]
) -> list[str]:
    """Map secondary agent utterance text onto primary timeline by nearest start."""
    if not secondary:
        return []
    sec_agents = [u for u in secondary if u.speaker == "Agent"]
    if not sec_agents:
        return []

    aligned: list[str] = []
    for utt in primary:
        if utt.speaker != "Agent":
            aligned.append("")
            continue
        best = min(sec_agents, key=lambda s: abs(s.start - utt.start))
        if abs(best.start - utt.start) <= 2.0:
            aligned.append(best.text)
        else:
            aligned.append("")
    return aligned


def detect_hold_events_dual(
    original_transcript: str,
    english_transcript: str,
    *,
    total_duration_sec: float | None = None,
) -> list[HoldEvent]:
    """Run hold detection on original + English; merge deduplicated episodes."""
    orig = (original_transcript or "").strip()
    eng = (english_transcript or "").strip()
    if not orig or orig == eng:
        return detect_hold_events(eng or orig, total_duration_sec=total_duration_sec)

    utts_en = _parse_utterances(eng)
    utts_orig = _parse_utterances(orig)

    # Primary timeline: English (post-translation, normalized). Phrase check both.
    phrase_from_orig = _align_agent_phrase_texts(utts_en, utts_orig)
    events_en = detect_hold_events(
        eng,
        total_duration_sec=total_duration_sec,
        phrase_texts=phrase_from_orig,
    )

    # Also run full pass on original — catches timeline drift / translation re-order.
    phrase_from_en = _align_agent_phrase_texts(utts_orig, utts_en)
    events_orig = detect_hold_events(
        orig,
        total_duration_sec=total_duration_sec,
        phrase_texts=phrase_from_en,
    )

    return _merge_events(events_en + events_orig)


def _fmt_duration(sec: float) -> str:
    sec = max(0, int(round(sec)))
    m, s = divmod(sec, 60)
    if m:
        return f"{m}m {s}s"
    return f"{s}s"


def analyze_hold(
    english_transcript: str,
    *,
    original_transcript: str | None = None,
    total_duration_sec: float | None = None,
) -> dict[str, Any]:
    """Full hold analysis payload for DB / intelligence merge."""
    orig = (original_transcript or "").strip()
    eng = (english_transcript or "").strip()

    if orig and orig != eng:
        events = detect_hold_events_dual(orig, eng, total_duration_sec=total_duration_sec)
    else:
        events = detect_hold_events(eng or orig, total_duration_sec=total_duration_sec)

    total = sum(e.duration_sec for e in events)
    longest = max((e.duration_sec for e in events), default=0.0)
    return {
        "Hold_Detected": "Yes" if events else "No",
        "Hold_Count": len(events),
        "Hold_Total_Sec": round(total, 2),
        "Hold_Longest_Sec": round(longest, 2),
        "Hold_Total_Display": _fmt_duration(total),
        "Hold_Events": [e.to_dict() for e in events],
        "Hold_Events_JSON": json.dumps([e.to_dict() for e in events], ensure_ascii=False),
    }


def default_hold() -> dict[str, Any]:
    return {
        "Hold_Detected": "No",
        "Hold_Count": 0,
        "Hold_Total_Sec": 0.0,
        "Hold_Longest_Sec": 0.0,
        "Hold_Total_Display": "0s",
        "Hold_Events": [],
        "Hold_Events_JSON": "[]",
    }
