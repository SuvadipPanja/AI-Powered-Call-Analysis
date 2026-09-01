"""Debt-collections AQM scoring.

Active only when a collections vendor profile is published (see
center_pack.collections_mode). Produces a 14-parameter weighted scorecard with
Pass/Fail/NA per dimension, fatal handling (RPC = fatal to compliance,
rude/abusive = red alert forcing overall to 0), NA re-normalisation, plus PTP,
fraud, agent-sentiment and rate-of-speech / dead-air signals.

The safety-critical fields (foul language, personal-payment-channel fraud, agent
sentiment trajectory, dead air) are computed by DETERMINISTIC detectors that
override the LLM, so scoring never depends on the model alone. Every function
here is import-safe and unit-testable without a live LLM or DB.
"""

from __future__ import annotations

import json
import os
import re
from typing import Any

# The scoring LLM (prod vLLM Llama/Qwen AWQ) has a fixed 8192-token context
# window. A long bilingual collections call (12-15 min) can push the judge
# prompt past the window and the model returns HTTP 400, which degrades the
# whole score (see _degraded_collections_scores). Keep the *judge* transcript
# well under budget and cap the JSON output. The deterministic detectors always
# run on the FULL transcript in build_collections_payload, so compliance / fraud
# / PTP / rate-of-speech stay accurate regardless of this cap.
_COLL_LLM_MAX_TRANSCRIPT_CHARS = int(
    os.getenv("COLLECTIONS_LLM_MAX_TRANSCRIPT_CHARS", "7000")
)
_COLL_LLM_MAX_OUTPUT_TOKENS = int(
    os.getenv("COLLECTIONS_LLM_MAX_OUTPUT_TOKENS", "1400")
)

# Dimension key -> DB column suffix (must match db._COLLECTIONS_DIM_SUFFIXES and
# backend rubricService COLLECTIONS_DIMENSIONS `column` values).
KEY_TO_COLUMN: dict[str, str] = {
    "Self Introduction": "Self_Introduction",
    "Recording Disclaimer": "Recording_Disclaimer",
    "RPC Verification": "RPC_Verification",
    "Sentiment Analysis": "Sentiment_Analysis",
    "Politeness and Empathy": "Politeness_Empathy",
    "PTP Success Rate": "PTP_Success_Rate",
    "Payment Confirmation": "Payment_Confirmation",
    "Negotiation Quality": "Negotiation_Quality",
    "Reason for Delay": "Reason_For_Delay",
    "Agent Tone and Clarity": "Agent_Tone_Clarity",
    "Rude and Unprofessional": "Rude_Unprofessional",
    "Telephone Etiquette": "Telephone_Etiquette",
    "Unusual Patterns": "Unusual_Patterns",
    "Blank Documentation": "Blank_Documentation",
}

RUDE_KEY = "Rude and Unprofessional"
RPC_KEY = "RPC Verification"

_LINE_RE = re.compile(
    r"^\s*([\d.]+)\s*-\s*([\d.]+)\s*\((Agent|Customer)\)\s*:\s*(.+)$",
    re.MULTILINE,
)

_POSITIVE = (
    "thank", "thanks", "appreciate", "sure", "help", "glad", "cooperat",
    "understand", "dhanyavad", "shukriya", "theek", "haan", "ok", "great",
)
_NEGATIVE = (
    "angry", "frustrat", "upset", "problem", "complaint", "threat", "refuse",
    "shout", "yell", "naraz", "pareshan", "galat", "jhagda", "abuse",
)

# --- Personal / non-official payment-channel fraud (BRD 5) --------------------
# A collections agent must route payment ONLY to official channels (the HFC/bank
# app, net-banking, an official payment link/VPA, branch cash, or a registered
# ECS/NACH mandate) and must never capture payment credentials. Detection is
# PRECISION-FIRST: a false ZTP zeroes an honest agent and destroys trust in the
# tool, so a cue is a violation only after context is resolved — official vs
# personal, KYC identity vs payment credential, steering TOWARD vs AWAY.

# Fatal-payment ownership is narrower than a general personal-contact marker:
# a personal email used for documents is a policy issue, not proof that money
# was requested into the agent's account.
#
# "my account" alone is NOT enough: collections agents say "from my account" /
# "if I make a payment from my account" when explaining the borrower's debit,
# and HFC floor script sends an official payment LINK. Fatal only when the
# agent directs money TO an agent-owned destination (personal UPI/account/
# mobile/QR) or an explicit pay-to-me instruction.
_PERSONAL_PAY_TO_AGENT_RE = re.compile(
    r"(?:(?<![a-z])pay(?![a-z])|\bsend\b|\btransfer\b|\bbhej\b|\bdaal\b|\bjama\b|\bcredit\b|भेज|डाल|जमा)"
    r".{0,32}(?:to\s+)?(?:my|meri|mere|mera|apni|apna)\s+(?:personal\s+)?"
    r"(?:account|upi|number|mobile|wallet|gpay|phonepe|paytm|qr)|"
    r"(?:my|meri|mere|mera|apni)\s+(?:personal\s+)?"
    r"(?:account|upi|number|mobile|wallet)\s+(?:me|mein|par|pe|ko|में|पर|को)\b",
    re.I,
)
_EXPLICIT_PERSONAL_OWNERSHIP_RE = re.compile(
    r"(?:\bpersonal\b|पर्सनल|व्यक्तिगत)",
    re.I,
)
_PERSONAL_PAYMENT_MARKER_RE = re.compile(
    r"(?:my|meri|mere|mera|apni|apna)\s+personal\s+"
    r"(?:account|upi|gpay|google\s*pay|phonepe|paytm|wallet|number|mobile|qr|id)|"
    r"personal\s+(?:account|upi|gpay|google\s*pay|phonepe|paytm|wallet|number|qr)|"
    r"(?:my|meri|mere|mera|apni|apna)\s+(?:upi|gpay|google\s*pay|phonepe|paytm)\s*(?:id|number)?|"
    r"send\s+(?:the\s+)?(?:money|payment|amount)\s+to\s+my|"
    r"is\s+number\s+par\s+(?:payment|paisa|amount|daal|bhej)|"
    r"(?:mere|meri|my)\s+(?:personal\s+)?(?:number|mobile|phone)\s+"
    r"(?:par|pe|पे|पर)\s+(?:payment|paisa|amount|daal|bhej)|"
    r"(?:मेरे|मेरी)\s+(?:पर्सनल\s+)?(?:अकाउंट|यूपीआई|नंबर|मोबाइल).{0,24}(?:भेज|डाल|पेमेंट)|"
    r"पर्सनल\s+(?:अकाउंट|यूपीआई|वॉलेट|नंबर)",
    re.I,
)
# Source language: money leaving an account, not arriving in the agent's wallet.
_PERSONAL_PAYMENT_SOURCE_RE = re.compile(
    r"(?:from|via|through)\s+(?:my|your|the|apne|apna)\s+account|"
    r"(?:my|mere|meri|mera|apne)\s+account\s+(?:se|से|from)|"
    r"(?:make|making)\s+a\s+payment.{0,48}from\s+my\s+account|"
    r"debit(?:ed)?\s+from|deduct(?:ed)?\s+from|"
    r"मेरे\s+अकाउंट\s+से|माझ्या\s+खात्यातून",
    re.I,
)
# Official HFC/bank collection path — link/app/portal/SMS — all floor languages.
_OFFICIAL_PAYMENT_CHANNEL_RE = re.compile(
    r"(?:official|company|hfc|icici|home\s*finance|bank)\s+"
    r"(?:app|link|portal|upi|vpa|website|application)|"
    r"(?:payment|pay(?:ment)?)\s+link|"
    r"link\s+(?:has\s+been\s+|is\s+)?(?:sent|shared|forwarded|bhej)|"
    r"(?:sent|share[d]?|bhej)\w*.{0,24}link|"
    r"(?:through|via|using|from)\s+(?:the\s+)?link|"
    r"link\s+(?:se|के\s+(?:द्वारा|जरिए)|द्वारे)\s*(?:payment|pay|jama|भुगतान)?|"
    r"goodscore|play\s+store|home\s+finance\s+(?:app|application)|"
    r"लिंक\s+(?:भेज|भेजा|भेजी|आया|आयी|पाठव)|पेमेंट\s+लिंक|"
    r"ऑफिशियल\s+(?:ऐप|लिंक|अॅप)|कंपनी\s+(?:ऐप|लिंक|अॅप)|"
    r"अधिकृत\s+(?:लिंक|अॅप|ऐप)",
    re.I,
)

# Payment-credential terms (card number/PIN, CVV, OTP, net-banking
# password/login). A PAN or Aadhaar card NUMBER is a KYC IDENTITY field required
# for OFFICIAL app onboarding, NOT a payment credential — the negative lookbehinds
# keep legitimate KYC ("enter your PAN card number") from ever tripping fraud.
_CREDENTIAL_TERM_RE = re.compile(
    r"(\botp\b|\bcvv\b|"
    r"(?<!pan\s)(?<!aadhaar\s)(?<!aadhar\s)(?<!id\s)card\s+(?:number|no\.?|pin)|"
    r"net\s*banking\s+(?:password|login)|login\s+credential)",
    re.I,
)

# A credential term is a breach only when the agent asks the borrower to
# disclose it.  Entering an automatically received OTP in the official app is
# self-service authentication and must never be treated as credential capture.
_CREDENTIAL_SOLICIT_RE = re.compile(
    r"((?:share|send|forward|tell|read\s*out|reveal|disclose|provide|give)\b.{0,35}"
    r"(?:otp|cvv|card\s+(?:number|pin)|upi\s+pin|net\s*banking\s+(?:password|login)|credential)|"
    r"(?:otp|cvv|card\s+(?:number|pin)|upi\s+pin|net\s*banking\s+(?:password|login)|credential)"
    r".{0,35}(?:share|send|forward|tell|read\s*out|reveal|disclose|provide|give)|"
    r"(?:otp|cvv|pin|card\s+number).{0,25}(?:bata|bol|bhej|dijiye|do\b)|"
    r"(?:bata|bol|bhej|dijiye).{0,25}(?:otp|cvv|pin|card\s+number))",
    re.I,
)

_CREDENTIAL_SAFE_RE = re.compile(
    r"((?:do\s+not|don'?t|never|\bmat\b|\bnahi\b).{0,25}(?:share|send|tell|reveal|disclose).{0,25}"
    r"(?:otp|cvv|pin|password)|"
    r"(?:enter|type|input|fill).{0,20}(?:otp|pin|password).{0,45}(?:official|company|hfc|app|login)|"
    r"(?:official|company|hfc|app|login).{0,45}(?:enter|type|input|fill).{0,20}(?:otp|pin|password))",
    re.I,
)

# HARD cue 4 — "scan my/this QR": a personal collection QR presented by the agent.
_QR_PERSONAL_RE = re.compile(
    r"(scan\s+(?:my|mera|meri)\s*qr|(?:mera|meri|my)\s+qr\b[\w\s]{0,15}scan)",
    re.I,
)

# SOFT cue — steering documents/payment TOWARD WhatsApp. Only a violation when the
# agent pushes toward WhatsApp; declining or redirecting away from it is fine.
_WHATSAPP_STEER_RE = re.compile(
    r"((?:share|send|forward|bhej|document|screenshot|receipt|payment).{0,40}whats\s*app|"
    r"whats\s*app.{0,40}(?:share|send|forward|bhej|document|screenshot|receipt|payment))",
    re.I,
)

_PERSONAL_DOCUMENT_STEER_RE = re.compile(
    r"((?:document|statement|receipt|proof|screenshot).{0,40}personal\s+(?:email|mail|number)|"
    r"personal\s+(?:email|mail|number).{0,40}(?:document|statement|receipt|proof|screenshot))",
    re.I,
)

# Document / payment-proof nouns. Required to keep a WhatsApp contact-coordination
# turn from being treated as a document-channel ZTP.
_DOC_PROOF_NOUN_RE = re.compile(
    r"(document|screenshot|receipt|proof|statement|kyc|aadhaar|aadhar|pan\s*card)",
    re.I,
)

# Exchanging a phone number / hello / callback over WhatsApp is operational
# coordination, not "send me the receipt on WhatsApp".
_WHATSAPP_CONTACT_COORD_RE = re.compile(
    r"("
    r"whats\s*app\s+number|"
    r"(?:send|share|forward|bhej).{0,48}number.{0,24}whats\s*app|"
    r"whats\s*app.{0,40}number|"
    r"(?:hello|hi\b).{0,24}whats\s*app|"
    r"whats\s*app.{0,24}(?:hello|hi\b)|"
    r"send\s+a\s+message\s+there"
    r")",
    re.I,
)

# Agent DECLINING / redirecting AWAY from a non-official channel — a POSITIVE
# compliance behaviour ("you don't need to send it on WhatsApp, use the official
# app / play store"), so a WhatsApp cue in this context is NOT flagged.
_STEER_AWAY_RE = re.compile(
    r"(no\s+need|don'?t\s+(?:need|have)\s+to|do\s+not\s+(?:need|have|send)|"
    r"not\s+(?:on|via|through)\s+whats\s*app|"
    r"(?:zaroorat|zarurat|jarurat)\s+nahi|nahi\s+(?:bhej|karna|chahiye)|mat\s+bhej)",
    re.I,
)

_PERSONAL_PAYMENT_DECLINE_RE = re.compile(
    r"("
    # Existing: "do not pay … personal" / "personal … nahi"
    r"(?:do\s+not|don'?t|never|must\s+not|\bmat\b|\bnahi\b)\s+"
    r"(?:pay|send|transfer|deposit|bhej|jama|daal).{0,35}(?:personal|my\s+account|meri\s+upi)|"
    r"(?:personal|my\s+account|meri\s+upi).{0,35}(?:do\s+not|don'?t|never|\bmat\b|\bnahi\b)|"
    # Prod miss: "not into / in / to any (other) personal account"
    r"not\s+(?:into|in|to|on)\s+(?:any\s+)?(?:other\s+)?personal\s+"
    r"(?:account|upi|wallet|number|qr)|"
    r"not\s+(?:into|in|to|on)\s+any\s+(?:other\s+)?account|"
    # "loan account … not … personal / other account" in the same sentence
    r"loan\s+(?:account|number).{0,80}not\s+(?:into|in|to|on)\s+(?:any\s+)?"
    r"(?:other\s+)?(?:personal\s+)?account|"
    # Hindi / Hinglish floor: personal / other account is forbidden; loan only
    r"(?:personal|पर्सनल)\s+(?:account|अकाउंट|खाता).{0,20}(?:nahi|नहीं|मत)|"
    r"(?:nahi|नहीं|मत).{0,20}(?:personal|पर्सनल)\s+(?:account|अकाउंट|खाता)|"
    r"किसी\s+(?:और|अन्य|दूसरे).{0,16}(?:अकाउंट|खाता|account).{0,16}(?:नहीं|मत|nahi)|"
    r"(?:लोन|loan)\s+(?:अकाउंट|खाता|account|नंबर|number).{0,40}"
    r"(?:ही|hi).{0,40}(?:जमा|jama|पेमेंट|payment)"
    r")",
    re.I,
)

_MONEY_TRANSFER_ACTION_RE = re.compile(
    r"(payment|\bpay\b|paisa|amount|rupees|₹|\brs\b|transfer|\bsend\b|\bbhej|\bjama\b|\bdaal|"
    r"डाल|पैसा|रुपय|भुगतान|पेमेंट|भेज)",
    re.I,
)

_LLM_WHATSAPP_ZTP_RE = re.compile(r"whats\s*app", re.I)
_LLM_CREDENTIAL_ZTP_RE = re.compile(
    r"(\botp\b|\bcvv\b|\bpin\b|credential|card\s+number|net\s*banking\s+(?:password|login))",
    re.I,
)
_LLM_LOCATION_COLLISION_ZTP_RE = re.compile(
    r"\b(?:police|jail|arrest|thana|police\s*station)\b",
    re.I,
)

_LOCATION_ACCUSE_RE = re.compile(
    r"(prohibited\s+phrase|rude/abusive/threatening|threatening\s+language|"
    r"\bpolice\b|\bjail\b|\barrest\b|police\s*station)",
    re.I,
)


def _llm_claim_is_location_collision(category: str, evidence: str) -> bool:
    return bool(_LLM_LOCATION_COLLISION_ZTP_RE.search(f"{category} {evidence}"))


_LLM_ONLY_ZTP_RE = re.compile(
    r"(unauthori[sz]ed\s+waiver|\bwaiver\b|third[-\s]?party|disclosure)",
    re.I,
)

# Detector-owned CHANNEL class. Matched on category OR evidence so "Unusual Patterns"
# + a GPay quote cannot bypass the veto. No bare \bpersonal\b — that hits "personally".
_LLM_DETECTOR_OWNED_BLOB_RE = re.compile(
    r"(unusual\s*patterns?|non[-\s]?official|payment\s*channel|"
    r"\bupi\b|\bgpay\b|google\s*pay|phonepe|phone\s*pe|paytm|bhim|\bqr\b|wallet|"
    r"whats\s*app|"
    r"\bpersonal\s+(?:account|upi|channel|number|qr|wallet)\b)",
    re.I,
)


def classify_llm_ztp_claim(category: str, evidence: str) -> str:
    """Route a 14B ZTP claim to the owner that may accept it.

    Detector-owned classes (channel / WhatsApp-docs / credentials / location-foul)
    are classified from the *blob* of category+evidence. LLM-only allowlist
    (waiver, third-party disclosure) is last. Everything else is reject.
    """
    blob = f"{category} {evidence}"
    if _LLM_CREDENTIAL_ZTP_RE.search(blob):
        return "credential"
    if _LLM_WHATSAPP_ZTP_RE.search(blob):
        return "whatsapp"
    if _llm_claim_is_location_collision(category, evidence):
        return "foul"
    if _LLM_DETECTOR_OWNED_BLOB_RE.search(blob):
        return "channel"
    if _LLM_ONLY_ZTP_RE.search(category) or _LLM_ONLY_ZTP_RE.search(evidence):
        return "llm_only"
    return "reject"


def accept_llm_ztp(
    kind: str,
    *,
    personal_ztp: bool,
    credential_ztp: bool,
    document_channel_ztp: bool,
    foul_yes: bool,
) -> bool:
    if kind == "credential":
        return bool(credential_ztp)
    if kind == "whatsapp":
        return bool(document_channel_ztp or personal_ztp)
    if kind == "channel":
        return bool(personal_ztp)
    if kind == "foul":
        return bool(foul_yes)
    if kind == "llm_only":
        return True
    return False

# Sentences that ACCUSE the agent of using/suggesting a non-official channel —
# scrubbed from the model summary when the detector found the channel clean (e.g.
# the agent actually DECLINED WhatsApp).
_CHANNEL_ACCUSE_RE = re.compile(
    r"(whats\s*app|personal\s+(?:channel|account|number)|non[-\s]?official|"
    r"unofficial\s+channel|gpay|google\s*pay|phonepe|phone\s*pe|paytm)",
    re.I,
)


def dim_status(score: Any, threshold: float, na_eligible: bool) -> str:
    """Resolve a Pass/Fail/NA status from a numeric score."""
    if score is None or (isinstance(score, str) and str(score).strip().upper() in ("NA", "N/A")):
        return "NA" if na_eligible else "Fail"
    try:
        s = float(score)
    except (TypeError, ValueError):
        return "NA" if na_eligible else "Fail"
    return "Pass" if s >= float(threshold) else "Fail"


def _clamp(v: float) -> float:
    return max(0.0, min(100.0, float(v)))


def compute_weighted_overall(
    dim_results: dict[str, dict[str, Any]],
    rubric_dims: list[dict[str, Any]],
    *,
    external_red_alert: str = "",
) -> dict[str, Any]:
    """Compute the ICICI HFC BRD score using its binary 14-checkpoint contract.

    Applicable checkpoints are strictly Pass (full weight) or Fail (zero
    weight). N/A checkpoints are excluded from numerator and denominator and
    the remaining active weight is re-normalised to 100. Failure of any BRD
    checkpoint marked fatal forces the complete call score to zero.
    """
    per_dim: dict[str, dict[str, Any]] = {}
    red_alert = False
    red_reason = ""
    fatal_keys: list[str] = []

    # Pass 1 — resolve statuses/scores and fatal flags.
    resolved: dict[str, dict[str, Any]] = {}
    for d in rubric_dims:
        key = str(d.get("key") or "").strip()
        if not key:
            continue
        weight = float(d.get("weight") or 0)
        threshold = float(d.get("threshold") or 100)
        na_elig = bool(d.get("naEligible"))
        fatal = bool(d.get("isFatal"))
        group = str(d.get("group") or "")

        res = dim_results.get(key) or {}
        status = res.get("status")
        score = res.get("score")
        if status not in ("Pass", "Fail", "NA"):
            status = dim_status(score, threshold, na_elig)

        if status == "NA" and na_elig:
            resolved[key] = {"status": "NA", "score": None, "weight": weight, "group": group}
            continue

        # The BRD defines no partial checkpoint credit. Model confidence must
        # never leak into the production score.
        status = "Pass" if status == "Pass" else "Fail"
        sc = 100.0 if status == "Pass" else 0.0

        if fatal and status == "Fail":
            fatal_keys.append(key)
            if key == RUDE_KEY:
                red_alert = True
                red_reason = "Agent used rude/abusive/threatening language"
                sc = 0.0
        resolved[key] = {"status": status, "score": round(sc, 1), "weight": weight, "group": group}

    # A caller-supplied zero-tolerance breach (e.g. the agent collected payment
    # through a personal/consumer channel) is a red alert in its own right, even
    # when no rubric dimension is individually marked fatal.
    if external_red_alert and not red_alert:
        red_alert = True
        red_reason = external_red_alert

    # Pass 2 — compute earned / denominator, zeroing compliance on RPC fatal.
    included_weight = 0.0
    earned = 0.0
    for key, r in resolved.items():
        col = KEY_TO_COLUMN.get(key, key.replace(" ", "_"))
        if r["status"] == "NA":
            per_dim[col] = {"score": None, "status": "NA"}
            continue
        per_dim[col] = {"score": r["score"], "status": r["status"]}
        w = r["weight"]
        included_weight += w
        if r["status"] == "Pass":
            earned += w

    overall = round((earned / included_weight) * 100.0, 1) if included_weight > 0 else 0.0

    fatal_triggered = "No"
    fatal_reason = ""
    if fatal_keys or red_alert:
        overall = 0.0
        fatal_triggered = "Yes"
        if red_reason:
            fatal_reason = red_reason
        elif RPC_KEY in fatal_keys:
            fatal_reason = "RPC verification failed (fatal to the call)"
        else:
            fatal_reason = f"Fatal BRD checkpoint failed: {', '.join(fatal_keys)}"

    configured_count = len(resolved)
    evaluated_count = sum(1 for r in resolved.values() if r["status"] != "NA")
    effective_earned = 0.0 if fatal_triggered == "Yes" else earned
    return {
        "overall": overall,
        "fatalTriggered": fatal_triggered,
        "fatalReason": fatal_reason,
        "redAlert": "Yes" if red_alert else "No",
        "scoreBreakdown": {
            "method": "brd-binary-weighted",
            "earnedPoints": round(effective_earned, 2),
            "rawEarnedPoints": round(earned, 2),
            "includedWeight": round(included_weight, 2),
            "excludedWeight": round(max(
                0.0,
                sum(float(d.get("weight") or 0) for d in rubric_dims) - included_weight,
            ), 2),
            "complianceFatal": RPC_KEY in fatal_keys,
            "complianceWeight": 0.0,
            "configuredDimensionCount": configured_count,
            "evaluatedDimensionCount": evaluated_count,
            "passedDimensionCount": sum(1 for r in resolved.values() if r["status"] == "Pass"),
            "failedDimensionCount": sum(1 for r in resolved.values() if r["status"] == "Fail"),
            "naDimensionCount": configured_count - evaluated_count,
            "dimensionCount": configured_count,
        },
        "dimensions": per_dim,
    }


def detect_foul(
    original_transcript: str,
    english_transcript: str = "",
    call_language: str = "Hindi",
) -> dict[str, Any]:
    """Deterministic dual-script foul/threat detection via the taboo engine.

    Returns {violation, categories, evidence, agentHits}. Only AGENT hits count
    as a violation (a rude borrower never penalises the agent).
    """
    try:
        from taboo_worker import analyze_taboo

        taboo = analyze_taboo(original_transcript, english_transcript or original_transcript, call_language)
    except Exception:
        return {"violation": "No", "categories": [], "evidence": "", "agentHits": []}

    hits = [h for h in (taboo.get("hits") or []) if h.get("role") == "Agent"]
    categories = sorted({str(h.get("category") or "policy") for h in hits})
    evidence_parts = [
        f'{h.get("word")} @ {h.get("start")}s: "{str(h.get("matched_in"))[:80]}"'
        for h in hits[:5]
    ]
    return {
        "violation": "Yes" if hits else "No",
        "categories": categories,
        "evidence": " | ".join(evidence_parts),
        "agentHits": hits,
    }


def detect_personal_channel_fraud(*transcripts: str) -> dict[str, Any]:
    """Resolve personal-payment, credential and document-channel risks.

    Precision is mandatory because a false positive can zero an honest call.
    ``personalChannel`` and ``redAlert`` require an agent-owned/private
    destination plus a payment instruction in the same or an adjacent agent
    turn. Bare PhonePe/GPay/UPI words, customer speech, official-app onboarding,
    and entering an OTP in that app are never enough.

    Credential solicitation and steering documents to WhatsApp remain separate
    non-fatal policy signals. They must not be displayed as personal-account
    payment and must not make the whole call fatal.
    """
    channels: list[str] = []
    personal_evidence: list[str] = []
    credential_evidence: list[str] = []
    document_evidence: list[str] = []
    for transcript in transcripts:
        if not transcript or not str(transcript).strip():
            continue

        # (has_private_destination, has_payment_action, text) per AGENT turn.
        # Adjacency never crosses transcript views, so original and translated
        # copies cannot combine to manufacture a breach.
        agent_turns: list[tuple[bool, bool, str]] = []
        for m in _LINE_RE.finditer(transcript):
            role, raw_text = m.group(3), m.group(4)
            if role != "Agent":
                continue
            text = raw_text.strip()
            declines_personal = bool(_PERSONAL_PAYMENT_DECLINE_RE.search(text))
            personal_qr = bool(_QR_PERSONAL_RE.search(text))
            pay_to_agent = bool(_PERSONAL_PAY_TO_AGENT_RE.search(text))
            owned_dest = bool(
                _EXPLICIT_PERSONAL_OWNERSHIP_RE.search(text) or pay_to_agent or personal_qr
            )
            # Official HFC/bank link/app is a legitimate collection path.
            official_channel = bool(_OFFICIAL_PAYMENT_CHANNEL_RE.search(text))
            # "from my account" / debit-from is a source, not an agent wallet.
            source_only = bool(_PERSONAL_PAYMENT_SOURCE_RE.search(text)) and not owned_dest
            private_destination = (
                bool(_PERSONAL_PAYMENT_MARKER_RE.search(text) or pay_to_agent or personal_qr)
                and not declines_personal
                and not source_only
                and not (official_channel and not owned_dest)
            )
            payment_action = bool(_MONEY_TRANSFER_ACTION_RE.search(text) or personal_qr)
            agent_turns.append((private_destination, payment_action, text))

            credential_capture = bool(
                _CREDENTIAL_TERM_RE.search(text)
                and _CREDENTIAL_SOLICIT_RE.search(text)
                and not _CREDENTIAL_SAFE_RE.search(text)
            )
            if credential_capture:
                credential_evidence.append(text[:160])

            whatsapp_documents = bool(
                _WHATSAPP_STEER_RE.search(text) or _PERSONAL_DOCUMENT_STEER_RE.search(text)
            )
            if whatsapp_documents and _STEER_AWAY_RE.search(text):
                whatsapp_documents = False
            if (
                whatsapp_documents
                and _WHATSAPP_CONTACT_COORD_RE.search(text)
                and not _DOC_PROOF_NOUN_RE.search(text)
            ):
                whatsapp_documents = False
            if whatsapp_documents:
                document_evidence.append(text[:160])

        for i, (private_destination, _pay, text) in enumerate(agent_turns):
            if not private_destination:
                continue
            nearby_payment = any(
                pay for _private, pay, _text in agent_turns[max(0, i - 1): i + 2]
            )
            if not nearby_payment:
                continue
            personal_evidence.append(text[:160])
            low = text.lower()
            channel_count_before = len(channels)
            for probe, label in (
                ("personal account", "personal account"),
                ("upi", "upi"), ("gpay", "gpay"), ("g pay", "gpay"),
                ("google pay", "google pay"), ("gpay", "gpay"),
                ("phone pe", "phonepe"), ("phonepe", "phonepe"),
                ("paytm", "paytm"), ("bhim", "bhim"), ("qr", "qr"),
                ("फोन पे", "phonepe"), ("फ़ोन पे", "phonepe"),
                ("गूगल पे", "google pay"), ("पेटीएम", "paytm"), ("भीम", "bhim"),
            ):
                if probe in low and label not in channels:
                    channels.append(label)
            if len(channels) == channel_count_before and "personal account" not in channels:
                channels.append("personal account")

    all_policy_evidence = personal_evidence + credential_evidence + document_evidence
    return {
        "personalChannel": "Yes" if personal_evidence else "No",
        "channels": channels,
        "evidence": " | ".join(all_policy_evidence[:5]),
        "personalEvidence": " | ".join(personal_evidence[:5]),
        "credentialCapture": "Yes" if credential_evidence else "No",
        "credentialEvidence": " | ".join(credential_evidence[:5]),
        "nonOfficialDocumentChannel": "Yes" if document_evidence else "No",
        "documentChannelEvidence": " | ".join(document_evidence[:5]),
        "unusualPattern": "Yes" if all_policy_evidence else "No",
        # Per BRD, only explicit agent-directed payment to a private destination
        # is fatal. Credential/document misses are non-fatal ZTP signals.
        "redAlert": bool(personal_evidence),
    }


def _norm_txt(s: str) -> str:
    return re.sub(r"\s+", " ", str(s or "").lower()).strip()


def _evidence_in_transcript(evidence: str, *transcripts: str) -> bool:
    """True when the model's cited ZTP evidence really appears in the transcript.

    This lets the 14B judge ESCALATE a zero-tolerance breach the deterministic
    detectors did not catch (context/paraphrase the regex cannot see) while
    guarding against a HALLUCINATED ZTP: the model may only add a ZTP when it
    quotes words actually spoken on the call. Whitespace/case-insensitive, with a
    5-word shingle match (tolerant of light paraphrase) and a substring fallback
    for short quotes.
    """
    ev = _norm_txt(evidence)
    if len(ev) < 8:
        return False
    hay = _norm_txt(" ".join(t for t in transcripts if t))
    if not hay:
        return False
    if ev in hay:
        return True
    words = ev.split()
    if len(words) < 5:
        return False
    for i in range(len(words) - 4):
        if " ".join(words[i:i + 5]) in hay:
            return True
    return False


# --------------------------------------------------------------------------
# Deterministic criteria detectors.
#
# Compliance steps (disclaimer, self-introduction, right-party verification),
# the payment commitment and the delay probe are objectively present or absent
# in the transcript. The LLM used to mis-coach agents for steps they had
# performed in Hindi, so these detectors decide those dimensions and the model
# only judges the subjective ones (tone, empathy, negotiation).
# --------------------------------------------------------------------------

# "record" must refer to the CALL being recorded - agents also say things like
# "aapka record system me update ho gaya", which is not a disclaimer.
_DISCLAIMER_RE = re.compile(
    r"((?:call|line|baat|conversation)[\w\s]{0,20}?record|"
    r"record(?:ed|ing)?[\w\s]{0,20}?(?:call|line|purpose|ja\s+rahi|ho\s+rahi|hoti|chal)|"
    r"recorded\s+(?:call|line)|recording\s+line|"
    r"record(?:ed|ing)?\s+(?:kiya|kia|ki)\s+(?:gaya|ja)|"
    r"monitor(?:ed|ing)\b|"
    r"quality\s*(?:and|&|aur)\s*training|training\s*(?:and|&|aur)\s*quality|"
    r"quality\s*(?:purpose|purposes|check)|"
    r"कॉल[\s\w]{0,20}रिकॉर्ड|रिकॉर्ड[\s\w]{0,20}(?:की\s*जा|किया\s*गया|हो\s*रही)|गुणवत्ता|"
    # Marathi floor STT: "रेकॉर्ड केली जात आहे" / "रेकॉर्ड होत आहे"
    r"(?:कॉल|ट्रेनिंग|क्वालिटी|गुणवत्ता)[\s\w\u0900-\u097F]{0,40}रेकॉर्ड|"
    r"रेकॉर्ड\s*(?:केली|केला|होत|केली\s*जात))",
    re.I,
)

_SELF_NAME_RE = re.compile(
    r"(my\s+name\s+is\s+\w+|mera\s+naam\s+\w+|naam\s+\w+\s+hai|myself\s+\w+|"
    r"main\s+\w+\s+(?:bol|baat)|this\s+is\s+\w+\s+(?:from|calling|speaking|here|on\s+behalf)|"
    r"i\s+am\s+\w+\s+(?:from|calling|speaking)|"
    # "Moneyta is speaking on behalf…" / "Deepika speaking on behalf…"
    r"\w+\s+is\s+speaking\s+(?:on\s+behalf|from)|"
    r"\w+\s+(?:speaking|bol\s+rahi|bol\s+raha)\s+(?:on\s+behalf|from|se)|"
    # Hindi: "मैं अश्विनी बोल रही हूँ" / "मैं ज़ीनत, … बात कर रही हूँ"
    r"(?:मैं|मै)\s*[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,2}"
    r"(?:\s*[, ،]|)\s*(?:.{0,40}?)?(?:बोल|बात\s+कर)\s+रह[ीा]\s+(?:हूँ|हूं|है)|"
    r"[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,2}\s+"
    r"(?:बोल|बात\s+कर)\s+रह[ीा]\s+(?:हूँ|हूं|है)|"
    # Marathi: "मी तन्वी बोलते आहे" / "मी किरण बोलतो," / "राहुल बोलत होता" (ASR past)
    r"मी\s*[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,2}\s+"
    r"बोल(?:ते|तो|त)(?:\s*(?:आहे|आहेत|होता|होती))?"
    r"|"
    r"[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,2}\s+"
    r"बोलत\s+होत[ाी]"
    r"|"
    # English ASR: "Rahul was speaking" / "Rahul speaking"
    r"\b[a-z][a-z.'-]{1,30}\s+(?:was\s+)?speaking\b|"
    r"मेरा\s*नाम)",
    re.I,
)

# Translated South-Indian calls commonly render the introduction as
# "ICICI Home Finance Company, Mr. Akbar speaking sir".  It is a valid name
# introduction even though the translator omitted "this is" / "from".
_BARE_NAME_SPEAKING_RE = re.compile(
    r"\b(?:mr\.?|mrs\.?|ms\.?)?\s*[a-z][a-z.'-]{1,30}\s+speaking(?:\s+(?:sir|madam|here))?\b",
    re.I,
)

# BRD 1.1: a missing greeting alone scores 0, so the greeting is detected too.
# Floor STT often keeps Latin "Good afternoon" OR Devanagari "गुड आफ्टरनून"/"हेलो".
_GREETING_RE = re.compile(
    r"(good\s*(?:morning|afternoon|evening|day)|namaste|namaskar|namaskaar|"
    r"\bhello\b|\bhi\b|salaam|assalam|shubh|"
    r"नमस्ते|नमस्कार|सुप्रभात|शुभ|"
    r"हेलो|हैलो|हॅलो|"
    r"गुड\s*(?:मॉर्निंग|मोरनिंग|आफ्टरनून|आफ्टरनून|इव्हनिंग|ईवनिंग)|"
    r"शुभ\s*(?:प्रभात|संध्या|दिन))",
    re.I,
)

_ORG_STOPWORDS = {
    "company", "limited", "ltd", "pvt", "private", "the", "and", "bank",
    "india", "corporation", "corp", "inc",
}
_ORG_FALLBACK_RE = re.compile(r"(home\s*finance|housing\s*finance|hfc\b)", re.I)
# ASR often mangles ICICI → ITI / ICI / ICIC; treat as the same org family when
# paired with home/housing finance (never alone — avoids false company hits).
_ORG_ASR_FUZZ_RE = re.compile(
    r"\b(?:icici|icic|ici|iti)(?:'?s)?\b.{0,40}(?:home|housing)\s*finance|"
    r"(?:home|housing)\s*finance.{0,40}\b(?:icici|icic|ici|iti)\b",
    re.I,
)

# BRD 1.3 (fatal): the agent must address the borrower by first or last name.
# Agents phrase this as a statement as often as a question ("I'm talking to
# Rajendra Singh Gurjar, can you hear me?"), which an earlier question-only
# pattern missed and wrongly marked compliant calls fatal.
_RPC_ASK_RE = re.compile(
    r"((?:am\s+i|i\s*(?:'m|\s+am)?)\s+(?:speaking|talking)\s+(?:to|with)\s+(?:sir\s+|madam\s+|mr\.?\s*|mrs\.?\s*|ms\.?\s*)?\w+|"
    # "Are you Mukesh Pandavale sir?" / "Are you talking to Mr Sharma?"
    r"are\s+you\s+(?:talking\s+to\s+|speaking\s+to\s+|mr\.?\s*|mrs\.?\s*|ms\.?\s*|miss\s+)?"
    r"[a-z][a-z.'-]{1,30}(?:\s+[a-z][a-z.'-]{1,30}){0,3}(?:\s+(?:sir|madam|ji))?\b|"
    r"(?:is|am)\s+(?:this|that)\s+(?:mr|mrs|ms|miss)\b|"
    r"speaking\s+(?:to|with)\s+\w+|"
    r"kya\s+(?:main\s+)?[\w\s]{2,30}?se\s+baat|"
    r"(?:meri|apki)\s+baat\s+[\w\s]{0,25}?se\s+ho\s+rahi|"
    r"aap\s+[\w\s]{0,25}?(?:bol\s+rahe|baat\s+kar\s+rahe|hi\s+hain)|"
    r"\w+\s*ji\s*(?:\?|,)|"
    r"आप\s+.*बात|"
    # Hindi: "क्या समेश सिंह जी से बात हो रही है?" / "महावीर जी से बात हो रही है?"
    r"क्या\s+(?:मैं\s+)?[\u0900-\u097F\s]{2,40}?से\s+बात|"
    r"(?:मेरी|आपकी)\s+बात\s+[\u0900-\u097F\s]{0,30}?से\s+हो\s+रही|"
    r"[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,3}"
    r"\s+जी\s+से\s+बात\s+(?:हो\s+रही|कर\s+रही)|"
    # Marathi: "वैभव रेलेकर सर बोलत आहेत का?" / "मुकेश पांडवले सर्व/सर आहेत का?"
    r"[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,3}\s+"
    r"(?:सर|सर्व|जी)?\s*बोलत\s+आहेत\s+का|"
    r"[\u0900-\u097F]{2,}(?:\s+[\u0900-\u097F]{2,}){0,3}\s+"
    r"(?:सर|सर्व|जी)\s+आहेत\s+का)",
    re.I,
)

# Opening address translated as "Good afternoon, Mr. Nixon, sir" is an RPC
# ask when the borrower immediately affirms.  Exclude "Mr. Akbar speaking",
# which is the agent's own introduction rather than the borrower's identity.
_RPC_NAME_ADDRESS_RE = re.compile(
    r"\b(?:mr\.?|mister|mrs\.?|miss|ms\.?)\s+[a-z][a-z.'-]{1,30}(?:\s+(?:sir|madam))?\b",
    re.I,
)

# Never treat a pronoun or role label as the borrower's name.  The old RPC
# expression accepted "I am talking to you ..." and then consumed an unrelated
# "yes" several turns later, turning noisy ASR into a fatal-compliance Pass.
_RPC_GENERIC_TARGETS = frozenset(
    {
        "you", "your", "sir", "madam", "customer", "borrower", "client",
        "account", "holder", "account holder", "right party", "person",
        "someone", "anyone", "him", "her", "them", "this", "that", "there",
        "me", "us", "without", "any",
    }
)
_RPC_GENERIC_TARGET_RE = re.compile(
    r"\b(?:speaking|talking)\s+(?:to|with)\s+"
    r"(?:you|customer|borrower|client|account\s+holder|right\s+party|"
    r"someone|anyone|him|her|them|this|that)\b",
    re.I,
)
_RPC_NAME_CANDIDATE_RES = (
    re.compile(
        r"\b(?:speaking|talking)\s+(?:to|with)\s+"
        r"(?:(?:sir|madam|mr\.?|mister|mrs\.?|miss|ms\.?)\s+)?"
        r"([a-z][a-z.'-]{1,30})\b",
        re.I,
    ),
    re.compile(
        r"\bare\s+you(?:\s+(?:talking|speaking)\s+to)?\s+"
        r"(?:(?:sir|madam|mr\.?|mister|mrs\.?|miss|ms\.?)\s+)?"
        r"([a-z][a-z.'-]{1,30})\b",
        re.I,
    ),
    re.compile(r"\b(?:kya\s+(?:main\s+)?)?([a-z][a-z.'-]{1,30})(?:\s+ji)?\s+se\s+baat\b", re.I),
    re.compile(r"\b(?:meri|apki)\s+baat\s+([a-z][a-z.'-]{1,30})(?:\s+ji)?\s+se\b", re.I),
    re.compile(r"\baap\s+([a-z][a-z.'-]{1,30})(?:\s+ji)?\s+(?:bol|baat)\b", re.I),
    re.compile(r"\baap\s+([a-z][a-z.'-]{1,30})(?:\s+ji)?\s+(?:hi\s+)?(?:hain|hai|ho)\b", re.I),
    re.compile(r"\b([a-z][a-z.'-]{1,30})\s*ji\s*[?,]", re.I),
)


def _has_named_rpc_target(text: str) -> bool:
    """True only when an RPC line contains a plausible borrower name.

    This is deliberately precision-first because RPC is fatal to the compliance
    group. Generic second-person wording is not identity verification.
    """
    value = str(text or "").strip()
    if not value or _RPC_GENERIC_TARGET_RE.search(value):
        return False
    if _RPC_NAME_ADDRESS_RE.search(value):
        return True
    for pattern in _RPC_NAME_CANDIDATE_RES:
        match = pattern.search(value)
        if not match:
            continue
        candidate = re.sub(r"\s+", " ", match.group(1).lower()).strip(" .'-,")
        if candidate and candidate not in _RPC_GENERIC_TARGETS:
            return True
    # Devanagari multi-token name + optional जी + से बात
    # e.g. "समेश सिंह जी से बात" / "विनायक जी से बात"
    if re.search(
        r"[\u0900-\u097f]{2,}(?:\s+[\u0900-\u097f]{2,}){0,3}"
        r"(?:\s+\u091c\u0940)?\s+\u0938\u0947\s+\u092c\u093e\u0924",
        value,
    ):
        return True
    # Marathi named ask: "<name> सर/जी बोलत आहेत का" / "<name> सर/सर्व आहेत का"
    if re.search(
        r"[\u0900-\u097f]{2,}(?:\s+[\u0900-\u097f]{2,}){0,3}\s+"
        r"(?:सर|सर्व|जी)?\s*बोलत\s+आहेत\s+का",
        value,
    ):
        return True
    if re.search(
        r"[\u0900-\u097f]{2,}(?:\s+[\u0900-\u097f]{2,}){0,3}\s+"
        r"(?:सर|सर्व|जी)\s+आहेत\s+का",
        value,
    ):
        return True
    return False
_AFFIRM_RE = re.compile(
    r"^\W*(yes|yeah|yep|ya\b|haan|han\b|ha\b|ji\b|ok(?:ay)?|right|correct|speaking|"
    r"bol\s+raha|bol\s+rahi|boliye|theek|thik|sure|fine|hmm+|"
    r"this\s+is\s+speaking|speaking\s+sir|"
    r"हाँ|हां|जी(?:\s+मैडम|\s+सर)?|बोलिये|बोलिए|बोला|ठीक|"
    r"हो(?:\s|,|\.|$)|"
    # Marathi short affirm: "हा", "हा बोला", "हम्म हो"
    r"हा(?:\s*बोला)?(?:\s|,|\.|$)|हम्म+|हं+)",
    re.I,
)

# Filler before RPC affirm is common: "कहाँ से बोल रहे हैं?" / voice-check.
# Keep the window tight enough that a late payment "Yes" (30s+) is not reused.
_RPC_AFFIRM_LOOKAHEAD = 14
_RPC_AFFIRM_MAX_SEC = 22.0

_ECS_COMMIT_RE = re.compile(
    r"(maintain|balance\s*(?:rakh|rakhu|maintain|kar)|rakh\s*(?:dunga|doonga|dungi|denge)|"
    r"\becs\b|\bnach\b|auto\s*-?\s*debit|mandate|keep\s+(?:the\s+)?(?:balance|money|funds)|"
    r"paisa\s+(?:rakh|daal)|account\s+me[in]?\s+(?:paisa|balance)|"
    r"बैलेंस\s*(?:मेंटेन|रख)|मेंटेन\s*(?:रख|कर)|बॅलन्स\s*ठेव|"
    r"अकाउंट\s*(?:में|मध्ये).{0,20}(?:बैलेंस|बॅलन्स|पैसे)|"
    r"(?:बैलेंस|बॅलन्स|पैसे)\s*(?:रख|ठेव)|"
    r"(?:maintain|मॅनटेन|मेन्टेन|मेंटेन)\s*(?:करा|करायच|करून)|"
    r"account\s+ला\s+maintain|अकाऊंट\s*मेन्टेन|"
    r"auto\s*debit|ऑटो\s*डेबिट)",
    re.I,
)
_MANUAL_COMMIT_RE = re.compile(
    r"(i\s+will\s+(?:pay|do|deposit|clear)|will\s+(?:pay|clear)\s+(?:it|the)|"
    r"pay\s+kar\s+(?:dunga|doonga|dungi|denge)|de\s+(?:dunga|doonga|dungi|denge)|"
    r"jama\s+kar\s+(?:dunga|doonga|denge)|kar\s+(?:dunga|doonga|dungi|denge)|"
    r"i\s+will\s+do\s+it|"
    r"(?:भुगतान|पेमेंट|पे)\s*(?:कर|हो)|"
    r"कर\s*(?:वा\s*)?(?:दूँगा|दूंगा|दूंगी|देंगे|देटा)|"
    r"दे\s*(?:दूँगा|दूंगा|दूंगी|देंगे)|"
    r"(?:पेमेंट|भुगतान)\s*करतो|"
    r"करतो|करते|"
    r"टाकलं|टाकेन|"
    r"राहून\s*देतो|करून\s*देणार)",
    re.I,
)
_TIMING_RE = re.compile(
    r"(today|tonight|tomorrow|day\s+after|by\s+(?:evening|tonight|morning|night)|"
    r"aaj|kal\b|parso|shaam\s*(?:tak|ko)|subah\s*(?:tak|ko)|"
    r"(?:1|one|a)\s*day\s*before|before\s+the\s+due\s+date|due\s*date\s*se\s*pehle|"
    r"\b\d{1,2}\s*(?:st|nd|rd|th)?\s*(?:tarikh|of\s+\w+|\w+\s+month)|\b\d{1,2}\s*tarikh|"
    r"due\s+date\s+of\s+the\s+\d{1,2}|date\s+(?:is\s+)?(?:set\s+)?for\s+the\s+\d{1,2}|"
    r"आज|कल\b|परसों|शाम\s*(?:तक|को)|सुबह|"
    r"उद्या|परवा|दुपारी|"
    r"दो[\s\-]*तीन\s*दिन|"
    r"\d{1,2}\s*(?:तारिख|तारीख|तारखेला|तारख)|"
    # Marathi/Hindi spoken day numbers — require the date word (bare नऊ/आठ is too noisy)
    r"(?:आठ|नऊ|नववी|दहा|अकरा|बारा)\s*(?:तारिख|तारीख|तारखेला|तारख)|"
    r"(?:11|12|10|9|8|5)\s*(?:या|–|-)?\s*(?:12|11)?\s*तारख)",
    re.I,
)

# For ECS maintain commitments, prefer the funding date next to "maintain"
# over the auto-debit/cut date in the same turn ("maintain on 8th, cut on 10th").
_ECS_MAINTAIN_KW_RE = re.compile(
    r"maintain|मॅनटेन|मेन्टेन|मेंटेन",
    re.I,
)
_ECS_DEBIT_CUT_RE = re.compile(
    r"(?:auto[\s\-]?debit|auto\s*debit|\bdebit\b|\bcut\b|कापून|काप|कट\b)",
    re.I,
)
_ECS_DATE_TOKEN_RE = re.compile(
    r"(?:आठ|नऊ|नववी|दहा|दस|अकरा|ग्यारह|बारा|बारह)\s*(?:तारिख|तारीख|तारखेला|तारख)"
    r"|\b(?:on\s+the\s+)?(\d{1,2})(?:st|nd|rd|th)\b"
    r"|\b(\d{1,2})\s*(?:तारिख|तारीख|तारखेला|तारख|tarikh)\b",
    re.I,
)
# Fallback when proximity scoring finds nothing (older Latin/Hinglish phrasing).
_ECS_MAINTAIN_DATE_RE = re.compile(
    r"(?:(?:maintain|मॅनटेन|मेन्टेन|मेंटेन|maintain\s+कर).{0,40}|"
    r"(?:account|अकाऊंट|अकाउंट).{0,20}(?:maintain|मेन्टेन|मॅनटेन).{0,20})"
    r"((?:आठ|नऊ|नववी|दहा|दस|अकरा|ग्यारह|बारा|बारह|\d{1,2})\s*(?:तारिख|तारीख|तारखेला|तारख)?)"
    r"|"
    r"((?:आठ|नऊ|नववी|दहा|दस|अकरा|ग्यारह|बारा|बारह|\d{1,2})\s*(?:तारिख|तारीख|तारखेला|तारख))"
    r".{0,25}(?:maintain|मॅनटेन|मेन्टेन|मेंटेन)",
    re.I,
)


def _ecs_maintain_timing(text: str) -> str:
    """Pick the funding/maintain date, not the auto-debit/cut date.

    Floor scripts often say both in one breath:
    \"आठ तारखेला maintain करा … दहा तारखेला auto debit / cut\".
    Vague phrases like \"before the due date\" are reminder coaching, not a
    secured PTP calendar date — those must not win here.
    """
    text = text or ""
    maintain_hits = list(_ECS_MAINTAIN_KW_RE.finditer(text))
    if not maintain_hits:
        m = _ECS_MAINTAIN_DATE_RE.search(text)
        return ((m.group(1) or m.group(2) or "").strip() if m else "")
    candidates: list[tuple[int, int, str]] = []
    for dm in _ECS_DATE_TOKEN_RE.finditer(text):
        raw = (dm.group(0) or "").strip()
        if not raw:
            continue
        # Normalize bare digits from English "on the 8th" / "8th"
        if dm.lastindex:
            for g in dm.groups():
                if g:
                    raw = g
                    break
        local = text[max(0, dm.start() - 28) : min(len(text), dm.end() + 28)]
        # Skip dates whose local window is about debit/cut and not about maintain.
        if _ECS_DEBIT_CUT_RE.search(local) and not _ECS_MAINTAIN_KW_RE.search(local):
            continue
        dist = min(abs(dm.start() - mh.start()) for mh in maintain_hits)
        if dist > 55:
            continue
        candidates.append((dist, dm.start(), raw))
    if candidates:
        candidates.sort()
        return candidates[0][2]
    m = _ECS_MAINTAIN_DATE_RE.search(text)
    if m:
        return (m.group(1) or m.group(2) or "").strip()
    return ""


def _timing_from_text(text: str, *, prefer_ecs_maintain: bool = False) -> str:
    if prefer_ecs_maintain:
        chosen = _ecs_maintain_timing(text or "")
        if chosen:
            return chosen
    m = _TIMING_RE.search(text or "")
    if not m:
        return ""
    hit = ((m.group(1) if m.lastindex else m.group(0)) or m.group(0) or "").strip()
    if prefer_ecs_maintain and _VAGUE_DUE_TIMING_RE.search(hit):
        # Reminder coaching ("before due date") is not a secured PTP calendar day.
        return ""
    return hit


# Relative/vague due-date coaching — not a borrower PTP date for ECS affirm.
_VAGUE_DUE_TIMING_RE = re.compile(
    r"(?:before\s+the\s+due\s+date|due\s*date\s*se\s*pehle|"
    r"(?:1|one|a)\s*day\s*before(?:\s+the\s+due\s+date)?)",
    re.I,
)


# BRD 3.1: PTP needs the amount confirmed too, so a rupee figure spoken by the
# agent is tracked as evidence of mandate-detail confirmation.
_AMOUNT_RE = re.compile(
    r"(rupees|rupaye|rupya|\brs\.?\b|₹|\bemi\s+(?:of|is)\b|"
    r"ईएमआई|किस्त|रुपये|₹\s*\d)",
    re.I,
)

# Explicit borrower deposit/pay language — outranks agent ECS maintain coaching.
# "rakh dunga" after maintain stays ECS; "jama / deposit / put amount" is manual.
_CUSTOMER_MANUAL_PAYMENT_RE = re.compile(
    r"(?:i\s+will\s+(?:pay|deposit|put)|i'?ll\s+(?:pay|deposit|put)|"
    r"will\s+(?:pay|deposit)|will\s+(?:be\s+)?deposited|"
    r"put\s+the\s+amount|send\s+(?:the\s+)?(?:amount|money|it)|"
    r"jama\s+(?:kar|ho)|जमा\s*(?:हो|कर)|"
    r"(?:भुगतान|पेमेंट)\s*(?:कर|हो)|"
    r"pay\s+kar\s+(?:dunga|doonga|dungi|denge)|"
    r"de\s+(?:dunga|doonga|dungi|denge))",
    re.I,
)
# The borrower's own commitment words. An "ok / haan" alone is an acknowledgement,
# not a promise — BRD 3.1 requires a strong confirmation.
_CUSTOMER_COMMIT_RE = re.compile(
    r"(i\s+will\s+(?:do|pay|keep|maintain|deposit|clear|manage|put)|i'?ll\s+(?:do|pay|keep|maintain|put)|"
    r"will\s+keep\s+it|keep\s+it\s+for|"
    r"will\s+(?:be\s+)?deposited|put\s+the\s+amount\s+in|send\s+it|"
    r"kar\s+(?:dunga|doonga|dungi|denge|deta\s+hoon)|de\s+(?:dunga|doonga|dungi|denge)|"
    r"rakh\s+(?:dunga|doonga|dungi|denge|deta\s+hoon)|jama\s+kar\s+(?:dunga|doonga|denge)|"
    r"jama\s+ho\s+jayega|ho\s+jayega|kar\s+deta\s+hu|"
    r"कर\s*(?:वा\s*)?(?:दूँगा|दूंगा|दूंगी|देंगे|देटा|देता)|"
    r"दे\s*(?:दूँगा|दूंगा|दूंगी|देंगे)|"
    r"रख\s*(?:दूँगा|दूंगा|दूंगी|देंगे)|"
    r"(?:भुगतान|पेमेंट)\s*(?:कर|हो)\s*(?:दूँगा|दूंगा|जाएगा|जाएगी)|"
    r"हो\s*जाएगा|"
    r"जमा\s*(?:हो|कर)|"
    r"(?:पेमेंट|भुगतान)\s*करतो|"
    r"करतो|करते|"
    r"ठेवतो|ठेवते|"
    r"टाकलं|राहून\s*देतो|"
    r"(?:maintain|मेन्टेन|मॅनटेन)\s*(?:कर|करा))",
    re.I,
)
_CONDITIONAL_PAYMENT_CONTEXT_RE = re.compile(
    r"(?:\b(?:if|when|once|after|until)\b.{0,90}\b(?:account|bank|block|unblock|open|active|"
    r"activate|restore|fund|money|salary)\b|"
    r"\b(?:account|bank)\b.{0,55}\b(?:block(?:ed)?|unblock(?:ed)?|closed?|open(?:ed)?|"
    r"active|activate(?:d)?|restore(?:d)?)\b|"
    r"\b(?:two|three|2|3)\s+(?:or\s+)?(?:two|three|2|3)?\s*days?\b|"
    r"\b(?:uske\s+baad|tab|phir|jab|agar)\b|"
    r"अकाउंट.{0,40}(?:ब्लॉक|एक्टिव|सक्रिय)|"
    r"दो[\s\-]*तीन\s*दिन|"
    r"(?:उसके\s*बाद|फिर|जब|अगर))",
    re.I,
)
_CONDITIONAL_PAYMENT_ACTION_RE = re.compile(
    r"(?:\bi\s+(?:can|will|'ll)\s+(?:pay|do|make|clear|deposit|transfer)\b|"
    r"\b(?:payment|emi)\b.{0,35}\b(?:kar|pay|clear|deposit|transfer)\b|"
    r"\b(?:pay|payment|clear|deposit)\b.{0,35}\b(?:kar\s+)?(?:dunga|doonga|dungi|denge)\b|"
    r"\bkar\s+(?:dunga|doonga|dungi|denge|deta\s+hoon|deta\s+hu)\b|"
    r"(?:भुगतान|पेमेंट)\s*(?:कर|हो)|"
    r"कर\s*(?:दूँगा|दूंगा|दूंगी|देंगे))",
    re.I,
)
_VAGUE_RE = re.compile(
    r"(dekh\s*(?:lunga|loonga|lenge|ta hoon)|baad\s+(?:me|mein)|later|"
    r"i\s+will\s+see|let\s+me\s+see|try\s+kar|abhi\s+nahi\s+pata|don'?t\s+know)",
    re.I,
)
_PAID_STATED_RE = re.compile(
    r"(already\s+paid|have\s+paid|payment\s+(?:is\s+)?(?:done|made)|ho\s+gaya\s+(?:hai|h)?|"
    r"kar\s+diya|debit\s+ho\s+gaya|paisa\s+(?:cut|kat)\s+gaya|jama\s+kar\s+diya)",
    re.I,
)
_DELAY_ASK_RE = re.compile(
    r"(what\s+(?:is|was)\s+the\s+reason|reason\s+(?:for|of)\s+(?:the\s+)?(?:bounce|delay|late|non)|"
    r"(?:do|did)\s+you\s+know\s+the\s+reason|know\s+the\s+reason\b|may\s+i\s+know\s+the\s+reason|"
    # Floor phrasing: "Can you tell me the reason?" / "Reason जान सकती हूँ?"
    r"(?:can|could)\s+you\s+tell\s+me\s+the\s+reason|tell\s+me\s+the\s+reason|"
    r"reason\s+जान\s+सकती\s+हूँ|reason\s+jaan\s+sakti|"
    r"why\s+(?:did|was|is|has|were)\s+.*(?:bounce|delay|late|not\s+(?:pa|made|done|clear))|"
    r"kya\s+(?:reason|karan|wajah)|reason\s+(?:kya|pata|bata|batayenge|bataiye)|"
    r"(?:karan|wajah)\s+(?:kya|bata)|bounce\s+(?:ka|kyu|kyun|kyon)|"
    # Hindi/Marathi: "देरी का कारण क्या है?" / "अकाउंटमध्ये बॅलन्स नव्हता का?"
    r"देरी\s*(?:का|के)?\s*कारण|"
    r"कारण\s*(?:क्या|काय)|"
    r"क्या\s*(?:कारण|वजह)|"
    r"(?:बाउंस|bounce)\s*(?:का|क्यों|क्यूं)|"
    r"बॅलन्स\s*नव्हता\s*का|"
    r"क्यों\s*(?:बाउंस|देरी|भुगतान|पेमेंट)|"
    # Salary-cycle probe used as RFD on bounce calls
    r"(?:सैलरी|वेतन|सॅलरी).{0,30}(?:कब|कधी|तारीख|तारख|सायकल|सायकल|कोणती)|"
    r"(?:कब|कधी)\s*(?:सैलरी|वेतन|सॅलरी)|"
    r"सॅलरी\s*सायकल)",
    re.I,
)
# Hindi puts "kyun" after the subject as often as before, so the question word and
# a payment noun are matched independently rather than in a fixed order.
_WHY_RE = re.compile(r"\b(kyun|kyu|kyon|क्यों)\b", re.I)
_PAYMENT_NOUN_RE = re.compile(
    r"(payment|emi|bounce|installment|instalment|late|der\b|nahi|bhugtan|किस्त|भुगतान)", re.I
)

# BRD 3.4 exception: the borrower may volunteer the reason, in which case the
# agent need not ask.
_ACCOUNT_ACCESS_PROBLEM_RE = re.compile(
    r"(?:\b(?:bank\s+)?account\b.{0,35}\b(?:block(?:ed)?|frozen?|closed?|inactive|"
    r"not\s+active|not\s+working)\b|\b(?:block(?:ed)?|frozen?)\b.{0,35}\baccount\b)",
    re.I,
)
_DELAY_REASON_GIVEN_RE = re.compile(
    r"(the\s+reason\s+is|because\s+(?:my|of|the)|my\s+bank\s+(?:was|had)|"
    r"(?:salary|payment)\s+(?:was\s+)?(?:not|late|delayed)|problem\s+(?:tha|hua|was)|"
    r"reason\s+(?:ye|yah|yeh)|paisa\s+nahi\s+tha|medical|hospital|job\s+(?:chala|nahi)|"
    r"was\s+having\s+a\s+little\s+problem|not\s+being\s+uploaded|"
    r"(?:bank\s+)?account.{0,35}(?:block(?:ed)?|frozen?|closed?|inactive|not\s+active|not\s+working)|"
    r"(?:block(?:ed)?|frozen?).{0,35}account|"
    # Volunteered shortfall / underpayment (Shubham-class COLL calls)
    r"put\s+in\s+(?:some\s+)?less\s+money|less\s+money|"
    r"short\s*(?:fall|money)|under\s*paid|partial(?:ly)?\s*(?:paid|payment)|"
    r"last\s+time.{0,50}(?:less|कम|कमी)|"
    r"(?:वेतन|सैलरी|सॅलरी).{0,25}(?:नहीं|नही|नव्हते|उशिरा|आएगी|आती)|"
    r"अकाउंट.{0,35}(?:ब्लॉक|बंद|समस्या)|"
    r"पैसे\s*नहीं|"
    r"बॅलन्स\s*नव्हता|"
    r"(?:ATM|एटीएम).{0,20}(?:बंद|block)|"
    r"चेक\s*बाउंस|"
    r"सैलरी\s*\d{1,2}\s*तारीख|"
    r"(?:रक्कम|बॅलन्स|बैलेंस|पैसे).{0,40}(?:कमी|कम)|"
    r"कमी\s*पडला|"
    r"EMI\s*बढ़ा|"
    r"सॅलरी\s*सायकल)",
    re.I,
)

# BRD 3.4 applies only when a payment ACTUALLY bounced or was delayed. Warning a
# borrower so the EMI "doesn't bounce" is prevention, not a delay, and must not
# make the parameter applicable.
_PAST_DELAY_RE = re.compile(
    r"((?:there\s+was|was|had)\s+a\s+bounce|bounce\s+(?:occurred|occured|ho\s+gaya|hua|hui)|"
    r"bounced|payment\s+(?:was\s+)?(?:missed|delayed|late|not\s+made|nahi\s+hui)|"
    r"emi\s+(?:bounce\s+ho|nahi\s+gayi)|overdue|past\s+due|\bdpd\b|bakaya|"
    r"consecutive\s+bounces|broken\s+ptp|last\s+(?:payment|month)\s+.*bounce|"
    r"बाउंस\s*(?:हो|हुआ|झाली|झाले|चुका|चुकी)|"
    r"(?:भुगतान|पेमेंट|ईएमआई|EMI).{0,25}(?:बाउंस|लंबित|बकाया|अपडेट\s*नहीं)|"
    r"देय\s*तिथि\s*(?:निकल|बीत)|"
    r"ड्यू\s*डेट.{0,30}(?:निकल|बाउंस|लंबित)|"
    r"(?:जमा\s*झालेली\s*नाही|जमा\s*नहीं|अपडेट\s*नहीं\s*हुआ)|"
    r"विलंब\s*होतो|पेमेंट\s*\d{1,2}\s*तारख)",
    re.I,
)
_PREVENTIVE_BOUNCE_RE = re.compile(
    r"((?:doesn'?t|does\s+not|don'?t|do\s+not|won'?t|will\s+not|na)\s+bounce|"
    r"if\s+the\s+emi\s+bounces|in\s+case\s+.*bounce|bounce\s+(?:na|nahi)\s+ho|"
    r"so\s+that\s+.*bounce|to\s+avoid\s+.*bounce|bounce\s+hone\s+se)",
    re.I,
)


def _turns(transcript: str) -> list[tuple[float, str, str]]:
    """(start, role, text) turns from a diarized transcript."""
    out: list[tuple[float, str, str]] = []
    for m in _LINE_RE.finditer(transcript or ""):
        try:
            start = float(m.group(1))
        except (TypeError, ValueError):
            start = 0.0
        out.append((start, m.group(3), m.group(4).strip()))
    return out


def _merged_turns(*transcripts: str) -> list[tuple[float, str, str]]:
    """Turns from every available transcript view (original + translation).

    Cues may survive in only one view, so both are scanned; the longest view is
    used for ordering-sensitive checks.
    """
    views = [_turns(t) for t in transcripts if t and str(t).strip()]
    views = [v for v in views if v]
    if not views:
        return []
    return max(views, key=len)


def _role_text(turns: list[tuple[float, str, str]], role: str) -> str:
    return " ".join(t[2] for t in turns if t[1] == role)


def _all_role_text(role: str, *transcripts: str) -> str:
    parts = [_role_text(_turns(t), role) for t in transcripts if t and str(t).strip()]
    return " ".join(p for p in parts if p)


def detect_recording_disclaimer(*transcripts: str) -> dict[str, Any]:
    """Recording / quality-and-training notice spoken by the agent."""
    for t in transcripts:
        for _, role, text in _turns(t):
            if role != "Agent":
                continue
            m = _DISCLAIMER_RE.search(text)
            if m:
                return {"present": True, "evidence": text[:160]}
    return {"present": False, "evidence": ""}


def _org_tokens(org_name: str) -> list[str]:
    return [
        w.lower()
        for w in re.split(r"[^A-Za-z]+", str(org_name or ""))
        if len(w) > 2 and w.lower() not in _ORG_STOPWORDS
    ]


def _company_mentioned(text: str, tokens: list[str]) -> bool:
    low = (text or "").lower()
    if _ORG_FALLBACK_RE.search(text) or _ORG_ASR_FUZZ_RE.search(text):
        return True
    # Distinctive brand tokens (icici / hfc) count alone. Generic "home" must not
    # match "home loan" — require home/housing + finance together.
    distinctive = [tok for tok in tokens if tok not in ("home", "housing", "finance")]
    if any(tok in low for tok in distinctive):
        return True
    if "home" in tokens or "housing" in tokens or "finance" in tokens:
        return bool(re.search(r"(?:home|housing)\s*finance", low))
    return any(tok in low for tok in tokens)


def detect_self_introduction(org_name: str, *transcripts: str) -> dict[str, Any]:
    """Greeting + agent name + company, as BRD 1.1 requires all three.

    BRD: "AI rating will be 0 … failed to give greetings, failed to introduce
    self or bank or both", so a partial introduction is not a partial score.
    Runs over every transcript view (original + English) so a Hindi name line
    still counts when translation mangled it.
    """
    tokens = _org_tokens(org_name)
    name_ev = ""
    company_ev = ""
    greet_ev = ""
    for t in transcripts:
        for _, role, text in _turns(t):
            if role != "Agent":
                continue
            company_here = _company_mentioned(text, tokens)
            if not name_ev and (
                _SELF_NAME_RE.search(text)
                or (company_here and _BARE_NAME_SPEAKING_RE.search(text))
            ):
                name_ev = text[:160]
            if not company_ev and company_here:
                company_ev = text[:160]
            if not greet_ev and _GREETING_RE.search(text):
                greet_ev = text[:160]
    return {
        "nameGiven": bool(name_ev),
        "companyGiven": bool(company_ev),
        "greetingGiven": bool(greet_ev),
        "evidence": name_ev or company_ev or greet_ev,
        "nameEvidence": name_ev,
        "companyEvidence": company_ev,
        "greetingEvidence": greet_ev,
    }


# How far after an RPC ask we still accept a borrower affirm. Floor speech often
# has filler ("Oh", "Hello", voice-check, "कहाँ से बोल रहे हैं?") before "Yes" /
# "हाँ बोलिये". Constants are defined with _AFFIRM_RE above.


def detect_rpc_verification(*transcripts: str) -> dict[str, Any]:
    """Right-party confirmation: agent asks for the borrower, borrower confirms.

    Every ask is checked, not just the first — agents typically page the borrower
    ("Hello Lala Ram ji?") before the confirming question. Affirms may arrive
    several turns later after line-quality filler.
    """
    asked = False
    first_ask = ""
    first_ask_at: float | None = None
    confirmations: list[tuple[float, str, str]] = []
    first_disclosure_at: float | None = None
    first_disclosure = ""

    for t in transcripts:
        turns = _turns(t)
        for start, role, text in turns:
            if role == "Agent" and _ACCOUNT_DETAIL_RE.search(text):
                if first_disclosure_at is None or start < first_disclosure_at:
                    first_disclosure_at = start
                    first_disclosure = text[:160]

        for i, (ask_start, role, text) in enumerate(turns):
            is_explicit_ask = bool(_RPC_ASK_RE.search(text)) and _has_named_rpc_target(text)
            is_name_address = bool(_RPC_NAME_ADDRESS_RE.search(text))
            is_self_speaking = bool(_BARE_NAME_SPEAKING_RE.search(text)) and not re.search(
                r"speaking\s+(?:to|with)\b", text, re.I
            )
            if role != "Agent" or not (
                is_explicit_ask
                or (is_name_address and not is_self_speaking and _has_named_rpc_target(text))
            ):
                continue
            asked = True
            if first_ask_at is None or ask_start < first_ask_at:
                first_ask_at = ask_start
                first_ask = text[:160]
            customer_seen = 0
            for nstart, nrole, ntext in turns[i + 1 : i + 1 + _RPC_AFFIRM_LOOKAHEAD]:
                if nstart - ask_start > _RPC_AFFIRM_MAX_SEC:
                    break
                if nrole != "Customer":
                    continue
                customer_seen += 1
                if _AFFIRM_RE.search(ntext):
                    confirmations.append((nstart, text[:160], ntext[:160]))
                    break
                if customer_seen >= 8:
                    break

    if confirmations:
        confirm_at, ask_evidence, affirm_evidence = min(confirmations, key=lambda item: item[0])
        if first_disclosure_at is None or first_disclosure_at >= confirm_at:
            return {
                "verified": True,
                "asked": True,
                "evidence": ask_evidence,
                "affirmationEvidence": affirm_evidence,
                "disclosedBeforeVerification": False,
                "disclosureEvidence": "",
            }

    disclosed_first = bool(
        first_disclosure_at is not None
        and (not confirmations or first_disclosure_at < min(item[0] for item in confirmations))
    )
    return {
        "verified": False,
        "asked": asked,
        "evidence": first_ask,
        "affirmationEvidence": "",
        "disclosedBeforeVerification": disclosed_first,
        "disclosureEvidence": first_disclosure if disclosed_first else "",
    }


def recover_rpc_from_opening_evidence(
    opening_evidence: str,
    *transcripts: str,
) -> dict[str, Any] | None:
    """Recover an RPC ask lost only because short ASR chunks lacked context.

    The supplemental decode contains the isolated agent channel only.  It can
    supply a *named* ask, but never supplies the borrower's confirmation.  A
    real affirmative customer turn must still exist in the normal diarized
    transcript before the first sensitive account disclosure.  This preserves
    the BRD fatal gate and cannot turn generic "talking to you" wording into an
    RPC pass.
    """
    evidence = str(opening_evidence or "").strip()
    is_named_ask = bool(_RPC_ASK_RE.search(evidence)) and _has_named_rpc_target(evidence)
    is_named_address = bool(_RPC_NAME_ADDRESS_RE.search(evidence))
    is_agent_self_intro = bool(_BARE_NAME_SPEAKING_RE.search(evidence)) and not re.search(
        r"speaking\s+(?:to|with)\b", evidence, re.I
    )
    if not (is_named_ask or (is_named_address and not is_agent_self_intro)):
        return None

    all_turns = [_turns(value) for value in transcripts if value and str(value).strip()]
    first_disclosure_at: float | None = None
    first_disclosure = ""
    confirmations: list[tuple[float, str]] = []
    for turns in all_turns:
        for start, role, text in turns:
            if role == "Agent" and _ACCOUNT_DETAIL_RE.search(text):
                if first_disclosure_at is None or start < first_disclosure_at:
                    first_disclosure_at = start
                    first_disclosure = text[:160]
            if (
                role == "Customer"
                and start <= _RPC_AFFIRM_MAX_SEC
                and _AFFIRM_RE.search(text)
            ):
                confirmations.append((start, text[:160]))

    if confirmations:
        confirm_at, confirmation = min(confirmations, key=lambda item: item[0])
        if first_disclosure_at is None or confirm_at <= first_disclosure_at:
            return {
                "verified": True,
                "asked": True,
                "evidence": evidence[:160],
                "affirmationEvidence": confirmation,
                "disclosedBeforeVerification": False,
                "disclosureEvidence": "",
                "recoveredFromContextualOpening": True,
            }

    return {
        "verified": False,
        "asked": True,
        "evidence": evidence[:160],
        "affirmationEvidence": "",
        "disclosedBeforeVerification": bool(first_disclosure_at is not None),
        "disclosureEvidence": first_disclosure,
        "recoveredFromContextualOpening": True,
    }


def detect_delay_probe(*transcripts: str) -> dict[str, Any]:
    """Did the agent ask WHY the payment bounced / was delayed?

    Also reports whether the borrower volunteered the reason, which BRD 3.4
    accepts in place of the agent asking.
    """
    out = {"asked": False, "answered": False, "proactive": False, "evidence": ""}
    for t in transcripts:
        turns = _turns(t)
        for i, (_, role, text) in enumerate(turns):
            if role == "Customer" and _DELAY_REASON_GIVEN_RE.search(text):
                out["proactive"] = True
                if not out["evidence"]:
                    out["evidence"] = text[:160]
            if role != "Agent" or out["asked"]:
                continue
            asked = bool(_DELAY_ASK_RE.search(text)) or bool(
                _WHY_RE.search(text) and _PAYMENT_NOUN_RE.search(text)
            )
            if not asked:
                continue
            out["asked"] = True
            out["evidence"] = text[:160]
            out["answered"] = any(
                nrole == "Customer" and len(ntext.split()) >= 2
                for _, nrole, ntext in turns[i + 1 : i + 3]
            )
    return out


def detect_commitment(*transcripts: str) -> dict[str, Any]:
    """Payment commitment actually reached on the call.

    A balance-maintain agreement (so the ECS/NACH clears) is a commitment with
    mode "ECS" — collections floors phrase it as "aaj maintain kar dunga", which
    the model kept scoring as a plain callback.
    """
    result: dict[str, Any] = {
        "present": False,
        "mode": "",
        "timing": "",
        "paid": False,
        "refusal": False,
        "vagueOnly": False,
        "amountConfirmed": False,
        "evidence": "",
        "agentReadBack": False,
    }
    turns = _merged_turns(*transcripts)
    if not turns:
        return result

    cust_text = " ".join(t[2] for t in turns if t[1] == "Customer")
    agent_text = " ".join(t[2] for t in turns if t[1] == "Agent")
    if _PAID_STATED_RE.search(cust_text):
        result.update(paid=True, present=True, mode="already paid",
                      evidence=cust_text[:160])
    if any(cue in cust_text.lower() for cue in _REFUSAL_CUES):
        result["refusal"] = True
    # BRD 3.1 mandate details: prefer a parsed EMI/amount-due figure when present.
    loan_basics = extract_loan_basics(*transcripts)
    parsed_amount = loan_basics.get("emiAmount")
    result["amountConfirmed"] = parsed_amount is not None or bool(_AMOUNT_RE.search(agent_text))
    result["amountValue"] = parsed_amount

    for i, (_, role, text) in enumerate(turns):
        is_ecs = bool(_ECS_COMMIT_RE.search(text))
        is_manual = bool(_MANUAL_COMMIT_RE.search(text)) or (
            role == "Customer" and bool(_CUSTOMER_COMMIT_RE.search(text))
        )
        if not (is_ecs or is_manual):
            continue
        # Customer deposit/jama language is manual; "rakh/maintain" after ECS
        # coaching remains ECS.
        customer_manual = bool(
            role == "Customer" and _CUSTOMER_MANUAL_PAYMENT_RE.search(text)
        )
        timing_here = _timing_from_text(
            text, prefer_ecs_maintain=is_ecs and not customer_manual
        )
        tm = bool(timing_here)
        follow = turns[i + 1 : i + 4]
        if role == "Customer":
            # BRD 3.1 wants a strong confirmation: the borrower's own commitment
            # words or a date. A bare "haan / ok" is acknowledgement, not a promise.
            confirmed = bool(_CUSTOMER_COMMIT_RE.search(text) or tm)
        else:
            cust_commit = any(
                r == "Customer" and _CUSTOMER_COMMIT_RE.search(tx) for _, r, tx in follow
            )
            # ECS/NACH balance-maintain is routinely confirmed on the floor with a
            # short affirm ("हा / हम्म / okay") after the agent states the funding
            # date. Require the agent turn itself to carry ECS+timing evidence.
            ecs_affirm = bool(
                is_ecs
                and tm
                and any(
                    r == "Customer" and _AFFIRM_RE.search(tx)
                    for _, r, tx in follow
                )
            )
            # A dated instruction followed by "haan / okay" is still only an
            # acknowledgement for manual PTP. BRD 3.1 requires commitment
            # language ("I will pay/maintain") unless this is an ECS maintain.
            confirmed = cust_commit or ecs_affirm
            if confirmed:
                result["agentReadBack"] = True
        if not confirmed:
            continue

        # Mode: customer deposit/jama wins over earlier agent ECS coaching.
        if customer_manual:
            mode = "manual"
        else:
            window = " ".join(tx for _, _r, tx in turns[max(0, i - 2) : i + 3])
            mode = "ECS" if (is_ecs or _ECS_COMMIT_RE.search(window)) else "manual"
        if not result["present"]:
            result["present"] = True
            result["mode"] = mode
        elif customer_manual and result["mode"] == "ECS":
            # Borrower deposit/jama outranks earlier agent ECS maintain coaching.
            result["mode"] = "manual"
        elif mode == "ECS" and result["mode"] == "manual":
            # Keep the secured customer manual PTP; do not flip back to ECS.
            pass

        if timing_here:
            replace_timing = (
                not result["timing"]
                or customer_manual
                or (
                    result["mode"] == "ECS"
                    and is_ecs
                    and not customer_manual
                    and (
                        "maintain" in text.lower()
                        or "मेन्टेन" in text
                        or "मॅनटेन" in text
                    )
                )
            )
            if replace_timing:
                result["timing"] = timing_here
                result["evidence"] = text[:160]
        elif not result["evidence"]:
            result["evidence"] = text[:160]

        if result["present"] and not result["timing"]:
            lookback = " ".join(tx for _, _r, tx in turns[max(0, i - 4) : i + 1])
            inherited = _timing_from_text(
                lookback, prefer_ecs_maintain=(result["mode"] == "ECS")
            )
            if inherited:
                result["timing"] = inherited

    if not result["present"]:
        combined = " ".join(t[2] for t in turns)
        result["vagueOnly"] = bool(_VAGUE_RE.search(combined))
    return result


def is_secured_ptp(commitment: dict[str, Any] | None) -> bool:
    """True only for the complete BRD PTP bundle.

    A future PTP needs borrower commitment language plus a confirmed date/time,
    amount and payment mode.  A payment already made is a resolved-payment
    outcome, not a promise to pay.
    """
    value = commitment or {}
    return bool(
        value.get("present")
        and not value.get("paid")
        and str(value.get("timing") or "").strip()
        and value.get("amountConfirmed")
        and str(value.get("mode") or "").strip()
    )


def detect_conditional_payment_intent(*transcripts: str) -> dict[str, Any]:
    """Find borrower willingness that depends on an unresolved obstacle.

    This signal is deliberately informational.  It improves the summary and
    coaching but can never create a PTP/disposition because the BRD bundle is
    incomplete.
    """
    for transcript in transcripts:
        customer_turns = [
            (start, text) for start, role, text in _turns(transcript) if role == "Customer"
        ]
        for i, (start, text) in enumerate(customer_turns):
            nearby = [text]
            for next_start, next_text in customer_turns[i + 1 : i + 3]:
                if next_start - start > 35.0:
                    break
                nearby.append(next_text)
            window = " ".join(nearby)
            if (
                _CONDITIONAL_PAYMENT_CONTEXT_RE.search(window)
                and _CONDITIONAL_PAYMENT_ACTION_RE.search(window)
            ):
                return {"present": True, "evidence": text[:240]}
    return {"present": False, "evidence": ""}


_THIRD_PARTY_RE = re.compile(
    r"(wrong\s+number|galat\s+number|not\s+(?:his|her|my)\s+number|"
    r"(?:he|she|they)\s+(?:is|are)\s+not\s+(?:here|available|home|at\s+home)|"
    r"woh\s+(?:ghar|abhi)\s+(?:par\s+)?nahi|unhe?\s+nahi\s+(?:hai|hain)|"
    r"i\s+am\s+(?:his|her|their)\s+(?:brother|sister|wife|husband|son|daughter|father|mother|"
    r"friend|neighbour|neighbor|relative)|"
    r"(?:unka|unki|uska|uski)\s+(?:bhai|behen|patni|pati|beta|beti|pita|maa|dost|rishtedar)|"
    r"main\s+unk[ai]\s+\w+\s+(?:hoon|hu|hun)|"
    r"speaking\s+on\s+(?:his|her|their)\s+behalf)",
    re.I,
)
# BRD 1.3: a third party may only be told anything after name, relationship and
# consent are taken.
_TP_AUTH_RE = re.compile(
    r"(what\s+is\s+your\s+relation|relation(?:ship)?\s+(?:with|kya|hai)|"
    r"aap\s+unke\s+kya\s+(?:lagte|hote)|aap\s+kaun\s+bol\s+rahe|"
    r"kya\s+aapko\s+(?:is\s+)?(?:loan|account|payment)\s+(?:ke\s+baare\s+me\s+)?(?:pata|jankari|maloom)|"
    r"are\s+you\s+aware\s+of\s+(?:this|the)\s+(?:loan|account)|"
    r"do\s+you\s+handle\s+(?:his|her|the)\s+(?:financial|payment|transaction)|"
    r"aap\s+(?:hi\s+)?(?:payment|transaction)\s+(?:karte|dekhte|handle))",
    re.I,
)
_ACCOUNT_DETAIL_RE = re.compile(
    r"(loan\s+account|account\s+number|last\s+(?:4|four)\s+digits|"
    r"emi\s+(?:of|is|amount|hai)|due\s+(?:date|amount)|outstanding|bakaya|overdue\s+amount|"
    r"\d[\d,]{2,}\s*(?:rupees|rupaye|rs\.?|₹)|bounce\s+charge|penal\s+charge|"
    r"लोन\s*(?:नंबर|अकाउंट)|अंतिम\s*(?:चार\s*)?अंक|"
    r"ईएमआई|देय\s*तिथि|ड्यू\s*डेट|"
    r"बाउंस\s*चार्ज|पेनल्टी)",
    re.I,
)

# Spoken account facts for the Result Scoring "Loan basics" card (not sales leads).
_LOAN_TYPE_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\b(?:home|housing)\s+loan\b|होम\s*लोन|गृह\s*लोन|होम\s*लोन्स?", re.I), "Home Loan"),
    (re.compile(r"\bpersonal\s+loan\b|पर्सनल\s*लोन", re.I), "Personal Loan"),
    (re.compile(r"\b(?:car|auto|vehicle)\s+loan\b|कार\s*लोन|ऑटो\s*लोन", re.I), "Auto Loan"),
    (re.compile(r"\bgold\s+loan\b|गोल्ड\s*लोन", re.I), "Gold Loan"),
    (re.compile(r"\beducation\s+loan\b|एजुकेशन\s*लोन", re.I), "Education Loan"),
)
# Last-4: digits after OR before "loan account" / "account number" (ASR order varies).
_LOAN_LAST4_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"(?:last\s*(?:4|four)\s*(?:digit|digits|number|numbers|जी)|"
        r"last\s*4\s*digit(?:\s*number)?|"
        r"अंतिम\s*(?:चार\s*)?अंक|"
        r"शेवटचे\s*(?:चार\s*)?(?:अंक|digit))"
        r".{0,48}?(?<!\d)(\d{4})(?!\d)",
        re.I,
    ),
    # Spaced Hindi ASR: "2 6 डबल 4" → 2644
    re.compile(
        r"(?:last\s*(?:4|four)|last\s*4\s*(?:जी|digit)|लोन\s*का\s*last).{0,40}?"
        r"(\d)\s+(\d)\s+(?:डबल|double)\s+(\d)\b",
        re.I,
    ),
    re.compile(
        r"(?:last\s*(?:4|four)|last\s*4).{0,40}?"
        r"(\d)\s+(\d)\s+(\d)\s+(\d)\b",
        re.I,
    ),
    re.compile(
        r"(?:loan\s+)?account(?:\s+number)?(?:'s)?"
        r"(?:\s*(?:last\s*)?(?:4|four)?\s*(?:digit|digits)?)?"
        r"\s*(?:is|are|आहे|है|:)?\s*(?<!\d)(\d{4})(?!\d)",
        re.I,
    ),
    re.compile(
        r"(?<!\d)(\d{4})(?!\d)\s*(?:loan\s+)?(?:account|अकाउंट|अकाऊंट)(?:\s+number)?",
        re.I,
    ),
    re.compile(
        r"(?:loan|लोन).{0,24}(?:account|अकाउंट|number|नंबर).{0,24}(?<!\d)(\d{4})(?!\d)",
        re.I,
    ),
)
# EMI / amount-due figures (EMI keyword optional when "amount है … रुपये").
_LOAN_EMI_AMOUNT_RE = re.compile(
    r"(?:(?:an|the|your|about(?:\s+an)?)\s+)?(?:EMI|ईएमआई|ई\s*एम\s*आई)"
    r"\s*(?:amount|अमाउंट|रक्कम)?\s*(?:is|of|hai|आहे|है|:)?\s*"
    r"(?:of\s+|is\s+)?"
    r"(?:₹\s*|rs\.?\s*)?(\d{1,3}(?:[,\s]\d{2,3})+|\d{3,7})(?:\.\d+)?\s*(?:rupees?|rupaye|rupya|rs\.?|₹)?"
    r"|"
    r"(?:₹\s*|rs\.?\s*)?(\d{1,3}(?:[,\s]\d{2,3})+|\d{3,7})(?:\.\d+)?\s*(?:rupees?|rupaye|rupya|rs\.?)?\s*"
    r"(?:का\s*|चे\s*|ची\s*|ki\s+|ka\s+)?"
    r"(?:EMI|ईएमआई)"
    r"|"
    r"(?:EMI|ईएमआई)\s*(?:of|amount)?[^.\n]{0,40}?"
    r"(?:₹\s*|rs\.?\s*)?(\d{1,3}(?:[,\s]\d{2,3})+|\d{3,7})(?:\.\d+)?"
    r"|"
    r"(?:amount\s*(?:due|is)|मेरी\s*amount|amount\s*है|रक्कम(?:\s*है)?|"
    r"the\s+amount\s+due\s+is)"
    r".{0,36}?"
    r"(?:₹\s*|rs\.?\s*)?(\d{1,3}(?:[,\s]\d{2,3})+|\d{3,7})(?:\.\d+)?",
    re.I,
)
_LOAN_BOUNCE_NEAR_RE = re.compile(
    r"(?:bounce|बाउंस|penal|penalty|पेनल्टी|late\s+charge|1\s*\.?\s*5\s*%|1\s*point\s*5)",
    re.I,
)
# Hindi: day BEFORE तारीख ("10 तारीख" / "दस तारीख") — prefer over forward scan.
_LOAN_DUE_DATE_BEFORE_RE = re.compile(
    r"((?:आठ|नऊ|नववी|दहा|दस|अकरा|ग्यारह|बारा|बारह|\d{1,2}))\s*"
    r"(?:तारिख|तारीख|तारखेला|तारख)\b",
    re.I,
)
_LOAN_DUE_DATE_RE = re.compile(
    r"(?:due\s+date|emi\s+date|new\s+due\s+date|new\s+date|overdue\s+since|"
    r"ड्यू\s*डेट|देय\s*तिथि)"
    r".{0,48}?"
    r"(?:of\s+(?:the\s+)?|is\s+(?:the\s+)?|on\s+(?:the\s+)?|को\s*|ला\s*|by\s+(?:the\s+)?)?"
    r"(\d{1,2}(?:st|nd|rd|th)?|"
    r"आठ|नऊ|नववी|दहा|दस|अकरा|ग्यारह|बारा|बारह|"
    r"first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|"
    r"eleventh|twelfth|thirteenth|fourteenth|fifteenth)",
    re.I,
)
_LOAN_DUE_DATE_ALT_RE = re.compile(
    r"(?:due\s+on|due\s+for|emi\s+(?:is\s+)?on|emi\s+is\s+due|overdue\s+since)\s+(?:the\s+)?"
    r"(\d{1,2}(?:st|nd|rd|th)?)",
    re.I,
)
# PDM scripts often say the EMI due day as "maintain … by the 10th" / "before the 10th".
_LOAN_MAINTAIN_BY_DAY_RE = re.compile(
    r"(?:maintain(?:\s+the)?\s+(?:cash|balance|funds|amount).{0,40}?\bby\s+(?:the\s+)?|"
    r"before\s+(?:the\s+)?|"
    r"(?:पहले|आधी)\s*)"
    r"(\d{1,2}(?:st|nd|rd|th)?|"
    r"आठ|नऊ|नववी|दहा|दस|अकरा|ग्यारह|बारा|बारह)",
    re.I,
)
_LOAN_DUE_CALENDAR_NOISE_RE = re.compile(
    r"(?:today|already\s+passed|has\s+already\s+passed|date\s+of)\b",
    re.I,
)
# Words that mark a spoken day as "today", not as the EMI due day. Matched
# against the few characters immediately BEFORE the day, because the Hindi
# evidence string ("19 तारीख") never contains the आज that gives it away.
# Used only to weight consensus votes; the evidence-level filter is unchanged.
_LOAN_DUE_TODAY_RE = re.compile(r"(?:\btoday\b|आज)", re.I)
_LOAN_DUE_VETO_LOOKBEHIND = 18
_LOAN_DUE_STRONG_RE = re.compile(
    r"(?:due\s+on|due\s+date|emi\s+date|तारीख|तारिख|देय\s*तिथि|ड्यू\s*डेट)",
    re.I,
)
_LOAN_AMOUNT_CONTEXT_RE = re.compile(
    r"(?:amount|रुपये|rupees|rs\.?|₹|रक्कम)",
    re.I,
)
_DEVANAGARI_DAY = {
    "आठ": "8th",
    "नऊ": "9th",
    "नववी": "9th",
    "दहा": "10th",
    "दस": "10th",
    "अकरा": "11th",
    "ग्यारह": "11th",
    "बारा": "12th",
    "बारह": "12th",
}
_ENGLISH_DAY_ORD = {
    "first": "1st",
    "second": "2nd",
    "third": "3rd",
    "fourth": "4th",
    "fifth": "5th",
    "sixth": "6th",
    "seventh": "7th",
    "eighth": "8th",
    "ninth": "9th",
    "tenth": "10th",
    "eleventh": "11th",
    "twelfth": "12th",
    "thirteenth": "13th",
    "fourteenth": "14th",
    "fifteenth": "15th",
}


def _normalize_spoken_due_day(raw: str) -> str:
    token = (raw or "").strip()
    if not token:
        return ""
    if token in _DEVANAGARI_DAY:
        return _DEVANAGARI_DAY[token]
    low = token.lower()
    if low in _ENGLISH_DAY_ORD:
        return _ENGLISH_DAY_ORD[low]
    m = re.match(r"^(\d{1,2})(st|nd|rd|th)?$", low, re.I)
    if m:
        n = int(m.group(1))
        if 1 <= n <= 31:
            suf = {1: "st", 2: "nd", 3: "rd"}.get(n if n < 14 else n % 10, "th")
            if 11 <= (n % 100) <= 13:
                suf = "th"
            return f"{n}{suf}"
    return token


def _parse_emi_amount_token(raw: str) -> float | None:
    # Join all digit groups so ASR spacing survives: "30 1,054" / "30,1054" → 301054.
    digits = "".join(re.findall(r"\d+", raw or ""))
    if not digits:
        return None
    try:
        value = float(digits)
    except ValueError:
        return None
    # EMI amounts on HFC floor scripts are typically thousands, not bounce fees.
    if value < 500 or value > 5_000_000:
        return None
    return value


def _loan_last4_from_match(m: re.Match[str]) -> str:
    groups = [g for g in m.groups() if g]
    if len(groups) == 1 and len(groups[0]) == 4:
        return groups[0]
    pat = m.re.pattern
    if len(groups) == 3 and ("डबल" in pat or "double" in pat):
        # 2 6 डबल 4 → 2644
        return f"{groups[0]}{groups[1]}{groups[2]}{groups[2]}"
    if len(groups) == 4 and all(len(g) == 1 for g in groups):
        return "".join(groups)
    return ""


def _pick_loan_due_date(agent_text: str) -> tuple[str, str]:
    """Return (dueDate, evidence) preferring Hindi day-before-तारीख and English due cues.

    Never treat the leading digits of an amount phrase as the due day.
    """
    text = agent_text or ""
    # (priority, day, evidence, veto_context). ``evidence`` is what the UI
    # renders and must stay the bare match; ``veto_context`` is the short run
    # of text before the day, read only when counting consensus votes.
    candidates: list[tuple[int, str, str, str]] = []

    def _veto_context(start: int) -> str:
        return text[max(0, start - _LOAN_DUE_VETO_LOOKBEHIND) : start]

    for m in _LOAN_DUE_DATE_BEFORE_RE.finditer(text):
        due = _normalize_spoken_due_day(m.group(1))
        if due:
            candidates.append((0, due, m.group(0)[:100], _veto_context(m.start())))

    for pattern, priority in (
        (_LOAN_DUE_DATE_RE, 1),
        (_LOAN_DUE_DATE_ALT_RE, 1),
        (_LOAN_MAINTAIN_BY_DAY_RE, 2),
    ):
        for m in pattern.finditer(text):
            due = _normalize_spoken_due_day(m.group(1))
            if not due:
                continue
            # Reject amount-context false positives ("amount है sir 30").
            local = text[max(0, m.start() - 28) : min(len(text), m.end() + 12)]
            if _LOAN_AMOUNT_CONTEXT_RE.search(local) and not re.search(
                r"(?:तारीख|तारिख|due|overdue|before|maintain)", local, re.I
            ):
                continue
            if "तारीख" not in m.group(0) and "तारिख" not in m.group(0):
                # Forward match that only captured a bare amount digit.
                raw_day = (m.group(1) or "").strip()
                if raw_day.isdigit() and _LOAN_AMOUNT_CONTEXT_RE.search(
                    text[max(0, m.start() - 40) : m.start() + 1]
                ):
                    continue
            candidates.append(
                (priority, due, m.group(0)[:100], _veto_context(m.start()))
            )

    strong = [c for c in candidates if _LOAN_DUE_STRONG_RE.search(c[2])]
    if strong:
        candidates = [
            c for c in candidates
            if _LOAN_DUE_STRONG_RE.search(c[2])
            or not _LOAN_DUE_CALENDAR_NOISE_RE.search(c[2])
        ]
        if any(_LOAN_DUE_STRONG_RE.search(c[2]) for c in candidates):
            candidates = [c for c in candidates if _LOAN_DUE_STRONG_RE.search(c[2])]
    if not candidates:
        return "", ""

    # Consensus, not text order. A garbled single mention must not outrank a
    # day the agent states more than once: on noisy telephony the account
    # sentence is exactly where the ASR mangles digits. Days introduced by a
    # "today" word are chatter about the calendar and get no vote.
    best_priority = min(c[0] for c in candidates)
    top = [c for c in candidates if c[0] == best_priority]

    votes: dict[str, int] = {}
    for _priority, day, _evidence, veto_context in top:
        if _LOAN_DUE_TODAY_RE.search(veto_context):
            continue
        votes[day] = votes.get(day, 0) + 1

    if votes:
        most = max(votes.values())
        winners = [day for day, count in votes.items() if count == most]
        if len(winners) == 1:
            for _priority, day, evidence, _veto in top:
                if day == winners[0]:
                    return day, evidence

    # Tie, or every mention was calendar chatter: earliest non-chatter mention
    # wins, which is the historical behaviour.
    for _priority, day, evidence, veto_context in top:
        if not _LOAN_DUE_TODAY_RE.search(veto_context):
            return day, evidence
    return top[0][1], top[0][2]


def _loan_basics_agent_text(*transcripts: str) -> str:
    """Join agent speech from every transcript view (original + English)."""
    chunks: list[str] = []
    for transcript in transcripts:
        if not (transcript or "").strip():
            continue
        turns = _merged_turns(transcript)
        agent = " ".join(t[2] for t in turns if t[1] == "Agent")
        if agent.strip():
            chunks.append(agent)
        else:
            chunks.append(transcript)
    return "\n".join(chunks)


def extract_loan_basics(*transcripts: str) -> dict[str, Any]:
    """Pull account facts spoken on the call for UI / report storage.

    Deterministic only — loan type, last-4, EMI amount, due day as spoken.
    Scans original and English agent turns so bilingual ASR / translation gaps
    still fill the Scoring card.
    """
    out: dict[str, Any] = {
        "loanType": None,
        "accountLast4": None,
        "emiAmount": None,
        "dueDate": None,
        "evidence": "",
    }
    agent_text = _loan_basics_agent_text(*transcripts)
    if not agent_text.strip():
        return out

    evidence_bits: list[str] = []

    for pattern, label in _LOAN_TYPE_PATTERNS:
        m = pattern.search(agent_text)
        if m:
            out["loanType"] = label
            evidence_bits.append(m.group(0)[:80])
            break

    for pattern in _LOAN_LAST4_PATTERNS:
        m = pattern.search(agent_text)
        if not m:
            continue
        digits = _loan_last4_from_match(m)
        if digits and len(digits) == 4 and digits.isdigit():
            out["accountLast4"] = digits
            evidence_bits.append(m.group(0)[:100])
            break

    for m in _LOAN_EMI_AMOUNT_RE.finditer(agent_text):
        raw = next((g for g in m.groups() if g), "")
        # Expand left/right over spaced ASR digit clusters ("30 1,054").
        span_l, span_r = m.start(), m.end()
        i = span_l
        while i > 0 and (agent_text[i - 1].isdigit() or agent_text[i - 1] in " ,"):
            i -= 1
        j = span_r
        while j < len(agent_text) and (agent_text[j].isdigit() or agent_text[j] in " ,"):
            j += 1
        expanded = agent_text[i:j]
        if len("".join(re.findall(r"\d+", expanded))) > len("".join(re.findall(r"\d+", raw))):
            raw = expanded
        local = agent_text[max(0, i - 28) : min(len(agent_text), j + 28)]
        if _LOAN_BOUNCE_NEAR_RE.search(local):
            continue
        amount = _parse_emi_amount_token(raw)
        if amount is not None:
            out["emiAmount"] = amount
            evidence_bits.append(expanded[:100] if expanded else m.group(0)[:100])
            break

    due, due_ev = _pick_loan_due_date(agent_text)
    if due:
        out["dueDate"] = due
        if due_ev:
            evidence_bits.append(due_ev)

    if evidence_bits:
        out["evidence"] = " | ".join(evidence_bits)[:280]
    return out


def detect_third_party(*transcripts: str) -> dict[str, Any]:
    """Is someone other than the borrower on the line, and was that handled?"""
    out = {"thirdParty": False, "authorized": False, "detailsShared": False, "evidence": ""}
    turns = _merged_turns(*transcripts)
    tp_index = None
    for i, (_s, role, text) in enumerate(turns):
        if role == "Customer" and _THIRD_PARTY_RE.search(text):
            tp_index = i
            out["thirdParty"] = True
            out["evidence"] = text[:160]
            break
    if tp_index is None:
        return out
    for _s, role, text in turns[tp_index:]:
        if role != "Agent":
            continue
        if _TP_AUTH_RE.search(text):
            out["authorized"] = True
        if _ACCOUNT_DETAIL_RE.search(text):
            out["detailsShared"] = True
    return out


def detect_early_drop(*transcripts: str) -> dict[str, Any]:
    """Did the call end before the agent could run the script?

    BRD marks the compliance and collections parameters NA / benefit-of-doubt when
    the borrower disconnects right after picking up. Without this, every abandoned
    dialer call in a batch would score as a fatal compliance breach.
    """
    turns = _merged_turns(*transcripts)
    agent_turns = [t for t in turns if t[1] == "Agent"]
    cust_turns = [t for t in turns if t[1] == "Customer"]
    agent_words = sum(_count_words(t[2]) for t in agent_turns)
    cust_words = sum(_count_words(t[2]) for t in cust_turns)
    # No real exchange happened: at most one agent attempt and a single word or
    # two back. A short but genuine conversation is NOT an early drop.
    dropped = (
        bool(turns)
        and len(agent_turns) <= 2
        and agent_words <= 25
        and len(cust_turns) <= 1
        and cust_words <= 3
    )
    return {
        "dropped": dropped,
        "agentTurns": len(agent_turns),
        "agentWords": agent_words,
        "customerWords": cust_words,
    }


_EARLY_DROP_NA_DIMS = (
    "Self Introduction",
    "Recording Disclaimer",
    "RPC Verification",
    "PTP Success Rate",
    "Payment Confirmation",
    "Negotiation Quality",
    "Reason for Delay",
)


def _set_dim(
    dim_results: dict[str, dict[str, Any]],
    key: str,
    status: str,
    score: float | None,
    evidence: str,
) -> None:
    canonical_status = status if status in ("Pass", "Fail", "NA") else "Fail"
    canonical_score = None if canonical_status == "NA" else (
        100.0 if canonical_status == "Pass" else 0.0
    )
    dim_results[key] = {
        "score": canonical_score,
        "status": canonical_status,
        "evidence": evidence[:300],
    }


def _floor_dim(
    dim_results: dict[str, dict[str, Any]],
    key: str,
    score: float,
    evidence: str,
) -> None:
    """Mark a deterministic checkpoint Pass; BRD scoring has no partial credit."""
    cur = dim_results.get(key) or {}
    cur_score = cur.get("score")
    if (
        str(cur.get("status")) == "Pass"
        and isinstance(cur_score, (int, float))
        and float(cur_score) >= score
    ):
        return
    _set_dim(dim_results, key, "Pass", score, evidence)


_REMINDER_AMOUNT_RE = re.compile(
    r"(?:\b\d[\d,]*(?:\.\d+)?\s*(?:rupees?|rupaye|rupya|rs\.?|₹)|"
    r"(?:rupees?|rupaye|rupya|rs\.?|₹)\s*\d[\d,]*(?:\.\d+)?|"
    r"(?:सातशे|पाचशे|सात\s*हजार).{0,20}रुपये|"
    r"EMI\s*amount|ईएमआई)",
    re.I,
)
_REMINDER_MODE_RE = re.compile(
    r"(?:maintain\s+(?:the\s+)?(?:cash|balance|funds|amount)|"
    r"(?:cash|balance|funds|amount)\s+maintain|keep\s+(?:the\s+)?(?:cash|balance|funds)|"
    r"account\s+(?:me|mein|in|ला).{0,20}(?:cash|balance|funds|money|maintain)|"
    r"\becs\b|\bnach\b|auto\s*-?\s*debit|mandate|"
    r"official.{0,25}(?:app|application)|(?:app|application).{0,25}(?:payment|pay)|"
    r"बैलेंस\s*(?:मेंटेन|रख)|बॅलन्स\s*ठेव|मेंटेन\s*रख|"
    r"(?:maintain|मॅनटेन|मेन्टेन)\s*(?:करा|करायच|करून)|"
    r"UPI|PhonePe|ऑटो\s*डेबिट)",
    re.I,
)
_REMINDER_TIMING_RE = re.compile(
    r"(?:due\s+date|emi\s+date|before\s+(?:the\s+)?due|"
    r"\b(?:today|tomorrow|aaj|kal)\b|\b\d{1,2}(?:st|nd|rd|th)?\b|"
    r"\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|"
    r"eleventh|twelfth|thirteenth|fourteenth|fifteenth)\b|"
    r"ड्यू\s*डेट|देय\s*तिथि|तारिख|तारीख|तारखेला|एक\s*दिन\s*पहले|"
    r"(?:आठ|नऊ|दहा|अकरा)\s*तारख)",
    re.I,
)
_REMINDER_URGENCY_RE = re.compile(
    r"(?:before\s+(?:the\s+)?due\s+date|due\s+date\s+se\s+pehle|"
    r"(?:one|1|a)\s+day\s+before|same\s+day|today|aaj|kal|"
    r"maintain\s+(?:the\s+)?(?:cash|balance|funds|amount)|"
    r"(?:cash|balance|funds|amount)\s+maintain|"
    r"एक\s*दिन\s*पहले|ड्यू\s*डेट\s*से\s*पहले|बैलेंस\s*मेंटेन|बॅलन्स\s*ठेव|"
    r"(?:maintain|मॅनटेन|मेन्टेन)\s*(?:करा|करायच)|"
    r"reminder\s+call)",
    re.I,
)
_REMINDER_CONSEQUENCE_RE = re.compile(
    r"(?:bounce.{0,35}charge|cheque?\s+boun[cd]\w*.{0,20}charge|penal(?:ty)?\s+charge|"
    r"late\s+charge|charge.{0,30}(?:add|apply|laga)|notice|ecs\s+activation|"
    r"if.{0,30}(?:delay|bounce)|in\s+case.{0,30}(?:delay|bounce)|"
    r"बाउंस\s*चार्ज|पेनल्टी|नोटिस|ECS\s*डीएक्टिवेट|सीबिल|CIBIL|"
    r"bounce\s*(?:charge|लाग)|पाचशे\s*(?:नव्वद|नऊशे)|590|"
    r"1\s*(?:point|\.)\s*5\s*percent|1\.5\s*%)",
    re.I,
)
_PAYMENT_PROBE_RE = re.compile(
    r"(?:will\s+you\s+(?:pay|maintain|keep|deposit|arrange)|"
    r"can\s+you\s+(?:pay|maintain|keep|deposit|arrange)|"
    r"when\s+(?:can|will)\s+you\s+(?:pay|maintain)|"
    r"kab\s+(?:tak\s+)?(?:payment|pay|balance)|"
    r"(?:payment|balance).{0,30}(?:confirm|kar\s+denge|rakh\s+denge)|"
    r"is\s+that\s+correct|right\s*\??|"
    r"(?:बैलेंस|बॅलन्स|भुगतान|पेमेंट).{0,25}(?:हो\s*जाएगा|रखेंगे|ठेवाल|"
    r"मेंटेन|confirm)|"
    r"कितने\s*बजे\s*तक|"
    r"या\s*महिन्यात\s*वेळेवर|"
    r"(?:payment|पेमेंट)\s*कसं\s*करणार|"
    r"(?:UPI|maintain|मॅनटेन|मेन्टेन).{0,20}(?:करणार|करा)|"
    r"कसं\s*करायच)",
    re.I,
)
_PAYMENT_RESISTANCE_RE = re.compile(
    r"(?:cannot\s+pay|can'?t\s+pay|unable\s+to\s+pay|will\s+not\s+pay|won'?t\s+pay|"
    r"no\s+money|financial\s+(?:problem|difficulty|hardship)|salary\s+(?:late|delay)|"
    r"payment\s+(?:later|nahi|not)|nahi\s+(?:de|pay|kar)|paisa\s+nahi|"
    r"dekh\s*(?:lunga|loonga)|baad\s+(?:me|mein))",
    re.I,
)

_CUSTOMER_HARDSHIP_RE = re.compile(
    r"(?:account.{0,25}(?:block(?:ed)?|freeze|frozen|inactive)|"
    r"(?:block(?:ed)?|freeze|frozen|inactive).{0,25}account|"
    r"retir(?:ed|ement)|job\s*loss|lost\s+(?:my\s+)?job|unemploy|"
    r"medical|hospital|death\s+in\s+(?:the\s+)?family|bereave|"
    r"financial\s+(?:problem|difficulty|hardship)|no\s+(?:money|funds)|"
    r"salary\s+(?:late|delay|not\s+received)|unable\s+to\s+pay|can'?t\s+pay|"
    r"payment\s+(?:is\s+)?not\s+(?:happening|working)|bank\s+(?:issue|problem)|"
    r"अकाउंट.{0,25}(?:ब्लॉक|फ्रीज|फ्रोजन)|"
    r"(?:ब्लॉक|फ्रीज).{0,25}अकाउंट|"
    r"रिटायर|पैसे\s+नहीं|पेमेंट\s+नहीं|"
    r"(?:वेतन|सैलरी|सॅलरी).{0,20}(?:नहीं|नही|नव्हते)|"
    r"खर्चे\s*ज़्यादा|आउट\s*ऑफ\s*सिटी|शहराबाहेर)",
    re.I,
)

_AGENT_EMPATHY_RE = re.compile(
    r"(?:i\s+(?:can\s+)?understand|i\s+am\s+sorry|sorry\s+to\s+hear|"
    r"that\s+must\s+be\s+(?:difficult|hard)|i\s+appreciate|"
    r"samajh\s+(?:sakta|sakti|raha|rahi)|mujhe\s+(?:samajh|afsos)|"
    r"afsos\s+hai|chinta\s+mat|"
    r"मैं\s+(?:समझ|समझता|समझती)|मुझे\s+(?:समझ|अफसोस)|अफसोस\s+है)",
    re.I,
)


def detect_empathy_response(*transcripts: str) -> dict[str, Any]:
    """Require explicit empathy when the borrower describes a real obstacle.

    Generic acknowledgements such as "okay" or "alright" are deliberately not
    accepted: they confirm hearing, but do not acknowledge hardship.
    """
    turns = _merged_turns(*transcripts)
    for index, (_start, role, text) in enumerate(turns):
        if role != "Customer" or not _CUSTOMER_HARDSHIP_RE.search(text):
            continue
        for _s2, role2, text2 in turns[index + 1:index + 4]:
            if role2 == "Customer":
                continue
            if role2 == "Agent" and _AGENT_EMPATHY_RE.search(text2):
                return {
                    "applicable": True,
                    "acknowledged": True,
                    "evidence": f'Customer: {text[:120]} | Agent: {text2[:120]}',
                }
        return {
            "applicable": True,
            "acknowledged": False,
            "evidence": f'Customer hardship/obstacle: {text[:180]}',
        }
    return {"applicable": False, "acknowledged": False, "evidence": ""}
_CALLBACK_ARRANGEMENT_RE = re.compile(
    r"(?:call\s+(?:me|you|him|her)?\s*back|callback|call\s+again|"
    r"(?:call|phone)\s+(?:me|karna|karo|kijiye)\s+(?:later|baad\s+(?:me|mein))|"
    r"baad\s+(?:me|mein)\s+(?:call|phone)|phir\s+(?:call|phone)|"
    r"i\s+will\s+(?:call|phone)\s+(?:you\s+)?(?:later|tomorrow|again)|"
    r"(?:later|tomorrow)\s+(?:call|callback))",
    re.I,
)


def has_callback_arrangement(*transcripts: str) -> bool:
    """True only when a later call was actually requested or arranged."""
    return any(
        _CALLBACK_ARRANGEMENT_RE.search(text)
        for transcript in transcripts
        for _start, _role, text in _turns(transcript)
    )


def detect_reminder_completion(*transcripts: str) -> dict[str, Any]:
    """Objective PDM/FCR evidence, separate from a promise-to-pay.

    A borrower may acknowledge a complete pre-due reminder without making a
    payment promise.  That is a failed PTP but can still be a correctly resolved
    reminder under the BRD's Payment Confirmation/FCR criterion.
    """
    turns = _merged_turns(*transcripts)
    agent_text = _role_text(turns, "Agent")
    customer_text = _role_text(turns, "Customer")
    amount = bool(_REMINDER_AMOUNT_RE.search(agent_text))
    timing = bool(_TIMING_RE.search(agent_text) or _REMINDER_TIMING_RE.search(agent_text))
    mode = bool(_REMINDER_MODE_RE.search(agent_text))
    urgency = bool(_REMINDER_URGENCY_RE.search(agent_text))
    consequence = bool(_REMINDER_CONSEQUENCE_RE.search(agent_text))
    payment_probe = bool(_PAYMENT_PROBE_RE.search(agent_text))
    resistance = bool(_PAYMENT_RESISTANCE_RE.search(customer_text))
    acknowledged = False
    evidence = ""
    for i, (_start, role, text) in enumerate(turns):
        if role != "Agent":
            continue
        if not (
            _REMINDER_AMOUNT_RE.search(text)
            or _TIMING_RE.search(text)
            or _REMINDER_TIMING_RE.search(text)
        ):
            continue
        for _s2, role2, text2 in turns[i + 1:i + 4]:
            if role2 == "Customer" and _AFFIRM_RE.search(text2):
                acknowledged = True
                evidence = f'{text[:110]} | Customer: {text2[:60]}'
                break
        if acknowledged:
            break
    callback = has_callback_arrangement(*transcripts)
    complete = amount and timing and mode and acknowledged and not callback
    return {
        "amount": amount,
        "timing": timing,
        "mode": mode,
        "acknowledged": acknowledged,
        "urgency": urgency,
        "consequence": consequence,
        "paymentProbe": payment_probe,
        "resistance": resistance,
        "callback": callback,
        "complete": complete,
        "evidence": evidence,
    }


def apply_deterministic_criteria(
    dim_results: dict[str, dict[str, Any]],
    rubric_dims: list[dict[str, Any]],
    original_transcript: str,
    english_transcript: str = "",
    org_name: str = "",
    *,
    call_language: str = "Hindi",
    commitment: dict[str, Any] | None = None,
    ptp: dict[str, Any] | None = None,
    campaign: str = "",
    compliance_opening_evidence: str = "",
) -> dict[str, Any]:
    """Override objectively-detectable dimensions; return the detector evidence."""
    keys = {str(d.get("key") or "").strip() for d in rubric_dims}
    views = [v for v in (original_transcript, english_transcript) if v and str(v).strip()]
    commitment = commitment if commitment is not None else detect_commitment(*views)
    ptp = ptp or {}

    opening_view = (
        f"0.0 - 0.1 (Agent): {compliance_opening_evidence}"
        if str(compliance_opening_evidence or "").strip()
        else ""
    )
    compliance_views = views + ([opening_view] if opening_view else [])
    disclaimer = detect_recording_disclaimer(*compliance_views)
    intro = detect_self_introduction(org_name, *compliance_views)
    rpc = detect_rpc_verification(*views)
    if not rpc.get("verified") and compliance_opening_evidence:
        recovered_rpc = recover_rpc_from_opening_evidence(
            compliance_opening_evidence,
            *views,
        )
        if recovered_rpc is not None:
            rpc = recovered_rpc
    delay = detect_delay_probe(*views)
    third_party = detect_third_party(*views)
    early_drop = detect_early_drop(*views)
    campaign = str(campaign or derive_campaign("", " ".join(views))).upper()
    reminder = detect_reminder_completion(*views)
    empathy = detect_empathy_response(*views)
    conditional_intent = detect_conditional_payment_intent(*views)

    # BRD 4.3 — dead air over 10 seconds fails telephone etiquette.
    # BRD 4.1 — rushing (very high rate of speech) fails tone and clarity. Only
    # judge pace on a meaningful sample of agent speech: on a few short turns the
    # diarization boundaries alone can push words-per-minute past any threshold.
    ros = rate_of_speech_and_dead_air(original_transcript or english_transcript)
    if "Telephone Etiquette" in keys:
        # Dead air is an objective override. Other BRD etiquette failures (hold
        # without permission, interruption or abrupt closing) are judged from
        # the transcript, so a supported model failure must not be erased just
        # because no long silence was measured.
        if float(ros.get("deadAirMaxSec") or 0) > 10.0:
            _set_dim(dim_results, "Telephone Etiquette", "Fail", 0.0,
                     f'Dead air of {ros["deadAirMaxSec"]}s exceeds the 10s limit '
                     f'({ros["deadAirCount"]} gaps, {ros["deadAirTotalSec"]}s total).')
        else:
            etiquette = dim_results.get("Telephone Etiquette") or {}
            etiquette_status = str(etiquette.get("status"))
            etiquette_evidence = str(etiquette.get("evidence") or "").lower()
            explicit_etiquette_breach = any(term in etiquette_evidence for term in (
                "without permission", "no permission", "interrupt", "talked over",
                "talking over", "abrupt", "hang-up", "hung up", "yawn", "cough",
                "dead air", "silent hold", "unnecessary hold",
            ))
            if etiquette_status == "Fail" and not explicit_etiquette_breach:
                _set_dim(dim_results, "Telephone Etiquette", "Pass", 100.0,
                         "No measurable dead-air or specific transcript-supported etiquette breach detected.")
            elif etiquette_status not in ("Pass", "Fail"):
                _set_dim(dim_results, "Telephone Etiquette", "Pass", 100.0,
                         "No dead air over 10s and no transcript-supported etiquette breach detected.")
    wpm = ros.get("wpm")
    if "Agent Tone and Clarity" in keys:
        # Rushing is the one objective tone failure (BRD 4.1). Use calibrated WPM
        # (ASR compression expanded). Require a long sample and a clearly extreme
        # rate — short collections calls often looked "rushed" at 200 wpm raw
        # while the call-level WPM was ~140.
        if (
            isinstance(wpm, (int, float))
            and wpm > 230
            and float(ros.get("agentSpeechSec") or 0) >= 90.0
        ):
            _set_dim(dim_results, "Agent Tone and Clarity", "Fail", 0.0,
                     f"Rate of speech {wpm} wpm - agent rushed through the call.")
        else:
            tone = dim_results.get("Agent Tone and Clarity") or {}
            tone_status = str(tone.get("status"))
            tone_evidence = str(tone.get("evidence") or "").lower()
            rushing_only = (
                tone_status == "Fail"
                and any(term in tone_evidence for term in ("rush", "too fast", "high rate", "fast pace"))
                and not any(term in tone_evidence for term in (
                    "flat", "dull", "arrogant", "casual", "fumbl", "unclear", "inaudible",
                ))
            )
            # ASR garbage (#Ah / digit salad) is not an agent clarity breach.
            asr_garbage = bool(
                re.search(
                    r"#ah|\bash\b|\b\d\s+\d\s+\d\b|12\s*70|unclear.{0,40}(?:#|ash|\d\s+\d)",
                    tone_evidence,
                    re.I,
                )
            )
            if rushing_only or asr_garbage or tone_status not in ("Pass", "Fail"):
                _set_dim(
                    dim_results,
                    "Agent Tone and Clarity",
                    "Pass",
                    100.0,
                    "Measured pace did not support a rushing failure; no transcript-supported "
                    "tone-and-clarity breach beyond ASR noise was evidenced."
                    if asr_garbage
                    else "Measured pace did not support a rushing failure; no other tone-and-clarity breach was evidenced.",
                )

    # BRD 4.2 (fatal / red alert) is objective: a call is "rude/unprofessional"
    # ONLY if the agent actually used foul, abusive or threatening language. The
    # taboo engine decides this; the LLM must not be able to red-alert a whole call
    # on subjective impression. This alone was zeroing polite, compliant calls.
    foul = {"violation": "No", "evidence": ""}
    if RUDE_KEY in keys:
        foul = detect_foul(original_transcript, english_transcript, call_language)
        if foul.get("violation") == "Yes":
            _set_dim(dim_results, RUDE_KEY, "Fail", 0.0,
                     f'Agent used inappropriate language: {foul.get("evidence", "")[:200]}')
        else:
            _set_dim(dim_results, RUDE_KEY, "Pass", 100.0,
                     "No rude, abusive or unprofessional language detected from the agent.")

    # Soft CX dims: when the agent was not abusive, the LLM must not zero
    # politeness/empathy or customer sentiment on a routine collections call.
    if foul.get("violation") != "Yes":
        if "Politeness and Empathy" in keys:
            if empathy["applicable"] and not empathy["acknowledged"]:
                _set_dim(
                    dim_results,
                    "Politeness and Empathy",
                    "Fail",
                    40.0,
                    f'Borrower hardship was not acknowledged empathetically. {empathy["evidence"]}',
                )
            else:
                _floor_dim(
                    dim_results,
                    "Politeness and Empathy",
                    75.0,
                    empathy["evidence"]
                    if empathy["acknowledged"]
                    else "No abusive language and no borrower hardship requiring an empathy response.",
                )
        if "Sentiment Analysis" in keys:
            cust = sentiment_trajectory(
                original_transcript or english_transcript, "Customer"
            )
            if cust.get("direction") != "declining":
                _floor_dim(
                    dim_results,
                    "Sentiment Analysis",
                    70.0,
                    "Customer sentiment was not declining across the call.",
                )

    # A call that ended before the script could run gets benefit of doubt, not a
    # fatal compliance miss (BRD exceptions on 1.1 / 1.2 / 1.3 and section 3).
    if early_drop["dropped"]:
        for key in _EARLY_DROP_NA_DIMS:
            if key in keys:
                _set_dim(dim_results, key, "NA", None,
                         "Call ended immediately after connecting - parameter not applicable.")
        return {
            "disclaimer": disclaimer,
            "selfIntro": intro,
            "rpc": rpc,
            "delayProbe": delay,
            "thirdParty": third_party,
            "earlyDrop": early_drop,
            "commitment": commitment,
            "ros": ros,
            "reminder": reminder,
            "empathy": empathy,
            "conditionalIntent": conditional_intent,
        }

    if "Recording Disclaimer" in keys:
        if disclaimer["present"]:
            _set_dim(dim_results, "Recording Disclaimer", "Pass", 100.0,
                     f'Disclaimer given: "{disclaimer["evidence"]}"')
        else:
            _set_dim(dim_results, "Recording Disclaimer", "Fail", 0.0,
                     "No recording / quality-and-training notice found in the agent's speech.")

    # BRD 1.1 scores 0 unless greeting + agent name + company are all present.
    if "Self Introduction" in keys:
        missing = [
            label
            for label, ok in (
                ("greeting", intro["greetingGiven"]),
                ("agent name", intro["nameGiven"]),
                ("company name", intro["companyGiven"]),
            )
            if not ok
        ]
        if not missing:
            _set_dim(dim_results, "Self Introduction", "Pass", 100.0,
                     f'Greeting, name and company stated: "{intro["evidence"]}"')
        else:
            observed = intro.get("greetingEvidence") or intro.get("nameEvidence") or intro.get("companyEvidence")
            observed_note = f' Nearest opening evidence: "{observed}"' if observed else ""
            _set_dim(dim_results, "Self Introduction", "Fail", 0.0,
                     f'Script incomplete - missing {", ".join(missing)}.{observed_note}')

    # RPC is fatal to the complete BRD score. Early disconnects were already
    # returned as N/A above; every other call must contain positive right-party
    # evidence or this checkpoint fails, regardless of call length.
    if "RPC Verification" in keys:
        if rpc["verified"]:
            _set_dim(dim_results, "RPC Verification", "Pass", 100.0,
                     f'Right party confirmed: "{rpc["evidence"]}"')
        elif rpc.get("disclosedBeforeVerification"):
            detail = str(rpc.get("disclosureEvidence") or "")
            _set_dim(
                dim_results,
                "RPC Verification",
                "Fail",
                0.0,
                "No borrower-name confirmation was completed before account details were "
                f'disclosed. First sensitive disclosure: "{detail}"',
            )
        elif rpc["asked"]:
            _set_dim(
                dim_results,
                "RPC Verification",
                "Fail",
                0.0,
                f'Borrower name was asked but no confirming response was captured: "{rpc["evidence"]}"',
            )
        else:
            _set_dim(dim_results, "RPC Verification", "Fail", 0.0,
                     "Agent never confirmed they were speaking to a named borrower.")

        # Third-party contact overrides the borrower-verification result: account
        # details may only be discussed after relationship and consent are taken.
        if third_party["thirdParty"]:
            if third_party["detailsShared"] and not third_party["authorized"]:
                _set_dim(dim_results, "RPC Verification", "Fail", 0.0,
                         "Account details discussed with a third party without taking their "
                         f'relationship and consent: "{third_party["evidence"]}"')
            elif third_party["authorized"]:
                _set_dim(dim_results, "RPC Verification", "Pass", 100.0,
                         f'Third party authorised before any detail was shared: '
                         f'"{third_party["evidence"]}"')
            else:
                _set_dim(dim_results, "RPC Verification", "Pass", 90.0,
                         f'Third party on the line and no account details shared: '
                         f'"{third_party["evidence"]}"')

    # BRD 3.4 — applicable only when a payment actually bounced/was delayed;
    # a borrower who volunteers the reason satisfies it without the agent asking.
    if "Reason for Delay" in keys:
        applicable = _has_delay_context(original_transcript) or _has_delay_context(english_transcript)
        if delay["asked"]:
            score = 100.0 if delay["answered"] else 80.0
            _set_dim(dim_results, "Reason for Delay", "Pass", score,
                     f'Agent probed the delay: "{delay["evidence"]}"')
        elif delay["proactive"]:
            # BRD exception: borrower volunteered the reason — Pass even when the
            # overdue cue is only implicit in the borrower's explanation.
            _set_dim(dim_results, "Reason for Delay", "Pass", 90.0,
                     f'Borrower gave the reason without being asked: "{delay["evidence"]}"')
        elif not applicable:
            _set_dim(dim_results, "Reason for Delay", "NA", None,
                     "No bounce or payment delay on this call - parameter not applicable.")
        else:
            _set_dim(dim_results, "Reason for Delay", "Fail", 0.0,
                     "Payment bounced/was delayed but the agent never asked why.")

    # BRD 3.2 / 3.3 — PDM reminder completion and PTP are different outcomes.
    # A complete reminder can be first-call-resolved even when the borrower only
    # acknowledges it (PTP remains a strict Fail below).  Negotiation receives
    # credit for urgency/consequences, but cannot fully Pass without a relevant
    # payment probe or an actual commitment.
    if campaign == "PDM" and "Payment Confirmation" in keys:
        if commitment.get("paid"):
            _set_dim(dim_results, "Payment Confirmation", "Pass", 100.0,
                     "Borrower confirmed that payment was already completed.")
        elif reminder["complete"]:
            _floor_dim(
                dim_results,
                "Payment Confirmation",
                85.0,
                "Pre-due reminder resolved on the call: amount, due timing and official "
                f'payment/auto-debit guidance were supplied and acknowledged. "{reminder["evidence"]}"',
            )
        else:
            missing = [
                label for label, present in (
                    ("amount", reminder["amount"]),
                    ("due timing", reminder["timing"]),
                    ("payment mode", reminder["mode"]),
                    ("borrower acknowledgement", reminder["acknowledged"]),
                ) if not present
            ]
            if reminder["callback"]:
                missing.append("first-call resolution (callback arranged)")
            _set_dim(
                dim_results,
                "Payment Confirmation",
                "Fail",
                30.0,
                f'Pre-due reminder was not fully closed; missing {", ".join(missing) or "complete recap"}.',
            )

    if campaign == "COLL" and "Payment Confirmation" in keys:
        if commitment.get("paid"):
            _set_dim(
                dim_results,
                "Payment Confirmation",
                "Pass",
                100.0,
                "Borrower confirmed that payment was already completed.",
            )
        elif is_secured_ptp(commitment) and commitment.get("agentReadBack"):
            _set_dim(
                dim_results,
                "Payment Confirmation",
                "Pass",
                100.0,
                "BRD-valid PTP completed: payment date/time, amount and mode were stated and "
                "the borrower gave a strong confirmation.",
            )
        elif is_secured_ptp(commitment):
            _set_dim(
                dim_results,
                "Payment Confirmation",
                "Fail",
                50.0,
                "A BRD-valid PTP was captured, but the agent did not complete a final recap of "
                "the agreed date, amount and payment mode.",
            )
        elif commitment.get("present") or conditional_intent.get("present"):
            _set_dim(
                dim_results,
                "Payment Confirmation",
                "Fail",
                0.0,
                "The borrower expressed conditional or partial willingness to pay, but the "
                "agent did not confirm and recap a payment date, amount and mode.",
            )
        else:
            _set_dim(
                dim_results,
                "Payment Confirmation",
                "Fail",
                0.0,
                "No completed payment or BRD-valid PTP was confirmed; the call ended without "
                "a payment resolution.",
            )

    if "Negotiation Quality" in keys:
        if campaign == "PDM":
            if reminder["urgency"] and reminder["consequence"]:
                if reminder["paymentProbe"] or commitment.get("present"):
                    _floor_dim(
                        dim_results,
                        "Negotiation Quality",
                        85.0,
                        "Agent created pre-due urgency, explained consequences and used a "
                        "payment-specific confirmation/probe.",
                    )
                else:
                    _set_dim(
                        dim_results,
                        "Negotiation Quality",
                        "Fail",
                        40.0,
                        "Agent created urgency and explained bounce/late consequences, but did "
                        "not ask a payment-specific confirmation or probing question.",
                    )
            else:
                missing = []
                if not reminder["urgency"]:
                    missing.append("payment urgency")
                if not reminder["consequence"]:
                    missing.append("factual consequences")
                _set_dim(
                    dim_results,
                    "Negotiation Quality",
                    "Fail",
                    20.0 if len(missing) == 1 else 0.0,
                    f'Pre-due pitch did not establish {" and ".join(missing)}.',
                )
        elif delay.get("asked") or delay.get("proactive") or commitment.get("present"):
            _floor_dim(
                dim_results,
                "Negotiation Quality",
                65.0,
                "Agent probed delay/reason or secured a payment discussion on the call.",
            )

    # BRD 3.1 — mandate details (date, amount, mode) plus a strong borrower
    # confirmation. Missing the date/mode is a markdown, not a pass.
    if "PTP Success Rate" in keys:
        if commitment.get("paid"):
            _set_dim(dim_results, "PTP Success Rate", "Pass", 100.0,
                     f'Payment already made and confirmed on call: "{commitment.get("evidence", "")}"')
        elif is_secured_ptp(commitment):
            mode = commitment.get("mode") or "commitment"
            timing = commitment.get("timing") or ""
            _set_dim(dim_results, "PTP Success Rate", "Pass", 100.0,
                     f'Borrower-confirmed {mode} commitment for {timing}; amount and mode were '
                     f'confirmed: "{commitment.get("evidence", "")}"')
        elif commitment.get("present") or conditional_intent.get("present"):
            missing = []
            if not commitment.get("timing"):
                missing.append("date/time")
            if not commitment.get("amountConfirmed"):
                missing.append("amount")
            if not commitment.get("mode"):
                missing.append("payment mode")
            _set_dim(
                dim_results,
                "PTP Success Rate",
                "Fail",
                0.0,
                "Conditional or partial payment willingness was expressed, but no BRD-valid PTP "
                f'was secured (missing {", ".join(missing) or "complete confirmation"}).',
            )
        else:
            _set_dim(
                dim_results,
                "PTP Success Rate",
                "Fail",
                0.0,
                "Borrower only acknowledged the discussion; no explicit promise with payment "
                "date, amount and mode was secured.",
            )

    return {
        "disclaimer": disclaimer,
        "selfIntro": intro,
        "rpc": rpc,
        "delayProbe": delay,
        "thirdParty": third_party,
        "earlyDrop": early_drop,
        "commitment": commitment,
        "ros": ros,
        "reminder": reminder,
        "empathy": empathy,
        "conditionalIntent": conditional_intent,
    }


def reconcile_ptp(
    ptp: dict[str, Any],
    commitment: dict[str, Any],
    transcript: str = "",
    conditional_intent: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Expose PTP=Yes only when the complete BRD bundle is evidenced."""
    out = dict(ptp or {})
    conditional_intent = conditional_intent or detect_conditional_payment_intent(transcript)
    secured = is_secured_ptp(commitment)
    summary = str(out.get("summary") or "")
    if secured and re.search(
        r"no\s+(?:concrete\s+|specific\s+|clear\s+|firm\s+)?(?:payment\s+)?(?:commitment|promise|ptp)",
        summary,
        re.I,
    ):
        # The model's own note contradicts the commitment evidence; replace it.
        out["summary"] = f'Commitment captured on call: "{commitment.get("evidence", "")}"'
    if not secured:
        # Acknowledgement, conditional willingness, a partial promise, and an
        # already-completed payment are all different from a secured future PTP.
        out["present"] = "No"
        out["genuineness"] = "Not Applicable"
        out["propensity"] = "Low"
        out["date"] = ""
        out["amount"] = None
        out["mode"] = ""
        if commitment.get("paid"):
            out["summary"] = "The borrower stated that payment had already been completed."
        elif commitment.get("present") or conditional_intent.get("present"):
            out["summary"] = (
                "The borrower expressed conditional or partial willingness to pay, but no "
                "secured PTP with a confirmed date, amount and payment mode was completed."
            )
        else:
            out["summary"] = (
                "The borrower acknowledged the discussion but made no explicit promise to pay."
            )
        return out
    if str(out.get("present", "No")).strip().lower() != "yes":
        out["present"] = "Yes"
        if not str(out.get("summary") or "").strip():
            out["summary"] = f'Commitment captured on call: "{commitment.get("evidence", "")}"'
        # Repeated *actual* bounces make a fresh commitment doubtful. Warnings about
        # avoiding a bounce say nothing about the borrower's intent.
        if str(out.get("genuineness", "")).strip() in ("", "Not Applicable"):
            history = _PREVENTIVE_BOUNCE_RE.sub(" ", str(transcript or "")).lower()
            repeat = len(_PAST_DELAY_RE.findall(history)) >= 2
            out["genuineness"] = "Doubtful" if repeat else "Genuine"
        # A dated commitment cannot sit next to the "Low" propensity the model
        # picked while it believed there was no PTP at all.
        if str(out.get("propensity", "")).strip() in ("", "Low") and commitment.get("timing"):
            out["propensity"] = "High" if out.get("genuineness") == "Genuine" else "Medium"
    if not str(out.get("mode") or "").strip() and commitment.get("mode"):
        out["mode"] = commitment["mode"]
    elif commitment.get("mode"):
        # Always mirror reconciled commitment mode (manual vs ECS).
        out["mode"] = commitment["mode"]
    if commitment.get("timing"):
        out["date"] = commitment["timing"]
    elif not str(out.get("date") or "").strip() and commitment.get("timing"):
        out["date"] = commitment["timing"]
    # Prefer a parsed EMI/amount-due; never leave a secured PTP Amount as 0.
    amount_value = commitment.get("amountValue")
    cur_amt = out.get("amount")
    if amount_value is not None:
        out["amount"] = amount_value
    elif cur_amt in (0, 0.0, "0", "0.0", None, "") or not str(cur_amt or "").strip():
        if commitment.get("amountConfirmed"):
            out["amount"] = "Not confirmed on call"
        else:
            out["amount"] = None
    return out


def _polarity(text: str) -> float:
    low = (text or "").lower()
    pos = sum(1 for w in _POSITIVE if w in low)
    neg = sum(1 for w in _NEGATIVE if w in low)
    if pos > neg:
        return min(0.3 + pos * 0.15, 0.95)
    if neg > pos:
        return max(-0.3 - neg * 0.15, -0.95)
    return 0.0


def _role_polarities(transcript: str, role: str) -> list[float]:
    return [
        _polarity(m.group(4))
        for m in _LINE_RE.finditer(transcript or "")
        if m.group(3) == role and m.group(4).strip()
    ]


def sentiment_trajectory(transcript: str, role: str) -> dict[str, Any]:
    """Start/end/delta/direction of a role's sentiment across the call."""
    vals = _role_polarities(transcript, role)
    if not vals:
        return {"start": None, "end": None, "delta": None, "direction": "flat"}
    n = len(vals)
    head = vals[: max(1, n // 3)]
    tail = vals[-max(1, n // 3):]
    start = round(sum(head) / len(head), 3)
    end = round(sum(tail) / len(tail), 3)
    delta = round(end - start, 3)
    if delta > 0.15:
        direction = "improving"
    elif delta < -0.15:
        direction = "declining"
    else:
        direction = "flat"
    return {"start": start, "end": end, "delta": delta, "direction": direction}


def agent_sentiment_trajectory(transcript: str) -> dict[str, Any]:
    traj = sentiment_trajectory(transcript, "Agent")
    # Escalation trigger: agent sentiment turns clearly negative by the end.
    end = traj.get("end")
    escalation = "Yes" if (isinstance(end, (int, float)) and end <= -0.3) else "No"
    traj["escalationTrigger"] = escalation
    return traj


def _count_words(text: str) -> int:
    return len([w for w in re.split(r"\s+", text.strip()) if w])


def rate_of_speech_and_dead_air(transcript: str) -> dict[str, Any]:
    """Agent words-per-minute plus dead-air gaps between consecutive turns.

    ASR/diarization often packs a long Hindi line into a short timestamp span,
    which fabricates 200+ wpm "rushing" on otherwise normal floor speech. Dense
    turns are duration-expanded toward a natural ~180 wpm span before WPM is
    used for BRD 4.1 tone judgements.
    """
    turns = []
    for m in _LINE_RE.finditer(transcript or ""):
        try:
            start = float(m.group(1))
            end = float(m.group(2))
        except (TypeError, ValueError):
            continue
        turns.append((start, end, m.group(3), m.group(4)))

    agent_words = 0
    raw_secs = 0.0
    agent_secs = 0.0
    for start, end, role, text in turns:
        if role != "Agent":
            continue
        words = _count_words(text)
        dur = max(0.0, end - start)
        raw_secs += dur
        # Expand clearly time-compressed turns (e.g. 40 words in 8s → 300 wpm).
        if words >= 8 and dur > 0 and (words / (dur / 60.0)) > 220:
            dur = max(dur, words / (180.0 / 60.0))
        agent_words += words
        agent_secs += dur
    wpm = round(agent_words / (agent_secs / 60.0), 1) if agent_secs > 0 else None
    wpm_raw = round(agent_words / (raw_secs / 60.0), 1) if raw_secs > 0 else None

    gaps: list[float] = []
    turns_sorted = sorted(turns, key=lambda t: t[0])
    # Silence before the agent's first word is ring/connect time, not dead air.
    first_agent = next((i for i, t in enumerate(turns_sorted) if t[2] == "Agent"), None)
    for i in range(1, len(turns_sorted)):
        if first_agent is None or i <= first_agent:
            continue
        gap = turns_sorted[i][0] - turns_sorted[i - 1][1]
        if gap > 0:
            gaps.append(gap)
    dead = [g for g in gaps if g >= 3.0]  # >=3s counts as dead air
    return {
        "wpm": wpm,
        "wpmRaw": wpm_raw,
        "agentSpeechSec": round(agent_secs, 1),
        "deadAirMaxSec": round(max(dead), 1) if dead else 0.0,
        "deadAirTotalSec": round(sum(dead), 1) if dead else 0.0,
        "deadAirCount": len(dead),
    }


def parse_collections_json(text: str, rubric_dims: list[dict[str, Any]]) -> dict[str, Any]:
    """Parse the LLM JSON into {dim_results, ptp, fraud, sentiment, ztp, meta}."""
    try:
        from llm_utils import strip_llm_thinking
        cleaned = strip_llm_thinking(text or "")
    except Exception:
        cleaned = text or ""
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in collections model output")
    data = json.loads(cleaned[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("Collections JSON root must be an object")

    raw_dims = data.get("dimensions") if isinstance(data.get("dimensions"), dict) else {}
    dim_results: dict[str, dict[str, Any]] = {}
    for d in rubric_dims:
        key = str(d.get("key") or "").strip()
        if not key:
            continue
        entry = raw_dims.get(key) or {}
        score = entry.get("score")
        try:
            score = float(score) if score is not None and score != "" else None
        except (TypeError, ValueError):
            score = None
        status = entry.get("status")
        dim_results[key] = {
            "score": score,
            "status": status if status in ("Pass", "Fail", "NA") else None,
            "evidence": str(entry.get("evidence") or "")[:300],
        }

    return {
        "dim_results": dim_results,
        "ptp": data.get("ptp") if isinstance(data.get("ptp"), dict) else {},
        "fraud": data.get("fraud") if isinstance(data.get("fraud"), dict) else {},
        "customerSentiment": data.get("customerSentiment") if isinstance(data.get("customerSentiment"), dict) else {},
        "agentSentiment": data.get("agentSentiment") if isinstance(data.get("agentSentiment"), dict) else {},
        "ztp": data.get("ztp") if isinstance(data.get("ztp"), dict) else {},
        "disposition": str(data.get("disposition") or "").strip(),
        "campaign": str(data.get("campaign") or "").strip(),
        "callType": str(data.get("callType") or "Other"),
        "summary": str(data.get("summary") or ""),
        "feedback": str(data.get("feedback") or ""),
    }


# Canonical ICIC HFC dispositions (must match the frontend disposition list and
# the backend report export). The AI picks one; a deterministic fallback derives
# it from PTP / payment signals when the model omits or returns an unknown value.
DISPOSITIONS = (
    "Claim paid on call",
    "Confirm TO ECS",
    "Promise to pay",
    "Call Back (Plain)",
    "No Promise-Call back",
    "Will not clear",
    "Left Message",
    "Wrong Number",
    "Dispute",
    "Other",
)

# Dispositions the client's CRM actually offers. Labels outside this set (Dispute,
# Other) are mapped onto the closest CRM outcome so AI dispositions can be
# reconciled against the CRM export one-for-one.
CRM_DISPOSITIONS = (
    "Claim paid on call",
    "Confirm TO ECS",
    "Promise to pay",
    "Call Back (Plain)",
    "No Promise-Call back",
    "Will not clear",
    "Left Message",
    "Wrong Number",
)


def _to_crm_disposition(label: str, transcript: str = "") -> str:
    if label in CRM_DISPOSITIONS:
        return label
    # A dispute or unclassified outcome with a live right party and no promise is
    # a "No Promise-Call back" in the client's CRM.
    turns = _turns(transcript)
    contacted = any(role == "Customer" for _s, role, _t in turns)
    return "No Promise-Call back" if contacted else "Call Back (Plain)"


_DELAY_CUES = (
    "couldn't pay", "could not pay", "unable to pay", "nahi de paya", "nahi diya",
    "paisa nahi tha", "payment late", "late payment", "der ho gay", "broken ptp",
    "emi miss", "missed the emi", "payment nahi hui",
)
_REFUSAL_CUES = (
    "will not pay", "won't pay", "not paying", "cannot pay ever", "refuse",
    "nahi dunga", "nahi doonga", "nahi karunga", "nahi karoonga", "nahi karenge",
    "nahi bharunga", "nahi bharenge", "paisa nahi dunga", "payment nahi karunga",
    "mat call", "phone mat", "call mat kar", "don't call", "do not call again",
)
_ECS_CUES = ("ecs", "nach", "auto debit", "auto-debit", "autodebit", "mandate", "maintain balance",
             "maintain the balance", "balance maintain", "balance rakh", "account me balance", "debit ho")
_PAID_CUES = ("payment has been made", "already paid", "ho gaya", "done", "paid", "debit ho gaya", "paisa cut")


def _has_delay_context(transcript: str) -> bool:
    """True only when a payment ACTUALLY bounced or was late on this account.

    Preventive coaching ("maintain balance so the EMI doesn't bounce") is not a
    delay, so those clauses are removed before the check.
    """
    text = _PREVENTIVE_BOUNCE_RE.sub(" ", str(transcript or ""))
    if _PAST_DELAY_RE.search(text):
        return True
    low = text.lower()
    return any(cue in low for cue in _DELAY_CUES)


def normalize_disposition(value: str) -> str:
    """Map a free-text disposition onto the canonical ICIC list (case/space-tolerant)."""
    v = str(value or "").strip()
    if not v:
        return ""
    low = v.lower()
    for d in DISPOSITIONS:
        if low == d.lower():
            return d
    # tolerant partial matches for common model phrasings
    if "claim" in low and "paid" in low:
        return "Claim paid on call"
    if "ecs" in low or "nach" in low or "auto" in low:
        return "Confirm TO ECS"
    if "will not" in low or "wont" in low or "won't" in low or "refus" in low:
        return "Will not clear"
    if "no promise" in low:
        return "No Promise-Call back"
    if "call back" in low or "callback" in low:
        return "Call Back (Plain)"
    if "promise" in low:
        return "Promise to pay"
    if "left" in low and "message" in low:
        return "Left Message"
    if "wrong" in low:
        return "Wrong Number"
    if "disput" in low:
        return "Dispute"
    return "Other"


def derive_disposition(
    llm_disposition: str,
    ptp: dict[str, Any],
    dim_results: dict[str, dict[str, Any]],
    transcript: str,
    commitment: dict[str, Any] | None = None,
) -> str:
    """Disposition from transcript evidence first, LLM label second.

    The LLM used to return "Call Back (Plain)" for calls where the borrower had
    agreed to maintain balance for the ECS, so a borrower-confirmed commitment
    now outranks a callback/no-promise label.
    """
    norm = normalize_disposition(llm_disposition)
    commitment = commitment or {}

    if commitment.get("paid"):
        return "Claim paid on call"
    if is_secured_ptp(commitment):
        # Evidence wins over LLM label so disposition matches mode (manual vs ECS).
        return "Confirm TO ECS" if commitment.get("mode") == "ECS" else "Promise to pay"
    # A flat refusal outranks any promise label the model may have picked.
    if commitment.get("refusal"):
        return "Will not clear"
    if norm in ("Confirm TO ECS", "Promise to pay") and str(ptp.get("present", "No")).lower() != "yes":
        # Model claimed a commitment outcome without any commitment evidence.
        return "No Promise-Call back"
    if norm == "Call Back (Plain)" and not has_callback_arrangement(transcript):
        # "Call Back" is an observable outcome, not a generic no-PTP bucket.
        # The model repeatedly invented it for fully completed PDM reminders.
        return "No Promise-Call back"
    if norm and norm != "Other":
        return _to_crm_disposition(norm, transcript)

    low = (transcript or "").lower()
    pay = dim_results.get("Payment Confirmation") or {}
    if str(pay.get("status")) == "Pass" or any(c in low for c in _PAID_CUES):
        # Payment stated done on the call.
        if any(c in low for c in _PAID_CUES):
            return "Claim paid on call"
    if any(c in low for c in _REFUSAL_CUES):
        return "Will not clear"
    present = str(ptp.get("present", "No")).lower() == "yes"
    if present:
        mode = str(ptp.get("mode", "")).lower()
        if any(c in mode for c in ("ecs", "nach", "auto", "mandate")) or any(c in low for c in _ECS_CUES):
            return "Confirm TO ECS"
        return "Promise to pay"
    if has_callback_arrangement(transcript):
        return "Call Back (Plain)"
    return _to_crm_disposition(norm or "Other", transcript)


_PREDUE_RE = re.compile(
    r"(before\s+the\s+due\s+date|due\s+date\s+se\s+pehle|(?:1|one|a)\s*day\s*before|"
    r"maintain\s+(?:the\s+)?(?:balance|funds|amount)|balance\s+maintain|"
    r"keep\s+(?:the\s+)?(?:balance|funds|money|amount)|funds?\s+in\s+the\s+account|"
    r"balance\s+(?:rakh|rakhiye|ready|hona)|paisa\s+rakh|"
    r"ek\s+din\s+pehle|due\s+date\s+ke|upcoming\s+(?:emi|due)|pre-?due|"
    r"reminder\s+call|आगामी|एक\s*दिन\s*पहले|ड्यू\s*डेट\s*से\s*पहले|"
    r"बैलेंस\s*(?:मेंटेन|रख)|बॅलन्स\s*ठेव|मेंटेन\s*रख|"
    r"(?:maintain|मॅनटेन|मेन्टेन)\s*(?:करा|करायच)|"
    r"ड्यू\s*डेट(?:च्या)?\s*एक\s*दिवस\s*आधी|"
    r"auto\s*-?\s*debit|ऑटो\s*डेबिट)",
    re.I,
)

# Present overdue recovery (COLL), as opposed to historical bounce coaching on a
# pre-due reminder. Used so "पिछली बार बाउंस" does not flip a Confirm-TO-ECS call.
_CURRENT_OVERDUE_COLLECT_RE = re.compile(
    r"(?:(?:अभी|आज|तुरंत).{0,20}(?:भुगतान|पेमेंट|pay)|"
    r"(?:भुगतान|पेमेंट|EMI|ईएमआई).{0,25}(?:लंबित|बकाया|बाउंस\s*हो\s*चुका|बाउंस\s*झाली)|"
    r"(?:जमा\s*झालेली\s*नाही|अपडेट\s*नहीं\s*हुआ)|"
    r"overdue|outstanding\s+amount|"
    r"देय\s*तिथि\s*निकल)",
    re.I,
)


def derive_campaign(llm_campaign: str, transcript: str) -> str:
    """PDM (pre-due reminder) vs COLL (overdue recovery), from evidence first.

    A call that only warns the borrower to keep balance so the upcoming EMI does
    not bounce is a pre-due reminder; the model tended to read any mention of the
    word "bounce" as recovery. Historical bounce coaching on a pre-due call must
    stay PDM.
    """
    v = str(llm_campaign or "").strip().upper()
    text = str(transcript or "")
    predue = bool(_PREDUE_RE.search(_PREVENTIVE_BOUNCE_RE.sub(" ", text)))
    collecting_now = bool(_CURRENT_OVERDUE_COLLECT_RE.search(text))
    has_delay = _has_delay_context(text)

    if predue and not collecting_now:
        return "PDM"
    if has_delay or collecting_now:
        return "COLL"
    if predue:
        return "PDM"
    # Nothing has bounced yet and the agent is warning about a future bounce:
    # that is a pre-due reminder even without an explicit "maintain balance".
    if _PREVENTIVE_BOUNCE_RE.search(text):
        return "PDM"
    if v in ("PDM", "COLL"):
        return v
    return "Other"


def _map_resolution(
    ptp: dict[str, Any],
    dim_results: dict[str, dict[str, Any]],
    commitment: dict[str, Any] | None = None,
) -> str:
    """Resolved only when money already moved — a promise is a follow-up.

    A Pass on "Payment Confirmation" means the agent recapped mode/amount/date
    correctly, not that the due was cleared, so it must not read as Resolved.
    """
    commitment = commitment or {}
    if commitment.get("paid"):
        return "Resolved"
    if commitment.get("present") or str(ptp.get("present", "No")).lower() == "yes":
        return "Follow-Up"
    return "Pending"


# Coaching terms per dimension — used to strip advice about steps the agent
# actually performed (the model coached "improve the recording disclaimer" on
# calls where the disclaimer was given in Hindi).
_FEEDBACK_TERMS: dict[str, tuple[str, ...]] = {
    "Recording Disclaimer": ("disclaimer", "recording", "monitored"),
    "Self Introduction": ("introduc", "identify themsel", "state their name", "greeting"),
    "RPC Verification": (
        "right party", "rpc", "verification", "verify the customer", "verify the borrower",
        "confirm the customer", "confirm the borrower", "identity",
    ),
    "Reason for Delay": ("reason for delay", "reason for the bounce", "why the payment"),
    "PTP Success Rate": ("promise to pay", "ptp", "commitment"),
    "Payment Confirmation": ("payment confirmation", "confirm the payment", "recap"),
    "Politeness and Empathy": ("empathy", "polite"),
    "Telephone Etiquette": ("etiquette", "greeting", "closing"),
    "Unusual Patterns": (
        "personal account", "personal channel", "non-official", "unofficial channel",
        "payment channel", "phonepe", "phone pe", "google pay", "gpay", "paytm",
        "whatsapp", "otp", "credential", "unusual", "fraud",
    ),
}

_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")

# Blanket all-clear claims must not survive next to a listed failure.
_ALL_CLEAR_RE = re.compile(
    r"(no\s+coaching\s+(?:is\s+)?(?:needed|required)|all\s+(?:criteria|dimensions|parameters)\s+"
    r"(?:were|are|was)\s+(?:met|passed)|performed\s+well\s+in\s+all|nothing\s+to\s+improve|"
    r"all\s+dimensions\s+were\s+passed)",
    re.I,
)
_NEGATION_RE = re.compile(
    r"(did\s+not|didn'?t|failed|never|was\s+not|wasn'?t|missing|missed|omitted|"
    r"no\s+\w+\s+(?:was|were)\s+(?:given|provided|made))",
    re.I,
)
# Imperative coaching that implies a passed step still needs doing
# ("Confirm the borrower's identity, obtain a commitment…").
_IMPERATIVE_COACH_RE = re.compile(
    r"^(?:please\s+)?(?:confirm|verify|establish|provide|give|ensure|improve|obtain)\b",
    re.I,
)


def scrub_contradictions(text: str, dim_results: dict[str, dict[str, Any]]) -> str:
    """Drop claims that a passed step was missed.

    The model narrates summaries like "the agent did not confirm the borrower's
    identity, failed to provide a recording disclaimer" on calls where both were
    done; those sentences undermine the audit in front of the client.
    """
    passed = {k for k, v in dim_results.items() if str(v.get("status")) == "Pass"}
    terms: list[str] = []
    for key in passed:
        terms.extend(_FEEDBACK_TERMS.get(key, ()))
    if not terms:
        return str(text or "").strip()

    kept: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(str(text or "").strip()):
        s = sentence.strip()
        if not s:
            continue
        low = s.lower()
        # Split compound coaching lines so a false identity clause can drop while
        # a real PTP clause remains.
        clauses = re.split(r",\s*(?:and\s+)?", s)
        filtered = []
        for c in clauses:
            cl = c.lower().strip()
            false_neg = _NEGATION_RE.search(cl) and any(t in cl for t in terms)
            false_imp = (
                _IMPERATIVE_COACH_RE.search(cl)
                and any(t in cl for t in terms)
            )
            if false_neg or false_imp:
                continue
            filtered.append(c.strip())
        if not filtered:
            continue
        if len(filtered) < len(clauses):
            rebuilt = ", ".join(filtered).strip()
            if rebuilt and not rebuilt.endswith((".", "!", "?")):
                rebuilt += "."
            kept.append(rebuilt[0].upper() + rebuilt[1:] if rebuilt else rebuilt)
            continue
        kept.append(s)
    return " ".join(kept).strip()


def scrub_channel_accusations(text: str) -> str:
    """Drop claims that the agent used/suggested a non-official channel.

    Applied only when the deterministic detector cleared the call: the 14B judge
    tends to narrate "the agent suggested using WhatsApp" on calls where the agent
    actually DECLINED it. A trailing relative clause ("...which is not an official
    channel") attached to the dropped channel clause is removed with it; unrelated
    clauses (e.g. a real RPC miss or no-PTP) survive.
    """
    out: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(str(text or "").strip()):
        s = sentence.strip()
        if not s:
            continue
        if not _CHANNEL_ACCUSE_RE.search(s):
            out.append(s)
            continue
        clauses = re.split(r",\s*(?:and\s+)?", s)
        kept: list[str] = []
        drop_prev = False
        for c in clauses:
            cl = c.strip()
            is_channel = bool(_CHANNEL_ACCUSE_RE.search(cl))
            is_rel = bool(re.match(r"(?:which|that|who)\b", cl, re.I))
            if is_channel or (is_rel and drop_prev):
                drop_prev = True
                continue
            drop_prev = False
            kept.append(cl)
        if not kept:
            continue
        rebuilt = ", ".join(kept).strip()
        if rebuilt and not rebuilt.endswith((".", "!", "?")):
            rebuilt += "."
        out.append(rebuilt[0].upper() + rebuilt[1:] if rebuilt else rebuilt)
    return " ".join(out).strip()


def scrub_location_collision_accusations(text: str) -> str:
    """Drop police/jail threat narration when the foul detector cleared the call."""
    out: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(str(text or "").strip()):
        s = sentence.strip()
        if not s:
            continue
        if _LOCATION_ACCUSE_RE.search(s):
            continue
        out.append(s)
    return " ".join(out).strip()


_FEEDBACK_ANCHOR_RE = re.compile(
    r"\s*Anchor\s*:\s*(?P<quote>['\"])(?P<evidence>.+?)(?P=quote)\s*\.?",
    re.I,
)


def scrub_unsupported_feedback_anchors(
    feedback: str,
    *transcripts: str,
) -> str:
    """Remove model-generated `Anchor: "..."` text unless it was spoken.

    Coaching may be inferential, but anything presented as a quotation must be
    traceable to the call. This prevents a fluent Qwen paraphrase from looking
    like verbatim audit evidence.
    """
    def replace(match: re.Match[str]) -> str:
        evidence = match.group("evidence")
        return match.group(0) if _evidence_in_transcript(evidence, *transcripts) else ""

    cleaned = _FEEDBACK_ANCHOR_RE.sub(replace, str(feedback or ""))
    return re.sub(r"\s+", " ", cleaned).strip()


_CHARGE_GUIDANCE_RE = re.compile(
    r"(bounce\s+charge|check\s+boun[cd]\s+charge|penal(?:ty)?\s+charge|late\s+charge|"
    r"charge.{0,20}(?:add|apply|laga))",
    re.I,
)
_OFFICIAL_APP_GUIDANCE_RE = re.compile(
    r"((?:icici|icic|hfc|home\s+finance|company|official).{0,35}(?:app|application)|"
    r"(?:app|application).{0,35}(?:icici|icic|hfc|home\s+finance|company|official))",
    re.I,
)
_DUE_DETAIL_RE = re.compile(
    r"(emi\s+(?:amount|date)|due\s+date|before\s+(?:the\s+)?due\s+date|"
    r"\bemi\b.{0,35}(?:rupees|rs\.?|₹|amount|date))",
    re.I,
)
_AUTODEBIT_ACCOUNT_RE = re.compile(
    r"(?:auto\s*-?\s*debit.{0,45}account|account.{0,45}auto\s*-?\s*debit|"
    r"which\s+account.{0,45}(?:debit|mandate)|mandate.{0,45}account)",
    re.I,
)


def build_grounded_summary(
    campaign: str,
    commitment: dict[str, Any],
    criteria: dict[str, Any],
    fraud: dict[str, Any],
    original_transcript: str,
    english_transcript: str = "",
) -> str:
    """Create a conservative factual summary from transcript-backed signals.

    Used when the model summary contradicted deterministic evidence.  It avoids
    generic audit accusations and reports only facts the local detectors can
    prove, which is safer for multilingual calls with imperfect translation.
    """
    agent_text = _all_role_text("Agent", original_transcript, english_transcript)
    customer_text = _all_role_text("Customer", original_transcript, english_transcript)
    parts: list[str] = []
    if campaign == "PDM":
        parts.append("This was a pre-due EMI reminder.")
    elif campaign == "COLL":
        parts.append("This was a collections follow-up about the loan repayment.")
    else:
        parts.append("The agent discussed the borrower's loan account.")

    intro = criteria.get("selfIntro") or {}
    if all(intro.get(k) for k in ("greetingGiven", "nameGiven", "companyGiven")):
        parts.append("The agent greeted the borrower and introduced themself and ICICI Home Finance.")
    if (criteria.get("rpc") or {}).get("verified"):
        parts.append("The borrower was addressed by name and confirmed the call.")
    if _DUE_DETAIL_RE.search(agent_text):
        parts.append("The agent explained the EMI amount and due-date timing.")
    if _CHARGE_GUIDANCE_RE.search(agent_text):
        parts.append("The agent explained the possible charge if payment is delayed.")
    if _OFFICIAL_APP_GUIDANCE_RE.search(agent_text):
        if re.search(r"\bpan\b", agent_text, re.I) and re.search(r"\botp\b", agent_text, re.I):
            parts.append(
                "The agent also explained official-app registration and login using PAN and an OTP entered by the borrower."
            )
        else:
            parts.append("The agent also explained how to use the official ICICI Home Finance app.")
    combined_text = " ".join(v for v in (original_transcript, english_transcript) if v)
    if _AUTODEBIT_ACCOUNT_RE.search(combined_text) and _OFFICIAL_APP_GUIDANCE_RE.search(agent_text):
        parts.append(
            "The borrower also asked about the linked auto-debit account, and the agent advised "
            "checking its status in the official app."
        )
    if _ACCOUNT_ACCESS_PROBLEM_RE.search(customer_text):
        parts.append("The borrower said a blocked or inaccessible bank account was preventing payment.")
    elif (criteria.get("delayProbe") or {}).get("answered") or (
        criteria.get("delayProbe") or {}
    ).get("proactive"):
        parts.append("The borrower explained the reason for the payment delay.")

    if fraud.get("personalChannel") == "Yes":
        parts.append("The agent directed payment to a personal destination; this requires immediate review.")
    elif fraud.get("credentialCapture") == "Yes":
        parts.append("The agent asked the borrower to disclose a payment credential; this requires policy review.")
    elif fraud.get("nonOfficialDocumentChannel") == "Yes":
        parts.append("The agent directed documents or payment evidence to a non-official messaging channel.")

    conditional_intent = criteria.get("conditionalIntent") or detect_conditional_payment_intent(
        original_transcript, english_transcript
    )
    if commitment.get("paid"):
        parts.append("The borrower stated that payment had already been made.")
    elif is_secured_ptp(commitment):
        if commitment.get("mode") == "ECS":
            parts.append(
                "A secured PTP was completed: the borrower committed to maintain funds for "
                "the ECS/auto-debit with a confirmed date, amount and mode."
            )
        else:
            parts.append(
                "A secured PTP was completed with a confirmed payment date, amount and mode."
            )
    elif commitment.get("present") or conditional_intent.get("present"):
        parts.append(
            "The borrower expressed willingness to pay after the account obstacle was resolved, "
            "but no secured PTP with a confirmed date, amount and payment mode was completed."
        )
    elif commitment.get("refusal"):
        parts.append("The borrower explicitly refused payment.")
    else:
        parts.append("The borrower acknowledged the information; no explicit payment commitment was made.")
    return " ".join(parts)


_SUMMARY_RPC_POSITIVE_RE = re.compile(
    r"(borrower\s+was\s+addressed\s+by\s+name\s+and\s+confirmed|"
    r"right\s+party\s+(?:was\s+)?confirmed|"
    r"borrower(?:'s)?\s+identity\s+(?:was\s+)?(?:verified|confirmed)|"
    r"verified\s+(?:the\s+)?borrower)",
    re.I,
)
_SUMMARY_INTRO_POSITIVE_RE = re.compile(
    r"(agent\s+(?:properly\s+)?introduced\s+(?:themself|himself|herself)|"
    r"agent\s+gave\s+(?:their|his|her)\s+name)",
    re.I,
)
_SUMMARY_COMMITMENT_POSITIVE_RE = re.compile(
    r"(borrower|customer).{0,35}(?:made|gave|confirmed|committed\s+to)\s+"
    r"(?:an?\s+)?(?:explicit\s+)?(?:promise|commitment|payment)",
    re.I,
)


def summary_conflicts_with_reconciled_facts(
    summary: str,
    dim_results: dict[str, dict[str, Any]],
    criteria: dict[str, Any],
    commitment: dict[str, Any],
) -> bool:
    """Reject positive model claims contradicted by final detector results."""
    text = str(summary or "")
    if not text:
        return False
    if not (criteria.get("rpc") or {}).get("verified") and _SUMMARY_RPC_POSITIVE_RE.search(text):
        return True
    if str((dim_results.get("Self Introduction") or {}).get("status")) == "Fail":
        if _SUMMARY_INTRO_POSITIVE_RE.search(text):
            return True
    if not commitment.get("present") and not commitment.get("paid"):
        if _SUMMARY_COMMITMENT_POSITIVE_RE.search(text):
            return True
    return False


_AUDIT_JARGON_RE = re.compile(
    r"\s*(?:Nearest opening evidence|Anchor)\s*:\s*(?P<quote>['\"])(?P<body>.+?)(?P=quote)\s*\.?",
    re.I,
)
_NOT_FOUND_PREFIX_RE = re.compile(r"^not found[:.\s-]*", re.I)


def _strip_audit_jargon(evidence: str) -> str:
    """Drop internal audit labels agents should never see."""
    text = _AUDIT_JARGON_RE.sub("", str(evidence or ""))
    text = _NOT_FOUND_PREFIX_RE.sub("", text)
    text = re.sub(r'\s+"[^"]{12,}"', "", text)
    return re.sub(r"\s+", " ", text).strip(" .")


def _human_coach_point(key: str, evidence: str) -> str:
    """One agent-facing note: what went wrong + what to do next."""
    ev = _strip_audit_jargon(evidence)
    low = ev.lower()

    if key == "Self Introduction":
        missing: list[str] = []
        if "agent name" in low:
            missing.append("your name")
        if "company" in low:
            missing.append("the company name")
        if "greeting" in low:
            missing.append("a greeting")
        missed = ", ".join(missing) if missing else "part of the opening script"
        return (
            f"Opening: the introduction was incomplete — you missed {missed}. "
            "Start with a greeting, your name, and ICICI Home Finance so the customer knows who is calling."
        )
    if key == "Recording Disclaimer":
        return (
            "Recording notice: tell the customer the call is recorded for quality and training "
            "before you discuss the account."
        )
    if key == "RPC Verification":
        if "third party" in low:
            return (
                "Right party: someone else was on the line. Confirm their relationship and take "
                "consent before sharing any account details."
            )
        return (
            "Right party: confirm you are speaking to the named borrower and wait for a clear yes "
            "before you share loan or EMI details."
        )
    if key == "PTP Success Rate":
        bits: list[str] = []
        if "date" in low or "time" in low:
            bits.append("date")
        if "amount" in low:
            bits.append("amount")
        if "mode" in low:
            bits.append("payment mode")
        miss = ", ".join(bits) if bits else "date, amount, and payment mode"
        return (
            f"Promise to pay: a firm PTP was not completed. Lock {miss} and get a clear "
            "'I will pay' or 'I will maintain the balance' — not only 'okay' or 'I will try'."
        )
    if key == "Payment Confirmation":
        if "conditional or partial willingness" in low:
            return (
                "Payment confirmation: the customer showed conditional or partial willingness, "
                "but you did not recap a payment date, amount, and mode. Repeat the agreement "
                "back and ask them to confirm it."
            )
        if "recap" in low:
            return (
                "Payment confirmation: a promise was discussed, but you did not recap the date, "
                "amount, and mode before closing. End by repeating those three points."
            )
        return (
            "Payment confirmation: the call ended without a confirmed payment or a recapped PTP. "
            "Before you hang up, confirm what will be paid, when, and how."
        )
    if key == "Negotiation Quality":
        if "created urgency" in low or "bounce/late consequences" in low:
            return (
                "Negotiation: you created urgency and explained bounce/late consequences, but "
                "did not finish with a direct payment question. Ask when the amount will be paid "
                "or the balance will be maintained."
            )
        return (
            "Negotiation: explain why paying now matters, then ask a specific payment question "
            "instead of ending on a general 'try next time'."
        )
    if key == "Reason for Delay":
        return (
            "Reason for delay: ask why the EMI bounced or was late, then use that reason to "
            "agree a realistic payment plan."
        )
    if key == "Agent Tone and Clarity":
        return (
            "Tone: the delivery sounded flat or hard to follow. Keep a clear, even pace and "
            "match how fast the customer is speaking so the call feels professional."
        )
    if key == "Politeness and Empathy":
        return (
            "Empathy: acknowledge the customer's situation in one short sentence before you "
            "ask for payment. That keeps the call polite and easier to close."
        )
    if key == "Sentiment Analysis":
        return (
            "Customer mood: sentiment slipped on this call. Pause, acknowledge the concern, "
            "then return to the payment ask in a calm voice."
        )
    if key == "Telephone Etiquette":
        return (
            "Call manner: keep a professional greeting and a clear thank-you close. "
            "Do not talk over the customer."
        )
    if key == "Unusual Patterns":
        return (
            "Payment channel: use only the official company link, app, or registered mandate. "
            "Never ask the customer to pay to a personal UPI, mobile number, or account."
        )
    if key == "Rude and Unprofessional":
        return (
            "Conduct: language on this call was unprofessional. Stay calm, do not threaten, "
            "and keep the conversation respectful."
        )
    if ev:
        return f"{key}: {ev}. Correct this on the next similar call before you close."
    return (
        f"{key}: this checkpoint did not meet the standard. Review the script and apply it "
        "on the next call."
    )


def _tone_sentiment_note(
    dim_results: dict[str, dict[str, Any]],
    agent_sentiment: dict[str, Any] | None,
    customer_sentiment: dict[str, Any] | None,
) -> str:
    """One extra line when tone/sentiment failed or the customer mood dropped."""
    tone = dim_results.get("Agent Tone and Clarity") or {}
    sent = dim_results.get("Sentiment Analysis") or {}
    if str(tone.get("status")) == "Fail" or str(sent.get("status")) == "Fail":
        return ""
    cust_dir = str((customer_sentiment or {}).get("direction") or "").lower()
    agent_dir = str((agent_sentiment or {}).get("direction") or "").lower()
    if cust_dir == "declining":
        return (
            "Watch the customer's mood: it dipped during the call — acknowledge that once, "
            "then continue the payment discussion calmly."
        )
    if agent_dir == "declining":
        return (
            "Your own language became less positive toward the end. Stay even and professional "
            "through the close."
        )
    return ""


def build_feedback(
    model_feedback: str,
    dim_results: dict[str, dict[str, Any]],
    rubric_dims: list[dict[str, Any]],
    agent_sentiment: dict[str, Any] | None = None,
    customer_sentiment: dict[str, Any] | None = None,
) -> str:
    """Agent-facing coaching: what to improve, in plain language.

    Drops advice for dimensions that already passed. Never uses audit jargon
    (Focus on / Anchor / Nearest opening evidence).
    """
    passed = {k for k, v in dim_results.items() if str(v.get("status")) == "Pass"}
    banned: list[str] = []
    for key in passed:
        banned.extend(_FEEDBACK_TERMS.get(key, ()))

    has_failures = any(str(v.get("status")) == "Fail" for v in dim_results.values())

    kept: list[str] = []
    for sentence in _SENTENCE_SPLIT_RE.split(str(model_feedback or "").strip()):
        s = sentence.strip()
        if not s:
            continue
        low = s.lower()
        if any(term in low for term in banned):
            continue
        if has_failures and _ALL_CLEAR_RE.search(low):
            continue
        kept.append(s)

    order = {str(d.get("key")): float(d.get("weight") or 0) for d in rubric_dims}
    failures = sorted(
        (k for k, v in dim_results.items() if str(v.get("status")) == "Fail"),
        key=lambda k: -order.get(k, 0),
    )
    parts: list[str] = []
    if failures:
        strength_labels = {
            "Self Introduction": "the opening introduction",
            "RPC Verification": "right-party confirmation",
            "Agent Tone and Clarity": "your speaking tone",
            "Politeness and Empathy": "polite handling",
        }
        strength = next((k for k in strength_labels if k in passed), "")
        if strength:
            parts.append(f"You handled {strength_labels[strength]} well on this call.")
        for key in failures[:3]:
            ev = str((dim_results.get(key) or {}).get("evidence") or "").strip()
            parts.append(_human_coach_point(key, ev))
        extra = _tone_sentiment_note(dim_results, agent_sentiment, customer_sentiment)
        if extra:
            parts.append(extra)
    elif kept:
        parts.append(" ".join(kept))
    if not parts:
        parts.append("All audited parameters met the standard on this call. Keep it up.")
    text = " ".join(parts).strip()
    text = _AUDIT_JARGON_RE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def build_collections_payload(
    parsed: dict[str, Any],
    rubric_dims: list[dict[str, Any]],
    original_transcript: str,
    english_transcript: str = "",
    call_language: str = "Hindi",
    org_name: str = "",
    compliance_opening_evidence: str = "",
) -> dict[str, Any]:
    """Combine LLM output with deterministic detectors into the final payload +
    the top-level fields the existing DB/report pipeline consumes."""
    dim_results = dict(parsed.get("dim_results") or {})

    # NA discipline: NA-eligible dimensions must never carry a guessed
    # mid score that silently drags Overall down. They are excluded from the
    # weighted denominator instead (see compute_weighted_overall NA re-norm).
    has_delay = _has_delay_context(original_transcript) or _has_delay_context(english_transcript)
    for d in rubric_dims:
        key = str(d.get("key") or "").strip()
        if not key or not bool(d.get("naEligible")):
            continue
        if key == "Blank Documentation":
            # Documentation completeness comes from the CRM feed, not the audio.
            dim_results[key] = {"score": None, "status": "NA",
                                "evidence": "Assessed from CRM feed, not audio."}
        elif key == "Reason for Delay" and not has_delay:
            # On-time / auto-debit calls have no delay to capture.
            dim_results[key] = {"score": None, "status": "NA",
                                "evidence": "No payment delay discussed on the call."}
        # Reason for Delay is evaluated from the call whenever a delay or
        # payment obstacle exists. Missing evidence then means Fail, not N/A.

    campaign = derive_campaign(
        parsed.get("campaign", ""), f"{original_transcript} {english_transcript}"
    )

    # Deterministic criteria: compliance steps, delay probe and PTP are decided
    # from transcript evidence, not from the model's impression.
    ptp = parsed.get("ptp") or {}
    commitment = detect_commitment(original_transcript, english_transcript)
    criteria = apply_deterministic_criteria(
        dim_results,
        rubric_dims,
        original_transcript,
        english_transcript,
        org_name,
        call_language=call_language,
        commitment=commitment,
        ptp=ptp,
        campaign=campaign,
        compliance_opening_evidence=compliance_opening_evidence,
    )
    ptp = reconcile_ptp(
        ptp,
        commitment,
        f"{original_transcript} {english_transcript}",
        criteria.get("conditionalIntent"),
    )

    # Deterministic overrides for safety-critical dimensions.
    foul = detect_foul(original_transcript, english_transcript, call_language)
    if foul.get("violation") == "Yes":
        dim_results[RUDE_KEY] = {"score": 0.0, "status": "Fail",
                                 "evidence": foul.get("evidence", "")}

    fraud = detect_personal_channel_fraud(
        original_transcript, english_transcript
    )
    if "Unusual Patterns" in {str(d.get("key") or "") for d in rubric_dims}:
        if fraud.get("unusualPattern") == "Yes":
            dim_results["Unusual Patterns"] = {
                "score": 0.0,
                "status": "Fail",
                "evidence": fraud.get("evidence", ""),
            }
        else:
            # Personal-channel fraud is the objective risk signal. The LLM must
            # not zero this dimension on a clean call (it was dragging overall
            # into the fail band after compliance already Passed).
            _floor_dim(
                dim_results,
                "Unusual Patterns",
                100.0,
                "No personal-payment, credential-solicitation or non-official document-channel cue from the agent.",
            )

    # Collecting money through a personal/consumer channel (PhonePe / Google Pay
    # / personal UPI / QR over WhatsApp) is a zero-tolerance breach — treat it as
    # a red alert so the overall reflects the severity, not just a failed dim.
    channel_red_alert = (
        "Agent directed payment to an agent-owned or personal account, UPI, wallet or QR destination"
        if fraud.get("redAlert")
        else ""
    )
    weighted = compute_weighted_overall(
        dim_results, rubric_dims, external_red_alert=channel_red_alert
    )

    agent_traj = agent_sentiment_trajectory(original_transcript)
    cust_traj = sentiment_trajectory(original_transcript, "Customer")
    ros = rate_of_speech_and_dead_air(original_transcript)

    llm_ztp = parsed.get("ztp") or {}
    personal_ztp = fraud.get("personalChannel") == "Yes"
    credential_ztp = fraud.get("credentialCapture") == "Yes"
    document_channel_ztp = fraud.get("nonOfficialDocumentChannel") == "Yes"
    # The 14B judge may ADD a ZTP the deterministic detectors missed, but every
    # LLM claim is VERIFIED before it can stand:
    #   * it must quote evidence that actually appears in the transcript, AND
    #   * a payment-CHANNEL / WhatsApp category is trusted ONLY when the context-
    #     aware detector also found a real personal-channel breach — the model
    #     repeatedly misreads a DECLINE ("you don't need to send it on WhatsApp"),
    #     an OFFICIAL channel, or a CUSTOMER-proposed channel as a violation.
    # Non-channel categories (threats, third-party disclosure, unauthorised
    # waivers) stay LLM-driven when evidence is quoted.
    llm_ztp_raw = str(llm_ztp.get("violation", "No")).lower() == "yes"
    llm_ztp_ev = str(llm_ztp.get("evidence") or "")
    llm_evidence_ok = _evidence_in_transcript(
        llm_ztp_ev, original_transcript, english_transcript
    )
    accepted_llm_cats: list[str] = []
    if llm_ztp_raw and llm_evidence_ok:
        raw_cats = [str(c) for c in (llm_ztp.get("categories") or []) if str(c).strip()]
        foul_yes = foul.get("violation") == "Yes"
        kinds_to_scan = raw_cats if raw_cats else [""]
        for cat in kinds_to_scan:
            kind = classify_llm_ztp_claim(cat, llm_ztp_ev)
            if not accept_llm_ztp(
                kind,
                personal_ztp=personal_ztp,
                credential_ztp=credential_ztp,
                document_channel_ztp=document_channel_ztp,
                foul_yes=foul_yes,
            ):
                continue
            if cat:
                accepted_llm_cats.append(cat)
            elif kind == "credential":
                accepted_llm_cats.append("Payment credential solicitation")
            elif kind == "whatsapp":
                accepted_llm_cats.append("Non-official document channel")
            elif kind == "channel":
                accepted_llm_cats.append("Personal payment destination")
            elif kind == "foul":
                accepted_llm_cats.append("Threatening language")
            else:
                accepted_llm_cats.append("Policy violation")
    llm_ztp_ok = bool(accepted_llm_cats)

    ztp_violation = "Yes" if (
        foul.get("violation") == "Yes"
        or personal_ztp
        or credential_ztp
        or document_channel_ztp
        or llm_ztp_ok
    ) else "No"
    ztp_categories = sorted(set(
        foul.get("categories", [])
        + accepted_llm_cats
        + (["Personal payment destination"] if personal_ztp else [])
        + (["Payment credential solicitation"] if credential_ztp else [])
        + (["Non-official document channel"] if document_channel_ztp else [])
    ))
    ztp_evidence = (
        foul.get("evidence")
        or (fraud.get("personalEvidence") if personal_ztp else "")
        or (fraud.get("credentialEvidence") if credential_ztp else "")
        or (fraud.get("documentChannelEvidence") if document_channel_ztp else "")
        or (llm_ztp_ev if llm_ztp_ok else "")
    )

    disposition = derive_disposition(
        parsed.get("disposition", ""), ptp, dim_results, original_transcript, commitment
    )
    loan_basics = extract_loan_basics(original_transcript, english_transcript)
    collections = {
        "disposition": disposition,
        "campaign": campaign,
        "dimensions": weighted["dimensions"],
        "overall": weighted["overall"],
        "fatalTriggered": weighted["fatalTriggered"],
        "fatalReason": weighted["fatalReason"],
        "redAlert": weighted["redAlert"],
        "ztpViolation": ztp_violation,
        "ztpCategories": ztp_categories,
        "ztpEvidence": ztp_evidence[:4000],
        "loanBasics": {
            "loanType": loan_basics.get("loanType"),
            "accountLast4": loan_basics.get("accountLast4"),
            "emiAmount": loan_basics.get("emiAmount"),
            "dueDate": loan_basics.get("dueDate"),
            "evidence": str(loan_basics.get("evidence") or "")[:300],
        },
        "ptp": {
            "present": str(ptp.get("present", "No")),
            "genuineness": str(ptp.get("genuineness", "Not Applicable")),
            "propensity": str(ptp.get("propensity", "Low")),
            "date": str(ptp.get("date", "")),
            # Never surface Amount: 0 when no PTP was secured — that reads as a
            # real figure. Leave blank / "Not confirmed" for the UI.
            "amount": (
                None
                if (
                    str(ptp.get("present", "No")).lower() != "yes"
                    and (
                        ptp.get("amount") in (0, 0.0, "0", "0.0", None, "")
                        or str(ptp.get("amount") or "").strip() in ("0", "0.0")
                    )
                )
                else ptp.get("amount")
            ),
            "mode": str(ptp.get("mode", "")),
            "reasonForDelay": str(ptp.get("reasonForDelay", "")),
            "summary": str(ptp.get("summary", "")),
        },
        "fraud": fraud,
        "agentSentiment": agent_traj,
        "customerSentiment": cust_traj,
        "ros": ros,
        "documentation": {"disposition": "", "remarks": "", "blank": "NA"},
        "criteriaEvidence": {
            "disclaimer": criteria["disclaimer"],
            "selfIntro": criteria["selfIntro"],
            "rpc": criteria["rpc"],
            "delayProbe": criteria["delayProbe"],
            "commitment": commitment,
            "empathy": criteria["empathy"],
            "conditionalIntent": criteria["conditionalIntent"],
        },
        "scoreBreakdown": weighted["scoreBreakdown"],
    }

    feedback = build_feedback(
        parsed.get("feedback") or "",
        dim_results,
        rubric_dims,
        agent_sentiment=agent_traj,
        customer_sentiment=cust_traj,
    )
    feedback = scrub_unsupported_feedback_anchors(
        feedback, original_transcript, english_transcript
    )
    if not personal_ztp and not document_channel_ztp:
        feedback = scrub_channel_accusations(feedback)
    if foul.get("violation") != "Yes":
        feedback = scrub_location_collision_accusations(feedback)
    if weighted["redAlert"] == "Yes":
        feedback = (f"RED ALERT: {weighted['fatalReason']}. " + feedback).strip()

    raw_summary = str(parsed.get("summary") or "").strip()
    summary = scrub_contradictions(raw_summary, dim_results)
    # When the channel detector cleared the call, remove any lingering model claim
    # that the agent used/suggested a non-official channel (it declined it).
    if not personal_ztp and not document_channel_ztp:
        summary = scrub_channel_accusations(summary)
    if foul.get("violation") != "Yes":
        summary = scrub_location_collision_accusations(summary)
    summary_was_corrected = _norm_txt(summary) != _norm_txt(raw_summary)
    summary_conflict = summary_conflicts_with_reconciled_facts(
        summary, dim_results, criteria, commitment
    )
    # Collections summaries are compliance records. Qwen supplies candidate
    # judgements, but the user-facing summary is always rebuilt from reconciled
    # facts so an unsupported positive claim cannot survive on an unseen call.
    if campaign in {"PDM", "COLL"} or summary_was_corrected or summary_conflict or not summary:
        summary = build_grounded_summary(
            campaign,
            commitment,
            criteria,
            fraud,
            original_transcript,
            english_transcript,
        )
        if foul.get("violation") != "Yes":
            summary = scrub_location_collision_accusations(summary)

    scores: dict[str, Any] = {
        "Overall_Scoring": weighted["overall"],
        "Summary": summary or "Collections call summary not generated.",
        "Feedback": feedback or "Review RPC verification, PTP quality and professional conduct.",
        "Rude_Behavior": "Yes" if weighted["redAlert"] == "Yes" else "No",
        # Purpose / Call category on the Result page shows the real collections
        # disposition (Confirm TO ECS, Promise to pay, …) rather than a generic tag.
        "Call_Type": disposition or parsed.get("callType") or "Other",
        "Lead_Classification": "Not a Lead",
        "Resolution_Status": _map_resolution(ptp, dim_results, commitment),
        "Collections": collections,
    }
    return scores


def score_collections(
    transcript: str,
    english_transcript: str = "",
    language: str = "Hindi",
    *,
    rubric_dims: list[dict[str, Any]] | None = None,
    bank_cfg: Any = None,
    compliance_opening_evidence: str = "",
) -> dict[str, Any]:
    """Run the collections LLM pass + deterministic detectors, returning a
    `scores` dict (with a nested `Collections` payload). Raises on LLM/parse
    failure so the caller can fall back to the banking path (fail-closed)."""
    from prompts.collections import collections_json_prompt, collections_system_prompt
    from scoring_worker import ollama_generate, _truncate_transcript

    if bank_cfg is None:
        from bank_config import get_bank_config
        bank_cfg = get_bank_config()
    if not rubric_dims:
        from center_pack import get_center_pack
        rubric_dims = get_center_pack().rubric_dimensions(enabled_only=True)
    if not rubric_dims:
        raise RuntimeError("No collections rubric dimensions available")

    # LLM judges soft dims on the clearest English view when available; detectors
    # in build_collections_payload always see both original + English.
    llm_view = (english_transcript or "").strip() or transcript
    # Fit the 8192-token context: cap the judge transcript hard (head + tail keep
    # the opening compliance + the closing PTP, which carry most scoring signal)
    # and cap the JSON output. Without this, 12-15 min calls overflow the window
    # and the model returns HTTP 400 → the whole score degrades. Detectors below
    # still see the full transcript, so compliance / fraud / PTP stay exact.
    trimmed = _truncate_transcript(llm_view)
    if len(trimmed) > _COLL_LLM_MAX_TRANSCRIPT_CHARS:
        half = _COLL_LLM_MAX_TRANSCRIPT_CHARS // 2
        trimmed = (
            trimmed[:half]
            + "\n...[transcript truncated for scoring]...\n"
            + trimmed[-half:]
        )
    system = collections_system_prompt(bank_cfg)
    prompt = collections_json_prompt(trimmed, bank_cfg, rubric_dims)
    raw = ollama_generate(
        prompt,
        system=system,
        json_mode=True,
        temperature=0.0,
        max_tokens=_COLL_LLM_MAX_OUTPUT_TOKENS,
    )
    parsed = parse_collections_json(raw, rubric_dims)
    scores = build_collections_payload(
        parsed,
        rubric_dims,
        transcript,
        english_transcript,
        language,
        org_name=str(getattr(bank_cfg, "bank_name", "") or ""),
        compliance_opening_evidence=compliance_opening_evidence,
    )
    scores["_raw_text"] = raw
    return scores
