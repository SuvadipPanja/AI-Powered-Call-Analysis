"""
Phase 2c — per-utterance sentiment.

Backends (SENTIMENT_BACKEND):
  llm          — the shared scoring LLM rates every utterance in context
                 (banking-aware, handles code-switched Hindi/Bengali/English).
                 Any failure falls back to the transformers path below.
  transformers — HF pipelines (DistilBERT-SST2 / multilingual BERT), the
                 previous behavior and the always-available fallback.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Optional

from config import (
    SENTIMENT_BACKEND,
    SENTIMENT_ENABLED,
    SENTIMENT_ENSEMBLE_ENABLED,
    SENTIMENT_LLM_BATCH_SIZE,
    SENTIMENT_MODEL,
    SENTIMENT_MODEL_EN,
    SENTIMENT_MODEL_MULTILINGUAL,
)
from transcript_utils import parse_transcript

logger = logging.getLogger(__name__)

_pipe_en = None
_pipe_multi = None
_pipe_en_error: Optional[str] = None
_pipe_multi_error: Optional[str] = None

DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
HINDI_LANGUAGE_HINTS = {"hindi", "hi", "hinglish", "mixed", "multilingual"}

LABEL_POLARITY = {
    "POSITIVE": 0.65,
    "NEGATIVE": -0.65,
    "NEUTRAL": 0.0,
    "positive": 0.65,
    "negative": -0.65,
    "neutral": 0.0,
    "LABEL_0": -0.65,
    "LABEL_1": 0.65,
    "LABEL_2": 0.0,
}

STAR_LABEL_POLARITY = {
    "1 star": -0.75,
    "2 stars": -0.45,
    "3 stars": 0.0,
    "4 stars": 0.45,
    "5 stars": 0.75,
}


def _contains_devanagari(text: str) -> bool:
    return bool(DEVANAGARI_RE.search(text or ""))


def _needs_multilingual(language: str, text: str) -> bool:
    lang = (language or "").strip().lower()
    if lang in HINDI_LANGUAGE_HINTS or "hindi" in lang:
        return True
    if _contains_devanagari(text):
        return True
    return False


def _get_pipeline(model_name: str, cache: str):
    global _pipe_en, _pipe_multi, _pipe_en_error, _pipe_multi_error
    if cache == "en":
        if _pipe_en is not None:
            return _pipe_en
        if _pipe_en_error:
            raise RuntimeError(_pipe_en_error)
    else:
        if _pipe_multi is not None:
            return _pipe_multi
        if _pipe_multi_error:
            raise RuntimeError(_pipe_multi_error)

    try:
        from transformers import pipeline

        pipe = pipeline(
            "sentiment-analysis",
            model=model_name,
            tokenizer=model_name,
            device=-1,
            truncation=True,
        )
        if cache == "en":
            _pipe_en = pipe
        else:
            _pipe_multi = pipe
        return pipe
    except Exception as exc:
        if cache == "en":
            _pipe_en_error = str(exc)
        else:
            _pipe_multi_error = str(exc)
        raise


def _polarity_from_label(label: str, score: float) -> float:
    normalized = (label or "").strip().lower()
    for star_label, polarity in STAR_LABEL_POLARITY.items():
        if normalized == star_label.lower():
            return round(polarity * min(max(score, 0.5), 1.0), 3)

    base = LABEL_POLARITY.get(label, LABEL_POLARITY.get(normalized.upper(), 0.0))
    if base == 0.0:
        if "neg" in normalized or "bad" in normalized or "1 star" in normalized:
            return round(-0.5 * min(max(score, 0.5), 1.0), 3)
        if "pos" in normalized or "good" in normalized or "5 star" in normalized:
            return round(0.5 * min(max(score, 0.5), 1.0), 3)
        return 0.0
    return round(base * min(max(score, 0.5), 1.0), 3)


def _keyword_polarity(text: str) -> float:
    from scoring_worker import POSITIVE_WORDS, NEGATIVE_WORDS

    lower = text.lower()
    pos = sum(1 for w in POSITIVE_WORDS if w in lower)
    neg = sum(1 for w in NEGATIVE_WORDS if w in lower)
    if pos > neg:
        return min(0.35 + pos * 0.15, 0.95)
    if neg > pos:
        return max(-0.35 - neg * 0.15, -0.95)
    return 0.0


def _predict_batch(texts: list[str], language: str) -> list[dict[str, Any]]:
    if not texts:
        return []

    use_multi = any(_needs_multilingual(language, t) for t in texts)
    model = SENTIMENT_MODEL_MULTILINGUAL if use_multi else SENTIMENT_MODEL_EN
    cache_key = "multi" if use_multi else "en"

    try:
        pipe = _get_pipeline(model, cache_key)
        preds = pipe(texts)
    except Exception:
        if cache_key == "en" and any(_contains_devanagari(t) for t in texts):
            try:
                pipe = _get_pipeline(SENTIMENT_MODEL_MULTILINGUAL, "multi")
                preds = pipe(texts)
            except Exception:
                return [{"label": "NEUTRAL", "score": 0.5} for _ in texts]
        else:
            return [{"label": "NEUTRAL", "score": 0.5} for _ in texts]

    if isinstance(preds, dict):
        preds = [preds]
    return preds


def _ensemble_polarity(text: str, model_polarity: float, model_confidence: float) -> tuple[float, float]:
    """Combine model prediction with keyword heuristic for higher accuracy."""
    if not SENTIMENT_ENSEMBLE_ENABLED:
        return model_polarity, model_confidence

    keyword_pol = _keyword_polarity(text)

    if model_confidence >= 0.85:
        final_polarity = model_polarity * 0.8 + keyword_pol * 0.2
        confidence = model_confidence
    elif model_confidence >= 0.6:
        final_polarity = model_polarity * 0.6 + keyword_pol * 0.4
        confidence = model_confidence * 0.9
    else:
        final_polarity = model_polarity * 0.4 + keyword_pol * 0.6
        confidence = max(model_confidence, 0.4)

    if (model_polarity > 0 and keyword_pol < -0.3) or (model_polarity < 0 and keyword_pol > 0.3):
        confidence *= 0.7

    return round(final_polarity, 3), round(confidence, 3)


def _entry(utt, polarity: float, confidence: float) -> dict[str, Any]:
    return {
        "Role": utt.role if utt.role != "Call" else "Agent",
        "Start": utt.start,
        "End": utt.end,
        "Text": utt.text,
        "Sentiment Polarity": polarity,
        "Confidence": confidence,
    }


def _analyze_sentiment_llm(utterances) -> list[dict[str, Any]]:
    """Rate every utterance with the shared scoring LLM (vLLM in prod).

    The LLM sees the numbered dialog in batches, so each rating uses the
    conversational context — far more accurate than per-sentence classifiers
    on banking calls and code-switched Indic text. Raises on any failure so
    the caller can fall back to the transformers path.
    """
    import scoring_worker  # late import so the prod OpenAI patch applies
    from llm_utils import strip_llm_thinking

    system = (
        "You rate the sentiment of each line of a banking call-center transcript. "
        "Polarity is a number from -1.0 (very negative: angry, frustrated, complaint, "
        "threat to leave) to 1.0 (very positive: satisfied, thankful, delighted). "
        "Use 0.0 for neutral/procedural lines (greetings, OTP, account numbers, "
        "hold requests, factual statements). Judge the SPEAKER's emotion, not the "
        "topic. Lines may mix English with Hindi/Bengali/regional words. "
        "Return ONLY valid JSON, no commentary."
    )

    results: list[dict[str, Any]] = []
    batch = max(5, SENTIMENT_LLM_BATCH_SIZE)
    for i in range(0, len(utterances), batch):
        chunk = utterances[i : i + batch]
        numbered = "\n".join(
            f"{idx}. ({u.role}): {u.text[:300]}" for idx, u in enumerate(chunk)
        )
        prompt = (
            "Rate each numbered line.\n\n"
            f"{numbered}\n\n"
            "Return ONLY JSON in this exact shape (one item per line, same order):\n"
            '{"ratings": [{"i": 0, "polarity": 0.0, "confidence": 0.9}, ...]}\n'
            f"There are exactly {len(chunk)} lines (i = 0..{len(chunk) - 1})."
        )
        raw = scoring_worker.ollama_generate(
            prompt, system=system, json_mode=True, temperature=0.0,
            max_tokens=max(256, 24 * len(chunk)),
        )
        cleaned = strip_llm_thinking(raw or "").strip()
        start, end = cleaned.find("{"), cleaned.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("no JSON in LLM sentiment output")
        data = json.loads(cleaned[start : end + 1])
        ratings = data.get("ratings")
        if not isinstance(ratings, list):
            raise ValueError("LLM sentiment output missing 'ratings'")

        by_index: dict[int, dict[str, Any]] = {}
        for r in ratings:
            if isinstance(r, dict) and isinstance(r.get("i"), (int, float)):
                by_index[int(r["i"])] = r

        for idx, utt in enumerate(chunk):
            r = by_index.get(idx)
            if r is None:
                raise ValueError(f"LLM sentiment output missing line {idx}")
            polarity = max(-1.0, min(1.0, float(r.get("polarity", 0.0))))
            confidence = max(0.0, min(1.0, float(r.get("confidence", 0.7))))
            results.append(_entry(utt, round(polarity, 3), round(confidence, 3)))
    return results


def _analyze_sentiment_transformers(utterances, language: str) -> list[dict[str, Any]]:
    """HF-pipeline sentiment (previous behavior); keyword fallback inside."""
    entries: list[dict[str, Any]] = []
    batch_size = 8
    texts = [u.text[:512] for u in utterances]

    try:
        for i in range(0, len(texts), batch_size):
            batch_utts = utterances[i : i + batch_size]
            batch_texts = texts[i : i + batch_size]
            batch_lang = language
            if any(_needs_multilingual(language, t) for t in batch_texts):
                batch_lang = "Hindi"

            preds = _predict_batch(batch_texts, batch_lang)
            for utt, pred in zip(batch_utts, preds):
                raw_polarity = _polarity_from_label(
                    str(pred.get("label", "NEUTRAL")),
                    float(pred.get("score", 0.5)),
                )
                model_confidence = float(pred.get("score", 0.5))
                polarity, confidence = _ensemble_polarity(
                    utt.text, raw_polarity, model_confidence
                )
                entries.append(_entry(utt, polarity, confidence))
    except Exception:
        entries = [
            _entry(utt, _keyword_polarity(utt.text), 0.4) for utt in utterances
        ]
    return entries


def analyze_sentiment(transcript: str, language: str = "English") -> list[dict[str, Any]]:
    if not SENTIMENT_ENABLED:
        return []

    utterances = parse_transcript(transcript)
    if not utterances:
        return []

    if SENTIMENT_BACKEND == "llm":
        try:
            return _analyze_sentiment_llm(utterances)
        except Exception as exc:  # noqa: BLE001
            logger.warning("LLM sentiment failed (%s) — falling back to transformers", exc)

    return _analyze_sentiment_transformers(utterances, language)


def sentiment_health() -> dict[str, Any]:
    if not SENTIMENT_ENABLED:
        return {"enabled": False, "ready": False, "model": SENTIMENT_MODEL}
    status: dict[str, Any] = {
        "enabled": True,
        "model_en": SENTIMENT_MODEL_EN,
        "model_multilingual": SENTIMENT_MODEL_MULTILINGUAL,
    }
    try:
        _get_pipeline(SENTIMENT_MODEL_EN, "en")
        status["english_ready"] = True
    except Exception as exc:
        status["english_ready"] = False
        status["english_error"] = str(exc)[:200]
    try:
        _get_pipeline(SENTIMENT_MODEL_MULTILINGUAL, "multi")
        status["multilingual_ready"] = True
    except Exception as exc:
        status["multilingual_ready"] = False
        status["multilingual_error"] = str(exc)[:200]
    status["ready"] = status.get("english_ready") or status.get("multilingual_ready")
    return status
