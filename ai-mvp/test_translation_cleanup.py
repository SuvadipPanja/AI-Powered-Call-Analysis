"""Tests for translation output cleanup."""

from translation_worker import _clean_translation_line


def test_strips_leading_speaker_tag():
    raw = "[Customer] Madam, I don't have my reward points."
    assert _clean_translation_line(raw) == "Madam, I don't have my reward points."


def test_strips_inline_speaker_tag():
    raw = "[Agent] Yes, we will definitely help you with the plan."
    assert _clean_translation_line(raw).startswith("Yes, we will definitely help")


def test_strips_doubled_agent_tag():
    raw = "[Agent] [Agent] Triple 2 double 1 3"
    assert "[Agent]" not in _clean_translation_line(raw)
    assert "Triple 2 double 1 3" in _clean_translation_line(raw)
