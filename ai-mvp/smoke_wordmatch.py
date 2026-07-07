"""One-off smoke test: run the wordmatch LID end-to-end on a real call MP3.

Usage:  python smoke_wordmatch.py <audio-file> [expected-language]
Loads Whisper Large V3 from ../models/Whisper-large-v3 on CPU.
"""

import os
import sys
import time
from pathlib import Path

os.environ.setdefault("WHISPER_LANG_MODEL_PATH", str(Path(__file__).resolve().parents[1] / "models" / "Whisper-large-v3"))
os.environ.setdefault("WHISPER_LANG_DEVICE", "cpu")
os.environ.setdefault("AI_WORK_DIR", str(Path(__file__).resolve().parent / "smoke_work"))
os.environ.setdefault("LANG_LID_BACKEND", "wordmatch")

audio = Path(sys.argv[1])
expected = sys.argv[2] if len(sys.argv) > 2 else None
assert audio.is_file(), f"missing audio: {audio}"

import language_worker  # noqa: E402

start = time.time()
result = language_worker.detect_language(audio)
elapsed = time.time() - start

print(f"\nRESULT: {result}  (elapsed {elapsed:.1f}s, expected {expected or 'n/a'})")
if expected and result != expected:
    print("MISMATCH")
    sys.exit(1)
print("SMOKE-OK")
