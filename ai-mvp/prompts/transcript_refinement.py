"""Prompt builders for 3-step Transcript Refinement Agent (Auditor → Fixer → Verifier)."""

from __future__ import annotations

import json

REFINEMENT_FULL_CALL_MAX_LINES = 100


def _domain_hints(glossary_block: str, products: str) -> str:
    parts: list[str] = []
    if glossary_block:
        parts.append("Domain glossary (hints only — do not invent terms not spoken):\n" + glossary_block)
    if products:
        parts.append(f"Common product terms: {products}")
    return "\n".join(parts)


def auditor_system_prompt(language: str) -> str:
    lang = (language or "").strip() or "the spoken"
    return "\n".join([
        f"You are a forensic transcript auditor for {lang} Indian call-center/banking calls.",
        "Read the ENTIRE diarized conversation (Agent + Customer, chronological order).",
        "Detect inconsistencies and ASR errors — do NOT edit any line.",
        "",
        "Build an entity ledger: cluster mentions that refer to the same person, product, or phrase.",
        "Use phonetic similarity and cross-turn logic (not exact spelling).",
        "",
        "Flag issues when:",
        "- Customer name ≠ how Agent addresses them (e.g. fulkit vs mister police)",
        "- Customer phrase contradicted by Agent confirmation (icon pattern vs account balance)",
        "- Absurd honorifics (big Papa, Teacher when agent is Vinod → should be sir/madam)",
        "- ASR garbage in banking context (finared, manual data bursar, postcard vs mobile)",
        "- Same person named differently (Deep Gadhuli vs Deepak Adhikari)",
        "",
        "Issue types: name_mismatch, honorific_error, phrase_mismatch, asr_garbage, "
        "entity_label_mismatch, speaker_pov_error",
        "",
        "Output ONLY valid JSON matching the schema in the user message.",
        "confidence 0.0–1.0 per entity/issue. If no issues, return empty arrays.",
    ])


def auditor_user_prompt(
    lines: list[tuple[int, str, str]],
    language: str,
    *,
    glossary_block: str = "",
    products: str = "",
) -> str:
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    hints = _domain_hints(glossary_block, products)
    schema = (
        '{"call_summary":"...","entities":[{"entity_id":"E1","type":"person_name|phrase|product",'
        '"mentions":[{"line":1,"speaker":"Customer","surface":"..."}],'
        '"canonical_hypothesis":"...","confidence":0.0,"rationale":"..."}],'
        '"issues":[{"issue_id":"I1","type":"name_mismatch","severity":"high|medium|low",'
        '"lines":[1,2],"entity_id":"E1|null","description":"...","evidence_lines":[1,2],'
        '"confidence":0.0}]}'
    )
    body = f"Audit this {language} call transcript:\n{numbered}"
    if hints:
        body += f"\n\n{hints}"
    return (
        f"{body}\n\n"
        f"Return ONLY JSON: {schema}\n"
        "No markdown, no explanation outside JSON."
    )


def fixer_system_prompt(language: str) -> str:
    lang = (language or "").strip() or "the spoken"
    return "\n".join([
        f"You are a minimal transcript editor for {lang} call-center transcripts.",
        "You receive the full call PLUS an auditor report with issues and entities.",
        "Fix ONLY lines listed in issues[].lines — minimal edits to resolve each issue.",
        "",
        "Rules:",
        "- Align all lines tied to the same entity_id to one canonical form from entities[].",
        "- Use evidence_lines only — never invent OTP, PIN, amounts, or account numbers.",
        "- Do NOT change numeric digits (another pass handles numbers).",
        "- Customer keeps I/my; Agent keeps you/your.",
        "- Copy unchanged lines verbatim if not in any issue.",
        "- Output ONLY JSON with corrections array.",
        "",
        "CRITICAL examples you MUST fix when in issues list:",
        "- fulkid + mister police → Pulkit on BOTH customer and agent lines",
        "- icon pattern + account balance → customer says account balance",
        "- big Papa / Teacher → sir (when agent introduced as Vinod)",
        "- postcard number + mobile number → mobile number on customer line",
        "- Deep Gadhuli + Deepak Adhikari → one consistent name on both lines",
    ])


def fixer_issue_prompt(
    lines: list[tuple[int, str, str]],
    audit: dict,
    issue: dict,
    language: str,
) -> str:
    """Focused fixer prompt for a single issue (retry path)."""
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    schema = (
        '{"corrections":[{"line":1,"issue_id":"I1","original":"...","corrected":"...",'
        '"edit_type":"name_alignment","evidence_lines":[1,2]}]}'
    )
    return (
        f"Fix ONLY this issue in the {language} call transcript.\n"
        f"Issue:\n{json.dumps(issue, ensure_ascii=False, indent=2)}\n\n"
        f"Entities:\n{json.dumps(audit.get('entities') or [], ensure_ascii=False, indent=2)}\n\n"
        f"Full transcript:\n{numbered}\n\n"
        f"Return corrections for ALL lines in issue.lines.\n"
        f"Return ONLY JSON: {schema}"
    )


def fixer_user_prompt(
    lines: list[tuple[int, str, str]],
    audit: dict,
    language: str,
) -> str:
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    audit_json = json.dumps(audit, ensure_ascii=False, indent=2)
    schema = (
        '{"corrections":[{"line":1,"issue_id":"I1","original":"...","corrected":"...",'
        '"edit_type":"name_alignment|phrase_fix|honorific_fix|label_fix","evidence_lines":[1,2]}]}'
    )
    return (
        f"Full {language} transcript:\n{numbered}\n\n"
        f"Auditor report:\n{audit_json}\n\n"
        f"Propose corrections for every issue (all affected lines).\n"
        f"Return ONLY JSON: {schema}"
    )


def verifier_system_prompt(language: str) -> str:
    lang = (language or "").strip() or "the spoken"
    return "\n".join([
        f"You verify proposed {lang} transcript corrections for a banking call center.",
        "For each proposed correction, decide approve or reject.",
        "",
        "Approve when:",
        "- The fix resolves the auditor issue without inventing facts",
        "- Names/phrases are now consistent across cited evidence lines",
        "",
        "Reject when:",
        "- New digits/OTP/PIN/amounts appear that were not in the original call",
        "- Fix changes meaning beyond the cited issue",
        "- Fix introduces a name or fact with no support in evidence lines",
        "",
        "Output ONLY JSON with decisions array.",
    ])


def verifier_user_prompt(
    lines: list[tuple[int, str, str]],
    audit: dict,
    corrections: list[dict],
    language: str,
) -> str:
    numbered = "\n".join(f"{idx}. [{speaker}] {text}" for idx, speaker, text in lines)
    schema = (
        '{"decisions":[{"line":1,"issue_id":"I1","decision":"approve|reject",'
        '"reason":"..."}],"residual_issues":["..."]}'
    )
    return (
        f"Original {language} transcript:\n{numbered}\n\n"
        f"Auditor report:\n{json.dumps(audit, ensure_ascii=False, indent=2)}\n\n"
        f"Proposed corrections:\n{json.dumps(corrections, ensure_ascii=False, indent=2)}\n\n"
        f"Verify each correction. Return ONLY JSON: {schema}"
    )
