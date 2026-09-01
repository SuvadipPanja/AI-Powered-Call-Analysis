# -*- coding: utf-8 -*-
"""Second-pass referee: when to run Whisper, what to accept.

Run:  python -X utf8 ai-mvp/test_asr_second_pass.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from asr_second_pass import (
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
        "0.0 - 8.0 (Agent): Good morning, I am calling from ICICI Home Finance. Am I speaking with Manisha?",
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
