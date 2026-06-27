"""
Phase 2b — call scoring via Ollama (local CPU).
Parses legacy rubric format used by ResultPage / Consolidated_Audio_Analysis.
"""

from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from bank_config import get_bank_config
from config import (
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_SEC,
    OLLAMA_VERIFICATION_MODEL,
    SCORING_CONFIDENCE_THRESHOLD,
    SCORING_ENABLED,
    SCORING_MAX_TRANSCRIPT_CHARS,
    SCORING_VERIFICATION_ENABLED,
)
from prompts.scoring import scoring_json_prompt, scoring_line_prompt, scoring_system_prompt

LINE_RE = re.compile(
    r"^\s*([\d.]+)\s*-\s*([\d.]+)\s*\((Agent|Customer)\)\s*:\s*(.+)$",
    re.MULTILINE,
)

SCORE_PATTERN = re.compile(
    r"(Opening Speech|Empathy|Query Handling|Adherence to Protocol|"
    r"Resolution Assurance|Query Resolution|Polite Tone|"
    r"Authentication & Verification|Escalation Handling|Closing Speech):\s*(\d+)"
)
NA_PATTERN = re.compile(
    r"(Authentication\s*&?\s*Verification|Escalation\s+Handling)\s*:\s*N\.?/?A\.?",
    re.I,
)
RUDE_PATTERN = re.compile(r"Rude Behavior:\s*(Yes|No)", re.I)
OVERALL_PATTERN = re.compile(r"Overall\s+Scoring:\s*(\d+)", re.I)
CALL_TYPE_PATTERN = re.compile(
    r"Call\s+Type:\s+(Complaint|Inquiry|Transaction Issue|Service Request|Sales|Other)",
    re.I,
)
LEAD_PATTERN = re.compile(
    r"Lead\s+Classification:\s+(Hot Lead|Cold Lead|Warm Lead|Not a Lead)",
    re.I,
)
RESOLUTION_PATTERN = re.compile(
    r"Resolution\s+Status:\s+(Resolved|Pending|Escalated|Unresolved)",
    re.I,
)
FEEDBACK_PATTERN = re.compile(r"Feedback:\s*(.+)", re.I)
SUMMARY_PATTERN = re.compile(r"Summary:\s*(.+)", re.I)

_RE_OPEN_GREETING = re.compile(
    r"\b(welcome|namaste|namaskar|good\s+(?:morning|afternoon|evening|day)|"
    r"hello|hi\b|thank\s+you\s+for\s+calling)\b",
    re.I,
)
_RE_OPEN_ORG = re.compile(r"\b(welcome\s+to\b|\bbank\b)", re.I)
_RE_OPEN_NAME = re.compile(r"\b(my name is|i am|i'?m|this is|mera naam)\b", re.I)
_RE_OPEN_HELP = re.compile(
    r"\b(how may i|how can i|may i help|can i help|assist you|help you|sahayata)\b",
    re.I,
)
_RE_CLOSE_THANKS = re.compile(r"\b(thank you|thanks|thankyou|dhanyavad|dhanyavaad|shukriya)\b", re.I)
_RE_CLOSE_WRAP = re.compile(
    r"\b(anything else|further assistance|nice day|good day|great day|"
    r"have a (?:nice|good|great) day|thank you for calling|calling .{0,40} bank)\b",
    re.I,
)

POSITIVE_WORDS = (
    "thank", "thanks", "appreciate", "glad", "happy", "great", "resolved",
    "welcome", "pleased", "excellent", "good", "dhanyavad", "shukriya",
)
NEGATIVE_WORDS = (
    "angry", "frustrat", "upset", "complaint", "problem", "issue", "bad",
    "terrible", "unacceptable", "delay", "waiting", "sorry", "naraz",
)


@dataclass
class ScoringResult:
    raw_text: str
    scores: dict[str, Any]
    summary: str
    sentiment: list[dict[str, Any]]
    script_compliance: str
    tone_analysis: dict[str, Any]


def scoring_enabled() -> bool:
    return SCORING_ENABLED


def ollama_generate(
    prompt: str,
    system: str | None = None,
    *,
    json_mode: bool = False,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> str:
    payload: dict[str, Any] = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "options": {
            "temperature": 0.12 if temperature is None else temperature,
            "top_p": 0.9,
            "top_k": 40,
            "repeat_penalty": 1.15,
            "num_predict": max_tokens or 4096,
        },
    }
    if system:
        payload["system"] = system
    if json_mode:
        payload["format"] = "json"

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{OLLAMA_BASE_URL.rstrip('/')}/api/generate",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=OLLAMA_TIMEOUT_SEC) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                return (body.get("response") or "").strip()
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            last_error = RuntimeError(f"Ollama HTTP {exc.code}: {body[:300]}")
            if exc.code == 500 and "memory" in body.lower() and attempt < 2:
                time.sleep(4 * (attempt + 1))
                continue
            raise last_error from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"Ollama request failed: {exc}") from exc

    if last_error:
        raise last_error
    raise RuntimeError("Ollama request failed")


def ollama_health() -> dict[str, Any]:
    if not SCORING_ENABLED:
        return {"enabled": False, "ready": False, "model": OLLAMA_MODEL}
    try:
        req = urllib.request.Request(
            f"{OLLAMA_BASE_URL.rstrip('/')}/api/tags",
            method="GET",
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            tags = json.loads(resp.read().decode("utf-8"))
        models = [m.get("name", "") for m in tags.get("models", [])]
        model_base = OLLAMA_MODEL.split(":")[0]
        ready = any(
            m == OLLAMA_MODEL or m.startswith(f"{model_base}:")
            for m in models
        )
        return {
            "enabled": True,
            "ready": ready,
            "model": OLLAMA_MODEL,
            "available_models": models[:8],
        }
    except Exception as exc:
        return {
            "enabled": True,
            "ready": False,
            "model": OLLAMA_MODEL,
            "error": str(exc)[:200],
        }


RUBRIC_KEYS = (
    "Opening_Speech",
    "Empathy",
    "Query_Handling",
    "Adherence_to_Protocol",
    "Resolution_Assurance",
    "Query_Resolution",
    "Polite_Tone",
    "Authentication_Verification",
    "Escalation_Handling",
    "Closing_Speech",
)

# Only these dimensions may be marked N/A (when they genuinely did not apply).
NA_ELIGIBLE_KEYS = frozenset({"Authentication_Verification", "Escalation_Handling"})

_NA_TOKENS = frozenset({"N/A", "NA", "N.A.", "N.A", "NOT APPLICABLE", "NONE"})


def _is_na_value(value: Any) -> bool:
    return isinstance(value, str) and value.strip().upper() in _NA_TOKENS


def _normalize_na_list(raw: Any) -> set[str]:
    """Map a model-supplied NA_Dimensions list to canonical RUBRIC keys."""
    items: list[Any]
    if isinstance(raw, str):
        items = [raw]
    elif isinstance(raw, (list, tuple)):
        items = list(raw)
    else:
        return set()
    out: set[str] = set()
    for item in items:
        norm = (
            str(item).strip()
            .replace(" & ", "_").replace(" ", "_").replace("&", "").replace("__", "_")
        )
        for rk in RUBRIC_KEYS:
            if rk.lower() == norm.lower():
                out.add(rk)
                break
    return out & NA_ELIGIBLE_KEYS


def _resolve_na_dimensions(extracted: dict[str, Any], na_keys: set[str]) -> dict[str, Any]:
    """Give N/A dimensions a NEUTRAL value (the average of the dimensions that DID
    apply) so they neither reward nor penalise on the radar, and base Overall on the
    applicable dimensions only. Keeps every dimension numeric for the DB/chart."""
    na_keys = {k for k in na_keys if k in NA_ELIGIBLE_KEYS}
    applicable = [
        float(extracted[k])
        for k in RUBRIC_KEYS
        if k not in na_keys and isinstance(extracted.get(k), (int, float))
    ]
    avg = round(sum(applicable) / len(applicable), 1) if applicable else 50.0
    for k in na_keys:
        extracted[k] = avg
    if na_keys:
        extracted["NA_Dimensions"] = sorted(na_keys)
    if applicable and not isinstance(extracted.get("Overall_Scoring"), (int, float)):
        extracted["Overall_Scoring"] = avg
    return extracted


def _strip_think_blocks(text: str) -> str:
    from llm_utils import strip_llm_thinking
    return strip_llm_thinking(text)


def _clean_scoring_text(text: str) -> str:
    cleaned = _strip_think_blocks(text)
    cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", cleaned)
    cleaned = re.sub(r"^#+\s*", "", cleaned, flags=re.MULTILINE)
    return cleaned.strip()


def _normalize_rubric_scores(extracted: dict[str, Any]) -> dict[str, Any]:
    """Convert per-dimension 0-10 rubric scores to 0-100 for UI/charts."""
    for key in RUBRIC_KEYS:
        val = extracted.get(key)
        if isinstance(val, (int, float)) and val <= 10:
            extracted[key] = round(float(val) * 10, 1)
    overall = extracted.get("Overall_Scoring")
    if isinstance(overall, (int, float)) and overall <= 10:
        extracted["Overall_Scoring"] = round(float(overall) * 10, 1)
    return extracted


def parse_json_scores(text: str) -> dict[str, Any]:
    cleaned = _clean_scoring_text(text).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("No JSON object in model output")
    data = json.loads(cleaned[start : end + 1])
    if not isinstance(data, dict):
        raise ValueError("JSON root must be an object")
    if isinstance(data.get("scores"), dict):
        data = {**data, **data["scores"]}

    key_aliases = {
        "Opening Speech": "Opening_Speech",
        "Query Handling": "Query_Handling",
        "Adherence to Protocol": "Adherence_to_Protocol",
        "Resolution Assurance": "Resolution_Assurance",
        "Query Resolution": "Query_Resolution",
        "Polite Tone": "Polite_Tone",
        "Authentication & Verification": "Authentication_Verification",
        "Authentication Verification": "Authentication_Verification",
        "Escalation Handling": "Escalation_Handling",
        "Closing Speech": "Closing_Speech",
        "Rude Behavior": "Rude_Behavior",
        "Overall Scoring": "Overall_Scoring",
        "Call Type": "Call_Type",
        "Lead Classification": "Lead_Classification",
        "Resolution Status": "Resolution_Status",
    }
    extracted: dict[str, Any] = {}
    na_keys: set[str] = set()
    for raw_key, value in data.items():
        key = key_aliases.get(raw_key, raw_key.replace(" ", "_").replace("&", "").replace("__", "_"))
        if value is None or value == "":
            continue
        if key in ("Evidence", "NA_Dimensions"):
            extracted[key] = value
            continue
        if key in RUBRIC_KEYS or key == "Overall_Scoring":
            if _is_na_value(value):
                if key in NA_ELIGIBLE_KEYS:
                    na_keys.add(key)
                continue
            try:
                extracted[key] = float(value)
            except (TypeError, ValueError):
                continue
        else:
            extracted[key] = str(value).strip()

    na_keys |= _normalize_na_list(extracted.get("NA_Dimensions"))

    extracted = _normalize_rubric_scores(extracted)
    extracted = _resolve_na_dimensions(extracted, na_keys)

    if "Overall_Scoring" not in extracted:
        numeric = [extracted[k] for k in RUBRIC_KEYS if isinstance(extracted.get(k), (int, float))]
        if numeric:
            avg = sum(numeric) / len(numeric)
            extracted["Overall_Scoring"] = round(avg if avg > 10 else avg * 10, 1)

    return extracted


def parse_llama_scores(text: str) -> dict[str, Any]:
    text = _clean_scoring_text(text)
    extracted: dict[str, Any] = {}
    na_keys: set[str] = set()
    for line in text.splitlines():
        line_stripped = line.strip()
        if not line_stripped:
            continue

        na_match = NA_PATTERN.search(line_stripped)
        if na_match:
            raw = na_match.group(1)
            key = (
                raw.replace(" & ", "_").replace(" ", "_").replace("&", "").replace("__", "_")
            )
            for rk in NA_ELIGIBLE_KEYS:
                if rk.lower() == key.lower():
                    na_keys.add(rk)
            continue

        score_match = SCORE_PATTERN.search(line_stripped)
        if score_match:
            criterion, score = score_match.groups()
            key = (
                criterion.replace(" & ", "_")
                .replace(" ", "_")
                .replace("&", "")
                .replace("__", "_")
            )
            extracted[key] = float(score)

        rude_match = RUDE_PATTERN.search(line_stripped)
        if rude_match:
            extracted["Rude_Behavior"] = rude_match.group(1).capitalize()

        overall_match = OVERALL_PATTERN.search(line_stripped)
        if overall_match:
            extracted["Overall_Scoring"] = float(overall_match.group(1))

        call_type_match = CALL_TYPE_PATTERN.search(line_stripped)
        if call_type_match:
            extracted["Call_Type"] = call_type_match.group(1)

        lead_match = LEAD_PATTERN.search(line_stripped)
        if lead_match:
            extracted["Lead_Classification"] = lead_match.group(1)

        resolution_match = RESOLUTION_PATTERN.search(line_stripped)
        if resolution_match:
            extracted["Resolution_Status"] = resolution_match.group(1)

        feedback_match = FEEDBACK_PATTERN.search(line_stripped)
        if feedback_match:
            extracted["Feedback"] = feedback_match.group(1).strip()

        summary_match = SUMMARY_PATTERN.search(line_stripped)
        if summary_match:
            extracted["Summary"] = summary_match.group(1).strip()

    if "Summary" not in extracted:
        for line in reversed(text.splitlines()):
            lower = line.strip().lower()
            if lower.startswith("summary:"):
                extracted["Summary"] = line.split(":", 1)[1].strip()
                break

    extracted = _normalize_rubric_scores(extracted)
    extracted = _resolve_na_dimensions(extracted, na_keys)

    if "Overall_Scoring" not in extracted:
        numeric = [
            extracted[k]
            for k in RUBRIC_KEYS
            if isinstance(extracted.get(k), (int, float))
        ]
        if numeric:
            avg = sum(numeric) / len(numeric)
            extracted["Overall_Scoring"] = round(avg if avg > 10 else avg * 10, 1)

    return extracted


def _polarity_for_text(text: str) -> float:
    lower = text.lower()
    pos = sum(1 for w in POSITIVE_WORDS if w in lower)
    neg = sum(1 for w in NEGATIVE_WORDS if w in lower)
    if pos > neg:
        return min(0.35 + pos * 0.15, 0.95)
    if neg > pos:
        return max(-0.35 - neg * 0.15, -0.95)
    return 0.0


def build_sentiment_from_transcript(transcript: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for match in LINE_RE.finditer(transcript):
        start, end, role, text = match.groups()
        entries.append(
            {
                "Role": role,
                "Start": float(start),
                "End": float(end),
                "Text": text.strip(),
                "Sentiment Polarity": _polarity_for_text(text),
            }
        )
    return entries


def _tone_bucket(polarity: float) -> dict[str, float]:
    if polarity > 0.25:
        return {"High": 0.7, "Medium": 0.2, "Low": 0.1}
    if polarity < -0.25:
        return {"High": 0.1, "Medium": 0.2, "Low": 0.7}
    return {"High": 0.2, "Medium": 0.6, "Low": 0.2}


def build_tone_from_transcript(
    transcript: str, sentiment: list[dict[str, Any]]
) -> dict[str, Any]:
    results: dict[str, dict[str, Any]] = {"Agent": {}, "Customer": {}}
    for idx, entry in enumerate(sentiment):
        role = entry.get("Role", "Agent")
        if role not in results:
            results[role] = {}
        polarity = float(entry.get("Sentiment Polarity", 0))
        start = entry.get("Start", idx)
        end = entry.get("End", start + 1)
        key = f"{start:.2f} - {end:.2f}"
        results[role][key] = {
            "start": start,
            "end": end,
            "tone_distribution": _tone_bucket(polarity),
        }

    agent_polarities = [
        float(e["Sentiment Polarity"])
        for e in sentiment
        if e.get("Role") == "Agent"
    ]
    cust_polarities = [
        float(e["Sentiment Polarity"])
        for e in sentiment
        if e.get("Role") == "Customer"
    ]

    def overall_label(values: list[float]) -> str:
        if not values:
            return "Neutral"
        avg = sum(values) / len(values)
        if avg > 0.25:
            return "Positive"
        if avg < -0.25:
            return "Negative"
        return "Neutral"

    return {
        "status": "success",
        "results": {
            **results,
            "Overall_Tone": {
                "Agent": overall_label(agent_polarities),
                "Customer": overall_label(cust_polarities),
            },
        },
    }


BANKING_SCRIPT_CHECKS = (
    ("greeting", ("hello", "good morning", "good afternoon", "namaste", "welcome")),
    ("verification", ("verify", "confirm", "account", "authentication", "otp", "pin")),
    ("empathy", ("understand", "sorry", "apologize", "help", "assist")),
    ("resolution", ("resolve", "solution", "processed", "completed", "done")),
    ("closing", ("thank", "anything else", "nice day", "further assistance")),
)


def compute_script_compliance_keyword(transcript: str) -> str:
    lower = transcript.lower()
    matched = sum(
        1 for _name, keywords in BANKING_SCRIPT_CHECKS if any(k in lower for k in keywords)
    )
    score = round((matched / len(BANKING_SCRIPT_CHECKS)) * 100, 2)
    return f"{score:.2f}"


def _truncate_transcript(transcript: str) -> str:
    if len(transcript) <= SCORING_MAX_TRANSCRIPT_CHARS:
        return transcript
    half = SCORING_MAX_TRANSCRIPT_CHARS // 2
    return (
        transcript[:half]
        + "\n...[transcript truncated for scoring]...\n"
        + transcript[-half:]
    )


def _sanity_check_scores(scores: dict[str, Any]) -> dict[str, Any]:
    """Validate and fix score bounds/consistency."""
    for key in RUBRIC_KEYS:
        val = scores.get(key)
        if isinstance(val, (int, float)):
            scores[key] = max(0.0, min(100.0, float(val)))
        elif val is not None:
            try:
                scores[key] = max(0.0, min(100.0, float(val)))
            except (TypeError, ValueError):
                scores[key] = 50.0

    overall = scores.get("Overall_Scoring")
    if isinstance(overall, (int, float)):
        scores["Overall_Scoring"] = max(0.0, min(100.0, float(overall)))

    numeric_dims = [scores[k] for k in RUBRIC_KEYS if isinstance(scores.get(k), (int, float))]
    if numeric_dims and "Overall_Scoring" in scores:
        avg_dims = sum(numeric_dims) / len(numeric_dims)
        overall_val = float(scores["Overall_Scoring"])
        if abs(overall_val - avg_dims) > 35:
            scores["Overall_Scoring"] = round((overall_val + avg_dims) / 2, 1)

    all_same = len(set(int(v) for v in numeric_dims if isinstance(v, (int, float)))) <= 1
    if all_same and len(numeric_dims) >= 5 and numeric_dims[0] == 0:
        scores["_low_confidence"] = True

    rude = scores.get("Rude_Behavior", "No")
    if str(rude).strip().lower() not in ("yes", "no"):
        scores["Rude_Behavior"] = "No"

    valid_call_types = {"Complaint", "Inquiry", "Transaction Issue", "Service Request", "Sales", "Other"}
    if scores.get("Call_Type") not in valid_call_types:
        scores["Call_Type"] = "Other"

    valid_leads = {"Hot Lead", "Cold Lead", "Warm Lead", "Not a Lead"}
    if scores.get("Lead_Classification") not in valid_leads:
        scores["Lead_Classification"] = "Not a Lead"

    valid_resolutions = {"Resolved", "Pending", "Escalated", "Unresolved"}
    if scores.get("Resolution_Status") not in valid_resolutions:
        scores["Resolution_Status"] = "Pending"

    return scores


def _agent_utterances(transcript: str) -> list[str]:
    return [
        m.group(4).strip().lower()
        for m in LINE_RE.finditer(transcript)
        if m.group(3) == "Agent" and m.group(4).strip()
    ]


def _opening_speech_floor(transcript: str) -> float | None:
    """Minimum Opening_Speech (0-100) when branded greeting checklist is clearly met."""
    agent = _agent_utterances(transcript)
    if not agent:
        return None
    opening = " ".join(agent[:2])
    checks = (
        bool(_RE_OPEN_GREETING.search(opening)),
        bool(_RE_OPEN_ORG.search(opening)),
        bool(_RE_OPEN_NAME.search(opening)),
        bool(_RE_OPEN_HELP.search(opening)),
    )
    hits = sum(checks)
    if hits >= 4:
        return 90.0
    if hits == 3:
        return 85.0
    return None


def _closing_speech_floor(transcript: str) -> float | None:
    """Minimum Closing_Speech (0-100) when thank-you + wrap-up are present."""
    agent = _agent_utterances(transcript)
    if not agent:
        return None
    closing = " ".join(agent[-2:])
    has_thanks = bool(_RE_CLOSE_THANKS.search(closing))
    has_wrap = bool(_RE_CLOSE_WRAP.search(closing))
    if has_thanks and has_wrap:
        return 90.0
    if has_thanks or has_wrap:
        return 85.0
    return None


def _apply_script_floors(transcript: str, scores: dict[str, Any]) -> dict[str, Any]:
    """Correct systematic LLM under-scoring on opening/closing when checklist is met."""
    floors = {
        "Opening_Speech": _opening_speech_floor(transcript),
        "Closing_Speech": _closing_speech_floor(transcript),
    }
    bumped = False
    for key, floor in floors.items():
        if floor is None:
            continue
        cur = scores.get(key)
        if isinstance(cur, (int, float)) and float(cur) < floor:
            scores[key] = floor
            bumped = True
    if bumped:
        numeric = [scores[k] for k in RUBRIC_KEYS if isinstance(scores.get(k), (int, float))]
        if numeric:
            avg = sum(numeric) / len(numeric)
            overall = scores.get("Overall_Scoring")
            if isinstance(overall, (int, float)) and float(overall) < avg:
                scores["Overall_Scoring"] = round(avg, 1)
            elif not isinstance(overall, (int, float)):
                scores["Overall_Scoring"] = round(avg, 1)
    return scores


def _verification_pass(transcript_trimmed: str, initial_scores: dict[str, Any]) -> dict[str, Any]:
    """Second-pass verification: re-check scores that look suspect."""
    suspect_dims = []
    for key in RUBRIC_KEYS:
        val = initial_scores.get(key)
        if isinstance(val, (int, float)) and (val <= 10 or val >= 95):
            suspect_dims.append(key)

    if initial_scores.get("_low_confidence"):
        suspect_dims = list(RUBRIC_KEYS)

    if not suspect_dims:
        return initial_scores

    dims_list = ", ".join(suspect_dims)
    verification_model = OLLAMA_VERIFICATION_MODEL or OLLAMA_MODEL

    system = (
        "You are a senior QA reviewer verifying scoring accuracy. "
        "Re-evaluate ONLY the listed dimensions. Return corrected scores as JSON. "
        "Be evidence-based: cite what the agent said/did for each score."
    )
    prompt = f"""A junior auditor scored this call. Please verify these dimensions that look unusual: {dims_list}

Their scores were: {json.dumps({k: initial_scores.get(k) for k in suspect_dims})}

Rules:
- Each dimension: 0-100. REWARD professional work generously: correct, professional handling = 90-100,
  small gap = 70-85, partial/weak = 50-65, poor = 30-45, missing/wrong = 0-20.
- A rude or uncooperative CUSTOMER must NEVER lower the agent's score. An agent who stays polite and
  helpful under pressure should score HIGH (90-100), not low.
- Giving the correct, complete answer/steps to the customer's request = high Query Resolution, even
  if the customer does not explicitly confirm success.
- Return ONLY a JSON object with the corrected scores for these dimensions.
- If the original score was correct, return the same value. Base your assessment on the transcript.

Transcript:
{transcript_trimmed}
"""

    try:
        old_model = None
        if verification_model != OLLAMA_MODEL:
            import config as cfg
            old_model = cfg.OLLAMA_MODEL
            cfg.OLLAMA_MODEL = verification_model

        raw = ollama_generate(prompt, system=system, json_mode=True, temperature=0.0)

        if old_model:
            import config as cfg
            cfg.OLLAMA_MODEL = old_model

        cleaned = _clean_scoring_text(raw)
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start != -1 and end != -1:
            corrections = json.loads(cleaned[start:end + 1])
            for key, val in corrections.items():
                norm_key = key.replace(" ", "_").replace("&", "").replace("__", "_")
                if norm_key in RUBRIC_KEYS:
                    try:
                        new_val = float(val)
                        old_val = float(initial_scores.get(norm_key, 50))
                        initial_scores[norm_key] = round((old_val + new_val) / 2, 1)
                    except (TypeError, ValueError):
                        pass
    except Exception:
        pass

    initial_scores.pop("_low_confidence", None)
    return initial_scores


def score_call(transcript: str, language: str = "English") -> ScoringResult:
    if not SCORING_ENABLED:
        raise RuntimeError("Scoring is disabled (SCORING_ENABLED=false)")

    trimmed = _truncate_transcript(transcript)
    bank_cfg = get_bank_config()
    system = scoring_system_prompt(bank_cfg)
    json_prompt = scoring_json_prompt(trimmed, bank_cfg)
    line_prompt = scoring_line_prompt(trimmed, bank_cfg)

    raw_text = ""
    scores: dict[str, Any] = {}
    try:
        raw_text = ollama_generate(json_prompt, system=system, json_mode=True, temperature=0.0)
        scores = parse_json_scores(raw_text)
    except Exception:
        raw_text = ollama_generate(line_prompt, system=system, temperature=0.0)
        scores = parse_llama_scores(raw_text)

    scores = _sanity_check_scores(scores)

    if SCORING_VERIFICATION_ENABLED and (
        scores.get("_low_confidence")
        or any(
            isinstance(scores.get(k), (int, float)) and scores[k] <= 10
            for k in RUBRIC_KEYS
        )
    ):
        scores = _verification_pass(trimmed, scores)
        scores = _sanity_check_scores(scores)

    scores = _apply_script_floors(trimmed, scores)
    scores = _sanity_check_scores(scores)

    if not scores.get("Feedback"):
        scores["Feedback"] = (
            "Review agent greeting, identity verification, empathy during the issue, "
            "and professional closing for improvement opportunities."
        )
    elif len(str(scores["Feedback"])) < 20:
        scores["Feedback"] = (
            f"{scores['Feedback']} — add more specific examples from this call."
        )
    summary = scores.get("Summary", "Summary not generated.")

    return ScoringResult(
        raw_text=raw_text,
        scores=scores,
        summary=summary,
        sentiment=[],
        script_compliance="0.00",
        tone_analysis={"status": "pending", "results": {}},
    )
