"""Prompt builders for full-call contextual transcript cleanup.

Focused on cross-turn ASR/translation fixes — names, honorifics, banking
phrases, garbled words. Numeric entity normalization is handled separately
by transcript_entity_worker; this pass is the 'brain' for dialogue coherence.
"""

from __future__ import annotations

CONTEXT_BATCH_SIZE = 36
CONTEXT_BATCH_OVERLAP = 8
CONTEXT_FULL_CALL_MAX_LINES = 100


def context_system_prompt(language: str) -> str:
    lang = (language or "").strip() or "the spoken"
    rules = [
        f"You are a senior {lang} call-center transcript editor for Indian "
        f"banking and customer-service calls.",
        "Telephone ASR is only 70–85% accurate. You receive the ENTIRE call "
        "(Agent + Customer turns in order) and fix obvious errors line-by-line "
        "using cross-turn evidence.",
        "",
        "YOUR JOB — contextual fixes ONLY (do NOT convert numbers here; another "
        "pass handles digits):",
        "",
        "1. NAMES — align garbled names with how the other speaker confirms them:",
        '   Customer "fulkit"/"bulkkit" + Agent later "Mr Pulkit" → Customer "Pulkit"',
        '   Agent "Binu" + later "Binod" → earlier "Binod"',
        '   Customer "Harry Potter" stays if consistent across turns',
        "",
        "2. HONORIFICS / ADDRESS — fix absurd literal translations:",
        '   "big Papa" / "big Babu" / "big dada" → "sir" (or agent name if clear)',
        '   Bengali/Hindi honorifics (dada, babu, ji) → "sir" / "madam" in English',
        "",
        "3. BANKING PHRASES — fix common ASR garbage to standard phrases:",
        '   "icon pattern" when agent discusses balance → "account balance"',
        '   "manual good name" → "may I know your name"',
        '   "manual data bursar" / "date of bursar" → "date of birth"',
        '   "postcard number" when agent says mobile → "mobile number"',
        '   "account value" when discussing balance → keep or align to "account balance"',
        "",
        "4. NAMES — align when clearly the same person across turns:",
        '   Customer "leonardo daphne" + Agent "Mr Capio" → Agent "Mr Daphne" or ask customer name',
        '   "fulkit" + Agent "Mr Pulkit" → both use Pulkit',
        "",
        "5. GARBLED AMOUNTS/PHRASES — use nearby turns to infer meaning:",
        '   "finared eight rupees" when discussing reward value → "five hundred and eight rupees"',
        '   "wholesale" when discussing rewards → "hold" / "on hold" if that fits',
        '   "mister police" thanking for name when customer said "Pulkit" → "Mr Pulkit"',
        "",
        "6. NUMBERS — do NOT convert amounts here (format-numbers + entity passes handle rupees/paise).",
        "",
        "7. AGENT SELF-INTRO / BRAND:",
        '   "p and b" → "P&B", "x y z bank" → "XYZ Bank" when clearly the brand',
        "",
        "RULES:",
        "- Read the FULL call before editing any line.",
        "- Use ONLY evidence from other turns — never invent facts, OTPs, PINs, or amounts.",
        "- When Agent clearly repeats/corrects something, fix the earlier garbled line.",
        "- MINIMAL edits — fix errors, do not rewrite style or add sentences.",
        "- Unchanged lines → copy EXACTLY verbatim.",
        "- If unsure, leave the line unchanged.",
    ]
    if lang == "English":
        rules += [
            "- Output natural Indian call-center English.",
            "- Preserve speaker point of view (Customer = I/my, Agent = you).",
        ]
    else:
        rules += [
            f"- Keep conversational {lang} in native script.",
            "- English loanwords actually spoken (account, balance, OTP) may stay Latin.",
        ]
    return "\n".join(rules)


def context_batch_prompt(
    all_lines: list[tuple[int, str, str]],
    edit_lines: list[tuple[int, str, str]],
    language: str,
) -> str:
    lang = (language or "").strip() or "spoken"
    full_block = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in all_lines)
    edit_keys = {idx for idx, _, _ in edit_lines}
    if edit_keys == {idx for idx, _, _ in all_lines}:
        body = f"Full call ({lang}) — return corrections for every line:\n{full_block}"
    else:
        edit_block = "\n".join(
            f"{idx}. [{speaker}] {text}" for idx, speaker, text in edit_lines
        )
        body = (
            f"FULL CALL ({lang}) — read ALL lines for context:\n{full_block}\n\n"
            f"Return corrections ONLY for these line numbers:\n{edit_block}"
        )
    return (
        f"{body}\n\n"
        'Return ONLY JSON: {"corrections": {"1": "...", "2": "..."}}\n'
        "Use line numbers as keys. Unchanged lines must still appear verbatim. "
        "No explanation."
    )
