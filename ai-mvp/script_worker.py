"""
Phase 2c — script compliance via sentence-transformers cosine similarity.
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from bank_config import get_bank_config
from config import SCRIPT_COMPLIANCE_ENABLED, SCRIPT_MODEL_LOCAL, SCRIPT_MODEL_NAME
from transcript_utils import agent_lines

_model = None
_model_error: Optional[str] = None


def _cosine(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _get_model():
    global _model, _model_error
    if _model is not None:
        return _model
    if _model_error:
        raise RuntimeError(_model_error)
    try:
        from sentence_transformers import SentenceTransformer

        if SCRIPT_MODEL_LOCAL:
            _model = SentenceTransformer(str(SCRIPT_MODEL_LOCAL))
        else:
            _model = SentenceTransformer(SCRIPT_MODEL_NAME)
        return _model
    except Exception as exc:
        _model_error = str(exc)
        raise


CATEGORY_WEIGHTS = {
    "Opening Speech": 1.2,
    "Empathy": 1.0,
    "Query Handling": 1.5,
    "Authentication Verification": 1.3,
    "Closing Speech": 1.0,
    "Resolution": 1.4,
    "Compliance": 1.3,
}


def _category_score(agent_sentences: list[str], target_sentences: list[str], model) -> float:
    if not agent_sentences or not target_sentences:
        return 0.0
    target_embs = model.encode(target_sentences)
    agent_embs = model.encode(agent_sentences)

    best_per_target = []
    for t_emb in target_embs:
        best_sim = max(
            _cosine(np.asarray(t_emb), np.asarray(a_emb)) for a_emb in agent_embs
        )
        best_per_target.append(best_sim)

    if not best_per_target:
        return 0.0
    avg_best = sum(best_per_target) / len(best_per_target)
    score = max(0.0, min(100.0, (avg_best + 0.2) / 1.0 * 100))
    return score


def _language_key(language: str) -> str:
    lang = (language or "English").lower()
    if "hindi" in lang or lang in ("hi", "hin"):
        return "Hindi"
    if "bengali" in lang or lang in ("bn", "ben"):
        return "Bengali"
    return "English"


def analyze_script_compliance(transcript: str, language: str = "English") -> str:
    if not SCRIPT_COMPLIANCE_ENABLED:
        return "0.00"

    agents = agent_lines(transcript)
    if not agents:
        return "0.00"

    try:
        model = _get_model()
        lang_key = _language_key(language)
        target_sentences = get_bank_config().get_script_targets()
        weighted_scores: list[float] = []
        total_weight = 0.0
        for category, sentences_by_language in target_sentences.items():
            targets = sentences_by_language.get(lang_key) or sentences_by_language.get("English", [])
            if not targets:
                continue
            weight = CATEGORY_WEIGHTS.get(category, 1.0)
            cat_score = _category_score(agents, targets, model)
            weighted_scores.append(cat_score * weight)
            total_weight += weight

        if not weighted_scores or total_weight == 0:
            return "0.00"
        overall = sum(weighted_scores) / total_weight
        overall = max(0.0, min(100.0, overall))
        return f"{overall:.2f}"
    except Exception:
        from scoring_worker import compute_script_compliance_keyword

        return compute_script_compliance_keyword(transcript)


def script_health() -> dict[str, Any]:
    if not SCRIPT_COMPLIANCE_ENABLED:
        return {"enabled": False, "ready": False}
    try:
        _get_model()
        return {
            "enabled": True,
            "ready": True,
            "model": SCRIPT_MODEL_NAME,
            "local_path": str(SCRIPT_MODEL_LOCAL) if SCRIPT_MODEL_LOCAL else None,
        }
    except Exception as exc:
        return {
            "enabled": True,
            "ready": False,
            "model": SCRIPT_MODEL_NAME,
            "error": str(exc)[:200],
        }
