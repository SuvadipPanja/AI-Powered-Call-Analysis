"""
Phase 2a pipeline:
1) Diarization — stereo left=Agent, right=Customer (Silero VAD)
2) Whisper Large V3 — detect language (native LID token, NOT faster-whisper)
3) Transcribe each chunk — faster-whisper (default) | NeMo | Whisper transformers
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path

import logging

from asr_client import asr_service_health, transcribe_remote
from audio_utils import (
    format_duration,
    prepare_mono_wav,
    reexport_stereo_chunk_with_padding,
    trim_silence_for_asr,
)
from config import (
    AI_DISTRIBUTED,
    ASR_CHUNK_PARALLELISM,
    ASR_CHUNK_TRIM_SILENCE,
    ASR_INDIC_MIN_CHUNK_SEC,
    ASR_SPARSE_FALLBACK_ENABLED,
    ASR_SPARSE_MIN_LINE_RATIO,
    BENGALI_ASR_EXTRA_PADDING_SEC,
    FASTER_WHISPER_ASR_LANGUAGES,
    HIDE_EMPTY_TRANSCRIPT_SEGMENTS,
    MIN_USABLE_TRANSCRIPT_WORDS,
    NEMO_ASR_LANGUAGES,
    SEAMLESS_M4T_ENABLED,
    TRANSCRIBE_BACKEND,
)
from diarization_worker import diarize, diarization_health
from faster_whisper_worker import faster_whisper_health, transcribe_chunk as fw_transcribe_chunk
from lang_client import detect_language_remote, lang_service_health
from language_worker import detect_language, language_health
from nemo_worker import nemo_health, transcribe_with_nemo
from seamless_worker import seamless_m4t_health, transcribe_with_seamless
from whisper_asr_worker import transcribe_chunk as whisper_transcribe_chunk
from whisper_asr_worker import whisper_asr_health

logger = logging.getLogger(__name__)

# Once NeMo proves unloadable in this process (e.g. IndicConformer KeyError: 'dir'),
# latch it off and route to faster-whisper silently — avoids 30x log spam per call.
_NEMO_DISABLED = False
_SEAMLESS_DISABLED = False

# Distributed mode: once a remote ASR service proves dead in this process, latch
# it off so the remaining chunks skip the doomed HTTP round-trip and go straight
# to the local faster-whisper fallback. Reset on process restart.
_NEMO_REMOTE_DISABLED = False
_SEAMLESS_REMOTE_DISABLED = False
_latch_lock = threading.Lock()

# Local models are process-wide singletons; when the distributed per-chunk
# fan-out runs on multiple threads, any in-process ASR must be serialized.
_local_asr_lock = threading.Lock()


def _asr_log(msg: str, *args) -> None:
    """ASR routing logs via print so they ALWAYS surface in docker logs."""
    try:
        text = msg % args if args else msg
    except Exception:
        text = msg
    print(f"[ASR] {text}", flush=True)
    logger.info(msg, *args)


@dataclass
class TranscriptionResult:
    transcript: str
    language: str
    duration: str
    duration_seconds: float
    asr_engine: str
    diarization_status: str
    chunk_count: int


def _normalize_backend(name: str) -> str:
    if name in ("whisper",):
        return "whisper-large-v3"
    if name in ("faster_whisper",):
        return "faster-whisper"
    return name


def _pick_backend() -> str:
    configured = _normalize_backend(TRANSCRIBE_BACKEND)
    if configured in ("nemo", "whisper-large-v3", "faster-whisper"):
        return configured

    if AI_DISTRIBUTED:
        # auto + distributed: base routing on "nemo" so _resolve_asr_backend sends
        # chunks to the remote nemo/seamless services instead of probing (and
        # thereby lazily loading) controller-local models.
        return "nemo"

    # auto: prefer faster-whisper, then NeMo, then transformers Whisper
    if faster_whisper_health().get("ready"):
        return "faster-whisper"
    if nemo_health().get("ready"):
        return "nemo"
    if whisper_asr_health().get("ready"):
        return "whisper-large-v3"
    raise RuntimeError(
        "No ASR backend available. Install faster-whisper or set "
        "TRANSCRIBE_BACKEND=whisper-large-v3 for laptop dev mode."
    )


def _resolve_asr_backend(language: str, configured_backend: str) -> str:
    """Route Hindi/English → NeMo; all other languages → SeamlessM4T when enabled.

    A per-language override (FASTER_WHISPER_ASR_LANGUAGES) takes priority and
    forces faster-whisper large-v3 — best for code-mixed Hindi bank calls.
    Same priority order in distributed mode; only the SeamlessM4T readiness
    probe targets the remote service (which is what will actually transcribe)
    instead of controller-local model files.
    """
    backend = _normalize_backend(configured_backend)
    if language in FASTER_WHISPER_ASR_LANGUAGES:
        if faster_whisper_health().get("ready"):
            _asr_log("Routing %s to faster-whisper large-v3 (override)", language)
            return "faster-whisper"
        logger.warning(
            "FASTER_WHISPER_ASR_LANGUAGES requested %s but faster-whisper not ready",
            language,
        )
    if backend != "nemo":
        return backend
    if language in NEMO_ASR_LANGUAGES:
        return "nemo"
    if SEAMLESS_M4T_ENABLED:
        seamless = asr_service_health("seamless") if AI_DISTRIBUTED else seamless_m4t_health()
        if seamless.get("ready"):
            return "seamless-m4t"
        logger.warning(
            "SeamlessM4T not ready for %s (%s) — falling back to NeMo",
            language,
            seamless.get("error", "unknown"),
        )
    return "nemo"


def _indic_languages() -> set[str]:
    return {
        "Bengali", "Hindi", "Assamese", "Tamil", "Telugu", "Marathi",
        "Gujarati", "Kannada", "Malayalam", "Punjabi", "Odia", "Urdu",
    }


def _chunk_wav_for_asr(
    audio_path: Path,
    chunk,
    language: str,
    backend: str,
) -> tuple[Path | None, bool]:
    """Prepare the wav fed to ASR for one diarized chunk.

    Optionally re-exports short Indic segments with padding, then trims leading/
    trailing dead air (so Whisper/SeamlessM4T don't hallucinate a fluent
    continuation over silence). Returns ``(wav_path, is_temp)``; ``wav_path`` is
    ``None`` when the chunk is effectively silent and should be skipped.
    """
    duration = chunk.end_sec - chunk.start_sec
    base_path: Path = chunk.wav_path
    base_temp = False

    if (
        backend in ("nemo", "seamless-m4t")
        and language in _indic_languages()
        and duration < ASR_INDIC_MIN_CHUNK_SEC
        and BENGALI_ASR_EXTRA_PADDING_SEC > 0
    ):
        pad = BENGALI_ASR_EXTRA_PADDING_SEC
        if language == "Bengali":
            pad = max(pad, 0.5)
        try:
            base_path = reexport_stereo_chunk_with_padding(
                audio_path,
                speaker=chunk.speaker,
                start_sec=chunk.start_sec,
                end_sec=chunk.end_sec,
                pad_sec=pad,
            )
            base_temp = True
        except Exception as exc:
            logger.warning("Padded chunk export failed: %s", exc)

    if not ASR_CHUNK_TRIM_SILENCE:
        return base_path, base_temp

    try:
        trimmed, did_trim, is_silent = trim_silence_for_asr(base_path)
    except Exception as exc:
        logger.warning("Silence trim failed for %s: %s", base_path.name, exc)
        return base_path, base_temp

    if is_silent:
        if base_temp and base_path.exists():
            base_path.unlink(missing_ok=True)
        return None, False
    if not did_trim:
        return base_path, base_temp
    # New trimmed temp replaces any intermediate padded temp.
    if base_temp and base_path != trimmed and base_path.exists():
        base_path.unlink(missing_ok=True)
    return trimmed, True


def _transcribe_file_local(wav_path: Path, language: str, backend: str) -> tuple[str, str]:
    """Legacy in-process ASR path — unchanged monolith behavior."""
    global _NEMO_DISABLED, _SEAMLESS_DISABLED

    # If a backend already proved broken this run, skip straight to faster-whisper.
    if backend == "nemo" and _NEMO_DISABLED:
        backend = "faster-whisper"
    if backend == "seamless-m4t" and _SEAMLESS_DISABLED:
        backend = "faster-whisper"

    if backend == "seamless-m4t":
        try:
            return transcribe_with_seamless(wav_path, language)
        except RuntimeError as exc:
            if not _SEAMLESS_DISABLED:
                _SEAMLESS_DISABLED = True
                _asr_log(
                    "SeamlessM4T ASR unavailable for %s (%s) — switching this run to "
                    "faster-whisper for all remaining chunks.",
                    language, exc,
                )
            if faster_whisper_health().get("ready"):
                return fw_transcribe_chunk(wav_path, language)
            return transcribe_with_nemo(wav_path, language)
    if backend == "nemo":
        try:
            return transcribe_with_nemo(wav_path, language)
        except RuntimeError as exc:
            if not _NEMO_DISABLED:
                _NEMO_DISABLED = True
                _asr_log(
                    "NeMo ASR unavailable for %s (%s) — switching this run to "
                    "faster-whisper for all remaining chunks (logged once).",
                    language, exc,
                )
            if faster_whisper_health().get("ready"):
                return fw_transcribe_chunk(wav_path, language)
            raise
    if backend == "faster-whisper":
        return fw_transcribe_chunk(wav_path, language)
    return whisper_transcribe_chunk(wav_path, language)


def _remote_service_disabled(service: str) -> bool:
    return _NEMO_REMOTE_DISABLED if service == "nemo" else _SEAMLESS_REMOTE_DISABLED


def _latch_remote_service_off(service: str, language: str, exc: Exception) -> None:
    """Disable a failed remote ASR service for the rest of this process (log once)."""
    global _NEMO_REMOTE_DISABLED, _SEAMLESS_REMOTE_DISABLED
    with _latch_lock:
        already = _remote_service_disabled(service)
        if service == "nemo":
            _NEMO_REMOTE_DISABLED = True
        else:
            _SEAMLESS_REMOTE_DISABLED = True
    if not already:
        _asr_log(
            "Remote %s ASR service unavailable for %s (%s) — switching this process to "
            "local faster-whisper for remaining chunks (latch resets on restart).",
            service, language, exc,
        )


def _transcribe_file_distributed(wav_path: Path, language: str, backend: str) -> tuple[str, str]:
    """Remote ASR routing: nemo → sp-ai-nemo, seamless-m4t → sp-ai-seamless-m4t.

    Remote failures latch the service off and fall back to controller-local
    faster-whisper exactly like the legacy in-process failure handling. Any
    local model execution is serialized (_local_asr_lock) because the per-chunk
    fan-out runs on threads and local models are shared singletons.
    """
    service = {"nemo": "nemo", "seamless-m4t": "seamless"}.get(backend)
    if service is None:
        # faster-whisper override / whisper-large-v3 dev backend stay in-process.
        with _local_asr_lock:
            return _transcribe_file_local(wav_path, language, backend)

    if _remote_service_disabled(service):
        with _local_asr_lock:
            return fw_transcribe_chunk(wav_path, language)

    try:
        return transcribe_remote(wav_path, language, service)
    except RuntimeError as exc:
        _latch_remote_service_off(service, language, exc)
        with _local_asr_lock:
            if faster_whisper_health().get("ready"):
                return fw_transcribe_chunk(wav_path, language)
            if service == "seamless":
                # Same last resort as the legacy seamless handler.
                return transcribe_with_nemo(wav_path, language)
        raise


def _transcribe_file(wav_path: Path, language: str, backend: str) -> tuple[str, str]:
    if AI_DISTRIBUTED:
        return _transcribe_file_distributed(wav_path, language, backend)
    return _transcribe_file_local(wav_path, language, backend)


def _detect_language_any(audio_path: Path) -> str:
    """Language detection — remote service when distributed, local otherwise.

    A lang-service outage degrades to the in-process Whisper LID (serialized,
    since distributed mode does not hold the orchestrator pipeline lock).
    """
    if AI_DISTRIBUTED:
        try:
            return detect_language_remote(audio_path)
        except RuntimeError as exc:
            logger.warning(
                "Remote language detection failed (%s) — falling back to local detection",
                exc,
            )
            with _local_asr_lock:
                return detect_language(audio_path)
    return detect_language(audio_path)


def _transcribe_mono_fallback(
    audio_path: Path,
    backend: str,
    *,
    on_progress: Callable[[str, str | None], None] | None = None,
) -> TranscriptionResult:
    prepared_path, duration_seconds = prepare_mono_wav(audio_path)
    try:
        if on_progress:
            on_progress("detecting_language", None)
        language = _detect_language_any(prepared_path)
        if on_progress:
            on_progress("detecting_language", language)
        asr_backend = _resolve_asr_backend(language, backend)
        if on_progress:
            on_progress("transcribing", language)
        text, engine = _transcribe_file(prepared_path, language, asr_backend)
        transcript = f"0.0 - {duration_seconds:.1f} (Call): {text}"
        return TranscriptionResult(
            transcript=transcript,
            language=language,
            duration=format_duration(duration_seconds),
            duration_seconds=duration_seconds,
            asr_engine=engine,
            diarization_status="Skipped (mono)",
            chunk_count=1,
        )
    finally:
        if prepared_path.exists():
            prepared_path.unlink(missing_ok=True)



def _transcribe_one_chunk(
    audio_path: Path,
    chunk,
    language: str,
    asr_backend: str,
) -> tuple[str | None, float, str]:
    """Prepare and transcribe one diarized chunk (thread-safe, temp-leak-free).

    Returns ``(line, end_sec, engine)``; ``line`` is None when the chunk is
    skipped (silent after trim, or empty text with HIDE_EMPTY_TRANSCRIPT_SEGMENTS).
    """
    wav_path, is_temp = _chunk_wav_for_asr(audio_path, chunk, language, asr_backend)
    if wav_path is None:
        logger.info(
            "Skipping silent segment %s %.1f-%.1f (no speech after silence trim)",
            chunk.speaker, chunk.start_sec, chunk.end_sec,
        )
        return None, 0.0, ""
    try:
        text, engine = _transcribe_file(wav_path, language, asr_backend)
    finally:
        if is_temp and wav_path.exists():
            wav_path.unlink(missing_ok=True)

    is_empty = not text or text == "[No speech detected]"
    if is_empty and HIDE_EMPTY_TRANSCRIPT_SEGMENTS:
        logger.info(
            "Omitting empty segment %s %.1f-%.1f from transcript",
            chunk.speaker, chunk.start_sec, chunk.end_sec,
        )
        return None, 0.0, engine

    line = f"{chunk.start_sec:.1f} - {chunk.end_sec:.1f} ({chunk.speaker}): {text}"
    return line, chunk.end_sec, engine


def _run_chunks_in_order(worker, chunks, max_workers: int) -> list:
    """Fan chunks out to a thread pool; return results strictly in input order."""
    results: dict[int, tuple] = {}
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {pool.submit(worker, chunk): idx for idx, chunk in enumerate(chunks)}
        for future in as_completed(futures):
            results[futures[future]] = future.result()
    return [results[idx] for idx in range(len(chunks))]


def _collect_transcript_lines(
    audio_path: Path,
    chunks: list,
    language: str,
    asr_backend: str,
) -> tuple[list[str], float, str]:
    """Transcribe all diarized chunks; return (lines, max_end_sec, engine)."""
    sorted_chunks = sorted(chunks, key=lambda c: c.start_sec)
    use_parallel = AI_DISTRIBUTED and ASR_CHUNK_PARALLELISM > 1 and len(sorted_chunks) > 1
    if use_parallel:
        _asr_log(
            "Distributed ASR fan-out: %d chunks across %d workers (%s → %s)",
            len(sorted_chunks),
            ASR_CHUNK_PARALLELISM,
            language,
            asr_backend,
        )
        chunk_results = _run_chunks_in_order(
            lambda c: _transcribe_one_chunk(audio_path, c, language, asr_backend),
            sorted_chunks,
            ASR_CHUNK_PARALLELISM,
        )
    else:
        chunk_results = [
            _transcribe_one_chunk(audio_path, chunk, language, asr_backend)
            for chunk in sorted_chunks
        ]

    lines: list[str] = []
    max_end = 0.0
    engine = ""
    for line, end_sec, chunk_engine in chunk_results:
        if chunk_engine:
            engine = chunk_engine
        if line is None:
            continue
        lines.append(line)
        max_end = max(max_end, end_sec)
    return lines, max_end, engine


def _pick_sparse_fallback_backend(current: str) -> str | None:
    """Alternate ASR backend when the primary returns almost no text."""
    if current != "faster-whisper" and faster_whisper_health().get("ready"):
        return "faster-whisper"
    if current != "whisper-large-v3" and whisper_asr_health().get("ready"):
        return "whisper-large-v3"
    if current != "seamless-m4t" and SEAMLESS_M4T_ENABLED:
        seamless = asr_service_health("seamless") if AI_DISTRIBUTED else seamless_m4t_health()
        if seamless.get("ready"):
            return "seamless-m4t"
    return None


def is_transcript_usable(
    transcript: str,
    chunk_count: int,
    *,
    min_words: int | None = None,
) -> bool:
    """False when diarization found speech chunks but ASR returned almost nothing."""
    from llm_utils import count_speech_words

    threshold = min_words if min_words is not None else MIN_USABLE_TRANSCRIPT_WORDS
    body = (transcript or "").strip()
    if not body or body == "[No speech detected]":
        return chunk_count <= 2
    words = count_speech_words(body)
    if chunk_count >= 5 and words < threshold:
        return False
    return words >= 1


def transcribe(
    audio_path: Path,
    *,
    on_progress: Callable[[str, str | None], None] | None = None,
) -> TranscriptionResult:
    backend = _pick_backend()

    if on_progress:
        on_progress("detecting_language", None)
    language = _detect_language_any(audio_path)
    if on_progress:
        on_progress("detecting_language", language)

    dia = diarize(audio_path)
    if on_progress:
        on_progress("diarizing", language)

    if not dia.is_stereo or not dia.chunks:
        return _transcribe_mono_fallback(audio_path, backend, on_progress=on_progress)

    agent_chunks = sum(1 for c in dia.chunks if c.speaker == "Agent")
    customer_chunks = sum(1 for c in dia.chunks if c.speaker == "Customer")
    logger.info(
        "Diarization produced %d chunks (%d agent, %d customer) for %s lang=%s",
        len(dia.chunks), agent_chunks, customer_chunks, audio_path.name, language,
    )
    if customer_chunks == 0 and len(dia.chunks) <= 3:
        logger.warning(
            "Very few customer chunks for stereo call %s — check channel mapping or audio format",
            audio_path.name,
        )

    asr_backend = _resolve_asr_backend(language, backend)
    if on_progress:
        on_progress("transcribing", language)

    lines, max_end, engine = _collect_transcript_lines(
        audio_path, dia.chunks, language, asr_backend
    )

    chunk_total = len(dia.chunks)
    line_ratio = len(lines) / max(chunk_total, 1)
    if (
        ASR_SPARSE_FALLBACK_ENABLED
        and chunk_total >= 5
        and line_ratio < ASR_SPARSE_MIN_LINE_RATIO
    ):
        fallback = _pick_sparse_fallback_backend(asr_backend)
        if fallback:
            logger.warning(
                "Sparse ASR for %s: %d/%d lines via %s — retrying with %s",
                audio_path.name,
                len(lines),
                chunk_total,
                asr_backend,
                fallback,
            )
            fb_lines, fb_max, fb_engine = _collect_transcript_lines(
                audio_path, dia.chunks, language, fallback
            )
            if len(fb_lines) > len(lines):
                lines, max_end, engine = fb_lines, fb_max, fb_engine
                asr_backend = fallback

    if not max_end and dia.chunks:
        max_end = max(c.end_sec for c in dia.chunks)

    transcript = "\n".join(lines) if lines else "[No speech detected]"
    if not is_transcript_usable(transcript, chunk_total):
        logger.error(
            "Unusable transcript for %s: %d chars, %d/%d chunk lines, engine=%s lang=%s",
            audio_path.name,
            len(transcript),
            len(lines),
            chunk_total,
            engine or asr_backend,
            language,
        )

    return TranscriptionResult(
        transcript=transcript,
        language=language,
        duration=format_duration(max_end),
        duration_seconds=max_end,
        asr_engine=engine or asr_backend,
        diarization_status=dia.status,
        chunk_count=chunk_total,
    )


def transcription_health() -> dict:
    if AI_DISTRIBUTED:
        # Distributed mode: report remote service healths. Do NOT probe local
        # language/faster-whisper health here — those probes lazily LOAD the
        # models into the controller, defeating the whole split. Local
        # faster-whisper stays a lazy fallback that only loads on remote failure.
        dia = diarization_health()
        lang_svc = lang_service_health()
        nemo_svc = asr_service_health("nemo")
        seamless_svc = asr_service_health("seamless")
        asr_ok = bool(nemo_svc.get("ready") or seamless_svc.get("ready"))
        return {
            "ready": bool(dia.get("ready") and lang_svc.get("ready") and asr_ok),
            "distributed": True,
            "active_backend": "remote-services",
            "configured_backend": TRANSCRIBE_BACKEND,
            "nemo_asr_languages": sorted(NEMO_ASR_LANGUAGES),
            "diarization": dia,
            "lang_service": lang_svc,
            "nemo_service": nemo_svc,
            "seamless_service": seamless_svc,
            "chunk_parallelism": ASR_CHUNK_PARALLELISM,
            "local_fallback": "faster-whisper (lazy — loads only if a remote ASR service fails)",
            "pipeline": (
                "diarize (local) + lang-detect (sp-ai-whisper-lang) + "
                "per-chunk-asr (sp-ai-nemo hi/en, sp-ai-seamless-m4t other)"
            ),
        }

    lang = language_health()
    dia = diarization_health()
    nemo = nemo_health()
    seamless = seamless_m4t_health()
    fw = faster_whisper_health()
    whisper_asr = whisper_asr_health()
    backend = TRANSCRIBE_BACKEND

    active = None
    try:
        active = _pick_backend()
    except RuntimeError:
        pass

    asr_ready = (
        fw.get("ready")
        or nemo.get("ready")
        or whisper_asr.get("ready")
    )
    seamless_ok = not SEAMLESS_M4T_ENABLED or seamless.get("ready")

    return {
        "ready": bool(lang.get("ready") and dia.get("ready") and asr_ready and active and seamless_ok),
        "active_backend": active,
        "configured_backend": backend,
        "nemo_asr_languages": sorted(NEMO_ASR_LANGUAGES),
        "language_detection": lang,
        "diarization": dia,
        "faster_whisper_asr": fw,
        "nemo_asr": nemo,
        "seamless_m4t_asr": seamless,
        "whisper_asr_dev": whisper_asr,
        "pipeline": "diarize + lang-detect + per-chunk-asr (NeMo hi/en, SeamlessM4T other)",
        "laptop_note": (
            "Use TRANSCRIBE_BACKEND=faster-whisper on laptop or Jarvis GPU. "
            "NeMo requires GPU Linux/Docker; transformers Whisper is a slower fallback."
        ),
    }
