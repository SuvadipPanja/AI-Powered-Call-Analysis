"""Offline tests for the word-match LID scorer (LANG_LID_BACKEND=wordmatch).

Feeds realistic banking-call transcripts (native script, romanized, and
code-mixed) through score_transcript and asserts the right language wins.
"""

from pathlib import Path

from wordmatch_lid import (
    bengali_blocked_by_devanagari,
    detect_language_wordmatch,
    kannada_blocked_by_devanagari,
    marathi_overrides_hindi,
    score_transcript,
)


def _winner(text: str) -> str:
    scores, _ = score_transcript(text)
    return max(scores, key=lambda k: scores[k])


# --- native script ---------------------------------------------------------

def test_hindi_native_script():
    text = "नमस्कार मैं आपकी क्या मदद कर सकता हूँ आपका खाता नंबर बताइए धन्यवाद"
    assert _winner(text) == "Hindi"


def test_bengali_native_script():
    text = "নমস্কার আমি আপনার কি সাহায্য করতে পারি আপনার টাকা জমা হয়েছে ধন্যবাদ"
    assert _winner(text) == "Bengali"


def test_tamil_native_script():
    text = "வணக்கம் உங்கள் கணக்கு இருக்கிறது நன்றி தயவுசெய்து சொல்லுங்கள்"
    assert _winner(text) == "Tamil"


def test_telugu_native_script():
    text = "నమస్కారం మీ ఖాతా ఉంది ధన్యవాదాలు దయచేసి చెప్పండి"
    assert _winner(text) == "Telugu"


def test_kannada_native_script():
    text = "ನಮಸ್ಕಾರ ನಿಮ್ಮ ಖಾತೆ ಇದೆ ಧನ್ಯವಾದ ದಯವಿಟ್ಟು ಹೇಳಿ"
    assert _winner(text) == "Kannada"


def test_malayalam_native_script():
    text = "നമസ്കാരം നിങ്ങളുടെ അക്കൗണ്ട് ഉണ്ട് നന്ദി ദയവായി പറയൂ"
    assert _winner(text) == "Malayalam"


def test_gujarati_native_script():
    text = "નમસ્તે તમારું ખાતું છે આભાર કૃપા કરો કહો"
    assert _winner(text) == "Gujarati"


def test_punjabi_native_script():
    text = "ਸਤ ਸ੍ਰੀ ਅਕਾਲ ਤੁਹਾਡਾ ਖਾਤਾ ਹੈ ਧੰਨਵਾਦ ਕਿਰਪਾ ਦੱਸੋ"
    assert _winner(text) == "Punjabi"


def test_odia_native_script():
    text = "ନମସ୍କାର ଆପଣଙ୍କ ଖାତା ଅଛି ଧନ୍ୟବାଦ ଦୟାକରି କୁହନ୍ତୁ"
    assert _winner(text) == "Odia"


def test_marathi_beats_hindi_on_marathi_words():
    text = "नमस्कार मी तुमची काय मदत करू शकतो तुमचे खाते आहे धन्यवाद सांगा"
    assert _winner(text) == "Marathi"


def test_assamese_special_chars_beat_bengali():
    text = "নমস্কাৰ মই আপোনাক সহায় কৰিব পাৰোঁ আপোনাৰ টকা জমা হৈছে"
    assert _winner(text) == "Assamese"


# --- romanized (Whisper wrote Latin) ---------------------------------------

def test_hindi_romanized():
    text = "namaste main aapki madad kar sakta hoon aapka khata number bataiye dhanyavad"
    assert _winner(text) == "Hindi"


def test_bengali_romanized():
    text = "nomoshkar ami apnar ki sahajjo korte pari apnar taka joma hoyeche dhonnobad"
    assert _winner(text) == "Bengali"


# --- English ----------------------------------------------------------------

def test_real_english():
    text = ("good morning thank you for calling how may i help you today "
            "please tell me your registered mobile number i will check the details")
    assert _winner(text) == "English"


def test_neutral_banking_terms_alone_decide_nothing():
    scores, _ = score_transcript("account balance atm card loan emi otp bank")
    assert all(v == 0.0 for v in scores.values())


def test_code_mixed_hindi_beats_english():
    # Hinglish: English banking nouns are neutral; Hindi carriers decide.
    text = "ji haan aapka account balance check kar raha hoon kripya wait kijiye theek hai"
    assert _winner(text) == "Hindi"


# --- multi-snippet accumulation & debug -------------------------------------

def test_scores_accumulate_and_matches_logged():
    scores, matched = score_transcript("আপনার টাকা জমা হয়েছে ধন্যবাদ")
    assert scores["Bengali"] > 0
    assert matched["Bengali"], "matched words must be recorded for debugging"


def test_customer_marathi_overrides_hindi_agent():
    parts = [
        ("agent#1", "नमस्कार मैं आपकी क्या मदद कर सकता हूँ आपका खाता बताइए"),
        ("customer#1", "होय माझे खाते आहे तुम्ही सांगा मला पाहिजे"),
    ]
    assert marathi_overrides_hindi(parts) is True


def test_hindi_customer_does_not_become_marathi():
    parts = [
        ("agent#1", "नमस्कार मैं आपकी क्या मदद कर सकता हूँ"),
        ("customer#1", "हाँ जी मैं बोल रहा हूँ आपका खाता चेक कीजिए"),
    ]
    assert marathi_overrides_hindi(parts) is False


def test_devanagari_blocks_bengali_label():
    text = "नमस्कार मैं आपकी क्या मदद कर सकता हूँ आपका खाता"
    assert bengali_blocked_by_devanagari(text) is True
    assert bengali_blocked_by_devanagari("নমস্কার আমি আপনার কি সাহায্য করতে পারি") is False
    assert kannada_blocked_by_devanagari(text) is True
    assert kannada_blocked_by_devanagari("ನಾನು ನನ್ನ ಖಾತೆ ಇದೆ") is False


def test_false_kannada_script_loses_to_forced_hindi(tmp_path, monkeypatch):
    snippet = tmp_path / "a.wav"
    snippet.write_bytes(b"RIFF")
    monkeypatch.setattr(
        "wordmatch_lid._extract_snippets",
        lambda _path: [("agent#1", snippet)],
    )

    def _auto(_path):
        return "ನಾನು ನನ್ನ ಖಾತೆ ಇದೆ ಹಣ"

    def _forced(_path, code):
        if code == "hi":
            return "नमस्कार मैं आपकी क्या मदद कर सकता हूँ आपका खाता"
        return "hello there"

    language, _debug = detect_language_wordmatch(Path("call.wav"), _auto, _forced)
    assert language == "Hindi"


def test_real_kannada_survives_forced_hindi_check(tmp_path, monkeypatch):
    snippet = tmp_path / "a.wav"
    snippet.write_bytes(b"RIFF")
    monkeypatch.setattr(
        "wordmatch_lid._extract_snippets",
        lambda _path: [("agent#1", snippet)],
    )
    kannada = "ನಾನು ನನ್ನ ಖಾತೆ ಇದೆ ನಿಮ್ಮ ಸಹಾಯ ಬೇಕು ಧನ್ಯವಾದ"

    def _auto(_path):
        return kannada

    def _forced(_path, code):
        if code == "kn":
            return kannada
        return "hello"

    language, _debug = detect_language_wordmatch(Path("call.wav"), _auto, _forced)
    assert language == "Kannada"


def test_marathi_native_beats_hindi_full_sentence():
    text = ("नमस्कार मी बँकेतून बोलतोय तुमचा हप्ता थकबाकी आहे तो लवकर भरा "
            "काय तुम्हाला काही अडचण आहे का धन्यवाद")
    assert _winner(text) == "Marathi"

