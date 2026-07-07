"""Tests for deterministic transcript formatting (numbers, amounts, abbreviations)."""

from transcript_format_worker import entity_fallback_line, format_speech_line, format_transcript, polish_english_speech


def test_spelled_credit_card_digits():
    text = (
        "my credit card number is nine eight five four two eight "
        "double one three seven"
    )
    out = format_speech_line(text)
    assert "9854281137" in out
    assert "nine eight" not in out


def test_rupee_paise_amount():
    text = "your account balance is one rupees ninety eight paise"
    out = format_speech_line(text)
    assert "1.98 rupees" in out


def test_rupee_paise_with_and():
    text = "account is now one rupees and ninety nine paise okay"
    out = format_speech_line(text)
    assert "1.99 rupees" in out


def test_messy_rupee_paise_digits():
    text = "account is now 1 rupees and 90 9 paise okay"
    out = format_speech_line(text)
    assert "1.99 rupees" in out


def test_messy_rupee_pesa_typo():
    text = "account is now one rupees and ninety nine pesa"
    out = entity_fallback_line(text)
    assert "1.99 rupees" in out


def test_p_and_b_abbreviation():
    text = "thank you for calling p and b rewards my name is suhasmi"
    out = format_speech_line(text)
    assert "P&B" in out
    assert "p and b" not in out.lower()


def test_xyz_bank_abbreviation():
    text = "welcome to x y z bank my name is charlie"
    out = format_speech_line(text)
    assert "XYZ Bank" in out


def test_diarized_transcript_preserved(monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_FORMAT_NUMBERS_ENABLED", "true")
    import importlib
    import config
    import transcript_format_worker as tfw
    importlib.reload(config)
    importlib.reload(tfw)

    raw = (
        "0.00 - 3.00 (Agent): welcome to x y z bank\n"
        "3.00 - 8.00 (Customer): nine eight five four two eight double one three seven"
    )
    out = tfw.format_transcript(raw)
    assert "XYZ Bank" in out
    assert "9854281137" in out
    assert "(Agent):" in out
    assert "(Customer):" in out


def test_short_digit_words_not_converted():
    # Normal speech — not a digit sequence
    text = "one two three steps"
    out = format_speech_line(text)
    assert out == text


def test_verification_digit_sequence_spaced():
    text = "The number is one two three four five?"
    out = entity_fallback_line(text)
    assert "1 2 3 4 5" in out
    assert "one two three" not in out


def test_count_words_on_banking_line():
    text = (
        "on one date in your account, there was a transaction of 100 rupees, "
        "on two dates there was 200, on three dates there was 300"
    )
    out = entity_fallback_line(text)
    assert "on 1 date" in out
    assert "on 2 dates" in out
    assert "on 3 dates" in out


def test_fifteen_thousand_converts():
    text = "there is fifteen thousand rupees in your account"
    out = entity_fallback_line(text)
    assert "15,000 rupees" in out


def test_hybrid_thousand_reward_points():
    text = "your available points are two thousand 30 2 reward points"
    out = entity_fallback_line(text)
    assert "2,032 reward points" in out


def test_thousand_thirty_two_words():
    text = "you have two thousand thirty two reward points"
    out = entity_fallback_line(text)
    assert "2,032 reward points" in out


def test_p_and_b_in_entity_fallback():
    text = "thank you for calling p and b rewards my name is suhasmi"
    out = entity_fallback_line(text)
    assert "P&B" in out


def test_polish_capitalizes():
    text = "good morning thank you for calling"
    out = polish_english_speech(text)
    assert out.startswith("Good")


def test_five_hundred_eight_rupees():
    text = "your reward balance is five hundred eight rupees"
    out = format_speech_line(text)
    assert "508 rupees" in out
    assert "5 hundred" not in out.lower()
    assert "five hundred" not in out.lower()


def test_five_hundred_and_eight_rupees():
    text = "you have five hundred and eight rupees in rewards"
    out = entity_fallback_line(text)
    assert "508 rupees" in out


def test_finared_eight_means_508():
    text = "your finared 8 rupees reward is available"
    out = format_speech_line(text)
    assert "508 rupees" in out


def test_spoken_digit_amount_508():
    text = "balance shows five zero eight rupees"
    out = format_speech_line(text)
    assert "508 rupees" in out


def test_split_hundred_amount_508():
    text = "available 5 08 rupees in your account"
    out = entity_fallback_line(text)
    assert "508 rupees" in out


def test_five_not_eight_as_508():
    text = "the value will be five not eight rupees"
    out = entity_fallback_line(text)
    assert "508 rupees" in out
    assert "5 not 8" not in out


def test_mixed_hundred_eight_as_508():
    text = "reward balance is five hundred 8 rupees"
    out = entity_fallback_line(text)
    assert "508 rupees" in out


def test_hindi_rupee_paise_entity_fallback():
    text = "बैलेंस एक रुपया और नब्बे पैसे है"
    out = entity_fallback_line(text)
    assert "1.90" in out


def test_bengali_taka_poisa_entity_fallback():
    text = "ব্যালেন্স এক টাকা নব্বই পয়সা"
    out = entity_fallback_line(text)
    assert "1.90" in out


def test_romanized_hindi_hazaar_entity_fallback():
    text = "amount is pandrah hazaar rupaye"
    out = entity_fallback_line(text)
    assert "15,000" in out


def test_romanized_hindi_lakh_entity_fallback():
    text = "loan amount ek lakh rupees"
    out = entity_fallback_line(text)
    assert "100,000" in out


def test_triple_spoken_mobile_digits():
    text = (
        "my registered mobile number is nine eight five triple two "
        "eight one one three seven"
    )
    out = format_speech_line(text)
    assert "9852281137" in out


def test_triple_literal_mixed_mobile_digits():
    text = "My mobile number is 9 8 5 triple 2 8 11 3 7"
    out = format_speech_line(text)
    assert "9852281137" in out
    assert "triple" not in out.lower()


def test_triple_credit_card_sixteen_digits():
    text = (
        "credit card number is four one two three triple four five six "
        "seven eight nine zero one two three four"
    )
    out = format_speech_line(text)
    assert "41234445678901234" in out or "412333445678901234" in out


def test_quadruple_spoken_digit():
    text = "my mobile is nine eight five quadruple two one three seven eight nine zero"
    out = format_speech_line(text)
    assert "9852222137890" in out or "985222137890" in out
