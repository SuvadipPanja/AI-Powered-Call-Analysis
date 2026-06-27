"""Test script for AI-MVP accuracy improvements."""

import json
import sys

from scoring_worker import (
    RUBRIC_KEYS,
    ScoringResult,
    _sanity_check_scores,
    build_sentiment_from_transcript,
    build_tone_from_transcript,
    compute_script_compliance_keyword,
    parse_json_scores,
    parse_llama_scores,
)
from sentiment_worker import _ensemble_polarity, _keyword_polarity
from script_worker import CATEGORY_WEIGHTS

SAMPLE_TRANSCRIPT = """0.0 - 3.5 (Agent): Good morning, welcome to UCO Bank. My name is Rahul, how may I assist you today?
3.5 - 8.2 (Customer): Hello, I need help with a failed transaction. I tried to transfer money yesterday but it didn't go through.
8.2 - 12.1 (Agent): I understand your concern. Let me help you with that. May I have your account number for verification?
12.1 - 15.0 (Customer): Yes, my account number is 1234567890.
15.0 - 19.5 (Agent): Thank you. For security purposes, could you also confirm your registered mobile number?
19.5 - 22.0 (Customer): It's 9876543210.
22.0 - 28.3 (Agent): Thank you for verifying. I can see the failed transaction of Rs 5000. It appears the beneficiary account was temporarily unavailable. The amount has been reversed to your account.
28.3 - 31.0 (Customer): Oh okay, so the money is back in my account?
31.0 - 35.5 (Agent): Yes, the reversal was processed this morning. You should see it reflected already. Is there anything else I can help you with?
35.5 - 37.0 (Customer): No, that's all. Thank you for the quick help.
37.0 - 40.0 (Agent): You're welcome. Thank you for calling UCO Bank. Have a nice day!"""


def test_sanity_checks():
    print("=" * 60)
    print("TEST 1: Score sanity checks")
    print("=" * 60)

    # All zeros (low confidence)
    scores = {k: 0.0 for k in RUBRIC_KEYS}
    scores["Overall_Scoring"] = 0.0
    scores["Rude_Behavior"] = "maybe"
    scores["Call_Type"] = "invalid"
    scores["Lead_Classification"] = "blah"
    scores["Resolution_Status"] = "xyz"
    result = _sanity_check_scores(scores)
    assert result["Rude_Behavior"] == "No", f"Expected 'No', got {result['Rude_Behavior']}"
    assert result["Call_Type"] == "Other", f"Expected 'Other', got {result['Call_Type']}"
    assert result["Lead_Classification"] == "Not a Lead"
    assert result["Resolution_Status"] == "Pending"
    assert result.get("_low_confidence") is True
    print("  [PASS] All-zero scores flagged as low confidence")
    print("  [PASS] Invalid enum values corrected")

    # Extreme divergence between overall and dimensions
    scores2 = {k: 90.0 for k in RUBRIC_KEYS}
    scores2["Overall_Scoring"] = 20.0
    scores2["Rude_Behavior"] = "No"
    scores2["Call_Type"] = "Inquiry"
    scores2["Lead_Classification"] = "Not a Lead"
    scores2["Resolution_Status"] = "Resolved"
    result2 = _sanity_check_scores(scores2)
    assert result2["Overall_Scoring"] == 55.0, f"Expected 55.0, got {result2['Overall_Scoring']}"
    print(f"  [PASS] Divergence fix: dims avg=90, overall was 20, fixed to {result2['Overall_Scoring']}")

    # Out of bounds clamping
    scores3 = {k: 150.0 for k in RUBRIC_KEYS}
    scores3["Overall_Scoring"] = -10.0
    scores3["Rude_Behavior"] = "No"
    scores3["Call_Type"] = "Complaint"
    scores3["Lead_Classification"] = "Hot Lead"
    scores3["Resolution_Status"] = "Resolved"
    result3 = _sanity_check_scores(scores3)
    assert all(result3[k] == 100.0 for k in RUBRIC_KEYS)
    assert result3["Overall_Scoring"] == 50.0  # (0 + 100) / 2 due to divergence
    print("  [PASS] Out-of-bounds values clamped correctly")
    print()


def test_json_parsing():
    print("=" * 60)
    print("TEST 2: JSON score parsing with normalization")
    print("=" * 60)

    sample_json = json.dumps({
        "Opening_Speech": 8,
        "Empathy": 7,
        "Query_Handling": 8,
        "Adherence_to_Protocol": 7,
        "Resolution_Assurance": 8,
        "Query_Resolution": 9,
        "Polite_Tone": 8,
        "Authentication_Verification": 9,
        "Escalation_Handling": 7,
        "Closing_Speech": 8,
        "Rude_Behavior": "No",
        "Overall_Scoring": 82,
        "Call_Type": "Transaction Issue",
        "Lead_Classification": "Not a Lead",
        "Resolution_Status": "Resolved",
        "Feedback": "Agent handled the failed transaction query efficiently with proper verification.",
        "Summary": "Customer called about a failed transaction. Agent verified identity and confirmed the reversal was processed.",
    })

    scores = parse_json_scores(sample_json)
    assert scores["Opening_Speech"] == 80.0, f"Expected 80.0, got {scores['Opening_Speech']}"
    assert scores["Overall_Scoring"] == 82.0
    assert scores["Rude_Behavior"] == "No"
    assert scores["Call_Type"] == "Transaction Issue"
    print(f"  [PASS] JSON parsed: Opening={scores['Opening_Speech']}, Overall={scores['Overall_Scoring']}")
    print(f"  [PASS] Rubric 0-10 -> 0-100 normalization working")
    print()


def test_sentiment_ensemble():
    print("=" * 60)
    print("TEST 3: Sentiment ensemble (model + keyword)")
    print("=" * 60)

    # High confidence positive
    pol, conf = _ensemble_polarity("Thank you so much for the quick help!", 0.65, 0.92)
    assert pol > 0.4, f"Expected positive, got {pol}"
    assert conf >= 0.85
    print(f"  [PASS] High-conf positive: polarity={pol}, confidence={conf}")

    # Low confidence with keyword boost
    pol2, conf2 = _ensemble_polarity("I am very frustrated with this terrible service!", -0.3, 0.52)
    assert pol2 < -0.3, f"Expected negative, got {pol2}"
    print(f"  [PASS] Low-conf negative + keyword: polarity={pol2}, confidence={conf2}")

    # Conflict (model positive, keywords negative)
    pol3, conf3 = _ensemble_polarity("The problem is terrible and I am angry!", 0.5, 0.7)
    assert conf3 < 0.7, "Confidence should be reduced on conflict"
    print(f"  [PASS] Conflict detection: polarity={pol3}, confidence={conf3} (reduced)")
    print()


def test_script_compliance_keyword():
    print("=" * 60)
    print("TEST 4: Script compliance (keyword fallback)")
    print("=" * 60)

    score = compute_script_compliance_keyword(SAMPLE_TRANSCRIPT)
    print(f"  Keyword compliance score: {score}%")
    assert float(score) > 50, f"Expected >50% for good transcript, got {score}"
    print(f"  [PASS] Good transcript scores {score}% (>50%)")

    bad_transcript = "0.0 - 5.0 (Agent): Yeah what do you want?"
    bad_score = compute_script_compliance_keyword(bad_transcript)
    print(f"  Bad transcript scores: {bad_score}%")
    assert float(bad_score) < float(score)
    print(f"  [PASS] Bad transcript scores lower ({bad_score}% < {score}%)")
    print()


def test_category_weights():
    print("=" * 60)
    print("TEST 5: Script compliance category weights")
    print("=" * 60)
    assert "Query Handling" in CATEGORY_WEIGHTS
    assert CATEGORY_WEIGHTS["Query Handling"] > 1.0
    assert "Resolution" in CATEGORY_WEIGHTS
    print(f"  Weights: {CATEGORY_WEIGHTS}")
    print("  [PASS] Category weights configured correctly")
    print()


def test_transcript_sentiment():
    print("=" * 60)
    print("TEST 6: Transcript-based sentiment + tone")
    print("=" * 60)

    sentiment = build_sentiment_from_transcript(SAMPLE_TRANSCRIPT)
    assert len(sentiment) > 0, "Should parse utterances"
    print(f"  Parsed {len(sentiment)} utterances from sample transcript")

    agent_sentiments = [e for e in sentiment if e["Role"] == "Agent"]
    cust_sentiments = [e for e in sentiment if e["Role"] == "Customer"]
    print(f"  Agent utterances: {len(agent_sentiments)}, Customer: {len(cust_sentiments)}")

    avg_agent = sum(e["Sentiment Polarity"] for e in agent_sentiments) / len(agent_sentiments) if agent_sentiments else 0
    print(f"  Agent avg polarity: {avg_agent:.3f}")
    assert avg_agent > 0, "Agent should be positive in this sample"
    print("  [PASS] Agent sentiment is positive as expected")

    tone = build_tone_from_transcript(SAMPLE_TRANSCRIPT, sentiment)
    assert tone["status"] == "success"
    assert "Agent" in tone["results"]["Overall_Tone"]
    print(f"  Overall tone: Agent={tone['results']['Overall_Tone']['Agent']}, Customer={tone['results']['Overall_Tone']['Customer']}")
    print("  [PASS] Tone analysis produces valid structure")
    print()


if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("AI-MVP ACCURACY IMPROVEMENTS — TEST SUITE")
    print("=" * 60 + "\n")

    tests = [
        test_sanity_checks,
        test_json_parsing,
        test_sentiment_ensemble,
        test_script_compliance_keyword,
        test_category_weights,
        test_transcript_sentiment,
    ]

    passed = 0
    failed = 0
    for test in tests:
        try:
            test()
            passed += 1
        except Exception as exc:
            print(f"  [FAIL] {test.__name__}: {exc}")
            failed += 1

    print("=" * 60)
    print(f"RESULTS: {passed} passed, {failed} failed out of {len(tests)} tests")
    print("=" * 60)
    sys.exit(0 if failed == 0 else 1)
