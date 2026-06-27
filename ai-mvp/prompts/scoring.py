"""Prompt builders for call quality scoring (banking optional)."""

from __future__ import annotations

from bank_config import BankConfig

# What "good" looks like for each rubric dimension. Anchors the LLM to a concrete
# QA standard instead of a vague notion of "professionalism". {org} is filled in.
DIMENSION_PROTOCOL: dict[str, str] = {
    "Opening_Speech": (
        "CHECKLIST for opening (score separately from other dimensions):\n"
        "  (A) Greeting/welcome — welcome, namaste, hello, hi, good morning/afternoon/evening, "
        "thank you for calling\n"
        "  (B) Organization/bank branding — names the bank/org (e.g. \"Welcome to {org}\")\n"
        "  (C) Agent's OWN name — states their name (e.g. \"my name is ___\")\n"
        "  (D) Offer to help — how may/can I help/assist you\n"
        "SCORING RULE: If (A)+(B)+(C)+(D) are ALL present in the agent's opening, score 9-10 "
        "(90-100). Missing ONLY a time-of-day phrase (good morning/evening) must NOT reduce below 9. "
        "Score 9-10 for: \"Welcome to {org}, my name is Charlie, how may I assist you?\" even without "
        "good morning. Score 7-8 only when one checklist item is missing. Score below 7 only when "
        "two or more items are missing or absent."
    ),
    "Empathy": (
        "Agent is warm, reassuring and customer-focused (\"I understand\", \"I'll help you "
        "with that\"). If the customer shows NO distress, judge by the agent's general warmth — "
        "do NOT lower this just because there was no emotional moment, and NEVER lower it because "
        "the customer was rude. An agent who stays warm with a rude customer scores 9-10."
    ),
    "Query_Handling": (
        "Agent understands the request and gives a correct, complete, easy-to-follow answer or "
        "set of steps. Confirming details is a plus but not required for a simple, clear request."
    ),
    "Adherence_to_Protocol": (
        "Agent follows required process and any compliance step that applies "
        "(call-recording / KYC / RBI disclosure, correct procedure for the request)."
    ),
    "Resolution_Assurance": (
        "Agent states clear next steps and a concrete timeline (e.g. \"within 24 hours\") "
        "so the customer knows what happens next."
    ),
    "Query_Resolution": (
        "The customer's request was answered/resolved, or correctly logged/routed. Giving the "
        "correct, complete information or steps that answer a how-to/information request COUNTS as "
        "resolved — even if the customer does not explicitly confirm success on the call."
    ),
    "Polite_Tone": (
        "Agent stays courteous and professional throughout. The CUSTOMER'S tone is irrelevant — "
        "an agent who remains polite while the customer is rude scores 9-10, never lower."
    ),
    "Authentication_Verification": (
        "Before sharing or changing sensitive account information, the agent verifies the "
        "caller's identity (e.g. name + date of birth / account number / registered mobile). "
        "If the call never touches sensitive data, this is N/A."
    ),
    "Escalation_Handling": (
        "If the issue required escalation or a transfer, the agent did it correctly and set "
        "expectations. If no escalation was needed, this is N/A."
    ),
    "Closing_Speech": (
        "CHECKLIST for closing:\n"
        "  (A) Thanks the customer — thank you, thanks, dhanyavad, shukriya\n"
        "  (B) Proper wrap-up — asks \"anything else?\" / further assistance OR wishes good/nice day "
        "OR branded thank-you sign-off (e.g. thank you for calling {org})\n"
        "SCORING RULE: If (A) and (B) are both present, score 9-10 (90-100). If the agent gave a "
        "clear thank-you and a polite sign-off even without a long script, score 9-10. Score 7-8 "
        "only when closing is brief but still polite. Score below 7 only when the agent hangs up "
        "without thanking or closing."
    ),
}

NA_ELIGIBLE = ("Authentication_Verification", "Escalation_Handling")


def _protocol_block(org: str) -> str:
    lines = []
    for key, desc in DIMENSION_PROTOCOL.items():
        label = key.replace("_", " ")
        lines.append(f"- {label}: {desc.format(org=org)}")
    return "\n".join(lines)


def scoring_system_prompt(config: BankConfig) -> str:
    org = config.org_label()
    org_hint = (
        f"When the agent should mention the organization, expect \"{org}\" or equivalent. "
        if org != "the organization"
        else "Evaluate agent professionalism for any call-center domain (not only banking). "
    )
    return (
        f"You are a senior call-center quality auditor for {org} with 15+ years experience. "
        f"{config.org_context_line()} "
        "You evaluate ONLY the agent's performance, using specific evidence from the transcript. "
        "The transcript lines are tagged (Agent) or (Customer); judge only the (Agent) lines, "
        "using the (Customer) lines as context.\n"
        "Scoring guide (per dimension, 0-10):\n"
        "  10  = excellent / textbook execution of THIS dimension\n"
        "  8-9 = done well and professionally (good)\n"
        "  6-7 = done, but with a noticeable gap or it could be smoother\n"
        "  4-5 = done only partially or weakly\n"
        "  2-3 = poor attempt\n"
        "  0-1 = absent or wrong\n"
        "Judge EACH dimension SEPARATELY on its own evidence in THIS call. The dimensions will "
        "usually NOT all be the same number — do not give a uniform score across the board, and do "
        "not inflate a dimension the agent did not actually perform. Award 8-10 only when THAT "
        "specific dimension was genuinely done well; lower it when that dimension was rushed, weak, "
        "skipped, or missing. Reward real quality, but stay discriminating so that a strong call and "
        "a mediocre call do not get the same scores. A genuinely clean, professional call can reach "
        "the 90s overall; a call with real gaps should score lower.\n"
        "CRITICAL — customer rudeness rule: a rude, abusive, or uncooperative CUSTOMER must NEVER "
        "lower the agent's scores and must NEVER change the Call Type or Resolution Status. If the "
        "customer says things like \"shut up\", that is the CUSTOMER being rude — it is NOT agent "
        "rudeness, it is NOT a complaint, and it does NOT make the call unresolved. An agent who "
        "stays calm and courteous under such pressure scores 9-10 on Polite Tone and Empathy.\n"
        "Rude_Behavior = \"Yes\" ONLY when the AGENT uses rude/abusive/dismissive language toward the "
        "customer. The customer being rude is always Rude_Behavior = \"No\".\n"
        "Resolution: if the agent gives the correct, complete answer or steps for the customer's "
        "request and the customer does not report that it failed or raise a new unmet need, the call "
        "is Resolved (a customer ending with \"no, thank you\" after a full answer = Resolved).\n"
        "Call Type: classify by the customer's actual reason for calling (e.g. asking how to do "
        "something = Inquiry or Service Request). Use Complaint ONLY when the customer is complaining "
        "about a bank service/product/staff failure — not because the customer was rude.\n"
        "Opening & Closing Speech — mandatory calibration:\n"
        "  • Opening = 9-10 when agent's first turn includes welcome/greeting + bank/org name + "
        "agent's own name + offer to help — even WITHOUT good morning/evening.\n"
        "  • Closing = 9-10 when agent thanks the customer AND gives a proper wrap-up or sign-off.\n"
        "  • Do NOT score Opening or Closing at 8 when the checklist above is fully satisfied — "
        "that is 9-10, not \"good but not excellent\".\n"
        "Be consistent: the same call must always receive the same scores. "
        "Every numeric score MUST be justified by a short quote or moment in the Evidence object. "
        f"{org_hint}"
    )


def scoring_json_prompt(transcript: str, config: BankConfig) -> str:
    org = config.org_label()
    glossary = config.glossary_block(max_items=20)
    glossary_section = f"\nDomain glossary (optional context):\n{glossary}\n" if glossary else ""
    protocol = _protocol_block(org)

    return f"""Analyze this call-center transcript ({org}) and return ONLY valid JSON (no markdown, no commentary).

Score each dimension 0-10 (integer) against this standard of what a good agent does:
{protocol}

N/A rule: for "Authentication Verification" and "Escalation Handling" ONLY, if the dimension
genuinely did not apply to this call (no sensitive data was shared/changed, or no escalation was
needed), output the string "N/A" for that dimension instead of a number, and list it in
"NA_Dimensions". Do NOT invent a score for a dimension that did not apply, and do NOT use N/A for
any other dimension.

You MUST evaluate each dimension independently, based only on evidence in this transcript.

Required JSON keys (ALL must be present):
Opening_Speech, Empathy, Query_Handling, Adherence_to_Protocol, Resolution_Assurance,
Query_Resolution, Polite_Tone, Authentication_Verification, Escalation_Handling,
Closing_Speech, Rude_Behavior, Overall_Scoring, Call_Type, Lead_Classification,
Resolution_Status, NA_Dimensions, Evidence, Feedback, Summary

Constraints:
- Each rubric dimension: an integer 0-10, or "N/A" only where the N/A rule allows.
- NA_Dimensions: a JSON array listing any dimensions you marked "N/A" (empty array if none).
- Evidence: a JSON object mapping each scored dimension to ONE short quote/moment that justifies
  its score (e.g. {{"Opening_Speech": "'Welcome to {org}, my name is Ravi' — full branded greeting"}}).
- Overall_Scoring: 0-100, reflecting overall agent quality across the dimensions that applied.
- Rude_Behavior: exactly "Yes" or "No". "Yes" ONLY if the AGENT was rude/abusive/dismissive.
  A rude CUSTOMER (e.g. "shut up") is always "No".
- Call_Type: exactly one of [Complaint, Inquiry, Transaction Issue, Service Request, Sales, Other].
  Classify by the customer's reason for calling. A how-to / information request is Inquiry or
  Service Request. Use Complaint ONLY for a genuine complaint about a bank service/product/staff —
  NOT because the customer was rude.
- Lead_Classification: exactly one of [Hot Lead, Cold Lead, Warm Lead, Not a Lead]
- Resolution_Status: exactly one of [Resolved, Pending, Escalated, Unresolved]. Mark Resolved when
  the agent gave the correct, complete answer/steps and the customer did not report failure or a new
  unmet need (ending with "no, thank you" after a full answer = Resolved).
- Opening_Speech: use the checklist in the protocol. All four elements (greeting + bank/org + agent
  name + offer to help) = 9 or 10. Missing only good morning/evening is still 9-10.
- Closing_Speech: thank-you + wrap-up/sign-off = 9 or 10. Do not score 8 when both are present.
- Feedback: 2-3 sentences for the agent's coach — FIRST one concrete thing the agent did well
  (cite the moment), THEN the single most important thing to improve next time (cite the moment).
- Summary: 2-3 factual sentences (caller's reason + what happened + outcome).
{glossary_section}
Transcript:
{transcript}
"""


def scoring_line_prompt(transcript: str, config: BankConfig) -> str:
    org = config.org_label()
    return f"""Analyze this call-center transcript ({org}). Score each criterion 0-10 (integers) based on evidence.
Scale: 10 excellent, 8-9 done well, 6-7 noticeable gap, 4-5 partial/weak, 2-3 poor, 0-1 missing/wrong.
Judge each criterion SEPARATELY on its own evidence — they will usually NOT all be the same number.
Do not give a uniform score or inflate a criterion the agent did not actually perform. Stay
discriminating so a strong call and a mediocre call do not get the same scores. A genuinely clean,
professional call can reach the 90s overall; a call with real gaps should score lower. Overall Scoring is 0-100.
A rude CUSTOMER (e.g. "shut up") must NEVER lower the agent's scores, must NOT make Rude Behavior
"Yes" (that is AGENT-only), must NOT make Call Type "Complaint", and must NOT make it Unresolved.
Giving the correct, complete answer/steps = Resolved even if the customer does not confirm success.
Opening Speech: 9-10 if welcome + bank/org + agent name + offer to help (good morning NOT required).
Closing Speech: 9-10 if thank-you + wrap-up/sign-off both present.
Output ONLY these lines, one per line, no markdown:

Opening Speech: <0-10>
Empathy: <0-10>
Query Handling: <0-10>
Adherence to Protocol: <0-10>
Resolution Assurance: <0-10>
Query Resolution: <0-10>
Polite Tone: <0-10>
Authentication & Verification: <0-10 or N/A>
Escalation Handling: <0-10 or N/A>
Closing Speech: <0-10>
Rude Behavior: Yes or No
Overall Scoring: <0-100>
Call Type: Inquiry or Service Request or Transaction Issue or Complaint or Sales or Other
Lead Classification: Hot Lead or Cold Lead or Warm Lead or Not a Lead
Resolution Status: Resolved or Pending or Escalated or Unresolved
Feedback: <2-3 sentences: one strength then the top improvement, each citing a moment>
Summary: <2-3 sentence summary>

Transcript:
{transcript}
"""
