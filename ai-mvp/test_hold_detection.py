"""Tests for hold-time detection (phrase + silence gap + dual transcript)."""

from hold_worker import (
    analyze_hold,
    detect_hold_events,
    detect_hold_events_dual,
    _has_hold_phrase,
)


def _tx(*lines: str) -> str:
    return "\n".join(lines)


def test_explicit_hold_phrase_30s_gap():
    t = _tx(
        "0.0 - 5.0 (Agent): Please hold the line while I check your account.",
        "35.0 - 38.0 (Agent): Thank you for holding. Your balance is five thousand rupees.",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "Yes"
    assert r["Hold_Count"] == 1
    assert 28 <= r["Hold_Total_Sec"] <= 32


def test_no_hold_short_gaps():
    t = _tx(
        "0.0 - 3.0 (Agent): Good morning, how may I help?",
        "4.0 - 8.0 (Customer): I need my balance.",
        "9.0 - 15.0 (Agent): Your balance is ten thousand rupees.",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "No"
    assert r["Hold_Count"] == 0


def test_hindi_hold_phrase():
    t = _tx(
        "10.0 - 14.0 (Agent): Ek minute hold kariye, main check karta hoon.",
        "40.0 - 43.0 (Customer): Theek hai.",
        "41.0 - 45.0 (Agent): Ji, aapka balance update ho gaya.",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "Yes"
    assert r["Hold_Count"] >= 1


def test_implicit_silence_gap_hold():
    t = _tx(
        "0.0 - 5.0 (Agent): Let me verify that in the system.",
        "30.0 - 33.0 (Customer): Yes I am here.",
        "34.0 - 40.0 (Agent): Verified successfully.",
    )
    events = detect_hold_events(t)
    assert len(events) == 1
    assert events[0].trigger == "silence_gap"
    assert events[0].duration_sec >= 18


def test_multiple_holds():
    t = _tx(
        "0.0 - 4.0 (Agent): Please hold while I check.",
        "20.0 - 22.0 (Agent): One moment please hold again.",
        "45.0 - 48.0 (Customer): Okay.",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "Yes"
    assert r["Hold_Count"] == 2


def test_return_from_hold_not_new_hold():
    t = _tx(
        "0.0 - 4.0 (Agent): Thank you for holding. Your request is complete.",
        "5.0 - 8.0 (Customer): Thank you.",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "No"


def test_rewards_call_no_false_hold():
    t = _tx(
        "1.9 - 10.1 (Agent): Welcome to the bank. How may I assist regarding reward points?",
        "10.1 - 15.4 (Customer): I want to redeem my credit card points.",
        "16.0 - 25.0 (Agent): Sure, I can help you redeem your reward points for cashback.",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "No"


def test_banking_hold_with_customer_ack_then_agent_return():
    """Real prod case: agent asks hold, customer says 'hmm absolutely', agent returns ~90s later."""
    t = _tx(
        "168.0 - 174.0 (Agent): Yes sir, thank you sir. Can I put your call on hold for 2 minutes while you submit your cashback admission proof?",
        "177.0 - 179.0 (Customer): Hmm, absolutely.",
        "262.0 - 263.0 (Customer): Hmm.",
        "263.0 - 268.0 (Agent): Do you know that your card is currently active?",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "Yes", r
    assert r["Hold_Count"] >= 1
    assert r["Hold_Total_Sec"] >= 80


def test_cashback_hold_agent_thank_you_does_not_end_hold_early():
    """Prod UI case: agent says thank-you for speaking right after hold OK — must not truncate hold."""
    t = _tx(
        "168.0 - 174.0 (Agent): Can I put your call on hold for 2 minutes while you have done your cashback admission proof?",
        "177.0 - 179.0 (Customer): Hmm, absolutely.",
        "179.0 - 182.0 (Agent): Thank you sir, thank you for speaking, Akash Pratap ji.",
        "262.0 - 263.0 (Customer): Hmm.",
        "263.0 - 268.0 (Agent): Do you know that your card is currently active?",
    )
    r = analyze_hold(t)
    assert r["Hold_Detected"] == "Yes", r
    assert r["Hold_Count"] >= 1
    assert r["Hold_Total_Sec"] >= 80


def test_put_call_on_hold_phrase():
    line = "Can I put your call on hold for 2 minutes while you submit your cashback admission proof?"
    assert _has_hold_phrase(line)


def test_dual_bengali_original_english_no_phrase():
    original = _tx(
        "0.0 - 5.0 (Agent): এক মিনিট অপেক্ষা করুন, আমি চেক করছি।",
        "35.0 - 38.0 (Agent): ধন্যবাদ, আপনার ব্যালেন্স পাওয়া গেছে।",
    )
    english = _tx(
        "0.0 - 5.0 (Agent): Let me check your account in the system.",
        "35.0 - 38.0 (Agent): Thank you, your balance is available.",
    )
    r = analyze_hold(english, original_transcript=original)
    assert r["Hold_Detected"] == "Yes", r
    assert r["Hold_Count"] >= 1


def test_dual_tamil_original_catches_hold():
    original = _tx(
        "0.0 - 5.0 (Agent): ஒரு நிமிடம் காத்திருங்கள், நான் சரிபார்க்கிறேன்.",
        "30.0 - 33.0 (Agent): நன்றி, உங்கள் கணக்கு தயார்.",
    )
    english = _tx(
        "0.0 - 5.0 (Agent): I am verifying your account details now.",
        "30.0 - 33.0 (Agent): Thank you, your account is ready.",
    )
    r = analyze_hold(english, original_transcript=original)
    assert r["Hold_Detected"] == "Yes", r


def test_dual_merge_no_duplicate_count():
    original = _tx(
        "0.0 - 5.0 (Agent): Please hold the line.",
        "35.0 - 38.0 (Agent): Thank you for holding.",
    )
    english = _tx(
        "0.0 - 5.0 (Agent): Please hold the line.",
        "35.0 - 38.0 (Agent): Thank you for holding.",
    )
    events = detect_hold_events_dual(original, english)
    assert len(events) == 1


LANGUAGE_HOLD_LINES: dict[str, str] = {
    "English": "Please hold the line while I verify.",
    "Hindi": "Ek minute hold kariye, main check karta hoon.",
    "Bengali": "এক মিনিট অপেক্ষা করুন, আমি দেখছি।",
    "Tamil": "ஒரு நிமிடம் காத்திருங்கள், நான் பார்க்கிறேன்.",
    "Telugu": "ఒక నిమిషం వేచండి, నేను చెక్ చేస్తాను.",
    "Kannada": "ಒಂದು ನಿಮಿಷ ಕಾಯಿರಿ, ನಾನು ಪರಿಶೀಲಿಸುತ್ತೇನೆ.",
    "Malayalam": "ഒരു മിനിട് കാത്തിരിക്കുക, ഞാൻ പരിശോധിക്കുന്നു.",
    "Gujarati": "એક મિનિટ રાહ જુઓ, હું ચેક કરું છું.",
    "Punjabi": "ਇੱਕ ਮਿੰਟ ਇੰਤਜ਼ਾਰ ਕਰੋ, ਮੈਂ ਚੈਕ ਕਰਦਾ ਹਾਂ।",
    "Odia": "ଗୋଟିଏ ମିନିଟ୍ ଅପେକ୍ଷା କରନ୍ତୁ, ମୁଁ ଯାଞ୍ଚ କରୁଛି।",
    "Marathi": "एक मिनिट प्रतीक्षा करा, मी तपासतो.",
    "Assamese": "এমিনিট অপেক্ষা কৰক, মই চাওঁ।",
}


def test_all_12_language_hold_phrases():
    failed = [lang for lang, line in LANGUAGE_HOLD_LINES.items() if not _has_hold_phrase(line)]
    assert not failed, f"Hold phrase not matched: {failed}"


def test_all_12_languages_detect_hold_in_transcript():
    failed = []
    for lang, agent_line in LANGUAGE_HOLD_LINES.items():
        t = _tx(
            f"0.0 - 5.0 (Agent): {agent_line}",
            "35.0 - 38.0 (Agent): Thank you, done.",
        )
        r = analyze_hold(t)
        if r["Hold_Detected"] != "Yes":
            failed.append(lang)
    assert not failed, f"Hold not detected for: {failed}"


def test_all_12_dual_when_english_loses_phrase():
    english_generic = "Let me verify that in the system for you."
    failed = []
    for lang, agent_line in LANGUAGE_HOLD_LINES.items():
        if lang == "English":
            continue
        original = _tx(
            f"0.0 - 5.0 (Agent): {agent_line}",
            "35.0 - 38.0 (Agent): Done, thank you.",
        )
        english = _tx(
            f"0.0 - 5.0 (Agent): {english_generic}",
            "35.0 - 38.0 (Agent): Done, thank you.",
        )
        r = analyze_hold(english, original_transcript=original)
        if r["Hold_Detected"] != "Yes":
            failed.append(lang)
    assert not failed, f"Dual hold missed for: {failed}"


if __name__ == "__main__":
    tests = [
        test_explicit_hold_phrase_30s_gap,
        test_no_hold_short_gaps,
        test_hindi_hold_phrase,
        test_implicit_silence_gap_hold,
        test_multiple_holds,
        test_return_from_hold_not_new_hold,
        test_rewards_call_no_false_hold,
        test_banking_hold_with_customer_ack_then_agent_return,
        test_put_call_on_hold_phrase,
        test_dual_bengali_original_english_no_phrase,
        test_dual_tamil_original_catches_hold,
        test_dual_merge_no_duplicate_count,
        test_all_12_language_hold_phrases,
        test_all_12_languages_detect_hold_in_transcript,
        test_all_12_dual_when_english_loses_phrase,
    ]
    failed = 0
    for fn in tests:
        try:
            fn()
            print(f"PASS {fn.__name__}")
        except Exception as exc:
            failed += 1
            print(f"FAIL {fn.__name__}: {exc}")
    print(f"\n{len(tests) - failed}/{len(tests)} passed")
    raise SystemExit(1 if failed else 0)
