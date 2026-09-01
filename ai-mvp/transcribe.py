"""
Phase 2a pipeline:
1) Diarization — stereo left=Agent, right=Customer (Silero VAD)
2) Whisper Large V3 — detect language (native LID token, NOT faster-whisper)
3) Transcribe each chunk — faster-whisper (default) | NeMo | Whisper transformers
"""

from __future__ import annotations

import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import ContextManager

import logging

from asr_client import (
    asr_service_health,
    transcribe_remote,
    transcribe_remote_batch,
)
from asr_microbatch import batch_chunks_by_duration
from audio_utils import (
    format_duration,
    prepare_mono_wav,
    reexport_stereo_chunk_with_padding,
    trim_silence_for_asr,
)
from config import (
    AI_DISTRIBUTED,
    AI_REMOTE_FAIL_CLOSED,
    ASR_COMPLIANCE_OPENING_ENABLED,
    ASR_COMPLIANCE_OPENING_SEC,
    ASR_OPENING_PROMPT,
    ASR_OPENING_PROMPT_ENABLED,
    ASR_OPENING_SPLICE_ENABLED,
    ASR_SECOND_PASS_ENABLED,
    ASR_SECOND_PASS_OPENING,
    ASR_MAX_WORDS_PER_SEC,
    ASR_REFEREE_BEAM_SIZE,
    ASR_REFEREE_BUDGET_SEC,
    ASR_REFEREE_MAX_WINDOWS,
    ASR_CHUNK_PARALLELISM,
    ASR_CHUNK_TRIM_SILENCE,
    ASR_INDIC_MIN_CHUNK_SEC,
    ASR_MICROBATCH_ENABLED,
    ASR_MICROBATCH_MAX_AUDIO_SEC,
    ASR_MICROBATCH_MAX_ITEMS,
    ASR_SPARSE_FALLBACK_ENABLED,
    ASR_SPARSE_MIN_LINE_RATIO,
    BENGALI_ASR_EXTRA_PADDING_SEC,
    HINDI_ASR_EXTRA_PADDING_SEC,
    FASTER_WHISPER_ASR_LANGUAGES,
    HIDE_EMPTY_TRANSCRIPT_SEGMENTS,
    MIN_USABLE_TRANSCRIPT_WORDS,
    NEMO_ASR_LANGUAGES,
    SEAMLESS_M4T_ENABLED,
    TRANSCRIBE_BACKEND,
    WHISPER_REFEREE_ENABLED,
)
from diarization_worker import diarize, diarization_health
from faster_whisper_worker import faster_whisper_health, transcribe_chunk as fw_transcribe_chunk
from transcript_normalize import scrub_asr_artifacts
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
    # A longer, agent-channel-only decode of the call opening.  This is used by
    # compliance detectors to recover names/disclaimers lost by short ASR
    # chunks, but is intentionally not rendered as another transcript turn.
    compliance_opening_evidence: str = ""


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
    """Route configured NeMo languages there; all others use SeamlessM4T.

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
        "Nepali", "Sanskrit", "Sindhi",
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
        if language == "Hindi":
            pad = max(pad, HINDI_ASR_EXTRA_PADDING_SEC)
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
    if service == "nemo":
        return _NEMO_REMOTE_DISABLED
    return _SEAMLESS_REMOTE_DISABLED


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
        if AI_REMOTE_FAIL_CLOSED:
            raise RuntimeError(
                f"{service} GPU ASR service is latched unavailable; local model "
                "fallback is disabled by AI_REMOTE_FAIL_CLOSED"
            )
        with _local_asr_lock:
            return fw_transcribe_chunk(wav_path, language)

    try:
        return transcribe_remote(wav_path, language, service)
    except RuntimeError as exc:
        _latch_remote_service_off(service, language, exc)
        if AI_REMOTE_FAIL_CLOSED:
            raise RuntimeError(
                f"{service} GPU ASR service unavailable; local model fallback is "
                "disabled by AI_REMOTE_FAIL_CLOSED"
            ) from exc
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
            logger.warning("Remote language detection failed (%s)", exc)
            if AI_REMOTE_FAIL_CLOSED:
                raise RuntimeError(
                    "GPU language service unavailable; local model fallback is "
                    "disabled by AI_REMOTE_FAIL_CLOSED"
                ) from exc
            logger.warning("Falling back to controller-local language detection")
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


def _format_chunk_result(chunk, text: str, engine: str) -> tuple[str | None, float, str]:
    is_empty = not text or text == "[No speech detected]"
    if is_empty and HIDE_EMPTY_TRANSCRIPT_SEGMENTS:
        logger.info(
            "Omitting empty segment %s %.1f-%.1f from transcript",
            chunk.speaker,
            chunk.start_sec,
            chunk.end_sec,
        )
        return None, 0.0, engine
    line = f"{chunk.start_sec:.1f} - {chunk.end_sec:.1f} ({chunk.speaker}): {text}"
    return line, chunk.end_sec, engine


def _transcribe_chunk_batch(
    audio_path: Path,
    chunks: list,
    language: str,
    asr_backend: str,
) -> list[tuple[str | None, float, str]]:
    service = {"nemo": "nemo", "seamless-m4t": "seamless"}.get(asr_backend)
    if not service:
        return [
            _transcribe_one_chunk(audio_path, chunk, language, asr_backend)
            for chunk in chunks
        ]
    prepared: list[tuple[object, Path]] = []
    temporary: list[Path] = []
    results: list[tuple[str | None, float, str] | None] = [None] * len(chunks)
    try:
        for index, chunk in enumerate(chunks):
            wav_path, is_temp = _chunk_wav_for_asr(
                audio_path,
                chunk,
                language,
                asr_backend,
            )
            if wav_path is None:
                results[index] = (None, 0.0, "")
                continue
            prepared.append((index, wav_path))
            if is_temp:
                temporary.append(wav_path)
        if prepared:
            paths = [path for _, path in prepared]
            try:
                batch_results = transcribe_remote_batch(
                    paths,
                    language,
                    service,
                    audio_id=audio_path.name,
                )
            except RuntimeError as exc:
                # An older service, rejected duration, OOM, or malformed response
                # must preserve output semantics by retrying each chunk singly.
                logger.warning(
                    "Remote %s micro-batch failed (%s); retrying ordered singles",
                    service,
                    exc,
                )
                batch_results = [
                    _transcribe_file_distributed(path, language, asr_backend)
                    for path in paths
                ]
            if len(batch_results) != len(prepared):
                raise RuntimeError(
                    f"{service} micro-batch returned {len(batch_results)} "
                    f"results for {len(prepared)} prepared chunks"
                )
            for (index, _), (text, engine) in zip(prepared, batch_results):
                results[index] = _format_chunk_result(
                    chunks[index],
                    text,
                    engine,
                )
        return [
            result if result is not None else (None, 0.0, "")
            for result in results
        ]
    finally:
        for path in temporary:
            if path.exists():
                path.unlink(missing_ok=True)


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
    use_microbatch = (
        AI_DISTRIBUTED
        and ASR_MICROBATCH_ENABLED
        and asr_backend in {"nemo", "seamless-m4t"}
        and len(sorted_chunks) > 1
    )
    use_parallel = AI_DISTRIBUTED and ASR_CHUNK_PARALLELISM > 1 and len(sorted_chunks) > 1
    if use_microbatch:
        groups = batch_chunks_by_duration(
            sorted_chunks,
            max_items=ASR_MICROBATCH_MAX_ITEMS,
            max_audio_sec=ASR_MICROBATCH_MAX_AUDIO_SEC,
        )
        _asr_log(
            "ASR micro-batch: %d chunks in %d ordered batches (%s → %s; max=%d/%.0fs)",
            len(sorted_chunks),
            len(groups),
            language,
            asr_backend,
            ASR_MICROBATCH_MAX_ITEMS,
            ASR_MICROBATCH_MAX_AUDIO_SEC,
        )
        chunk_results = []
        for group in groups:
            chunk_results.extend(
                _transcribe_chunk_batch(
                    audio_path,
                    group,
                    language,
                    asr_backend,
                )
            )
    elif use_parallel:
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


def _transcribe_compliance_opening(
    audio_path: Path,
    chunks: list,
    language: str,
    asr_backend: str,
) -> str:
    """Decode one contextual opening window from the isolated agent channel.

    Short turn-by-turn decoding is retained as the authoritative transcript.
    The contextual result is a separate evidence lane, preventing duplicated
    UI turns and preventing customer speech from being attributed to the agent.
    Any failure is non-fatal because the primary transcript has already run.
    """
    if not ASR_COMPLIANCE_OPENING_ENABLED or not chunks:
        return ""
    agent_chunks = [
        chunk for chunk in chunks
        if chunk.speaker == "Agent" and chunk.start_sec < ASR_COMPLIANCE_OPENING_SEC
    ]
    if not agent_chunks:
        return ""
    end_sec = min(
        ASR_COMPLIANCE_OPENING_SEC,
        max(float(chunk.end_sec) for chunk in chunks),
    )
    if end_sec <= 0:
        return ""

    opening_path: Path | None = None
    try:
        opening_path = reexport_stereo_chunk_with_padding(
            audio_path,
            speaker="Agent",
            start_sec=0.0,
            end_sec=end_sec,
            pad_sec=0.0,
        )
        text: str | None = None
        engine: str | None = None
        # Whisper honours initial_prompt: bias the opening decode with the
        # campaign script (org name, RPC ask, disclaimer) so compliance
        # phrases survive noisy telephony audio. Only when faster-whisper is
        # already the routed backend — never force-load an extra local model.
        if ASR_OPENING_PROMPT_ENABLED and asr_backend == "faster-whisper":
            try:
                with _local_asr_lock:
                    text, engine = fw_transcribe_chunk(
                        opening_path, language, initial_prompt=ASR_OPENING_PROMPT
                    )
            except Exception as exc:  # noqa: BLE001 - fall back to plain decode
                logger.warning("Biased opening decode failed: %s", exc)
                text = None
        if not text:
            text, engine = _transcribe_file(opening_path, language, asr_backend)
        value = scrub_asr_artifacts(str(text or "").strip())
        if not value or value == "[No speech detected]":
            return ""
        _asr_log(
            "Compliance opening recovered: %.1fs agent channel via %s (%d chars)",
            end_sec,
            engine or asr_backend,
            len(value),
        )
        return value
    except Exception as exc:  # noqa: BLE001 - primary transcript remains valid
        logger.warning("Compliance opening decode failed for %s: %s", audio_path.name, exc)
        return ""
    finally:
        if opening_path is not None and opening_path.exists():
            opening_path.unlink(missing_ok=True)


def _referee_ready() -> tuple[bool, str]:
    """(ready, reason). The reason is always logged so a dead referee is visible."""
    if not (ASR_SECOND_PASS_ENABLED and WHISPER_REFEREE_ENABLED):
        return False, "referee disabled by config"
    try:
        health = faster_whisper_health()
    except Exception as exc:  # noqa: BLE001
        return False, f"faster-whisper probe raised: {exc}"
    if health.get("ready"):
        return True, f"faster-whisper {health.get('compute_type')} on {health.get('device')}"
    return False, str(health.get("error") or "faster-whisper not ready")


def _referee_health_report() -> dict:
    """Status for /health. Never loads the model — a probe would defeat the split."""
    if not (ASR_SECOND_PASS_ENABLED and WHISPER_REFEREE_ENABLED):
        return {"ready": False, "detail": "referee disabled by config"}
    from config import FASTER_WHISPER_MODEL_PATH

    if FASTER_WHISPER_MODEL_PATH and Path(FASTER_WHISPER_MODEL_PATH).is_dir():
        return {
            "ready": True,
            "detail": f"model present at {FASTER_WHISPER_MODEL_PATH}",
        }
    return {
        "ready": False,
        "detail": (
            f"FASTER_WHISPER_MODEL_PATH={FASTER_WHISPER_MODEL_PATH!r} "
            "is not a directory"
        ),
    }


def _referee_decode(
    audio_path: Path,
    speaker: str,
    start_sec: float,
    end_sec: float,
    language: str,
    prompt: str = "",
) -> str:
    """Second opinion on one window. Empty string on any failure."""
    ready, reason = _referee_ready()
    if not ready:
        _asr_log("[REFEREE] skipped %.1f-%.1fs: %s", start_sec, end_sec, reason)
        return ""

    window_path = None
    try:
        window_path = reexport_stereo_chunk_with_padding(
            audio_path,
            speaker=speaker,
            start_sec=start_sec,
            end_sec=end_sec,
            pad_sec=0.0,
        )
        started = time.monotonic()
        with _local_asr_lock:
            text, engine = fw_transcribe_chunk(
                window_path,
                language,
                initial_prompt=prompt or None,
                beam_size=ASR_REFEREE_BEAM_SIZE,
            )
        value = scrub_asr_artifacts(str(text or "").strip())
        if not value or value == "[No speech detected]":
            _asr_log(
                "[REFEREE] %.1f-%.1fs returned nothing after %.1fs",
                start_sec,
                end_sec,
                time.monotonic() - started,
            )
            return ""
        _asr_log(
            "[REFEREE] %.1f-%.1fs %s via %s -> %d chars in %.1fs",
            start_sec,
            end_sec,
            speaker,
            engine,
            len(value),
            time.monotonic() - started,
        )
        return value
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "[REFEREE] decode failed for %s %.1f-%.1fs: %s",
            audio_path.name,
            start_sec,
            end_sec,
            exc,
        )
        return ""
    finally:
        if window_path is not None and window_path.exists():
            window_path.unlink(missing_ok=True)


def _apply_second_pass_opening(
    lines: list[str],
    audio_path: Path,
    language: str,
    compliance_opening_evidence: str,
) -> tuple[list[str], str]:
    """Referee-splice a Whisper opening when the primary opening is weak."""
    if ASR_SECOND_PASS_ENABLED and ASR_SECOND_PASS_OPENING:
        from asr_second_pass import (
            opening_is_weak,
            pick_opening,
            splice_second_pass_opening,
        )

        agent_open = " ".join(
            line.split("): ", 1)[-1]
            for line in lines
            if " (Agent):" in line
            and float(line.split(" - ", 1)[0]) < ASR_COMPLIANCE_OPENING_SEC
        )
        if opening_is_weak(agent_open) or opening_is_weak(compliance_opening_evidence):
            # No prompt: Whisper parrots initial_prompt verbatim. A fact-bearing
            # prompt would fabricate the compliance phrases we are trying to detect.
            whisper_open = _referee_decode(
                audio_path,
                "Agent",
                0.0,
                ASR_COMPLIANCE_OPENING_SEC,
                language,
                ASR_OPENING_PROMPT if ASR_OPENING_PROMPT_ENABLED else "",
            )
            if whisper_open:
                spliced2 = splice_second_pass_opening(
                    lines, whisper_open, ASR_COMPLIANCE_OPENING_SEC
                )
                if spliced2 != lines:
                    _asr_log(
                        "Second-pass opening accepted (%d chars)",
                        len(whisper_open),
                    )
                    lines = spliced2
                chosen = pick_opening(compliance_opening_evidence, whisper_open)
                if chosen == " ".join(whisper_open.split()):
                    compliance_opening_evidence = whisper_open
    return lines, compliance_opening_evidence


def _apply_referee_windows(
    lines: list[str],
    audio_path: Path,
    language: str,
) -> list[str]:
    """Re-decode implausible rows anywhere in the call, not just the opening.

    CPU inference is not free, so this is bounded twice: by window count and
    by a wall-clock budget. A window is only replaced when the referee returns
    text; otherwise the primary decode stands.
    """
    if not (ASR_SECOND_PASS_ENABLED and WHISPER_REFEREE_ENABLED):
        return lines

    from asr_second_pass import implausible_windows, splice_window

    windows = implausible_windows(
        lines, ASR_MAX_WORDS_PER_SEC, ASR_REFEREE_MAX_WINDOWS
    )
    if not windows:
        return lines
    _asr_log(
        "[REFEREE] %d implausible window(s) in %s", len(windows), audio_path.name
    )

    deadline = time.monotonic() + ASR_REFEREE_BUDGET_SEC
    for start_sec, end_sec, speaker in windows:
        if time.monotonic() >= deadline:
            _asr_log(
                "[REFEREE] budget of %.0fs exhausted — %s keeps its primary decode",
                ASR_REFEREE_BUDGET_SEC,
                audio_path.name,
            )
            break
        refereed = _referee_decode(
            audio_path, speaker, start_sec, end_sec, language
        )
        if not refereed:
            continue
        spliced = splice_window(lines, start_sec, end_sec, speaker, refereed)
        if spliced != lines:
            _asr_log(
                "[REFEREE] accepted %.1f-%.1fs %s (%d chars)",
                start_sec,
                end_sec,
                speaker,
                len(refereed),
            )
            lines = spliced
    return lines


def _pick_sparse_fallback_backend(current: str) -> str | None:
    """Alternate ASR backend when the primary returns almost no text."""
    if (
        not (AI_DISTRIBUTED and AI_REMOTE_FAIL_CLOSED)
        and current != "faster-whisper"
        and faster_whisper_health().get("ready")
    ):
        return "faster-whisper"
    if (
        not (AI_DISTRIBUTED and AI_REMOTE_FAIL_CLOSED)
        and current != "whisper-large-v3"
        and whisper_asr_health().get("ready")
    ):
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


@contextmanager
def _noop_gpu_asr_slot() -> Iterator[float]:
    """Used when the caller does not supply a GPU stage gate."""
    yield 0.0


def transcribe(
    audio_path: Path,
    *,
    on_progress: Callable[[str, str | None], None] | None = None,
    gpu_asr_slot: Callable[[], ContextManager[float]] | None = None,
    on_gpu_wait: Callable[[float], None] | None = None,
) -> TranscriptionResult:
    """Run diarization on CPU, then language detection + ASR under the GPU lane.

    ``gpu_asr_slot`` must be a zero-arg callable returning a context manager that
    yields wait_ms (for example ``asr_slot`` from ``gpu_stage_scheduler``). CPU
    Silero diarization runs *before* that slot is acquired so a second call can
    prepare speaker chunks while another call holds GPU1 for LID/ASR.
    """
    backend = _pick_backend()

    # CPU stage — must not hold the exclusive GPU ASR lane.
    if on_progress:
        on_progress("diarizing", None)
    dia = diarize(audio_path)
    if on_progress:
        on_progress("diarizing", None)

    slot = gpu_asr_slot or _noop_gpu_asr_slot
    with slot() as gpu_wait_ms:
        if on_gpu_wait is not None:
            on_gpu_wait(float(gpu_wait_ms or 0.0))

        if not dia.is_stereo or not dia.chunks:
            return _transcribe_mono_fallback(
                audio_path, backend, on_progress=on_progress
            )

        if on_progress:
            on_progress("detecting_language", None)
        language = _detect_language_any(audio_path)
        if on_progress:
            on_progress("detecting_language", language)

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

        compliance_opening_evidence = _transcribe_compliance_opening(
            audio_path,
            dia.chunks,
            language,
            asr_backend,
        )

        if ASR_OPENING_SPLICE_ENABLED and compliance_opening_evidence:
            from asr_opening_splice import splice_opening_into_transcript

            spliced = splice_opening_into_transcript(
                lines,
                compliance_opening_evidence,
                ASR_COMPLIANCE_OPENING_SEC,
            )
            if spliced != lines:
                replaced = sum(
                    1
                    for line in lines
                    if " (Agent):" in line
                    and float(line.split(" - ", 1)[0]) < ASR_COMPLIANCE_OPENING_SEC
                )
                _asr_log(
                    "Opening splice used %d-char evidence in place of %d short agent lines",
                    len(compliance_opening_evidence),
                    replaced,
                )
                lines = spliced

        lines, compliance_opening_evidence = _apply_second_pass_opening(
            lines, audio_path, language, compliance_opening_evidence
        )
        lines = _apply_referee_windows(lines, audio_path, language)

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
                    if ASR_OPENING_SPLICE_ENABLED and compliance_opening_evidence:
                        from asr_opening_splice import splice_opening_into_transcript

                        lines = splice_opening_into_transcript(
                            lines,
                            compliance_opening_evidence,
                            ASR_COMPLIANCE_OPENING_SEC,
                        )
                    lines, compliance_opening_evidence = _apply_second_pass_opening(
                        lines, audio_path, language, compliance_opening_evidence
                    )
                    lines = _apply_referee_windows(lines, audio_path, language)

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
            compliance_opening_evidence=compliance_opening_evidence,
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
            "microbatch": {
                "enabled": ASR_MICROBATCH_ENABLED,
                "max_items": ASR_MICROBATCH_MAX_ITEMS,
                "max_audio_sec": ASR_MICROBATCH_MAX_AUDIO_SEC,
            },
            "local_fallback": (
                "disabled (fail closed)"
                if AI_REMOTE_FAIL_CLOSED
                else "faster-whisper (lazy — loads only if a remote ASR service fails)"
            ),
            "whisper_referee": _referee_health_report(),
            "remote_fail_closed": AI_REMOTE_FAIL_CLOSED,
            "pipeline": (
                "diarize (local) + lang-detect (sp-ai-whisper-lang) + "
                "per-chunk-asr (sp-ai-nemo en, sp-ai-seamless-m4t other)"
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
