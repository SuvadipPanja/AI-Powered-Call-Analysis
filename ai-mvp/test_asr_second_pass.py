# -*- coding: utf-8 -*-
"""Second-pass referee: when to run Whisper, what to accept.

Run:  python -X utf8 ai-mvp/test_asr_second_pass.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_second_pass import (
    due_conflict_windows,
    entities_need_second_pass,
    implausible_windows,
    opening_is_weak,
    pick_opening,
    row_is_implausible,
    splice_second_pass_opening,
    splice_window,
)

FAILURES = []


def check(name, got, expected):
    if got != expected:
        FAILURES.append(f"{name}\n  expected: {expected!r}\n  got:      {got!r}")
    else:
        print(f"OK  {name}")


audio113_opening = (
    "Hey, yes sir They live together. Good morning, Manisha is speaking. "
    "I'm speaking to you from Haji."
)
check("audio113 opening is weak", opening_is_weak(audio113_opening), True)
check(
    "clean ICICI opening is not weak",
    opening_is_weak(
        "Good morning, I am calling from ICICI Home Finance. Am I speaking with Manisha?"
    ),
    False,
)
check("empty opening is weak", opening_is_weak(""), True)

# Real Audio_113 shapes: Seamless writes 15 fluent Devanagari words of the
# wrong company; Whisper smears the markers into longer tokens.
seamless_hindi_opening = (
    "बुध मॉर्निंग मनीशा बात करें ऐसे चोव फाइनस के तरफ तेहार जी से बात हो रही मेरी"
)
whisper_hindi_opening = (
    "वुद्ध वॉनिंग मनीशा बात करें ऐसे चोड़ फाइनस के तरफ ते हर जी से बात हो रही मेरी "
    "जिस अपारिकोर्ट क्या जा रहा है कॉलिटेन ट्रेनिंग परपस के लिए"
)
check(
    "fluent Devanagari opening without markers is still weak",
    opening_is_weak(seamless_hindi_opening),
    True,
)
check(
    "smeared Devanagari recording-notice counts as a marker",
    opening_is_weak(whisper_hindi_opening),
    False,
)
check(
    "whisper opening with recording notice beats marker-less Seamless",
    pick_opening(seamless_hindi_opening, whisper_hindi_opening),
    whisper_hindi_opening,
)

check(
    "conflicting due days need second pass",
    entities_need_second_pass(
        "last number 0382 with a date of 20th. Today is the 19th and the 20th "
        "has already passed. Your payment is due on the 10th. Total amount 60652."
    ),
    True,
)
check(
    "single due day does not need second pass",
    entities_need_second_pass("Your EMI due date is the 10th. Amount is 30154 rupees."),
    False,
)

primary = audio113_opening
whisper_good = (
    "Good morning, I am calling from ICICI Home Finance. Am I speaking with Manisha?"
)
check(
    "accept whisper ICICI when primary is Haji/self-intro",
    pick_opening(primary, whisper_good),
    whisper_good,
)
check(
    "reject whisper junk when primary already has script",
    pick_opening(whisper_good, "What's up? They live together."),
    whisper_good,
)
check(
    "reject empty whisper",
    pick_opening(primary, ""),
    primary,
)
check(
    "do not invent ICICI — pick only among inputs",
    pick_opening("Good morning sir", "Hello, how are you today madam"),
    "Good morning sir",
)

lines = [
    "0.0 - 1.0 (Agent): Hey, yes sir",
    "1.0 - 2.0 (Customer): Hello",
    "3.0 - 4.0 (Agent): Good morning, Manisha is speaking.",
    "4.0 - 8.0 (Agent): I'm speaking to you from Haji.",
    "8.0 - 9.0 (Customer): Yes, go ahead",
    "10.0 - 12.0 (Agent): Your loan has a last number 0382",
]
got = splice_second_pass_opening(lines, whisper_good, 20.0)
check(
    "second-pass opening replaces weak agent turns only",
    got,
    [
        # Span runs to the decode-window end (20s), not to the last replaced
        # row, so the splice never looks like impossible speech to the
        # implausibility referee.
        "0.0 - 20.0 (Agent): Good morning, I am calling from ICICI Home Finance. Am I speaking with Manisha?",
        "1.0 - 2.0 (Customer): Hello",
        "8.0 - 9.0 (Customer): Yes, go ahead",
        "10.0 - 12.0 (Agent): Your loan has a last number 0382",
    ],
)
check(
    "second-pass no-op when whisper is junk",
    splice_second_pass_opening(lines, "What's up?", 20.0),
    lines,
)

import pathlib

tr = pathlib.Path(__file__).with_name("transcribe.py").read_text(encoding="utf-8")
if "splice_second_pass_opening(" not in tr:
    FAILURES.append("transcribe.py does not call splice_second_pass_opening")
else:
    print("OK  transcribe calls second-pass splice")
if "FASTER_WHISPER_ASR_LANGUAGES=Hindi" in tr:
    FAILURES.append("transcribe.py must not force Hindi onto Whisper routing")

if FAILURES:
    print("\nFAILURES:\n" + "\n".join(FAILURES))
    sys.exit(1)
print("\nALL PASSED")


def test_a_one_second_turn_with_a_full_sentence_is_implausible():
    # Seamless answered a 1.0s micro-turn with "वे एक-दूसरे के साथ रहते हैं"
    assert row_is_implausible(1.0, 2.0, "वे एक-दूसरे के साथ रहते हैं", 4.5) is True


def test_a_short_backchannel_is_plausible_and_must_not_be_flagged():
    assert row_is_implausible(1.0, 2.0, "हाँ जी", 4.5) is False


def test_a_long_turn_with_many_words_is_plausible():
    text = " ".join(["शब्द"] * 60)
    assert row_is_implausible(10.0, 30.0, text, 4.5) is False


def test_a_zero_length_row_is_never_flagged():
    assert row_is_implausible(5.0, 5.0, "कुछ शब्द यहाँ", 4.5) is False


def test_implausible_windows_merges_a_burst_of_bad_rows_into_one_span():
    lines = [
        "0.0 - 1.0 (Agent): यार, हाँ जी",
        "1.0 - 2.0 (Agent): वे एक-दूसरे के साथ रहते हैं",
        "2.0 - 2.5 (Customer): Hello",
        "3.0 - 4.0 (Agent): I'm talking to you from Haji today sir",
        "40.0 - 70.0 (Agent): " + " ".join(["ठीक"] * 40),
    ]
    windows = implausible_windows(lines, 4.5, 6)
    # The 0.0-1.0 row is a 3-word backchannel at 3.0 words/sec, so the span
    # starts at the first suspect row rather than at the first agent row.
    assert windows == [(1.0, 4.0, "Agent")]


def test_implausible_windows_respects_the_per_call_ceiling():
    lines = [
        f"{i}.0 - {i + 1}.0 (Agent): यह एक बहुत लंबा वाक्य है जी"
        for i in range(0, 40, 4)
    ]
    assert len(implausible_windows(lines, 4.5, 3)) == 3


def test_clean_transcript_yields_no_windows():
    lines = [
        "0.0 - 6.0 (Agent): गुड मॉर्निंग सर मैं आईसीआईसीआई होम फाइनेंस से बोल रही हूँ",
        "6.0 - 8.0 (Customer): जी बोलिए",
    ]
    assert implausible_windows(lines, 4.5, 6) == []


# Audio_113 row shapes: due day conflicts (20 vs 19 vs 10) across agent rows.
AUDIO113_LINES = [
    "0.0 - 1.0 (Agent): बुध मॉर्निंग मनीशा बात करें ऐसे चोव फाइनस के तरफ",
    "1.0 - 2.0 (Customer): हेलो",
    "10.0 - 26.0 (Agent): आपके जो लोन चला है लोन की लास्ट नंबर 0382 20 तारीख की डेट है",
    "33.0 - 38.0 (Customer): नहीं 26 तारीख के पहले हो जायेगा",
    "38.0 - 74.0 (Agent): आज 19 तारीख हो गई है 10 तारीख है ना सर टोटल अमाउंट 6005",
    "131.0 - 137.0 (Agent): बस सर काफी लेट हो जायेगा छब्बीस तारीख आप जो बोल रहे हो",
    "143.0 - 159.0 (Agent): पच्चीस तक की पेमेंट आज उन्नीस तारीख हो गई है सर दस तारीख का है",
]


def test_due_conflict_windows_picks_agent_day_rows_within_the_gpu_cap():
    # The 36s row is skipped (GPU window cap), the customer row is never
    # selected, day words like छब्बीस count as day mentions.
    assert due_conflict_windows(AUDIO113_LINES, 4) == [
        (10.0, 26.0, "Agent"),
        (131.0, 137.0, "Agent"),
        (143.0, 159.0, "Agent"),
    ]


def test_due_conflict_windows_respects_max_windows():
    assert due_conflict_windows(AUDIO113_LINES, 1) == [(10.0, 26.0, "Agent")]


def test_due_conflict_windows_stays_closed_without_a_day_conflict():
    lines = [
        "0.0 - 6.0 (Agent): गुड मॉर्निंग सर मैं आईसीआईसीआई होम फाइनेंस से बोल रही हूँ",
        "10.0 - 16.0 (Agent): आपका ईएमआई 10 तारीख का है सर",
        "16.0 - 18.0 (Customer): जी बोलिए",
    ]
    assert due_conflict_windows(lines, 4) == []


def test_transcribe_wires_entity_windows_with_a_digit_guard():
    import pathlib

    src = pathlib.Path(__file__).with_name("transcribe.py").read_text(encoding="utf-8")
    assert "due_conflict_windows(" in src
    assert "no digits in referee text" in src


def test_splice_window_replaces_every_row_of_that_speaker_in_the_span():
    lines = [
        "0.0 - 1.0 (Agent): यार, हाँ जी",
        "1.0 - 2.0 (Agent): वे एक-दूसरे के साथ रहते हैं",
        "2.0 - 2.5 (Customer): Hello",
        "3.0 - 4.0 (Agent): from Haji",
        "5.0 - 9.0 (Agent): आपके loan की last number 0382",
    ]
    out = splice_window(
        lines,
        0.0,
        4.0,
        "Agent",
        "गुड मॉर्निंग मैं आईसीआईसीआई होम फाइनेंस से मनीषा बोल रही हूँ",
    )
    assert out == [
        "0.0 - 4.0 (Agent): गुड मॉर्निंग मैं आईसीआईसीआई होम फाइनेंस से मनीषा बोल रही हूँ",
        "2.0 - 2.5 (Customer): Hello",
        "5.0 - 9.0 (Agent): आपके loan की last number 0382",
    ]


def test_splice_window_with_empty_text_is_a_no_op():
    lines = ["0.0 - 1.0 (Agent): यार, हाँ जी"]
    assert splice_window(lines, 0.0, 1.0, "Agent", "   ") == lines
