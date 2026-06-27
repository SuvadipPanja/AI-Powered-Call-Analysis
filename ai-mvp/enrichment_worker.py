"""
Phase 2c — audio tone, transformer sentiment, script similarity.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from config import ENRICHMENT_ENABLED
from script_worker import analyze_script_compliance, script_health
from sentiment_worker import analyze_sentiment, sentiment_health
from tone_worker import analyze_tone, tone_health


@dataclass
class EnrichmentResult:
    sentiment: list[dict[str, Any]]
    tone_analysis: dict[str, Any]
    script_compliance: str


def enrichment_enabled() -> bool:
    return ENRICHMENT_ENABLED


def enrich_call(
    audio_file: str,
    transcript: str,
    language: str = "English",
) -> EnrichmentResult:
    if not ENRICHMENT_ENABLED:
        return EnrichmentResult(sentiment=[], tone_analysis={}, script_compliance="0.00")

    tone = analyze_tone(audio_file)
    sentiment = analyze_sentiment(transcript, language)
    script = analyze_script_compliance(transcript, language)
    return EnrichmentResult(
        sentiment=sentiment,
        tone_analysis=tone,
        script_compliance=script,
    )


def enrichment_health() -> dict[str, Any]:
    return {
        "enabled": ENRICHMENT_ENABLED,
        "tone": tone_health(),
        "sentiment": sentiment_health(),
        "script": script_health(),
    }
