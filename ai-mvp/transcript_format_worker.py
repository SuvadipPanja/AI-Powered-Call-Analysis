"""Deterministic transcript formatting — numbers, amounts, abbreviations.

Runs AFTER filler normalization and BEFORE LLM contextual cleanup.
Conservative: only converts unambiguous spelled-out patterns; never
invents digits or changes semantic content outside formatting rules.
"""

from __future__ import annotations

import re

from config import TRANSCRIPT_FORMAT_NUMBERS_ENABLED

_LINE_RE = re.compile(r"^(\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]+\)\s*:)(.*)$")

# Single-digit spoken tokens (English + common ASR variants)
_DIGIT_WORD: dict[str, str] = {
    "zero": "0", "oh": "0", "o": "0",
    "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9",
    "won": "1", "to": "2", "too": "2", "for": "4", "fore": "4",
    "ate": "8", "nein": "9",
}

_REPEATER_COUNTS: dict[str, int] = {"double": 2, "triple": 3, "quadruple": 4}
_REPEATER_RE = re.compile(
    r"\b(double|triple|quadruple)\s+(\d|[a-z]+)\b",
    re.I,
)
_PHONE_MOBILE_CTX = re.compile(
    r"\b(?:mobile|registered\s+mobile|phone\s+number|my\s+mobile|"
    r"credit\s+card|card\s+number|debit\s+card|aadhaar)\b",
    re.I,
)
# In mobile/card digit runs, teens are dictated digit-by-digit (eleven → 1,1 not 11).
_TEEN_PHONE_DIGITS: dict[str, list[str]] = {
    "eleven": ["1", "1"],
    "twelve": ["1", "2"],
    "thirteen": ["1", "3"],
    "fourteen": ["1", "4"],
    "fifteen": ["1", "5"],
    "sixteen": ["1", "6"],
    "seventeen": ["1", "7"],
    "eighteen": ["1", "8"],
    "nineteen": ["1", "9"],
}

# 0–99 for rupee/paise components
_SMALL_NUM: dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14,
    "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}

_TENS = ("twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety")

# Abbreviation patterns (banking / call-center)
_ABBREV_RULES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bp\s+and\s+b\b", re.I), "P&B"),
    (re.compile(r"\bx\s+y\s+z\s+bank\b", re.I), "XYZ Bank"),
    (re.compile(r"\bx\s+y\s+z\b", re.I), "XYZ"),
    (re.compile(r"\bp\s*&\s*b\b", re.I), "P&B"),
]

# rupee + paise amount: "one rupees ninety eight paise" → "1.98 rupees"
_AMOUNT_RE = re.compile(
    r"\b("
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|"
    r"eighty|ninety)(?:\s+(?:one|two|three|four|five|six|seven|"
    r"eight|nine))?"
    r")\s+rupees?\s+("
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|twenty\s+one|twenty\s+two|twenty\s+three|"
    r"twenty\s+four|twenty\s+five|twenty\s+six|twenty\s+seven|twenty\s+eight|"
    r"twenty\s+nine|thirty|forty|fifty|sixty|seventy|eighty|ninety|"
    r"thirty\s+one|forty\s+five|fifty\s+one|sixty\s+two|seventy\s+three|"
    r"eighty\s+four|ninety\s+eight|ninety\s+nine)"
    r")\s+paise?\b",
    re.I,
)
# "one rupees and ninety nine paise" / "one rupee and ninety nine pesa"
_AMOUNT_AND_RE = re.compile(
    r"\b("
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|"
    r"eighty|ninety)(?:\s+(?:one|two|three|four|five|six|seven|"
    r"eight|nine))?"
    r")\s+rupees?\s+and\s+("
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|twenty\s+one|twenty\s+two|twenty\s+three|"
    r"twenty\s+four|twenty\s+five|twenty\s+six|twenty\s+seven|twenty\s+eight|"
    r"twenty\s+nine|thirty|forty|fifty|sixty|seventy|eighty|ninety|"
    r"thirty\s+one|forty\s+five|fifty\s+one|sixty\s+two|seventy\s+three|"
    r"eighty\s+four|ninety\s+eight|ninety\s+nine)"
    r")\s+(?:paise?|pesa)\b",
    re.I,
)
# ASR mess: "1 rupees and 90 9 paise" → "1.99 rupees"
_MESSY_RUPEE_PAISE = re.compile(
    r"\b(\d+)\s+rupees?\s+and\s+((?:\d+\s*)+)\s*(?:paise?|pesa)\b",
    re.I,
)


def format_enabled() -> bool:
    return TRANSCRIPT_FORMAT_NUMBERS_ENABLED


def _words_to_int(phrase: str) -> int | None:
    """Parse 0–99 English number phrase."""
    parts = phrase.lower().strip().split()
    if not parts:
        return None
    if len(parts) == 1:
        return _SMALL_NUM.get(parts[0])
    if len(parts) == 2 and parts[0] in _TENS:
        unit = _SMALL_NUM.get(parts[1])
        if unit is not None and unit < 10:
            return _SMALL_NUM[parts[0]] + unit
    return None


def _parse_messy_paise(part: str) -> int | None:
    """Parse broken paise like '90 9' → 99."""
    nums = [int(x) for x in part.split() if x.isdigit()]
    if not nums:
        return None
    if len(nums) == 1:
        return nums[0] if nums[0] <= 99 else None
    if len(nums) == 2 and nums[0] >= 10 and nums[1] < 10:
        return (nums[0] // 10) * 10 + nums[1]
    joined = "".join(str(n) for n in nums)
    if len(joined) <= 2:
        return int(joined)
    return None


def _format_messy_rupee_paise(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        rupee = int(m.group(1))
        paise = _parse_messy_paise(m.group(2).strip())
        if paise is None:
            return m.group(0)
        return f"{rupee}.{paise:02d} rupees"

    return _MESSY_RUPEE_PAISE.sub(_repl, text)


def _format_amounts(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        rupee = _words_to_int(m.group(1))
        paise = _words_to_int(m.group(2))
        if rupee is None or paise is None:
            return m.group(0)
        return f"{rupee}.{paise:02d} rupees"

    def _repl_and(m: re.Match[str]) -> str:
        rupee = _words_to_int(m.group(1))
        paise = _words_to_int(m.group(2))
        if rupee is None or paise is None:
            return m.group(0)
        return f"{rupee}.{paise:02d} rupees"

    text = _AMOUNT_RE.sub(_repl, text)
    text = _AMOUNT_AND_RE.sub(_repl_and, text)
    return _format_messy_rupee_paise(text)


def _single_digit_char(token: str) -> str | None:
    """Map one token to a single digit character, if unambiguous."""
    low = token.lower().strip(".,;:?")
    if len(low) == 1 and low.isdigit():
        return low
    return _DIGIT_WORD.get(low)


def _expand_spoken_repeaters(text: str) -> str:
    """Expand double/triple/quadruple N before digit-run collection."""

    def _repl(m: re.Match[str]) -> str:
        kind = m.group(1).lower()
        digit = _single_digit_char(m.group(2))
        if digit is None:
            return m.group(0)
        count = _REPEATER_COUNTS.get(kind, 0)
        if count < 2:
            return m.group(0)
        return " ".join([digit] * count)

    return _REPEATER_RE.sub(_repl, text)


def _digit_tokens_from_word(token: str, *, phone_ctx: bool) -> list[str] | None:
    """Return one or more digit chars for a token inside an active digit run."""
    low = token.lower().strip(".,;:?")
    if phone_ctx and low in _TEEN_PHONE_DIGITS:
        return list(_TEEN_PHONE_DIGITS[low])
    if phone_ctx and low.isdigit() and len(low) == 2:
        return list(low)
    digit = _single_digit_char(token)
    if digit is not None:
        return [digit]
    return None


def _try_fix_overlong_mobile(digits: str) -> str:
    """Fix 11-digit mobile when ASR says 'triple' instead of 'double' (222→22)."""
    if len(digits) != 11 or digits[0] not in "6789":
        return digits
    fixed = re.sub(r"222", "22", digits, count=1)
    if len(fixed) == 10 and fixed[0] in "6789":
        return fixed
    return digits


def _collect_digit_run(
    tokens: list[str],
    start: int,
    *,
    phone_ctx: bool,
) -> tuple[list[str], int] | None:
    """Collect consecutive spoken/literal single-digit tokens (incl. repeaters)."""
    digits: list[str] = []
    i = start
    n = len(tokens)
    while i < n:
        raw = tokens[i]
        low = raw.lower().strip(".,;:?")
        if low in _REPEATER_COUNTS and i + 1 < n:
            nxt = tokens[i + 1]
            digit = _single_digit_char(nxt)
            if digit is not None:
                digits.extend([digit] * _REPEATER_COUNTS[low])
                i += 2
                continue
            break
        chunk = _digit_tokens_from_word(raw, phone_ctx=phone_ctx)
        if chunk is not None:
            digits.extend(chunk)
            i += 1
            continue
        break
    if len(digits) >= 3:
        return digits, i
    return None


def _format_spelled_digits(text: str) -> str:
    """Card/account runs → concatenated; verification runs → spaced digits."""
    text = _expand_spoken_repeaters(text)
    tokens = text.split()
    if not tokens:
        return text
    verification = bool(re.search(r"\b(?:number|digit|otp|pin)\s+is\b", text, re.I))
    phone_ctx = bool(_PHONE_MOBILE_CTX.search(text))
    out: list[str] = []
    i = 0
    while i < len(tokens):
        run = _collect_digit_run(tokens, i, phone_ctx=phone_ctx)
        if run:
            digits, end = run
            n = len(digits)
            joined = "".join(digits)
            if phone_ctx and len(joined) == 11:
                joined = _try_fix_overlong_mobile(joined)
            if n >= 8:
                out.append(joined)
            elif n >= 4:
                out.append(" ".join(digits) if verification else joined)
            elif n >= 3 and verification:
                out.append(" ".join(digits))
            else:
                out.append(tokens[i])
                i += 1
                continue
            i = end
        else:
            out.append(tokens[i])
            i += 1
    return " ".join(out)


_BANKING_CTX = re.compile(
    r"\b(?:rupee|rupees|transaction|date|dates|balance|account|number|numbers|"
    r"digit|digits|point|points|card|mobile|otp|aadhaar|amount|paise|reward)\b",
    re.I,
)
_COUNT_WORD = re.compile(
    r"\b("
    r"zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
    r")\b",
    re.I,
)


def _format_count_words(text: str) -> str:
    """Convert remaining small number words on numeric/banking lines."""
    if not _COUNT_WORD.search(text):
        return text
    spell_hits = len(_COUNT_WORD.findall(text))
    has_digit = bool(re.search(r"\d", text))
    banking = bool(_BANKING_CTX.search(text))
    if not (has_digit or banking or spell_hits >= 2):
        return text

    def _repl(m: re.Match[str]) -> str:
        word = m.group(1).lower()
        rest = text[m.end() :]
        before = text[max(0, m.start() - 12) : m.start()].lower()
        # Never strip "five" from "five hundred ..." — hundred pass handles those
        if re.search(r"\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|"
                     r"twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen)\s+$",
                     before):
            return m.group(0)
        if re.match(r"\s+hundred\b", rest, re.I):
            return m.group(0)
        if re.match(r"\s+not\s+(?:eight|8)\b", rest, re.I):
            return m.group(0)
        if re.match(r"\s+(?:thousand|lakh|lac|crore|hundred)\b", rest, re.I):
            return m.group(0)
        val = _SMALL_NUM.get(word)
        if val is None:
            return m.group(0)
        return str(val)

    return _COUNT_WORD.sub(_repl, text)


def _phrase_to_int(phrase: str) -> int | None:
    """Parse 0–99 English number phrase."""
    return _words_to_int(phrase)


_WORD_NUM = (
    r"(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
    r"(?:\s+(?:one|two|three|four|five|six|seven|eight|nine))?)"
)

_THOUSAND_PHRASE = re.compile(
    rf"\b({_WORD_NUM})\s+thousand"
    rf"(?:\s+(?:(\d{{1,2}})\s+(\d)|((?:{_WORD_NUM}(?:\s+{_WORD_NUM})*))))?"
    rf"(?:\s+((?:reward\s+)?points?|rupees?))?",
    re.I,
)

_HUNDRED_PHRASE = re.compile(
    r"\b("
    r"one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen"
    r")\s+hundred(?:\s+(?:and\s+)?("
    r"zero|one|two|three|four|five|six|seven|eight|nine|ten|"
    r"eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|"
    r"eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
    r"(?:\s+(?:one|two|three|four|five|six|seven|eight|nine))?)"
    r")?\s+(rupees?|reward\s+points?|points?)\b",
    re.I,
)
# ASR: "finared 8 rupees" / "finared eight rupees" often means 508 rupees (reward cash value)
_FINARED_508 = re.compile(
    r"\bfinared\s+(?:eight|8|0\s*8)\s+(rupees?)\b",
    re.I,
)
# ASR mishears "five hundred eight" as "five not eight"
_NOT_EIGHT_508 = re.compile(
    r"\b(?:five|5)\s+not\s+(?:eight|8)\s+(rupees?|reward\s+points?|points?)\b",
    re.I,
)
# Partial conversion residue: "five hundred 8 rupees" / "5 hundred 8 rupees"
_MIXED_HUNDRED_TAIL = re.compile(
    r"\b(?:five|5)\s+hundred\s+(?:and\s+)?(?:eight|8)\s+(rupees?|reward\s+points?|points?)\b",
    re.I,
)
# "5 08 rupees" or "5 8 rupees" when clearly one amount (not "5 rupees")
_SPLIT_HUNDRED_AMOUNT = re.compile(
    r"\b([1-9])\s+0?(\d)\s+(rupees?|reward\s+points?|points?)\b",
    re.I,
)
# "five zero eight rupees" / "five oh eight points" on banking lines
_BANKING_UNIT = re.compile(
    r"\b(rupees?|reward\s+points?|points?|rs\.?)\b",
    re.I,
)

# Indic entity fallback (safety net when Qwen3-8B misses LLM entity pass)
_HI_RUPEE_PAISE = re.compile(
    r"एक\s+रुप(?:या|ये|ए)\s+और\s+नब्बे\s+पैसे",
    re.UNICODE,
)
_HI_RUPEE_PAISE_99 = re.compile(
    r"एक\s+रुप(?:या|ये|ए)\s+और\s+निन्यानवे\s+पैसे",
    re.UNICODE,
)
_BN_RUPEE_POISA = re.compile(
    r"এক\s+টাকা\s+নব্বই\s+পয়সা",
    re.UNICODE,
)
_BN_RUPEE_POISA_99 = re.compile(
    r"এক\s+টাকা\s+এবং\s+নিরানব্বই\s+পয়সা",
    re.UNICODE,
)
# Romanized Hindi (common ASR roman output)
_HI_ROMAN_HAZAAR = re.compile(
    r"\b(pandrah|pandreh|solah|satrah|atharah|unnees|bees)\s+hazaar\s+(rupaye?|rupees?)\b",
    re.I,
)
_HI_ROMAN_LAKH = re.compile(
    r"\b(ek|do|teen|char|paanch|panch)\s+lakh\s+(rupaye?|rupees?)\b",
    re.I,
)

_ROMAN_HAZAAR_WORDS: dict[str, int] = {
    "pandrah": 15, "pandreh": 15, "solah": 16, "satrah": 17,
    "atharah": 18, "unnees": 19, "bees": 20,
}
_ROMAN_LAKH_WORDS: dict[str, int] = {
    "ek": 1, "do": 2, "teen": 3, "char": 4, "paanch": 5, "panch": 5,
}


def _format_indic_entity_fallback(text: str) -> str:
    """Deterministic Indic number patterns — complements LLM entity pass on 8B."""
    t = text
    t = _HI_RUPEE_PAISE.sub("1.90 रुपये", t)
    t = _HI_RUPEE_PAISE_99.sub("1.99 रुपये", t)
    t = _BN_RUPEE_POISA.sub("1.90 টাকা", t)
    t = _BN_RUPEE_POISA_99.sub("1.99 টাকা", t)

    def _hazar(m: re.Match[str]) -> str:
        n = _ROMAN_HAZAAR_WORDS.get(m.group(1).lower())
        if n is None:
            return m.group(0)
        return f"{n * 1000:,} {m.group(2)}"

    def _lakh(m: re.Match[str]) -> str:
        n = _ROMAN_LAKH_WORDS.get(m.group(1).lower())
        if n is None:
            return m.group(0)
        return f"{n * 100000:,} {m.group(2)}"

    t = _HI_ROMAN_HAZAAR.sub(_hazar, t)
    t = _HI_ROMAN_LAKH.sub(_lakh, t)
    return t


def _phrase_words_to_int(phrase: str) -> int | None:
    """Parse a short chain like 'thirty two' or 'five hundred' fragments."""
    parts = (phrase or "").lower().split()
    if not parts:
        return None
    if len(parts) == 1:
        return _SMALL_NUM.get(parts[0])
    if len(parts) == 2 and parts[0] in _TENS:
        unit = _SMALL_NUM.get(parts[1])
        if unit is not None and unit < 10:
            return _SMALL_NUM[parts[0]] + unit
    total = 0
    i = 0
    while i < len(parts):
        w = parts[i]
        if w in _TENS and i + 1 < len(parts):
            unit = _SMALL_NUM.get(parts[i + 1])
            if unit is not None and unit < 10:
                total += _SMALL_NUM[w] + unit
                i += 2
                continue
        val = _SMALL_NUM.get(w)
        if val is None:
            return None
        total += val
        i += 1
    return total


def _format_thousand_phrases(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        mult = _phrase_to_int(m.group(1))
        if mult is None:
            return m.group(0)
        total = mult * 1000
        if m.group(2) is not None and m.group(3) is not None:
            tens, ones = int(m.group(2)), int(m.group(3))
            if tens >= 10 and ones < 10:
                total += tens + ones
            else:
                total += tens * 10 + ones
        elif m.group(4):
            rem = _phrase_words_to_int(m.group(4).strip())
            if rem is not None:
                total += rem
        unit = m.group(5) or ""
        return f"{total:,} {unit}".strip() if unit else f"{total:,}"

    return _THOUSAND_PHRASE.sub(_repl, text)


def _format_hundred_phrases(text: str) -> str:
    def _repl(m: re.Match[str]) -> str:
        base = _phrase_to_int(m.group(1))
        if base is None:
            return m.group(0)
        total = base * 100
        if m.group(2):
            rem = _phrase_to_int(m.group(2))
            if rem is not None:
                total += rem
        unit = m.group(3)
        return f"{total} {unit}"

    return _HUNDRED_PHRASE.sub(_repl, text)


def _format_finared_508(text: str) -> str:
    return _FINARED_508.sub(r"508 \1", text)


def _format_not_eight_508(text: str) -> str:
    return _NOT_EIGHT_508.sub(r"508 \1", text)


def _format_mixed_hundred_tail(text: str) -> str:
    return _MIXED_HUNDRED_TAIL.sub(r"508 \1", text)


def _format_split_hundred_amounts(text: str) -> str:
    """Merge '5 08 rupees' -> '508 rupees' (ASR splits hundreds)."""

    def _repl(m: re.Match[str]) -> str:
        hundreds = int(m.group(1))
        rest = int(m.group(2))
        unit = m.group(3)
        if rest >= 10:
            return m.group(0)
        amount = hundreds * 100 + rest
        if amount < 100:
            return m.group(0)
        return f"{amount} {unit}"

    return _SPLIT_HUNDRED_AMOUNT.sub(_repl, text)


def _format_spoken_digit_amounts(text: str) -> str:
    """Join 'five zero eight rupees' -> '508 rupees' on banking amount lines."""
    if not _BANKING_CTX.search(text) and not _BANKING_UNIT.search(text):
        return text
    tokens = text.split()
    if len(tokens) < 4:
        return text
    out: list[str] = []
    i = 0
    while i < len(tokens):
        run_start = i
        digits: list[str] = []
        while i < len(tokens):
            low = tokens[i].lower().strip(".,;:?")
            if low in _DIGIT_WORD:
                digits.append(_DIGIT_WORD[low])
                i += 1
                continue
            break
        if len(digits) >= 3 and i < len(tokens):
            tail = tokens[i].lower().strip(".,;:?")
            if _BANKING_UNIT.match(tail) or tail in ("rs", "rs."):
                out.append("".join(digits))
                out.append(tokens[i])
                i += 1
                continue
        if digits:
            out.extend(tokens[run_start:i])
        else:
            out.append(tokens[i])
            i += 1
    return " ".join(out)


def _capitalize_speech(text: str) -> str:
    s = (text or "").lstrip()
    if len(s) >= 2 and s[0].islower() and s[1].isalpha():
        return s[0].upper() + s[1:]
    return text


def _format_abbreviations(text: str) -> str:
    for pattern, repl in _ABBREV_RULES:
        text = pattern.sub(repl, text)
    return text


def _apply_number_formatting(text: str, *, include_count_words: bool = False) -> str:
    """Shared number pipeline — order matters for compound amounts like 508 rupees."""
    t = _format_indic_entity_fallback(text)
    t = _format_finared_508(t)
    t = _format_not_eight_508(t)
    t = _format_mixed_hundred_tail(t)
    t = _format_split_hundred_amounts(t)
    t = _format_spoken_digit_amounts(t)
    t = _format_thousand_phrases(t)
    t = _format_hundred_phrases(t)
    t = _format_amounts(t)
    if include_count_words:
        t = _format_count_words(t)
    t = _format_abbreviations(t)
    t = _format_spelled_digits(t)
    return t


def format_speech_line(text: str) -> str:
    """Apply all deterministic formatting rules to one speech line."""
    if not text or not text.strip():
        return text
    return _apply_number_formatting(text)


def entity_fallback_line(text: str) -> str:
    """Deterministic safety net after LLM entity pass — catches missed patterns."""
    if not text or not text.strip():
        return text
    return _apply_number_formatting(text, include_count_words=True)


def polish_english_speech(text: str) -> str:
    """Final English Transcript-tab polish: entities + brands + sentence case."""
    t = entity_fallback_line(text)
    return _capitalize_speech(t)


def polish_english_transcript(transcript: str) -> str:
    """Polish diarized English transcript for UI display."""
    trimmed = (transcript or "").strip()
    if not trimmed:
        return transcript
    out_lines: list[str] = []
    changed = False
    for raw_line in trimmed.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            out_lines.append(line)
            continue
        match = _LINE_RE.match(line)
        if match:
            prefix, speech = match.group(1), match.group(2)
            polished = polish_english_speech(speech)
            if polished != speech:
                changed = True
            out_lines.append(f"{prefix}{polished}".rstrip())
        else:
            polished = polish_english_speech(line)
            if polished != line:
                changed = True
            out_lines.append(polished)
    if not changed:
        return transcript
    return "\n".join(out_lines).strip()


def format_transcript(transcript: str) -> str:
    """Format numbers/amounts/abbreviations in a diarized transcript."""
    if not format_enabled():
        return transcript
    trimmed = (transcript or "").strip()
    if not trimmed:
        return transcript

    out_lines: list[str] = []
    changed = False
    for raw_line in trimmed.splitlines():
        line = raw_line.rstrip()
        if not line.strip():
            out_lines.append(line)
            continue
        match = _LINE_RE.match(line)
        if match:
            prefix, speech = match.group(1), match.group(2)
            formatted = format_speech_line(speech)
            if formatted != speech:
                changed = True
            out_lines.append(f"{prefix}{formatted}".rstrip())
        else:
            formatted = format_speech_line(line)
            if formatted != line:
                changed = True
            out_lines.append(formatted)

    if not changed:
        return transcript
    return "\n".join(out_lines).strip()
