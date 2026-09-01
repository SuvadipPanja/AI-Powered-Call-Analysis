# -*- coding: utf-8 -*-
"""Tests for scrub_asr_artifacts — hallucinated non-speech tags on noisy audio.

Run:  python -X utf8 ai-mvp/test_transcript_scrub.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault("TRANSCRIPT_NORMALIZE_ENABLED", "true")

from transcript_normalize import normalize_transcript, scrub_asr_artifacts

FAILURES = []


def check(name, got, expected):
    if got != expected:
        FAILURES.append(f"{name}\n  expected: {expected!r}\n  got:      {got!r}")
    else:
        print(f"OK  {name}")


# 1. Seamless unintelligible markers removed, real words preserved.
check(
    "seamless (()) markers",
    scrub_asr_artifacts("(()) आपके जो (()) payment pending है"),
    "आपके जो payment pending है",
)

# 2. Whisper Devanagari event tag removed (Audio_113 real case).
check("devanagari growl tag", scrub_asr_artifacts("[गुर्राते हुए]"), "")

# 3. English event tags removed mid-sentence.
check(
    "english music tag",
    scrub_asr_artifacts("thank you [music] for calling"),
    "thank you for calling",
)

# 4. Inline speaker tags are ASR junk — the row already carries the speaker.
check(
    "inline agent tag removed",
    scrub_asr_artifacts("[Agent] Good morning, Manisha."),
    "Good morning, Manisha.",
)
check(
    "doubled inline tags removed",
    scrub_asr_artifacts("[Agent] [Agent] Sir बस ये payment भी करना important है"),
    "Sir बस ये payment भी करना important है",
)
check(
    "inline customer tag removed",
    scrub_asr_artifacts("[Customer] नहीं twenty sixth के पहले हो जायेगा"),
    "नहीं twenty sixth के पहले हो जायेगा",
)

# 5. [No speech detected] sentinel preserved.
check(
    "sentinel preserved",
    scrub_asr_artifacts("[No speech detected]"),
    "[No speech detected]",
)

# 6. Music note symbols removed.
check("music notes", scrub_asr_artifacts("♪ ♪ hello ♫"), "hello")

# 7. Bracketed real words (names/amounts) preserved.
check(
    "real bracketed text preserved",
    scrub_asr_artifacts("aapka [EMI amount] due hai"),
    "aapka [EMI amount] due hai",
)

# 8. Full transcript: tag-only turn dropped, mixed turn cleaned.
transcript = (
    "0.00 - 1.00 (Agent): [गुर्राते हुए]\n"
    "1.00 - 2.00 (Customer): हम्म\n"
    "2.00 - 4.00 (Agent): Good morning, Manisha.\n"
    "4.00 - 6.00 (Agent): (()) आपके जो (()) EMI due है"
)
normalized = normalize_transcript(transcript)
check(
    "full transcript scrub",
    normalized,
    "2.00 - 4.00 (Agent): Good morning, Manisha.\n"
    "4.00 - 6.00 (Agent): आपके जो EMI due है",
)

# 9. Devanagari filler "अह" turn drops inside a multi-turn transcript.
# (A transcript that normalizes to fully empty intentionally returns the
# original text — that safeguard is existing behavior, so test in context.)
check(
    "devanagari filler",
    normalize_transcript(
        "0.00 - 1.00 (Customer): अह\n1.00 - 2.00 (Agent): payment due hai"
    ),
    "1.00 - 2.00 (Agent): payment due hai",
)

# 10. Unclear-audio tag in Hindi removed.
check(
    "aspashta tag",
    scrub_asr_artifacts("payment [अस्पष्ट] कर दीजिए"),
    "payment कर दीजिए",
)

if FAILURES:
    print("\n".join(["", "FAILURES:"] + FAILURES))
    sys.exit(1)
print("\nALL PASSED")
