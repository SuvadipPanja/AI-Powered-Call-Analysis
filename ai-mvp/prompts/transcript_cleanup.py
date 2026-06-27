"""Prompt builders for in-language ASR transcript cleanup (Hindi/Bengali/etc.).

This is a CONSERVATIVE correction pass: it fixes obvious speech-to-text errors
(misheard or broken words, wrong homophones) using conversational context, while
keeping the text in its original language/script. It must NOT translate, add,
remove, summarise, or invent facts (names, numbers, amounts).
"""

from __future__ import annotations

CLEANUP_BATCH_SIZE = 12


def cleanup_system_prompt(language: str) -> str:
    return "\n".join(
        [
            f"You are an expert {language} transcription editor for Indian bank "
            f"call-center recordings. You receive raw speech-to-text (ASR) output "
            f"that contains recognition errors.",
            "Rules:",
            f"- Make MINIMAL edits only. Change as few words as possible per line.",
            f"- Fix ONLY obvious ASR errors: misheard words, broken/split words, "
            f"wrong homophones, missing matras/spacing.",
            f"- Keep the text in {language} using its native script (Bengali "
            f"বাংলা / Hindi देवनागरी). Do NOT transliterate Bengali/Hindi words "
            f"into Latin letters.",
            "- English/Hinglish words that were actually spoken (account, balance, "
            "T Plus, application, SMS, maintenance) may stay in Latin script.",
            "- Do NOT add, remove, summarise, or rephrase. Keep the speaker's exact "
            "meaning and similar length.",
            "- Do NOT invent or 'fix' facts. Never shorten or alter person names — "
            "if a name looks garbled, return the line unchanged.",
            "- Leave numbers, account IDs, amounts, and product names unchanged.",
            "- If a line is already correct, repetitive (yes yes yes), or you are "
            "unsure, return it EXACTLY unchanged.",
        ]
    )


def cleanup_batch_prompt(lines: list[tuple[int, str, str]], language: str) -> str:
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    return (
        f"Correct ASR errors in each numbered {language} line. Each line is tagged "
        f"with its speaker in square brackets for context — do NOT include the tag "
        f"in the output.\n"
        f"Return ONLY a JSON object: {{\"corrections\": {{\"1\": \"...\", \"2\": \"...\"}}}}\n"
        f"Use the line numbers as keys. Every value must stay in {language} native "
        f"script except English words already present. Copy unchanged lines verbatim. "
        f"No extra keys, no explanation.\n\n"
        f"Lines:\n{numbered}"
    )
