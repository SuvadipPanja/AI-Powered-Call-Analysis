"""Focused LLM prompt — entity normalization ONLY (numbers, amounts, dates, IDs).

Separate from contextual ASR cleanup so Qwen always converts spoken
quantities to digits without conservative similarity gates blocking Indic script.
"""

from __future__ import annotations

ENTITY_BATCH_SIZE = 32
ENTITY_FULL_CALL_MAX_LINES = 50


def entity_system_prompt(language: str) -> str:
    lang = (language or "").strip() or "the spoken"
    rules = [
        f"You normalize numeric ENTITIES in {lang} call-center transcripts.",
        "Your ONLY job: convert spoken numbers to readable numeric form.",
        "Do NOT fix grammar, names, or ASR errors — numbers/amounts/dates/IDs only.",
        "",
        "ALWAYS convert when spoken as words:",
        "",
        "English examples:",
        '  "fifteen thousand rupees" → "15,000 rupees"',
        '  "one rupee and ninety paise" → "1.90 rupees"',
        '  "fourteen eight rupees" → "14.80 rupees"',
        '  "two thousand thirty two reward points" → "2,032 reward points"',
        '  "nine eight five triple two eight one one three seven" → "9852281137"',
        '  "mobile number is 9 8 5 triple 2 8 11 3 7" → "mobile number is 9852281137"',
        '  "zero" (as Aadhaar/card digit) → "0"',
        '  "nineteen january nineteen sixty eight" → "19 January 1968"',
        '  "one to five" (IVR rating) → "1 to 5"',
        '  "on one date... on two dates... on five dates" → "on 1 date... on 2 dates... on 5 dates"',
        '  "the number is one two three four five" → "the number is 1 2 3 4 5"',
        '  "the last four numbers are zero" → "the last four numbers are 0"',
        "- Convert EVERY number word (one, two, three...) even when used as a count or ordinal.",
        "",
        "Hindi (Devanagari) examples:",
        '  "पंद्रह हजार रुपए" → "15,000 रुपये" or "₹15,000"',
        '  "एक रुपया और नब्बे पैसे" → "1.90 रुपये"',
        '  "एक से पांच" → "1 से 5"',
        "",
        "Bengali examples:",
        '  "এক টাকা নব্বই পয়সা" → "1.90 টাকা"',
        '  "zero" / "শূন্য" (last digit) → "0"',
        '  "পনের হাজার টাকা" → "15,000 টাকা"',
        "",
        "Tamil/Telugu/Marathi/Gujarati/Punjabi/Odia: same rule — number words → digits.",
        "",
        "Rules:",
        "- Use Indian numbering (lakh/crore): 1,99,999 not 199999 when appropriate.",
        "- Card/mobile/Aadhaar digit sequences → continuous digits (9854281137).",
        "- NEVER invent numbers not spoken.",
        "- Lines with NO numbers → return EXACTLY unchanged.",
        "- Keep the same language/script for non-numeric words.",
    ]
    return "\n".join(rules)


def entity_batch_prompt(lines: list[tuple[int, str, str]], language: str) -> str:
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    return (
        f"Normalize ALL numeric entities in every numbered {language} line below.\n"
        f"Return JSON: {{\"corrections\": {{\"1\": \"...\", \"2\": \"...\"}}}}\n"
        f"Include a key for EVERY line — unchanged lines copied verbatim.\n"
        f"No explanation.\n\n"
        f"Conversation:\n{numbered}"
    )
