"""Offline tests for Bengali/English LID guard eligibility and phrase fallback."""

from language_worker import (
    BANKING_FALLBACK_PHRASES,
    _bengali_guard_eligible,
    _bengali_roman_hint_count,
    _english_guard_eligible,
    _fallback_phrase_detection,
    _hindi_guard_eligible,
    _hindi_roman_hint_count,
)


def test_bengali_phrase_fallback_legacy():
    text = "Nomoshkar apni keman achhen apnar account balance koto"
    assert _fallback_phrase_detection(text) == "Bengali"


def test_bengali_roman_hints():
    text = "ami apnar account balance janaben dhonnobad"
    assert _bengali_roman_hint_count(text) >= 3


def test_english_guard_not_eligible_when_bengali_leads():
    probs = {"en": 0.20, "bn": 0.35, "hi": 0.10}
    assert not _english_guard_eligible("bn", probs)
    assert _bengali_guard_eligible("bn", probs)


def test_english_guard_eligible_when_english_leads():
    probs = {"en": 0.55, "bn": 0.12, "hi": 0.08}
    assert _english_guard_eligible("en", probs)


def test_bengali_guard_eligible_on_en_token_with_bn_mass():
    probs = {"en": 0.40, "bn": 0.22, "hi": 0.05}
    assert _bengali_guard_eligible("en", probs)


def test_hindi_guard_eligible_on_telugu_mislabel():
    probs = {"en": 0.05, "bn": 0.08, "hi": 0.22, "te": 0.45}
    assert _hindi_guard_eligible("te", probs)


def test_hindi_namaskar_roman_hint():
    text = "namaskar xyz bank se baat kar raha hoon"
    assert _hindi_roman_hint_count(text) >= 1


def test_urdu_maps_to_hindi():
    from language_worker import _normalize_call_center_language
    assert _normalize_call_center_language("Urdu") == "Hindi"
    assert _normalize_call_center_language("Nepali") == "Hindi"
    assert _normalize_call_center_language("English") == "English"


def test_hindi_guard_eligible_on_urdu_token():
    probs = {"en": 0.05, "bn": 0.08, "hi": 0.04, "ur": 0.72}
    assert _hindi_guard_eligible("ur", probs)


def test_dravidian_codes_in_config():
    from config import LANG_DRAVIDIAN_CONFUSABLE_CODES
    assert "te" in LANG_DRAVIDIAN_CONFUSABLE_CODES
    assert "ta" in LANG_DRAVIDIAN_CONFUSABLE_CODES


def test_restricted_probs_excludes_tamil_telugu():
    from language_worker import _restricted_probs
    # Whisper top = Tamil on a Hindi call: Tamil mass is simply excluded.
    probs = {"ta": 0.45, "te": 0.20, "hi": 0.18, "bn": 0.05, "en": 0.04}
    r = _restricted_probs(probs)
    assert set(r) == {"Hindi", "Bengali", "English"}
    assert max(r, key=lambda k: r[k]) == "Hindi"


def test_restricted_probs_folds_urdu_into_hindi():
    from language_worker import _restricted_probs
    probs = {"ur": 0.60, "hi": 0.10, "bn": 0.05, "en": 0.05}
    r = _restricted_probs(probs)
    assert max(r, key=lambda k: r[k]) == "Hindi"
    assert r["Hindi"] > 0.8


def test_restricted_probs_folds_assamese_into_bengali():
    from language_worker import _restricted_probs
    probs = {"as": 0.40, "bn": 0.25, "hi": 0.10, "en": 0.05}
    r = _restricted_probs(probs)
    assert max(r, key=lambda k: r[k]) == "Bengali"


def test_restricted_probs_zero_mass_uniform():
    from language_worker import _restricted_probs
    r = _restricted_probs({"ja": 0.9})
    assert set(r) == {"Hindi", "Bengali", "English"}
    assert abs(sum(r.values()) - 1.0) < 1e-6
