# -*- coding: utf-8 -*-
"""Regression tests for transcript_normalize (grapheme-safety + filler/repeat).

Run:  python -X utf8 ai-mvp/test_normalize_repro.py   (needs config importable)
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TRANSCRIPT_NORMALIZE_ENABLED", "true")

from transcript_normalize import _strip_fillers_and_repeats, normalize_transcript

FAILURES = []


def check(name, got, expected):
    if got != expected:
        FAILURES.append(f"{name}\n  expected: {expected!r}\n  got:      {got!r}")
    else:
        print(f"OK  {name}")


# 1. Bengali script must pass through byte-exact (no grapheme splitting).
bengali = "হ্যালো নমস্কার XYZ ব্যাংকে আপনাকে স্বাগত জানাই"
check("bengali untouched", _strip_fillers_and_repeats(bengali), bengali)

# 2. Bengali with a repeated word collapses but keeps graphemes intact.
check(
    "bengali repeat collapse",
    _strip_fillers_and_repeats("হ্যাঁ, হ্যাঁ, হ্যাঁ।"),
    "হ্যাঁ,",
)

# 3. Output is never longer than input (the prod bug grew 1505→1958 chars).
long_bn = " ".join(["আপনাকে কিভাবে সাহায্য করতে পারি"] * 10)
assert len(_strip_fillers_and_repeats(long_bn)) <= len(long_bn), "output grew!"
print("OK  output never grows")

# 4. English fillers dropped, immediate repeats collapsed.
check(
    "english fillers/repeats",
    _strip_fillers_and_repeats("madam basically basically ma'am uh I want to redeem"),
    "madam basically ma'am I want to redeem",
)

# 5. Hyphen/number/contraction/punctuation preserved verbatim.
keep = "two-minute hold; 9,000 rupees T+ app, ma'am."
check("punctuation preserved", _strip_fillers_and_repeats(keep), keep)

# 6. mm-hmm style fillers (with hyphen) still dropped.
check("hyphen filler dropped", _strip_fillers_and_repeats("mm-hmm okay"), "okay")

# 7. Full transcript: filler-only turn dropped, prefixes kept.
transcript = (
    "0.00 - 2.00 (Agent): thank you\n"
    "2.00 - 3.00 (Customer): mm\n"
    "3.00 - 6.00 (Agent): good good morning sir"
)
expected = (
    "0.00 - 2.00 (Agent): thank you\n"
    "3.00 - 6.00 (Agent): good morning sir"
)
check("full transcript", normalize_transcript(transcript), expected)

# 8. Devanagari (Hindi) untouched.
hindi = "नमस्ते मैं आपकी क्या सहायता कर सकता हूँ"
check("hindi untouched", _strip_fillers_and_repeats(hindi), hindi)

if FAILURES:
    print("\n".join(["", "FAILURES:"] + FAILURES))
    sys.exit(1)
print("\nALL PASSED")
