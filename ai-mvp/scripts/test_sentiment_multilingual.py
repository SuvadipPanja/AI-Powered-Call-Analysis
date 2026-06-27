"""Quick tests for multilingual sentiment routing."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()

from sentiment_worker import _contains_devanagari, _needs_multilingual, analyze_sentiment


def test_detection() -> None:
    assert _contains_devanagari("नमस्ते, मैं आपकी मदद करूंगा")
    assert not _contains_devanagari("Hello, how can I help you?")
    assert _needs_multilingual("Hindi", "hello")
    assert _needs_multilingual("English", "आपका खाता सक्रिय है")
    print("detection OK")


def test_analyze() -> None:
    transcript = (
        "1.0 - 5.0 (Agent): Hello, welcome to UCO Bank.\n"
        "6.0 - 10.0 (Customer): मुझे अपने खाते की जानकारी चाहिए।\n"
        "11.0 - 15.0 (Agent): Sure, I will help you with that."
    )
    rows = analyze_sentiment(transcript, language="Mixed")
    assert len(rows) == 3
    hindi_row = next(r for r in rows if "खाते" in r["Text"])
    assert "Sentiment Polarity" in hindi_row
    print("analyze OK", len(rows), "rows")


if __name__ == "__main__":
    test_detection()
    test_analyze()
    print("All sentiment tests passed.")
