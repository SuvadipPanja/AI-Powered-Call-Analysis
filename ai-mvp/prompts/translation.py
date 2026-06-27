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
        "- Preserve product names, brand names, numbers, IDs, and amounts exactly.",
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
