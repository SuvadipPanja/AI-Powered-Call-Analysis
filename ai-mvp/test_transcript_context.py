"""Tests for full-call contextual cleanup acceptance gates."""

from transcript_context_worker import (
    _accept_context_fix,
    _context_supports_correction,
    _looks_like_garbled,
    _reject_digit_invention,
    context_cleanup_transcript,
)


def test_detects_garbled_markers():
    assert _looks_like_garbled("yes big Papa I cannot access my account")
    assert _looks_like_garbled("thank you mister police for providing your name")
    assert _looks_like_garbled("the value will be finared 8 rupees")


def test_context_supports_pulkit_name():
    original = "my name is fulkid and my mobile number is 9854281137"
    corrected = "my name is Pulkit and my mobile number is 9854281137"
    full = [
        original,
        "thank you Mr Pulkit for providing your name and registered mobile number",
    ]
    assert _context_supports_correction(original, corrected, full)


def test_accept_mister_police_to_pulkit():
    original = "thank you mister police for providing your name"
    corrected = "thank you Mr Pulkit for providing your name"
    full = [
        "my name is fulkid and my mobile number is 9854281137",
        original,
    ]
    assert _accept_context_fix(original, corrected, full)


def test_accept_big_papa_to_sir():
    original = "yes big Papa I cannot access my account balance"
    corrected = "yes sir I cannot access my account balance"
    full = [
        "Hello, welcome to XYZ Bank. I am Vinod. How can I assist you?",
        original,
    ]
    assert _accept_context_fix(original, corrected, full)


def test_accept_finared_amount_with_context():
    original = "your available points are 2032 and the value will be finared 8 rupees"
    corrected = "your available points are 2032 and the value will be 508 rupees"
    full = [
        "two thousand thirty two reward points",
        original,
    ]
    assert _accept_context_fix(original, corrected, full)


def test_reject_invented_card_number():
    original = "my number is nine eight five"
    corrected = "my number is 1234567890123456"
    full = ["thank you for calling"]
    assert _reject_digit_invention(original, corrected, full)
    assert not _accept_context_fix(original, corrected, full)


def test_accept_icon_pattern_with_balance_context():
    original = "hello charlie can you tell me my icon pattern"
    corrected = "hello charlie can you tell me my account balance"
    full = [
        original,
        "yes sir as i understood that you want to know your account balance",
    ]
    assert _accept_context_fix(original, corrected, full)


def test_deterministic_icon_pattern_fix():
    transcript = (
        "0.0 - 6.0 (Customer): hello charlie can you tell me my icon pattern\n"
        "6.0 - 12.0 (Agent): yes sir you want to know your account balance"
    )
    out = context_cleanup_transcript(transcript, "English")
    assert "account balance" in out.lower()
    assert "icon pattern" not in out.lower()


def test_deterministic_manual_good_name():
    transcript = (
        "0.0 - 6.0 (Agent): manual good name sir for your account safety\n"
        "6.0 - 12.0 (Customer): my name is leonardo daphne"
    )
    out = context_cleanup_transcript(transcript, "English")
    assert "may i know your name" in out.lower()
    assert "manual good name" not in out.lower()
