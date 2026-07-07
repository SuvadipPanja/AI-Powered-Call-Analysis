"""Prompt builders for Indic → English call translation (banking optional)."""

from __future__ import annotations

from bank_config import BankConfig

TRANSLATION_BATCH_SIZE = 10


def translation_system_prompt(config: BankConfig) -> str:
    org = config.org_label()
    parts = [
        f"You translate Indian call-center speech (Hindi, Hinglish, Bengali, or other Indic languages) "
        f"to clear English for {org}.",
        config.org_context_line(),
        "Rules:",
        "- Output ONLY the English translation — no timestamps, speaker labels, markdown, or commentary.",
        "- Write like a professional human interpreter: natural, fluent, conversational "
        "English. NEVER translate word-for-word or produce stiff, robotic phrasing.",
        "- Smooth over speech-to-text artifacts so it reads cleanly: collapse stuttered "
        "repetitions ('haan haan haan haan' → 'Yes.'), drop meaningless filler, and fix "
        "obvious broken grammar — but NEVER add facts, details, or sentences that were not spoken.",
        "- Preserve the meaning exactly. Do not summarise, embellish, or guess intent.",
        "- Preserve product names, brand names, and factual meaning exactly.",
        "- NUMERIC FORMAT (mandatory): convert ALL spoken amounts, balances, points, "
        "card/account/mobile digits, dates of birth, OTPs, and quantities to digits "
        "in the English output.",
        "  Examples: 'पंद्रह हजार रुपए' → '15,000 rupees'; "
        "'এক টাকা নব্বই পয়সা' → '1.90 rupees'; "
        "'fifteen thousand' → '15,000'; 'zero' (digit) → '0'.",
        "- Convert ALL counting words too: 'one date' → '1 date', 'two transactions' → '2 transactions'.",
        "- Digit-by-digit verification: 'one two three four five' → '1 2 3 4 5'.",
        "- Mobile/card runs: 'nine eight five triple two eight one one three seven' → '9852281137'; "
        "'9 8 5 triple 2 8 11 3 7' → '9852281137'.",
        "- Do NOT leave numbers as English words when they represent amounts or IDs.",
        "- Render Indian discourse words and honorifics idiomatically, not literally: "
        "जी/ji, हाँ/haan → 'yes'; अच्छा/accha → 'okay'/'I see'; ठीक है/theek hai → 'alright'; "
        "दादा/বাবু/भाई/सर/साहब → 'sir' or 'madam'. Never produce 'big brother' or 'big Babu'.",
        "- When the agent asks for a name (নাম / नाम), translate as 'name', not 'surname'.",
        "- Spoken English product terms (T Plus, account balance, application, SMS) stay as-is.",
        "- Keep each speaker's point of view exactly. A line spoken by the Customer is "
        "about the customer's own account/request — translate it in the FIRST person "
        "('I', 'my', 'me'). A line spoken by the Agent addresses the customer as 'you'. "
        "Never swap 'I' and 'you' between speakers, and never rewrite a customer's request "
        "as if the agent said it.",
        "- If the domain is unclear, use neutral professional English.",
    ]
    if org != "the organization":
        parts.append(f'- When the agent mentions the organization, use the name "{org}".')
    glossary = config.glossary_block()
    if glossary:
        parts.append("\nPreferred term mappings (when applicable):\n" + glossary)
    products = config.product_terms_line()
    if products:
        parts.append(f"\nBanking / financial terms: {products}")
    non_banking = config.non_banking_terms_line()
    if non_banking:
        parts.append(f"\nNon-banking / general support terms: {non_banking}")
    return "\n".join(parts)


def translation_batch_prompt(lines: list[tuple[int, str, str]], config: BankConfig) -> str:
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    return (
        "Translate each numbered line (Indian language / Hinglish) to English.\n"
        "Each line is tagged with its speaker in square brackets ([Customer] or [Agent]) "
        "for context — keep that speaker's point of view, but do NOT include the tag in "
        "the output.\n"
        "Return ONLY a JSON object: {\"translations\": {\"1\": \"...\", \"2\": \"...\"}}\n"
        "Use the line numbers as keys. No extra keys or explanation.\n\n"
        f"Lines:\n{numbered}"
    )


def translation_single_prompt(speech: str, speaker: str | None = None) -> str:
    who = f" The speaker is the {speaker}; keep their point of view." if speaker else ""
    return (
        "Translate the following Indian call-center speech to English.\n"
        f"Reply with ONLY the English translation — one line, no explanation.{who}\n\n"
        f"{speech}"
    )
