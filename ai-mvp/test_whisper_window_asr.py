"""Unit tests for whisper_window_asr — no GPU, no model load."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from whisper_window_asr import (  # noqa: E402
    WHISPER_WINDOW_MAX_SEC,
    _strip_prompt_echo,
    whisper_window_lang_code,
)


def test_known_languages_map_to_whisper_codes():
    assert whisper_window_lang_code("Hindi") == "hi"
    assert whisper_window_lang_code("English") == "en"
    assert whisper_window_lang_code("Bengali") == "bn"


def test_unknown_language_returns_none():
    assert whisper_window_lang_code("Klingon") is None
    assert whisper_window_lang_code("") is None


def test_prompt_echo_is_stripped():
    prompt = "calling from ICICI Home Finance"
    decoded = "calling from ICICI Home Finance good morning Manisha"
    assert _strip_prompt_echo(decoded, prompt) == "good morning Manisha"


def test_window_cap_is_one_whisper_receptive_field():
    assert WHISPER_WINDOW_MAX_SEC == 30.0
