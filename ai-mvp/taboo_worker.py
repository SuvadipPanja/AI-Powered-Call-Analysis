"""
Taboo / prohibited phrase detection with timestamp, role, and scoring impact.
Configured via BankSettings (Admin → Bank Config).
"""

from __future__ import annotations

import re
from typing import Any

from bank_config import get_bank_config
from transcript_utils import parse_transcript

SEVERITY_PENALTY = {
    "low": {"overall": 5, "polite_tone": 1, "protocol": 2},
    "medium": {"overall": 10, "polite_tone": 3, "protocol": 5},
    "high": {"overall": 20, "polite_tone": 5, "protocol": 10},
}


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower()).strip()


def _word_matches(utterance: str, taboo_word: str) -> bool:
    u = _normalize(utterance)
    w = _normalize(taboo_word)
    if not w or not u:
        return False
    if w in u:
        return True
    # Word-boundary match for Latin tokens
    if re.search(r"[a-z0-9]", w):
        return bool(re.search(rf"\b{re.escape(w)}\b", u))
    return w in u


def _lang_matches(configured: str, call_language: str) -> bool:
    cfg = (configured or "Any").strip().lower()
    if cfg in ("any", "all", ""):
        return True
    call = (call_language or "").strip().lower()
    if cfg == call:
        return True
    if cfg == "hinglish" and call in ("hindi", "hinglish", "english"):
        return True
    if cfg == "hindi" and call in ("hindi", "hinglish"):
        return True
    return False


def _applies_to_role(applies_to: str, role: str) -> bool:
    target = (applies_to or "agent").strip().lower()
    r = (role or "").strip().lower()
    if target in ("both", "all"):
        return True
    if target == "agent":
        return r == "agent"
    if target == "customer":
        return r == "customer"
    return True


def analyze_taboo(
    original_transcript: str,
    english_transcript: str,
    call_language: str = "Hindi",
) -> dict[str, Any]:
    config = get_bank_config()
    taboo_list = config.taboo_words or []
    if not taboo_list:
        return {
            "enabled": True,
            "hits": [],
            "agent_violations": 0,
            "customer_mentions": 0,
            "total_penalty": 0,
            "summary": "No taboo words configured.",
        }

    hits: list[dict[str, Any]] = []
    for utt in parse_transcript(original_transcript):
        for entry in taboo_list:
            word = entry.get("word") or entry.get("term") or ""
            if not word:
                continue
            if not _lang_matches(entry.get("language", "Any"), call_language):
                continue
            if not _applies_to_role(entry.get("appliesTo", "agent"), utt.role):
                continue
            if not _word_matches(utt.text, word):
                continue
            sev = str(entry.get("severity", "medium")).lower()
            penalty = SEVERITY_PENALTY.get(sev, SEVERITY_PENALTY["medium"])
            hits.append({
                "word": word,
                "matched_in": utt.text[:200],
                "role": utt.role,
                "start": utt.start,
                "end": utt.end,
                "severity": sev,
                "category": entry.get("category", "policy"),
                "language": entry.get("language", "Any"),
                "transcript": "original",
                "score_impact": {
                    "Overall_Scoring": -penalty["overall"],
                    "Polite_Tone": -penalty["polite_tone"],
                    "Adherence_to_Protocol": -penalty["protocol"],
                },
            })

    # Also scan English translation for Latin taboo / compliance phrases
    for utt in parse_transcript(english_transcript):
        for entry in taboo_list:
            word = entry.get("word") or ""
            lang = (entry.get("language") or "Any").lower()
            if lang not in ("english", "any", "hinglish", ""):
                continue
            if not _applies_to_role(entry.get("appliesTo", "agent"), utt.role):
                continue
            if not _word_matches(utt.text, word):
                continue
            if any(h["start"] == utt.start and h["role"] == utt.role and h["word"] == word for h in hits):
                continue
            sev = str(entry.get("severity", "medium")).lower()
            penalty = SEVERITY_PENALTY.get(sev, SEVERITY_PENALTY["medium"])
            hits.append({
                "word": word,
                "matched_in": utt.text[:200],
                "role": utt.role,
                "start": utt.start,
                "end": utt.end,
                "severity": sev,
                "category": entry.get("category", "policy"),
                "language": "English",
                "transcript": "english",
                "score_impact": {
                    "Overall_Scoring": -penalty["overall"],
                    "Polite_Tone": -penalty["polite_tone"],
                    "Adherence_to_Protocol": -penalty["protocol"],
                },
            })

    agent_violations = sum(1 for h in hits if h["role"] == "Agent")
    customer_mentions = sum(1 for h in hits if h["role"] == "Customer")
    total_penalty = sum(abs(h["score_impact"]["Overall_Scoring"]) for h in hits if h["role"] == "Agent")

    if not hits:
        summary = "No taboo or prohibited phrases detected."
    else:
        summary = (
            f"Detected {len(hits)} policy phrase(s): "
            f"{agent_violations} agent, {customer_mentions} customer. "
            f"Score impact: -{total_penalty} overall (agent violations)."
        )

    return {
        "enabled": True,
        "hits": hits,
        "agent_violations": agent_violations,
        "customer_mentions": customer_mentions,
        "total_penalty": total_penalty,
        "summary": summary,
    }


def apply_taboo_to_scores(scores: dict[str, Any], taboo: dict[str, Any]) -> dict[str, Any]:
    if not scores or not taboo.get("hits"):
        return scores
    out = dict(scores)
    agent_hits = [h for h in taboo["hits"] if h.get("role") == "Agent"]
    if not agent_hits:
        return out

    for key in (
        "Overall_Scoring", "Polite_Tone", "Adherence_to_Protocol",
        "Opening_Speech", "Closing_Speech",
    ):
        val = out.get(key)
        if not isinstance(val, (int, float)):
            continue
        penalty = sum(abs(h["score_impact"].get(key, 0)) for h in agent_hits)
        if penalty:
            out[key] = max(0, min(100 if key == "Overall_Scoring" else 10, val - penalty))

    if agent_hits:
        high_rude = any(
            h.get("category") == "rude" and h.get("severity") in ("high", "medium")
            for h in agent_hits
        )
        if high_rude:
            out["Rude_Behavior"] = "Yes"
        compliance_hit = any(h.get("category") == "compliance" for h in agent_hits)
        if compliance_hit:
            fb = str(out.get("Feedback", ""))
            if "taboo" not in fb.lower() and "prohibited" not in fb.lower():
                words = ", ".join({h["word"] for h in agent_hits[:3]})
                out["Feedback"] = (
                    f"{fb} Agent used prohibited phrase(s): {words} — review required."
                ).strip()

    return out


def merge_taboo_into_tone(tone_analysis: dict[str, Any], taboo: dict[str, Any]) -> dict[str, Any]:
    base = dict(tone_analysis or {})
    base["taboo_analysis"] = taboo
    return base
