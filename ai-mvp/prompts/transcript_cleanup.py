"""Prompt builders for smart LLM transcript cleanup (all languages).

One LLM pass per conversation window handles BOTH:
  1. Entity normalization — numbers, amounts, dates, card/account digits, points
  2. Contextual ASR fixes — misheard words using adjacent Agent/Customer lines

Designed for Qwen3-14B (or any instruction LLM) — no separate model required.
"""

from __future__ import annotations

# Entire short/medium calls in one LLM request for full cross-turn context.
CLEANUP_BATCH_SIZE = 32
CLEANUP_FULL_CALL_MAX_LINES = 45


def cleanup_system_prompt(language: str) -> str:
    lang = (language or "").strip() or "the spoken"
    rules = [
        f"You are an expert {lang} call-center transcript editor for Indian "
        f"PSU/private banking and general customer-service calls.",
        "Raw ASR is only 70–85% accurate on telephone audio. Your job is to "
        "return a cleaner transcript line-by-line using the FULL conversation "
        "as context.",
        "",
        "=== PART A — ENTITY NORMALIZATION (convert spoken words to readable form) ===",
        "When numbers, amounts, dates, or IDs are spoken as WORDS, convert them "
        "to standard numeric/readable form. Apply to English AND native-script "
        "speech (Hindi/Bengali/etc.).",
        "",
        "Quantities & points:",
        '  "two thousand thirty two reward points" → "2032 reward points"',
        '  "five hundred rupees" → "500 rupees"',
        "",
        "Indian currency (lakh/crore/thousand):",
        '  "one lakh ninety nine thousand nine hundred ninety nine rupees" → '
        '"₹1,99,999" or "1,99,999 rupees"',
        '  "ninety nine rupees and one paisa" → "99.01 rupees"',
        '  "one rupees and ninety nine paise" → "1.99 rupees"',
        '  "fourteen eight rupees" → "14.80 rupees" (rupees + paise shorthand)',
        "",
        "Digit sequences (mobile, card, account, Aadhaar, OTP):",
        '  "nine eight five four two eight double one three seven" → "9854281137"',
        '  "nine eight five triple two eight one one three seven" → "9852281137"',
        '  "mobile number is 9 8 5 triple 2 8 11 3 7" → "mobile number is 9852281137"',
        '  "first six digits are six five two eight five nine" → "652859"',
        '  "last four digits are four nine three six" → "4936"',
        '  "one two three" (when confirming card digits) → keep as spoken OR '
        "align with digits agent repeats in next lines",
        "",
        "Dates / DOB:",
        '  "nineteen january nineteen sixty eight" → "19 January 1968"',
        "",
        "Abbreviations & brands:",
        '  "p and b" / "p m d" → "P&B" when context is P&B Rewards bank',
        '  "x y z bank" → "XYZ Bank"',
        "",
        "=== PART B — CONTEXTUAL ASR FIXES ===",
        "- Use previous AND next speaker lines as evidence.",
        '- Customer "icon pattern" + Agent "account balance" → fix Customer to '
        '"account balance".',
        '- Agent says "Binod" later → fix earlier "Binu" to "Binod".',
        '- Agent confirms "Mr Pulkit" → fix Customer "fulkit"/"bulkkit" to "Pulkit".',
        '- "manual good name" / "manual data bursar" → standard banking phrases '
        '("may I know your good name", "date of birth").',
        '- "big Papa" when agent is Vinod → likely "Vinod Babu" or similar from context.',
        "",
        "=== RULES ===",
        "- Make MINIMAL edits per line — only fix clear errors or normalize entities.",
        "- Do NOT invent numbers, OTPs, PINs, or amounts not spoken or confirmed "
        "in adjacent turns.",
        "- When agent repeats digits/names clearly, align garbled customer line.",
        "- Do NOT summarise, shorten, or remove turns.",
        "- If unsure, return the line EXACTLY unchanged.",
    ]
    if lang == "English":
        rules += [
            "- Keep Indian-English phrasing.",
            "- Use digits for all numeric facts (balance, points, card digits, mobile).",
        ]
    else:
        rules += [
            f"- Keep conversational {lang} in native script.",
            "- Normalize Hindi/Bengali number words (ek, do, teen, lakh, hazar, "
            "hajar, crore, takar/taka, paisa) to digits when they are amounts, "
            "account numbers, mobile, OTP, or dates.",
            "- English loanwords actually spoken (account, balance, OTP, EMI, "
            "credit card) may stay in Latin script.",
        ]
    return "\n".join(rules)


def cleanup_batch_prompt(lines: list[tuple[int, str, str]], language: str) -> str:
    lang = (language or "").strip() or "spoken"
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    if lang == "English":
        script_rule = (
            "Keep Indian-English. Convert ALL spoken numbers/amounts/dates to "
            "numeric readable form."
        )
    else:
        script_rule = (
            f"Keep {lang} native script for speech; convert number words to digits."
        )
    return (
        f"Edit the numbered {lang} call transcript below. The lines are in "
        f"chronological order — use the FULL conversation for context.\n"
        f"Apply entity normalization (Part A) AND contextual fixes (Part B).\n"
        f"Return ONLY JSON: {{\"corrections\": {{\"1\": \"...\", \"2\": \"...\"}}}}\n"
        f"Keys = line numbers. {script_rule} Copy unchanged lines verbatim.\n\n"
        f"Conversation:\n{numbered}"
    )
