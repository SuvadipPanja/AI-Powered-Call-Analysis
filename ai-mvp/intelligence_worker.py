"""
Phase 2d — per-call intelligence extraction.

Produces escalation, customer query category and loan/lead signals from the
English transcript via the same LLM backend used for scoring (Ollama in dev,
vLLM/OpenAI in prod). Designed to NEVER break the pipeline: any failure returns
safe defaults so scoring/storage still completes.
"""

from __future__ import annotations

import json
import re
from typing import Any

import logging

import scoring_worker  # call attributes dynamically so prod LLM patch applies
from bank_config import get_bank_config
from config import (
    INTELLIGENCE_ENABLED,
    INTELLIGENCE_VERIFY_ENABLED,
    QUERY_CATEGORY_AUTODISCOVER_ENABLED,
    QUERY_CATEGORY_AUTODISCOVER_MAX,
    QUERY_CATEGORY_DEDUPE_SIMILARITY,
    SCORING_MAX_TRANSCRIPT_CHARS,
)
from query_categories import add_discovered_category, fallback_name, get_query_categories
from prompts.intelligence import (
    AGENT_CONVINCED,
    EMI_AFFORDABILITY,
    ESCALATION_CATEGORIES,
    INTEREST_LEVELS,
    LOAN_TYPES,
    QUERY_CATEGORIES,
    YES_NO,
    YES_NO_NA,
    category_discovery_prompt,
    category_verify_prompt,
    intelligence_json_prompt,
    intelligence_system_prompt,
)

logger = logging.getLogger(__name__)

# Keys merged into the scoring `scores` dict and persisted by db.upsert_scoring_result.
INTELLIGENCE_KEYS: tuple[str, ...] = (
    "Primary_Query_Type",
    "Secondary_Query_Types",
    "Escalation_Requested",
    "Escalation_Actioned",
    "Escalation_Category",
    "CSAT_Transferred",
    "Loan_Is_Loan_Call",
    "Loan_Type",
    "Loan_Interest",
    "EMI_Affordability",
    "EMI_Amount",
    "Loan_Amount",
    "Agent_Convinced",
    "Loan_Success_Probability",
    "Intelligence_Summary",
)


def intelligence_enabled() -> bool:
    return INTELLIGENCE_ENABLED


def default_intelligence() -> dict[str, Any]:
    """Safe, fully-populated defaults (used when intelligence is off or fails)."""
    return {
        "Primary_Query_Type": "Other/General Info",
        "Secondary_Query_Types": [],
        "Escalation_Requested": "No",
        "Escalation_Actioned": "N/A",
        "Escalation_Category": "None",
        "CSAT_Transferred": "No",
        "Loan_Is_Loan_Call": "No",
        "Loan_Type": "None",
        "Loan_Interest": "None",
        "EMI_Affordability": "Not Discussed",
        "EMI_Amount": None,
        "Loan_Amount": None,
        "Agent_Convinced": "N/A",
        "Loan_Success_Probability": 0.0,
        "Intelligence_Summary": "",
    }


def _closest(value: Any, allowed: tuple[str, ...], fallback: str) -> str:
    """Map a model string to the closest canonical option (case/space-insensitive)."""
    if value is None:
        return fallback
    raw = str(value).strip()
    if not raw:
        return fallback
    low = raw.lower()
    for opt in allowed:
        if opt.lower() == low:
            return opt
    # loose containment match (e.g. "manager" -> "Manager/Supervisor", "home" -> "Home Loan")
    for opt in allowed:
        token = opt.split("/")[0].split(" ")[0].lower()
        if token and (token in low or low in opt.lower()):
            return opt
    return fallback


def _to_number(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).replace(",", "")
    match = re.search(r"\d+(?:\.\d+)?", text)
    if not match:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _clamp_probability(value: Any) -> float:
    num = _to_number(value)
    if num is None:
        return 0.0
    if 0 < num <= 1:  # model may emit a fraction
        num *= 100
    return round(max(0.0, min(100.0, num)), 1)


def _match_category(value: Any, categories: list[dict[str, Any]], fallback: str) -> str:
    """Map an LLM category string to an admin-defined category.

    Order: exact name -> closest name -> keyword containment -> fallback.
    """
    names = tuple(c["name"] for c in categories) or QUERY_CATEGORIES
    if value is None:
        return fallback
    raw = str(value).strip()
    if not raw:
        return fallback
    low = raw.lower()

    for name in names:  # exact (case-insensitive)
        if name.lower() == low:
            return name

    mapped = _closest(raw, names, "")  # fuzzy on names
    if mapped:
        return mapped

    for c in categories:  # keyword containment
        kws = [k.strip().lower() for k in str(c.get("keywords") or "").split(",") if k.strip()]
        for kw in kws:
            if kw and (kw in low or low in kw):
                return c["name"]
    return fallback


def _normalize(raw: dict[str, Any], categories: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out = default_intelligence()
    cats = categories or [{"name": n, "keywords": ""} for n in QUERY_CATEGORIES]
    names = tuple(c["name"] for c in cats)
    fallback = "Other/General Info" if "Other/General Info" in names else (names[-1] if names else "Other/General Info")

    out["Primary_Query_Type"] = _match_category(raw.get("Primary_Query_Type"), cats, fallback)

    secondary_raw = raw.get("Secondary_Query_Types")
    secondary: list[str] = []
    if isinstance(secondary_raw, str):
        secondary_raw = [s.strip() for s in re.split(r"[,;|]", secondary_raw) if s.strip()]
    if isinstance(secondary_raw, (list, tuple)):
        for item in secondary_raw:
            mapped = _match_category(item, cats, "")
            if mapped and mapped != out["Primary_Query_Type"] and mapped not in secondary:
                secondary.append(mapped)
    out["Secondary_Query_Types"] = secondary

    out["Escalation_Requested"] = _closest(raw.get("Escalation_Requested"), YES_NO, "No")
    out["Escalation_Actioned"] = _closest(raw.get("Escalation_Actioned"), YES_NO_NA, "N/A")
    out["Escalation_Category"] = _closest(
        raw.get("Escalation_Category"), ESCALATION_CATEGORIES, "None"
    )
    # Hard guard: escalation only exists when the customer actually requested a senior.
    # Prevents false positives where a routine feedback/CSAT/IVR transfer is read as an
    # escalation (agent-initiated transfers are NOT escalations).
    if out["Escalation_Requested"] != "Yes":
        out["Escalation_Actioned"] = "N/A"
        out["Escalation_Category"] = "None"

    out["CSAT_Transferred"] = _closest(raw.get("CSAT_Transferred"), YES_NO, "No")

    is_loan = _closest(raw.get("Is_Loan_Call"), YES_NO, "No")
    out["Loan_Is_Loan_Call"] = is_loan
    out["Loan_Type"] = _closest(raw.get("Loan_Type"), LOAN_TYPES, "None")
    out["Loan_Interest"] = _closest(raw.get("Customer_Interest"), INTEREST_LEVELS, "None")
    out["EMI_Affordability"] = _closest(
        raw.get("EMI_Affordability"), EMI_AFFORDABILITY, "Not Discussed"
    )
    out["EMI_Amount"] = _to_number(raw.get("EMI_Amount"))
    out["Loan_Amount"] = _to_number(raw.get("Loan_Amount"))
    out["Agent_Convinced"] = _closest(raw.get("Agent_Convinced"), AGENT_CONVINCED, "N/A")
    out["Loan_Success_Probability"] = _clamp_probability(raw.get("Success_Probability"))

    # If it's clearly not a loan call, force loan fields to neutral defaults.
    if is_loan == "No" and out["Loan_Type"] == "None":
        out["Loan_Interest"] = "None"
        out["Agent_Convinced"] = "N/A"
        out["Loan_Success_Probability"] = 0.0

    summary = raw.get("Intelligence_Summary")
    out["Intelligence_Summary"] = str(summary).strip()[:500] if summary else ""

    return out


def reconcile_lead_classification(scores: dict[str, Any]) -> dict[str, Any]:
    """Align scoring Lead_Classification with intelligence loan signals.

    Intelligence is the source of truth for whether a LOAN was discussed.
    Scoring LLM often false-positives on "credit card", "credit", rewards, etc.
    """
    is_loan = str(scores.get("Loan_Is_Loan_Call", "No")).strip().lower()
    if is_loan != "yes":
        scores["Lead_Classification"] = "Not a Lead"
        return scores

    interest = str(scores.get("Loan_Interest", "None")).strip().lower()
    prob = scores.get("Loan_Success_Probability")
    try:
        prob_val = float(prob) if prob is not None else 0.0
    except (TypeError, ValueError):
        prob_val = 0.0

    if interest == "high" or prob_val >= 70:
        scores["Lead_Classification"] = "Hot Lead"
    elif interest == "low" or (0 < prob_val < 40):
        scores["Lead_Classification"] = "Cold Lead"
    else:
        # medium interest, or loan discussed with moderate success probability
        scores["Lead_Classification"] = "Warm Lead"
    return scores


def _parse(raw_text: str, categories: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    from llm_utils import strip_llm_thinking

    cleaned = strip_llm_thinking(raw_text or "").strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in intelligence output")
    data = json.loads(cleaned[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("Intelligence JSON root must be an object")
    if isinstance(data.get("intelligence"), dict):
        data = {**data, **data["intelligence"]}
    return _normalize(data, categories)


def _truncate(transcript: str) -> str:
    if len(transcript) <= SCORING_MAX_TRANSCRIPT_CHARS:
        return transcript
    half = SCORING_MAX_TRANSCRIPT_CHARS // 2
    return transcript[:half] + "\n...[truncated]...\n" + transcript[-half:]


def _maybe_discover_category(transcript: str, cfg, categories) -> str | None:
    """When a call matches no existing category, ask the LLM to propose a genuine
    new one; validate + insert it. Returns the new category name or None."""
    if not QUERY_CATEGORY_AUTODISCOVER_ENABLED:
        return None
    try:
        prompt = category_discovery_prompt(_truncate(transcript), cfg, categories)
        raw = scoring_worker.ollama_generate(
            prompt,
            system="You classify banking calls. Return only strict JSON.",
            json_mode=True,
            temperature=0.0,
            max_tokens=400,
        )
        from llm_utils import strip_llm_thinking

        cleaned = strip_llm_thinking(raw or "").strip()
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end == -1:
            return None
        data = json.loads(cleaned[start : end + 1])
        if not isinstance(data, dict) or not data.get("needs_new_category"):
            return None
        name = str(data.get("name") or "").strip()
        if not name:
            return None
        return add_discovered_category(
            name,
            str(data.get("description") or "").strip(),
            str(data.get("keywords") or "").strip(),
            dedupe_similarity=QUERY_CATEGORY_DEDUPE_SIMILARITY,
            max_auto=QUERY_CATEGORY_AUTODISCOVER_MAX,
        )
    except Exception as exc:  # noqa: BLE001
        logger.info("Query auto-discovery skipped: %s", exc)
        return None


def _keyword_candidates(
    transcript: str, categories: list[dict[str, Any]] | None
) -> list[dict[str, Any]]:
    """Categories whose admin keywords literally appear in the transcript."""
    if not categories:
        return []
    low = (transcript or "").lower()
    hits = []
    for c in categories:
        kws = [k.strip().lower() for k in str(c.get("keywords") or "").split(",") if k.strip()]
        if any(kw in low for kw in kws):
            hits.append(c)
    return hits


def _verify_primary_category(
    transcript: str, cfg, parsed: dict[str, Any], categories: list[dict[str, Any]] | None
) -> None:
    """Second LLM pass: re-check Primary_Query_Type against the categories whose
    keywords actually occur in the call. Mutates `parsed` in place; never raises.

    Only runs when the transcript's keywords point at MORE than one category
    (i.e. real ambiguity, like balance vs mini statement) — cheap on clear calls.
    """
    if not INTELLIGENCE_VERIFY_ENABLED or not categories:
        return
    try:
        chosen = parsed.get("Primary_Query_Type") or ""
        candidates = _keyword_candidates(transcript, categories)
        names = {c["name"] for c in candidates}
        if chosen and chosen not in names:
            chosen_cat = next((c for c in categories if c["name"] == chosen), None)
            if chosen_cat:
                candidates.append(chosen_cat)
                names.add(chosen)
        if len(names) < 2:
            return  # nothing to disambiguate

        prompt = category_verify_prompt(_truncate(transcript), cfg, chosen, candidates)
        raw = scoring_worker.ollama_generate(
            prompt,
            system="You audit banking call classifications. Return only strict JSON.",
            json_mode=True,
            temperature=0.0,
            max_tokens=300,
        )
        from llm_utils import strip_llm_thinking

        cleaned = strip_llm_thinking(raw or "").strip()
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end == -1:
            return
        data = json.loads(cleaned[start : end + 1])
        best = _match_category(data.get("best_category"), candidates, "")
        if best and best != chosen:
            logger.info(
                "Query type verify: %r -> %r (evidence: %s)",
                chosen, best, str(data.get("evidence") or "")[:120],
            )
            secondary = [s for s in parsed.get("Secondary_Query_Types", []) if s != best]
            if chosen and chosen not in secondary:
                secondary.insert(0, chosen)  # demote the first-pass pick
            parsed["Secondary_Query_Types"] = secondary
            parsed["Primary_Query_Type"] = best
    except Exception as exc:  # noqa: BLE001
        logger.info("Query type verification skipped: %s", exc)


def extract_intelligence(transcript: str, language: str = "English") -> dict[str, Any]:
    """Return normalized intelligence fields; never raises."""
    if not INTELLIGENCE_ENABLED or not (transcript or "").strip():
        return default_intelligence()
    try:
        cfg = get_bank_config()
        try:
            categories = get_query_categories()
        except Exception:
            categories = None
        system = intelligence_system_prompt(cfg)
        prompt = intelligence_json_prompt(_truncate(transcript), cfg, categories)
        raw = scoring_worker.ollama_generate(
            prompt, system=system, json_mode=True, temperature=0.0, max_tokens=1024
        )
        parsed = _parse(raw, categories)

        # Second-pass audit against keyword-candidate categories (balance vs
        # mini-statement style mixups) before any auto-discovery.
        _verify_primary_category(transcript, cfg, parsed, categories)

        # No existing category matched → try to discover a genuine new one and,
        # if added, re-tag this call with it so the taxonomy grows automatically.
        if parsed.get("Primary_Query_Type") == fallback_name():
            new_name = _maybe_discover_category(transcript, cfg, categories)
            if new_name:
                parsed["Primary_Query_Type"] = new_name
        return parsed
    except Exception:
        return default_intelligence()


def intelligence_health() -> dict[str, Any]:
    try:
        n = len(get_query_categories())
    except Exception:
        n = len(QUERY_CATEGORIES)
    return {
        "enabled": INTELLIGENCE_ENABLED,
        "categories": n,
    }
