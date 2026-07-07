"""Tests for LLM cleanup acceptance gates (context-aware)."""

from transcript_cleanup_worker import (
    _accept_correction,
    _context_supports_correction,
)


def test_context_supports_account_balance_fix():
    original = "hello charlie can you tell me my icon pattern"
    corrected = "hello charlie can you tell me my account balance"
    context = [
        "yes sir as i understood that you want to know your account balance",
    ]
    assert _context_supports_correction(original, corrected, context)


def test_accept_contextual_correction_with_low_similarity():
    original = "hello charlie can you tell me my icon pattern"
    corrected = "hello charlie can you tell me my account balance"
    context = [
        "yes sir as i understood that you want to know your account balance",
    ]
    assert _accept_correction(original, corrected, "English", context)


def test_reject_invented_account_number():
    original = "my number is nine eight five"
    corrected = "my number is 1234567890123456"
    context = ["thank you for calling"]
    assert not _accept_correction(original, corrected, "English", context)
