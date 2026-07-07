"""Word-match language detection (LANG_LID_BACKEND=wordmatch).

The user-proven legacy idea (AI/src "2nd step Language_Detection") rebuilt for
the current stack:

  1. Take the FIRST 2 voiced chunks of the AGENT channel and the FIRST 2
     voiced chunks of the CUSTOMER channel (4 snippets, ~10s each).
  2. Whisper transcribes each snippet in AUTO mode — the decoder writes what
     it hears in the language's own script (reliable even when Whisper's
     language-token probabilities are noise, which they are on telephone audio).
  3. Every language is scored by counting dictionary word matches
     (lang_word_dictionaries.py: PSU-banking + everyday words, native script +
     romanized) plus script-character evidence. Highest total wins.
  4. Hindi vs Bengali (the production confusion pair) gets a forced-decode
     word-count tiebreak: transcribe the best snippet forced-hi AND forced-bn,
     count real dictionary words in each output — the language that produces
     real words (not phonetic garbage) wins.

Why this beats probability renormalization: words are direct, explainable
evidence. A Bengali call produces আপনার/আমি/টাকা; a Hindi call produces
आप/है/रुपये. Logs show exactly which words matched, so a wrong result is
debuggable instead of a black box.

This module is self-contained (no language_worker import — avoids circular
imports). language_worker passes its Whisper transcribe functions in.
"""

from __future__ import annotations

import logging
import re
import unicodedata
import uuid
from pathlib import Path
from typing import Callable

import torch
import torchaudio

from audio_io import load_audio, save_audio
from config import (
    LANG_WORDMATCH_CHUNK_SEC,
    LANG_WORDMATCH_CHUNKS_PER_CHANNEL,
    LANG_WORDMATCH_MIN_EVIDENCE,
    LANG_WORDMATCH_TIEBREAK_MARGIN,
    WORK_DIR,
)
from lang_word_dictionaries import (
    ENGLISH_FUNCTION_WORDS as _RAW_ENGLISH,
    LANGUAGE_WORDS as _RAW_LANGUAGE_WORDS,
    NEUTRAL_TERMS as _RAW_NEUTRAL,
)

logger = logging.getLogger(__name__)


def _nfc_set(words) -> frozenset[str]:
    return frozenset(unicodedata.normalize("NFC", w).lower() for w in words)


# NFC-normalize all dictionaries once at import so lookups match _tokenize output
# (Indic combining marks like য় have composed and decomposed encodings).
ENGLISH_FUNCTION_WORDS = _nfc_set(_RAW_ENGLISH)
NEUTRAL_TERMS = _nfc_set(_RAW_NEUTRAL)
LANGUAGE_WORDS: dict[str, dict] = {
    name: {**spec, "native": _nfc_set(spec["native"]), "roman": _nfc_set(spec["roman"])}
    for name, spec in _RAW_LANGUAGE_WORDS.items()
}

TranscribeAutoFn = Callable[[Path], str]
TranscribeForcedFn = Callable[[Path, str], str]


def _log(msg: str, *args) -> None:
    try:
        text = msg % args if args else msg
    except Exception:
        text = msg
    try:
        print(f"[LID-WM] {text}", flush=True)
    except UnicodeEncodeError:
        print(f"[LID-WM] {text}".encode("ascii", "replace").decode("ascii"), flush=True)
    logger.info(msg, *args)


# --- scoring weights -------------------------------------------------------
W_NATIVE_WORD = 3.0        # word in the language's own script — strongest signal
W_ROMAN_WORD = 2.0         # romanized word (Whisper wrote Latin)
W_ENGLISH_WORD = 1.0       # English function word (they are very frequent)
W_SCRIPT_CHAR = 0.05       # per native-script character (shared by script siblings)
SCRIPT_CHAR_CAP = 6.0      # script chars alone can never beat a few real words
W_ASSAMESE_CHAR = 2.0      # ৰ/ৱ appear in Assamese only, never standard Bengali
MIN_ROMAN_LEN = 3          # skip 1-2 letter roman tokens (too noisy across languages)

SCRIPT_RES: dict[str, re.Pattern[str]] = {
    "devanagari": re.compile(r"[\u0900-\u097F]"),
    "bengali": re.compile(r"[\u0980-\u09FF]"),
    "tamil": re.compile(r"[\u0B80-\u0BFF]"),
    "telugu": re.compile(r"[\u0C00-\u0C7F]"),
    "kannada": re.compile(r"[\u0C80-\u0CFF]"),
    "malayalam": re.compile(r"[\u0D00-\u0D7F]"),
    "gujarati": re.compile(r"[\u0A80-\u0AFF]"),
    "gurmukhi": re.compile(r"[\u0A00-\u0A7F]"),
    "odia": re.compile(r"[\u0B00-\u0B7F]"),
}

# Which languages share each script (script chars add evidence to all of them;
# distinctive dictionary words then decide between the siblings).
SCRIPT_FAMILY: dict[str, tuple[str, ...]] = {
    "devanagari": ("Hindi", "Marathi"),
    "bengali": ("Bengali", "Assamese"),
    "tamil": ("Tamil",),
    "telugu": ("Telugu",),
    "kannada": ("Kannada",),
    "malayalam": ("Malayalam",),
    "gujarati": ("Gujarati",),
    "gurmukhi": ("Punjabi",),
    "odia": ("Odia",),
}

# \w alone breaks Indic words apart: dependent vowel signs (matras) and the
# halant are combining marks, which \w does NOT match. Include the full
# Devanagari→Malayalam block range plus ZWJ/ZWNJ so words stay whole.
_TOKEN_RE = re.compile(r"[\w\u0900-\u0D7F\u200C\u200D']+", re.UNICODE)


def _tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFC", text or "")
    tokens = []
    for raw in _TOKEN_RE.findall(text):
        t = raw.replace("\u200C", "").replace("\u200D", "").lower()
        if t:
            tokens.append(t)
    return tokens


def score_transcript(text: str) -> tuple[dict[str, float], dict[str, list[str]]]:
    """Score every language against one transcript.

    Returns (scores, matched_words) — matched_words is kept for logging so a
    wrong detection can be debugged by looking at WHICH words fired.
    """
    scores: dict[str, float] = {name: 0.0 for name in LANGUAGE_WORDS}
    scores["English"] = 0.0
    matched: dict[str, list[str]] = {name: [] for name in scores}

    if not text:
        return scores, matched

    tokens = _tokenize(text)

    # Script-character evidence (shared within a script family, capped).
    for key, rx in SCRIPT_RES.items():
        count = len(rx.findall(text))
        if count <= 0:
            continue
        bonus = min(count * W_SCRIPT_CHAR, SCRIPT_CHAR_CAP)
        for name in SCRIPT_FAMILY[key]:
            scores[name] += bonus

    # Assamese-only characters (deterministic within Bengali script).
    assamese_special = text.count("\u09F0") + text.count("\u09F1")  # ৰ ৱ
    if assamese_special:
        scores["Assamese"] += min(assamese_special * W_ASSAMESE_CHAR, 8.0)
        matched["Assamese"].append(f"ৰ/ৱ×{assamese_special}")

    # Word-dictionary evidence.
    for token in tokens:
        if token in NEUTRAL_TERMS:
            continue
        if token in ENGLISH_FUNCTION_WORDS:
            scores["English"] += W_ENGLISH_WORD
            matched["English"].append(token)
        for name, spec in LANGUAGE_WORDS.items():
            if token in spec["native"]:
                scores[name] += W_NATIVE_WORD
                matched[name].append(token)
            elif len(token) >= MIN_ROMAN_LEN and token in spec["roman"]:
                scores[name] += W_ROMAN_WORD
                matched[name].append(token)

    return scores, matched


def _native_word_hits(text: str, language: str) -> int:
    """Count distinct native-script dictionary words of `language` in text."""
    spec = LANGUAGE_WORDS.get(language)
    if not spec or not text:
        return 0
    return len(set(_tokenize(text)) & spec["native"])


# --- snippet extraction ----------------------------------------------------

def _first_voiced_chunks(
    channel_wave: torch.Tensor,
    sample_rate: int,
    chunk_sec: float,
    count: int,
) -> list[torch.Tensor]:
    """First `count` voiced windows of `chunk_sec` from one channel.

    Frames of 0.5s are energy-scored; a chunk starts at the first voiced frame
    and runs chunk_sec; the next chunk starts at the next voiced frame after
    the previous chunk ends. Mirrors "1st and 2nd agent/customer chunk".
    """
    frame = int(0.5 * sample_rate)
    mono = channel_wave.mean(dim=0)
    n_frames = max(1, mono.shape[0] // frame)

    energies = [float(mono[i * frame:(i + 1) * frame].pow(2).mean()) for i in range(n_frames)]
    sorted_e = sorted(energies)
    median = sorted_e[len(sorted_e) // 2]
    threshold = max(median * 0.5, 1e-6)

    chunks: list[torch.Tensor] = []
    chunk_samples = int(chunk_sec * sample_rate)
    i = 0
    while i < n_frames and len(chunks) < count:
        if energies[i] >= threshold:
            start = i * frame
            piece = channel_wave[:, start:start + chunk_samples]
            if piece.shape[1] >= sample_rate * 2:  # at least 2s of audio
                chunks.append(piece)
            i += max(1, chunk_samples // frame)
        else:
            i += 1
    return chunks


def _extract_snippets(audio_path: Path) -> list[tuple[str, Path]]:
    """(label, wav_path) snippets: first N agent chunks + first N customer chunks."""
    waveform, sample_rate = load_audio(audio_path)
    if sample_rate != 16000:
        waveform = torchaudio.transforms.Resample(sample_rate, 16000)(waveform)
        sample_rate = 16000

    if waveform.shape[0] >= 2:
        channels = [("agent", waveform[0:1]), ("customer", waveform[1:2])]
    else:
        channels = [("mix", waveform[0:1])]

    snippets: list[tuple[str, Path]] = []
    for label, chan in channels:
        if float(chan.abs().mean()) < 1e-4:
            _log("channel %s near-silent — skipped", label)
            continue
        chunks = _first_voiced_chunks(
            chan, sample_rate, LANG_WORDMATCH_CHUNK_SEC, LANG_WORDMATCH_CHUNKS_PER_CHANNEL
        )
        for n, piece in enumerate(chunks, start=1):
            out = WORK_DIR / f"lidwm_{audio_path.stem}_{label}{n}_{uuid.uuid4().hex[:6]}.wav"
            save_audio(out, piece, sample_rate)
            snippets.append((f"{label}#{n}", out))
    return snippets


# --- decision --------------------------------------------------------------

def detect_language_wordmatch(
    audio_path: Path,
    transcribe_auto: TranscribeAutoFn,
    transcribe_forced: TranscribeForcedFn,
) -> tuple[str, dict]:
    """Run the word-match pipeline. Returns (language, debug) — language is
    "Unknown" when there is not enough word evidence (caller decides fallback).
    """
    snippets = _extract_snippets(audio_path)
    if not snippets:
        return "Unknown", {"reason": "no_voiced_snippets"}

    totals: dict[str, float] = {}
    all_matches: dict[str, list[str]] = {}
    transcripts: list[tuple[str, Path, str]] = []

    try:
        for label, path in snippets:
            try:
                text = transcribe_auto(path)
            except Exception as exc:
                _log("snippet %s transcribe failed: %s", label, exc)
                continue
            transcripts.append((label, path, text))
            scores, matched = score_transcript(text)
            top3 = sorted(scores.items(), key=lambda x: -x[1])[:3]
            _log("snippet %s: %s | text='%.80s'",
                 label, [(n, round(s, 1)) for n, s in top3 if s > 0], text)
            for name, s in scores.items():
                totals[name] = totals.get(name, 0.0) + s
            for name, words in matched.items():
                if words:
                    all_matches.setdefault(name, []).extend(words)

        if not totals or max(totals.values()) < LANG_WORDMATCH_MIN_EVIDENCE:
            _log("insufficient word evidence (max=%.1f < %.1f)",
                 max(totals.values()) if totals else 0.0, LANG_WORDMATCH_MIN_EVIDENCE)
            return "Unknown", {"reason": "insufficient_evidence", "totals": totals}

        ranking = sorted(totals.items(), key=lambda x: -x[1])
        winner, w_score = ranking[0]
        forced_checked = False
        _log("totals: %s", [(n, round(s, 1)) for n, s in ranking if s > 0][:5])

        # English cross-check. Whisper sometimes writes garbled ENGLISH text for
        # Hindi/Bengali telephone audio ("I am a person who started my account"),
        # which would wrongly fire English function words. Discriminator: force-
        # transcribe the first agent snippet as hi and bn and count NATIVE
        # DICTIONARY words. Real Hindi speech yields real Hindi function words
        # (है/आपका/हैं); English speech forced-hi yields only transliterated
        # English (डेट ऑफ बर्स्टे) which matches nothing in the dictionary.
        if winner == "English":
            best_indic = next(((n, s) for n, s in ranking if n != "English" and s > 0), None)
            native_chars = sum(
                len(rx.findall(t)) for _, _, t in transcripts for rx in SCRIPT_RES.values()
            )
            if best_indic and native_chars >= 10:
                winner, w_score = best_indic
                _log("English demoted (native_chars=%d) → %s", native_chars, winner)
            else:
                best_path = transcripts[0][1] if transcripts else snippets[0][1]
                try:
                    hi_text = transcribe_forced(best_path, "hi")
                    bn_text = transcribe_forced(best_path, "bn")
                    hi_hits = _native_word_hits(hi_text, "Hindi")
                    bn_hits = _native_word_hits(bn_text, "Bengali")
                    forced_checked = True
                    _log("English cross-check: hi_hits=%d bn_hits=%d | hi='%.60s' bn='%.60s'",
                         hi_hits, bn_hits, hi_text, bn_text)
                    if max(hi_hits, bn_hits) >= 2:
                        winner = "Hindi" if hi_hits >= bn_hits else "Bengali"
                        _log("English rejected — real %s words under forced decode", winner)
                except Exception as exc:
                    _log("English cross-check failed (%s) — keeping English", exc)

        # Hindi/Bengali forced-decode WORD tiebreak (the production confusion pair).
        hi_s, bn_s = totals.get("Hindi", 0.0), totals.get("Bengali", 0.0)
        if (
            not forced_checked
            and winner in ("Hindi", "Bengali")
            and abs(hi_s - bn_s) < LANG_WORDMATCH_TIEBREAK_MARGIN
        ):
            best_path = transcripts[0][1] if transcripts else snippets[0][1]
            try:
                hi_text = transcribe_forced(best_path, "hi")
                bn_text = transcribe_forced(best_path, "bn")
                hi_hits = _native_word_hits(hi_text, "Hindi")
                bn_hits = _native_word_hits(bn_text, "Bengali")
                _log("hi/bn word tiebreak: hi_hits=%d bn_hits=%d | hi='%.60s' bn='%.60s'",
                     hi_hits, bn_hits, hi_text, bn_text)
                if hi_hits != bn_hits:
                    winner = "Hindi" if hi_hits > bn_hits else "Bengali"
            except Exception as exc:
                _log("hi/bn tiebreak failed (%s) — keeping %s", exc, winner)

        debug = {
            "totals": {n: round(s, 1) for n, s in ranking if s > 0},
            "matched": {n: sorted(set(w))[:12] for n, w in all_matches.items() if w},
            "snippets": [lbl for lbl, _, _ in transcripts],
        }
        _log("wordmatch decision: %s (matched: %s)",
             winner, debug["matched"].get(winner, [])[:8])
        return winner, debug
    finally:
        for _, path in snippets:
            path.unlink(missing_ok=True)
