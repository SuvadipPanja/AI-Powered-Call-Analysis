"""Tests for entity normalization acceptance (Indic + English)."""

from transcript_entity_worker import (
    _accept_entity_change,
    _line_has_spelled_numbers,
)


def test_detects_english_amount_words():
    assert _line_has_spelled_numbers("fifteen thousand rupees in your account")


def test_detects_bengali_amount_words():
    assert _line_has_spelled_numbers("এক টাকা নব্বই পয়সা")


def test_detects_hindi_amount_words():
    assert _line_has_spelled_numbers("पंद्रह हजार रुपए")


def test_accept_fifteen_thousand():
    orig = "there is a bank balance of fifteen thousand rupees"
    corr = "there is a bank balance of 15,000 rupees"
    assert _accept_entity_change(orig, corr)


def test_accept_bengali_taka_paisa():
    orig = "আপনার account এ balance আছে এক টাকা নব্বই পয়সা"
    corr = "আপনার account এ balance আছে 1.90 টাকা"
    assert _accept_entity_change(orig, corr)


def test_accept_one_rupee_ninety_paise():
    orig = "one rupee and ninety paise in your account balance"
    corr = "1.90 rupees in your account balance"
    assert _accept_entity_change(orig, corr)


def test_accept_zero_digit():
    orig = "the last four numbers are zero"
    corr = "the last four numbers are 0"
    assert _accept_entity_change(orig, corr)
