"""Prompt builder for per-call intelligence extraction.

Extracts business intelligence from a call transcript that the scoring rubric
does not cover: escalation handling, the customer's main query category, and
loan / lead signals. Kept separate from prompts/scoring.py so the carefully
calibrated quality scoring stays stable.
"""

from __future__ import annotations

from bank_config import BankConfig

try:  # single source of truth for the default taxonomy
    from query_categories import DEFAULT_CATEGORIES as _DEFAULTS
    QUERY_CATEGORIES: tuple[str, ...] = tuple(name for (name, *_rest) in _DEFAULTS)
except Exception:  # pragma: no cover - defensive fallback
    QUERY_CATEGORIES = (
        "Balance/Account Enquiry",
        "ATM/Debit Card Issue",
        "ATM/Debit PIN Generation",
        "New ATM/Debit Card Request",
        "Complaint/Grievance",
        "Branch/ATM Locator/Referral",
        "Net Banking/Mobile App Issue",
        "Loan Enquiry",
        "Bank Server/Technical Issue",
        "Payment Deducted/Failed Transaction",
        "KYC/Document Update",
        "Other/General Info",
    )

LOAN_TYPES: tuple[str, ...] = (
    "Home Loan",
    "Car Loan",
    "Personal Loan",
    "Education Loan",
    "Gold Loan",
    "Business Loan",
    "Other Loan",
    "None",
)

ESCALATION_CATEGORIES: tuple[str, ...] = (
    "Manager/Supervisor",
    "Fraud",
    "RBI",
    "Other",
    "None",
)

INTEREST_LEVELS: tuple[str, ...] = ("High", "Medium", "Low", "None")
EMI_AFFORDABILITY: tuple[str, ...] = ("Yes", "No", "Not Discussed")
AGENT_CONVINCED: tuple[str, ...] = ("Yes", "Partial", "No", "N/A")
YES_NO: tuple[str, ...] = ("Yes", "No")
YES_NO_NA: tuple[str, ...] = ("Yes", "No", "N/A")


def _bullet_list(values: tuple[str, ...]) -> str:
    return ", ".join(values)


def _category_block(categories: list[dict] | None) -> str:
    """Render the admin-managed query categories as `- Name: description [keywords]`.

    Keywords are the admin-maintained trigger phrases from the Query Types page;
    including them lets the LLM anchor each category to the customer's actual
    words instead of guessing from the name alone. Falls back to the built-in
    QUERY_CATEGORIES if none are supplied so the prompt is always valid.
    """
    if not categories:
        return "\n".join(f"- {name}" for name in QUERY_CATEGORIES)
    lines = []
    for c in categories:
        name = (c.get("name") or "").strip()
        if not name:
            continue
        desc = (c.get("description") or "").strip()
        kws = (c.get("keywords") or "").strip()
        if len(kws) > 160:  # keep the prompt bounded on long admin keyword lists
            kws = kws[:160].rsplit(",", 1)[0]
        line = f"- {name}"
        if desc:
            line += f": {desc}"
        if kws:
            line += f" [keywords: {kws}]"
        lines.append(line)
    return "\n".join(lines) if lines else "\n".join(f"- {name}" for name in QUERY_CATEGORIES)


def intelligence_system_prompt(config: BankConfig) -> str:
    org = config.org_label()
    return (
        f"You are a banking call-center analyst for {org}. "
        "You read a call transcript whose lines are tagged (Agent) or (Customer) "
        "and extract structured business intelligence about WHAT the call was about "
        "and the customer's intent — NOT a quality score. "
        "Base every field strictly on evidence in the transcript. When something was "
        "not discussed, use the explicit 'not discussed' / 'None' / 'No' option rather "
        "than guessing. Return ONLY valid JSON, no markdown, no commentary."
    )


def intelligence_json_prompt(transcript: str, config: BankConfig, categories: list[dict] | None = None) -> str:
    org = config.org_label()
    return f"""Analyze this {org} call transcript and extract intelligence as ONLY valid JSON.

Choose Primary_Query_Type — the SINGLE main reason the customer called. You MUST pick the
most SPECIFIC matching category name (copy the name EXACTLY) from this list:
{_category_block(categories)}

Rules for picking the category:
- Always prefer the most specific match. E.g. if the customer wants to generate/reset their
  ATM/debit card PIN, pick "ATM/Debit PIN Generation", NOT the broader "ATM/Debit Card Issue".
- REQUEST vs ISSUE: a category whose name/description says "Issue", "Problem", "Failed",
  "Blocked", "Complaint", "Dispute" or "Fraud" is ONLY for something that is actually broken,
  failed, declined, blocked, or a grievance. Do NOT use an "Issue/Problem" category for a normal
  service request, an enquiry, or a task the agent completes successfully.
- A request to DO or KNOW something (redeem reward points/cashback, check points or balance,
  get a statement, generate a PIN, apply for a card, transfer funds, update details) is a
  service REQUEST/ENQUIRY — pick the specific request/enquiry/rewards category, NEVER an
  "Issue" category, unless the customer explicitly reports that something went wrong.
- Reward points / cashback / points redemption → pick the rewards/redemption category if one
  exists (e.g. "Credit Card Rewards/Redemption"); otherwise the closest request/enquiry category.
- Use each category's [keywords] as strong evidence: prefer the category whose keywords match
  what the CUSTOMER actually said (the customer's own words outweigh the agent's words).
- Balance vs statement — decide by what the CUSTOMER ASKED FOR, not what the agent did:
  * Customer wants to KNOW HOW MUCH money is in the account ("balance", "how much do I have",
    "available balance") → "Balance/Account Enquiry", EVEN IF the agent also reads out or sends
    recent transactions.
  * Pick "Mini Statement/Transaction History" ONLY when the customer explicitly asks for recent
    transactions / mini statement / last few transactions.
  * Pick a full statement category (e.g. "Account Statement Request") ONLY for a complete or
    emailed statement for a period, or a passbook update.
- Copy the category name EXACTLY as written above (text before the colon).
- If no listed category clearly matches, choose "Other/General Info" rather than forcing a wrong
  specific category (especially an "Issue/Problem/Complaint" one).

Secondary_Query_Types: a JSON array of any OTHER category names from the same list that also
came up (empty array if none). Do NOT repeat the primary one.

Escalation (this is ONLY about the CUSTOMER asking to be handed to a more senior HUMAN):
- Escalation_Requested: "Yes" ONLY if the CUSTOMER explicitly asks to speak to a senior person —
  a supervisor, manager, team leader, higher official — or asks to escalate a complaint to a higher
  authority. If the customer never asks for that, it is "No".
  CRITICAL: An automated or routine transfer is NOT an escalation. Transferring the call to a
  feedback / rating / satisfaction / CSAT / IVR / survey system, or ANY transfer the agent starts
  that the customer did not ask for, is NOT an escalation -> "No".
- Escalation_Actioned: "Yes" ONLY if Escalation_Requested is "Yes" AND the agent transferred the
  customer to (or arranged) a senior person. "No" if the customer asked but the agent did not.
  "N/A" if Escalation_Requested is "No".
- Escalation_Category: which authority/area the escalation was about — one of
  [{_bullet_list(ESCALATION_CATEGORIES)}] ("None" when Escalation_Requested is "No").

CSAT transfer (separate from escalation):
- CSAT_Transferred: "Yes" if, typically at the END of the call, the agent transfers/routes the
  customer to a feedback / satisfaction / rating / CSAT / IVR / survey system so the customer can
  rate the agent or the call (e.g. "your call will be transferred for feedback", "you can provide
  feedback on our conversation", "please rate this call", "C-SAT"). Otherwise "No".

Loan / lead (fill only from what was actually said; use defaults when not a loan call):
- Is_Loan_Call: "Yes" if a loan was discussed/requested/offered, else "No".
- Loan_Type: one of [{_bullet_list(LOAN_TYPES)}] ("None" if no loan).
- Customer_Interest: the customer's genuine interest in taking the loan, judged from their
  tone and words — one of [{_bullet_list(INTEREST_LEVELS)}].
- EMI_Affordability: did the customer indicate they can pay the EMI on time? one of
  [{_bullet_list(EMI_AFFORDABILITY)}].
- EMI_Amount: the monthly EMI amount in rupees if a specific number was stated, else null.
- Loan_Amount: the loan/principal amount in rupees if a specific number was stated, else null.
- Agent_Convinced: did the agent properly pitch/convince the customer for the loan? one of
  [{_bullet_list(AGENT_CONVINCED)}] ("N/A" if not a loan call).
- Success_Probability: an integer 0-100 — your estimate of how likely this customer is to
  actually take the loan, based on their interest, EMI ability and the agent's pitch
  (0 when not a loan call).

Required JSON keys (ALL must be present):
{{
  "Primary_Query_Type": "<one category>",
  "Secondary_Query_Types": ["<category>", ...],
  "Escalation_Requested": "Yes|No",
  "Escalation_Actioned": "Yes|No|N/A",
  "Escalation_Category": "<category>",
  "CSAT_Transferred": "Yes|No",
  "Is_Loan_Call": "Yes|No",
  "Loan_Type": "<loan type>",
  "Customer_Interest": "High|Medium|Low|None",
  "EMI_Affordability": "Yes|No|Not Discussed",
  "EMI_Amount": <number or null>,
  "Loan_Amount": <number or null>,
  "Agent_Convinced": "Yes|Partial|No|N/A",
  "Success_Probability": <0-100>,
  "Intelligence_Summary": "<one short sentence on the customer's intent/outcome>"
}}

Transcript:
{transcript}
"""


def category_discovery_prompt(
    transcript: str, config: BankConfig, categories: list[dict] | None = None
) -> str:
    """Ask the LLM to propose ONE genuinely new, reusable query category.

    Used only when the call did not match any existing category. The model must
    either return a specific, reusable banking category (name + description +
    keywords) or decline. Returns a prompt expecting strict JSON.
    """
    org = config.org_label()
    existing = _category_block(categories)
    return f"""You maintain the customer-query taxonomy for {org}.

The following call did NOT match any of these EXISTING categories:
{existing}

Decide whether this call is about a SPECIFIC, RECURRING banking topic that
deserves its OWN new category (one that other future calls would also fall into).

Return ONLY valid JSON:
{{
  "needs_new_category": true|false,
  "name": "<short Title Case category name, 2-5 words>",
  "description": "<one sentence describing what calls in this category are about>",
  "keywords": "<6-12 lowercase comma-separated phrases customers/agents would say>",
  "reason": "<one short sentence why this is a distinct, reusable category>"
}}

Rules:
- Set "needs_new_category" to false when the call is generic small-talk, a wrong
  number, a duplicate of an existing category, or too one-off to reuse. When
  false, the other fields may be empty.
- The name MUST be generic and reusable (e.g. "Credit Card Statement Request"),
  NEVER call-specific (no customer names, amounts, dates or ticket numbers).
- Do NOT propose a name that is essentially the same as an existing category
  above — reuse would be better, so return false instead.
- Prefer a clear REQUEST/ENQUIRY vs ISSUE/COMPLAINT distinction in the name.
- Keywords must be real phrases people say, not a description.

Transcript:
{transcript}
"""


def category_verify_prompt(
    transcript: str,
    config: BankConfig,
    chosen: str,
    candidates: list[dict],
) -> str:
    """Second-pass check of Primary_Query_Type against keyword-matched candidates.

    The model must justify the winner with a literal CUSTOMER quote, which stops
    plausible-but-wrong picks (e.g. Mini Statement when the customer asked for
    the balance). Candidates are the few categories whose keywords actually
    appear in the transcript, so this is a small, focused choice.
    """
    org = config.org_label()
    block = _category_block(candidates)
    return f"""You are auditing the query classification of a {org} call.

A first pass labeled this call: "{chosen}"

The ONLY allowed categories (pick from these, copy the name EXACTLY):
{block}

Task: decide which single category is the CUSTOMER's main reason for calling.
- Judge by what the CUSTOMER asked for in their own words. What the agent did
  or offered afterwards does not change the customer's query type.
- If the customer wants to know how much money they have, that is a balance
  enquiry even if transactions/statements are also mentioned.
- Keep "{chosen}" unless another listed category is CLEARLY a better match for
  the customer's request.

Return ONLY valid JSON:
{{
  "best_category": "<one category name from the list>",
  "evidence": "<short literal quote from a Customer line that proves it>",
  "changed": true|false
}}

Transcript:
{transcript}
"""
