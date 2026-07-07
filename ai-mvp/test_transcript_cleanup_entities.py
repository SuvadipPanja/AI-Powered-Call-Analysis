"""Tests for LLM cleanup acceptance of entity normalization (numbers, amounts, dates)."""

from transcript_cleanup_worker import (
    _accept_correction,
    _is_entity_normalization,
)


def test_entity_points_normalization_detected():
    orig = "your available points are two thousand thirty two reward points"
    corr = "your available points are 2032 reward points"
    assert _is_entity_normalization(orig, corr)
    assert _accept_correction(orig, corr, "English", [])


def test_entity_lakh_balance_detected():
    orig = (
        "the balance in your account is one lakh ninety nine thousand "
        "nine hundred and ninety nine rupees"
    )
    corr = "the balance in your account is ₹1,99,999"
    assert _is_entity_normalization(orig, corr)
    assert _accept_correction(orig, corr, "English", [])


def test_entity_rupee_paise_detected():
    orig = "the balance in your account is ninety nine rupees and one paisa"
    corr = "the balance in your account is 99.01 rupees"
    assert _is_entity_normalization(orig, corr)
    assert _accept_correction(orig, corr, "English", [])


def test_entity_fourteen_eight_rupees():
    orig = "the value will be fourteen eight rupees"
    corr = "the value will be 14.80 rupees"
    assert _is_entity_normalization(orig, corr)
    assert _accept_correction(orig, corr, "English", [])


def test_entity_dob_date():
    orig = "nineteen january nineteen sixty eight"
    corr = "19 January 1968"
    assert _is_entity_normalization(orig, corr)
    assert _accept_correction(orig, corr, "English", [])


def test_context_binod_name_fix():
    orig = "hello this is binu from xyz bank"
    corr = "hello this is binod from xyz bank"
    ctx = ["yes sir my name is binod"]
    assert _accept_correction(orig, corr, "English", ctx)
