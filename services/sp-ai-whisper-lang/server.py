"""sp-ai-whisper-lang — language-detection HTTP service (port 8010).

Thin HTTP wrapper around the CURRENT production LID pipeline in
``ai-mvp/language_worker.py`` (Whisper Large V3 first-token LID + English
guard + hi/bn acoustic disambiguation + IndicLID text hints), muxed with the
OLD ``AI/src/2nd step Language_Detection`` concept: energy-ranked multi-window
sampling across the whole call with a majority / confidence-weighted vote.

Deployment: this file is copied into the image as ``/app/lang_service_server.py``
next to the full ai-mvp code base, so every ai-mvp module (``language_worker``,
``log_setup``, ``audio_io``, ``config``, ...) is a plain top-level import.

HTTP contract (FROZEN): production/docs/AI-STACK-SPEC.md §3
  GET  /health          -> {ready, service, models, device, error, uptime_sec, threads}
  POST /detect-language -> multipart ``file`` (+ optional form ``audio_id``)
                           -> {success, language, confidence, method, details}
"""

from __future__ import annotations

# SPEC §7: initialise shared logging BEFORE any other ai-mvp import can log.
from log_setup import init_service_logging

logger = init_service_logging("sp-ai-whisper-lang")

import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

from flask import Flask, jsonify, request

try:
    from audio_io import load_audio, save_audio
    from language_worker import detect_language, language_health

    _IMPORT_ERROR: str | None = None
except Exception as exc:  # pragma: no cover — base image always ships ai-mvp
    load_audio = save_audio = detect_language = language_health = None  # type: ignore[assignment]
    _IMPORT_ERROR = f"ai-mvp modules unavailable: {exc}"
    logger.exception("Failed to import ai-mvp modules")


# --------------------------------------------------------------------------
# Env (read here per spec — config.py is owned by agent CTRL, do not touch)
# --------------------------------------------------------------------------

def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("Invalid %s — using default %d", name, default)
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        logger.warning("Invalid %s — using default %s", name, default)
        return default


SERVICE_NAME = "sp-ai-whisper-lang"
MULTI_CHUNK = _env_bool("AI_LANG_MULTI_CHUNK", True)
CHUNK_COUNT = max(1, _env_int("AI_LANG_CHUNK_COUNT", 4))
CHUNK_SEC = max(5.0, _env_float("AI_LANG_CHUNK_SEC", 20.0))
THREADS = _env_int("AI_SERVICE_THREADS", 4)
# Same tunable name/default as the legacy AI/src language_detection service.
SILENCE_RMS = _env_float("LANG_SILENCE_RMS", 0.004)
FFMPEG_TIMEOUT_SEC = 120

_START_MONOTONIC = time.monotonic()
_MODEL_LOCK = threading.Lock()  # one GPU inference at a time; HTTP threads queue here

app = Flask(__name__)


# --------------------------------------------------------------------------
# Eager model load at import time (SPEC §1: models resident before request #1).
# language_health() drives language_worker._load_transformers_whisper() and
# never raises by contract, but we still guard and keep the error for /health.
# --------------------------------------------------------------------------

_STARTUP_ERROR: str | None = _IMPORT_ERROR

if _IMPORT_ERROR is None:
    try:
        logger.info("Eager-loading Whisper Large V3 LID model (may take a while on first boot)...")
        _t0 = time.monotonic()
        _boot_health = language_health()
        if _boot_health.get("ready"):
            logger.info(
                "Whisper LID model resident in %.1fs (device=%s, method=%s, multi_chunk=%s count=%d win=%.0fs)",
                time.monotonic() - _t0,
                _boot_health.get("device"),
                _boot_health.get("method"),
                MULTI_CHUNK, CHUNK_COUNT, CHUNK_SEC,
            )
        else:
            _STARTUP_ERROR = str(_boot_health.get("error") or "language model failed to load")
            logger.error("Whisper LID eager load failed: %s", _STARTUP_ERROR)
    except Exception as exc:  # defensive — must never crash-loop the container
        _STARTUP_ERROR = str(exc)
        logger.exception("Whisper LID eager load crashed")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

def _resolve_device() -> str:
    """Mirror language_worker._tw_device() without importing private names."""
    pref = os.getenv("WHISPER_LANG_DEVICE", "auto").strip().lower()
    try:
        import torch

        has_cuda = torch.cuda.is_available()
    except Exception:
        has_cuda = False
    if pref == "cpu":
        return "cpu"
    return "cuda" if has_cuda else "cpu"


def _safe_suffix(filename: str) -> str:
    suffix = Path(filename or "").suffix.lower()
    return suffix if re.fullmatch(r"\.[a-z0-9]{1,8}", suffix) else ".bin"


def _normalize_to_wav(src: Path, tmp_dir: Path) -> Path:
    """Re-encode the upload (wav/mp3/...) to 16 kHz PCM wav via ffmpeg.

    Channel layout is PRESERVED (no -ac) so language_worker's customer-channel
    selection for stereo calls keeps working. Falls back to the original file
    when ffmpeg fails — soundfile still reads plain wavs directly.
    """
    dst = tmp_dir / "normalized_16k.wav"
    cmd = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(src), "-ar", "16000", "-acodec", "pcm_s16le", str(dst),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=FFMPEG_TIMEOUT_SEC)
        if proc.returncode == 0 and dst.is_file() and dst.stat().st_size > 44:
            return dst
        stderr = (proc.stderr or b"").decode("utf-8", "replace")[-300:]
        logger.warning("ffmpeg normalize failed (rc=%s): %s — using original upload",
                       proc.returncode, stderr)
    except Exception as exc:
        logger.warning("ffmpeg normalize crashed: %s — using original upload", exc)
    return src


def _detect_single(wav_path: Path) -> dict:
    """Current production behavior: one detect_language() pass on the whole file."""
    with _MODEL_LOCK:
        language = detect_language(wav_path)
    return {
        "language": language,
        "confidence": 1.0,
        "method": "whisper-v3",
        "details": {"multi_chunk": False},
    }


def _detect_multi_chunk(wav_path: Path, tmp_dir: Path, audio_id: str) -> dict | None:
    """Old AI/src chunk-vote concept layered over the current detect_language().

    Algorithm:
      1. Pick up to CHUNK_COUNT windows of CHUNK_SEC evenly spread over the call.
      2. Rank windows by RMS energy (mono mix); drop near-silent ones (legacy floor).
      3. Run the CURRENT full detect_language() on the best-energy window and on
         each remaining usable window (all serialized under the model lock).
      4. Energy-weighted vote across window results. The highest-energy window is
         the anchor: if the vote winner differs, keep the anchor's language and
         log the disagreement loudly (unless the anchor said "Unknown").

    Returns None when voting is not applicable (short audio / all windows silent
    / detections failed) — caller falls back to the single-pass behavior.
    """
    waveform, sr = load_audio(wav_path)
    total = int(waveform.shape[1])
    win = int(CHUNK_SEC * sr)
    if win <= 0 or total < int(win * 1.5):
        logger.info("[LID-VOTE] audio %.1fs too short for %d-sec windows — single-pass",
                    total / sr, int(CHUNK_SEC))
        return None

    # Number of mostly-non-overlapping windows that fit, capped by env.
    n_fit = (total // win) + (1 if (total % win) >= win // 2 else 0)
    n_windows = min(CHUNK_COUNT, n_fit)
    if n_windows < 2:
        return None

    span = total - win
    starts = sorted({int(round(i * span / (n_windows - 1))) for i in range(n_windows)})

    mono = waveform.mean(dim=0)
    windows = []
    for start in starts:
        seg = mono[start:start + win]
        rms = float(seg.pow(2).mean().sqrt().item()) if seg.numel() else 0.0
        windows.append({"start": start, "rms": rms})

    usable = [w for w in windows if w["rms"] >= SILENCE_RMS]
    skipped_silent = len(windows) - len(usable)
    if not usable:
        logger.info("[LID-VOTE] all %d windows near-silent (rms<%.4f) — single-pass",
                    len(windows), SILENCE_RMS)
        return None
    usable.sort(key=lambda w: -w["rms"])  # energy-ranked, best window first

    per_window: list[dict] = []
    for rank, wdw in enumerate(usable):
        wpath = tmp_dir / f"lid_window_{rank}_{wdw['start']}.wav"
        save_audio(wpath, waveform[:, wdw["start"]:wdw["start"] + win], sr)
        start_sec = wdw["start"] / sr
        try:
            with _MODEL_LOCK:
                lang = detect_language(wpath)
        except Exception as exc:
            logger.warning("[LID-VOTE] window @%.1fs detection failed: %s", start_sec, exc)
            continue
        logger.info("[LID-VOTE] window %d/%d @%.1fs rms=%.4f -> %s",
                    rank + 1, len(usable), start_sec, wdw["rms"], lang)
        per_window.append({"start_sec": start_sec, "rms": wdw["rms"], "language": lang})

        # Early exit: unanimous on first 2 usable windows saves ~50% LID time.
        if len(per_window) >= 2:
            langs = {r["language"] for r in per_window}
            if len(langs) == 1 and "Unknown" not in langs:
                logger.info(
                    "[LID-VOTE] early unanimous %s after %d windows — skipping rest",
                    per_window[0]["language"], len(per_window),
                )
                break

    if not per_window:
        logger.warning("[LID-VOTE] every window detection failed — single-pass fallback")
        return None

    counts = Counter(r["language"] for r in per_window)
    weights: dict[str, float] = defaultdict(float)
    for r in per_window:
        weights[r["language"]] += r["rms"]
    total_weight = sum(weights.values()) or 1.0

    # "Unknown" votes never outrank a real language.
    candidates = {l: w for l, w in weights.items() if l != "Unknown"} or dict(weights)
    vote_winner = max(candidates, key=lambda l: candidates[l])

    best = per_window[0]  # current-logic result on the highest-energy window
    final = best["language"]
    disagreement = vote_winner != best["language"]
    if disagreement:
        if best["language"] == "Unknown":
            final = vote_winner  # anchor inconclusive — trust the vote
            logger.warning(
                "[LID-VOTE] DISAGREEMENT%s: best-energy window said Unknown — using vote winner %r (votes=%s)",
                f" audio_id={audio_id}" if audio_id else "", vote_winner, dict(counts),
            )
        elif vote_winner in ("Bengali", "Hindi") and best["language"] == "English":
            # Legacy AI/src multi-chunk vote: customer Bengali/Hindi windows must not
            # lose to a single high-energy English agent-greeting window.
            indic_weight = weights.get("Bengali", 0.0) + weights.get("Hindi", 0.0)
            en_weight = weights.get("English", 0.0)
            indic_votes = counts.get("Bengali", 0) + counts.get("Hindi", 0)
            if indic_weight > en_weight or indic_votes >= 2:
                final = vote_winner
                logger.warning(
                    "[LID-VOTE] DISAGREEMENT%s: preferring indic vote winner %r over English "
                    "anchor %r (votes=%s weighted indic=%.3f en=%.3f)",
                    f" audio_id={audio_id}" if audio_id else "",
                    vote_winner, best["language"], dict(counts),
                    indic_weight / total_weight, en_weight / total_weight,
                )
            else:
                logger.warning(
                    "[LID-VOTE] DISAGREEMENT%s: keeping English anchor %r over indic vote %r "
                    "(votes=%s weighted indic=%.3f en=%.3f)",
                    f" audio_id={audio_id}" if audio_id else "",
                    best["language"], vote_winner, dict(counts),
                    indic_weight / total_weight, en_weight / total_weight,
                )
        elif vote_winner == "English" and best["language"] in ("Bengali", "Hindi"):
            final = best["language"]
            logger.warning(
                "[LID-VOTE] DISAGREEMENT%s: keeping indic anchor %r over English vote %r (votes=%s)",
                f" audio_id={audio_id}" if audio_id else "",
                best["language"], vote_winner, dict(counts),
            )
        else:
            logger.warning(
                "[LID-VOTE] DISAGREEMENT%s: vote winner %r (votes=%s weighted=%s) != best-energy "
                "window %r (@%.1fs rms=%.4f) — preferring best-energy window result",
                f" audio_id={audio_id}" if audio_id else "",
                vote_winner, dict(counts),
                {l: round(w / total_weight, 3) for l, w in weights.items()},
                best["language"], best["start_sec"], best["rms"],
            )

    confidence = round(weights.get(final, 0.0) / total_weight, 3)
    if len(per_window) == 1:
        confidence = 1.0

    return {
        "language": final,
        "confidence": confidence,
        "method": "whisper-v3+chunk-vote",
        "details": {
            "multi_chunk": True,
            "votes": dict(counts),
            "weighted_votes": {l: round(w / total_weight, 3) for l, w in weights.items()},
            "windows": [
                {"start_sec": round(r["start_sec"], 1), "rms": round(r["rms"], 5),
                 "language": r["language"]}
                for r in per_window
            ],
            "windows_skipped_silent": skipped_silent,
            "chunk_sec": CHUNK_SEC,
            "best_window_language": best["language"],
            "vote_winner": vote_winner,
            "unanimous": len(counts) == 1,
            "disagreement": disagreement,
        },
    }


# --------------------------------------------------------------------------
# Endpoints (SPEC §3)
# --------------------------------------------------------------------------

@app.get("/health")
def health():
    ready = False
    device = _resolve_device()
    error: str | None = _STARTUP_ERROR
    models = {"whisper-large-v3-lid": "error", "indiclid": "unavailable"}

    if _IMPORT_ERROR is None:
        try:
            h = language_health()  # cheap once loaded; returns cached error otherwise
            ready = bool(h.get("ready"))
            if ready:
                models["whisper-large-v3-lid"] = "loaded"
                device = h.get("device") or device
                error = None
            else:
                error = str(h.get("error") or error or "language model not ready")
            indic = h.get("indiclid") or {}
            if indic.get("ready"):
                models["indiclid"] = "loaded"
        except Exception as exc:  # defensive — health must always answer
            error = str(exc)

    payload = {
        "ready": ready,
        "service": SERVICE_NAME,
        "models": models,
        "device": device,
        "error": error,
        "uptime_sec": round(time.monotonic() - _START_MONOTONIC, 1),
        "threads": THREADS,
    }
    return jsonify(payload), (200 if ready else 503)


@app.post("/detect-language")
def detect_language_endpoint():
    if _STARTUP_ERROR is not None:
        return jsonify({
            "success": False,
            "message": f"service not ready: {_STARTUP_ERROR}",
        }), 503

    upload = request.files.get("file")
    if upload is None or not upload.filename:
        return jsonify({"success": False, "message": "Missing multipart 'file'"}), 400
    audio_id = (request.form.get("audio_id") or "").strip()

    tmp_dir = Path(tempfile.mkdtemp(prefix="lang-req-"))
    t0 = time.monotonic()
    try:
        src = tmp_dir / f"upload{_safe_suffix(upload.filename)}"
        upload.save(str(src))

        wav_path = _normalize_to_wav(src, tmp_dir)

        result = None
        if MULTI_CHUNK:
            result = _detect_multi_chunk(wav_path, tmp_dir, audio_id)
        if result is None:
            result = _detect_single(wav_path)

        elapsed = time.monotonic() - t0
        result["details"]["elapsed_sec"] = round(elapsed, 2)
        if audio_id:
            result["details"]["audio_id"] = audio_id

        logger.info(
            "detect-language%s -> %s (confidence=%.3f method=%s %.1fs)",
            f" audio_id={audio_id}" if audio_id else "",
            result["language"], result["confidence"], result["method"], elapsed,
        )
        return jsonify({"success": True, **result}), 200
    except Exception as exc:
        logger.exception("detect-language failed%s", f" audio_id={audio_id}" if audio_id else "")
        return jsonify({"success": False, "message": str(exc)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    # Dev-only entry point; production uses gunicorn (see Dockerfile CMD).
    app.run(host="0.0.0.0", port=int(os.getenv("AI_SERVICE_PORT", "8010")), threaded=True)
