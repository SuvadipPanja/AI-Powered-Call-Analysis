"""
AI MVP orchestrator — Phase 2a transcription + translation + Phase 2b Ollama scoring.
Enhanced with transcript caching and parallel-safe job tracking.
"""

from __future__ import annotations

import hashlib
import os
import threading
import time
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request

from config import AUDIO_UPLOAD_DIR, ENRICHMENT_ENABLED, LOG_DIR, OLLAMA_MODEL, PORT, SCORING_ENABLED
from db import (
    ensure_consolidated_table,
    mark_failed,
    update_detected_language,
    update_processing_progress,
    upsert_scoring_result,
    upsert_transcription_result,
)
from enrichment_worker import enrich_call, enrichment_enabled, enrichment_health
from intelligence_worker import extract_intelligence, intelligence_enabled, intelligence_health
from model_memory import release_transcription_memory
from prod_logging import log_call_event
from progress import stage_message, stage_percent
from scoring_worker import ollama_health, score_call, scoring_enabled
from taboo_worker import analyze_taboo, apply_taboo_to_scores, merge_taboo_into_tone
from transcribe import transcribe, transcription_health
from transcript_cleanup_worker import cleanup_enabled, cleanup_supported, cleanup_transcript
from translation_worker import needs_translation, translate_transcript, translation_enabled

load_dotenv()

_transcript_cache: dict[str, dict] = {}
_cache_lock = threading.Lock()
MAX_CACHE_SIZE = 50

# Serializes the GPU model phase (Whisper LID + ASR) and the subsequent model
# release. Uploads are processed on separate threads (see /upload-and-process),
# and the LID/faster-whisper models are shared singletons that
# release_transcription_memory() sets to None. Without this lock, one job can
# null a model while another is mid-`model.generate`, which surfaces as
# "'NoneType' object is not callable". Holding the same lock for both the
# transcribe() call and the release guarantees they never overlap.
_pipeline_lock = threading.Lock()


def _file_hash(path: Path) -> str:
    h = hashlib.md5()
    h.update(str(path.stat().st_size).encode())
    h.update(str(path.stat().st_mtime_ns).encode())
    return h.hexdigest()


def _get_cached_transcript(audio_path: Path) -> dict | None:
    key = _file_hash(audio_path)
    with _cache_lock:
        return _transcript_cache.get(key)


def _set_cached_transcript(audio_path: Path, result: dict) -> None:
    key = _file_hash(audio_path)
    with _cache_lock:
        if len(_transcript_cache) >= MAX_CACHE_SIZE:
            oldest = next(iter(_transcript_cache))
            del _transcript_cache[oldest]
        _transcript_cache[key] = result

app = Flask(__name__)

ORCHESTRATOR_SECRET = os.getenv("ORCHESTRATOR_SECRET", "").strip()


def _authorized(req) -> bool:
    if not ORCHESTRATOR_SECRET:
        return True
    return req.headers.get("X-Orchestrator-Secret", "") == ORCHESTRATOR_SECRET


def log(msg: str) -> None:
    line = f"[{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}] {msg}"
    print(line, flush=True)
    log_file = LOG_DIR / f"orchestrator_{datetime.now():%Y-%m-%d}.log"
    with open(log_file, "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def _progress(
    audio_file: str,
    stage: str,
    status: str | None = None,
    *,
    message: str | None = None,
    language: str | None = None,
) -> None:
    pct = stage_percent(stage)
    msg = message or stage_message(stage)
    if language and language.lower() not in msg.lower():
        msg = f"Language detected: {language}. {msg}"
    update_processing_progress(
        audio_file,
        stage=stage,
        progress=pct,
        message=msg,
        status=status,
        language=language,
    )


def _on_transcribe_progress(audio_file: str, stage: str, language: str | None) -> None:
    if stage == "detecting_language":
        if language:
            _progress(audio_file, "detecting_language", "In Progress", language=language)
        else:
            _progress(audio_file, "detecting_language", "In Progress")
        return
    if stage == "diarizing":
        _progress(audio_file, "diarizing", "In Progress", language=language)
        return
    if language:
        _progress(
            audio_file,
            "transcribing",
            "In Progress",
            language=language,
        )


def process_audio_job(audio_file: str) -> None:
    audio_path = AUDIO_UPLOAD_DIR / audio_file
    job_started = time.time()
    stage = "upload"
    try:
        log_call_event(audio_file, "upload", "Processing started")
        _progress(audio_file, "upload", "In Progress")

        cached = _get_cached_transcript(audio_path)
        if cached:
            log_call_event(audio_file, "transcription", "Cache hit — skipping ASR")
            from transcribe import TranscriptionResult
            result = TranscriptionResult(**cached)
            update_detected_language(audio_file, result.language)
        else:
            stage = "transcription"
            _progress(audio_file, "transcribing", "In Progress")
            with _pipeline_lock:
                result = transcribe(
                    audio_path,
                    on_progress=lambda stage, language: _on_transcribe_progress(
                        audio_file, stage, language
                    ),
                )
            update_detected_language(audio_file, result.language)
            _set_cached_transcript(audio_path, {
                "transcript": result.transcript,
                "language": result.language,
                "duration": result.duration,
                "duration_seconds": result.duration_seconds,
                "asr_engine": result.asr_engine,
                "diarization_status": result.diarization_status,
                "chunk_count": result.chunk_count,
            })
        log_call_event(
            audio_file,
            "transcription",
            f"Transcribed lang={result.language} engine={result.asr_engine} "
            f"chunks={result.chunk_count} chars={len(result.transcript)}",
        )

        original_transcript = result.transcript
        if cleanup_enabled() and cleanup_supported(result.language):
            stage = "cleanup"
            cleaned = cleanup_transcript(original_transcript, result.language)
            if cleaned and cleaned != original_transcript:
                log_call_event(
                    audio_file,
                    "cleanup",
                    f"Transcript cleanup applied ({result.language}) "
                    f"chars {len(original_transcript)}→{len(cleaned)}",
                )
                original_transcript = cleaned

        english_transcript = original_transcript
        translation_model = ""

        if needs_translation(result.language) and translation_enabled():
            stage = "translation"
            _progress(audio_file, "translating", "Translating")
            log_call_event(audio_file, "translation", f"Translation started ({result.language} → English)")
            english_transcript = translate_transcript(original_transcript, result.language)
            translation_model = OLLAMA_MODEL
            log_call_event(
                audio_file,
                "llm",
                f"LLM translation complete chars={len(english_transcript)}",
            )
            log_call_event(audio_file, "translation", f"Translation complete chars={len(english_transcript)}")
        else:
            log_call_event(audio_file, "translation", f"Skipped language={result.language}")

        if not scoring_enabled():
            upsert_transcription_result(
                audio_file,
                original_transcript,
                english_transcript,
                result.language,
                result.duration,
                result.diarization_status,
                result.asr_engine,
                duration_seconds=result.duration_seconds,
            )
            _progress(audio_file, "complete", "Transcribed")
            log(f"Completed (transcribed only): {audio_file}")
            return

        with _pipeline_lock:
            release_transcription_memory()

        if scoring_enabled():
            stage = "scoring"
            _progress(audio_file, "scoring", "Scoring")
            log_call_event(audio_file, "scoring", "Scoring started")
            scoring = score_call(english_transcript, "English")
            log_call_event(
                audio_file,
                "llm",
                f"LLM scoring complete chars={len(scoring.raw_text or '')}",
            )

            sentiment = scoring.sentiment
            tone_analysis = scoring.tone_analysis
            script_compliance = scoring.script_compliance

            if enrichment_enabled():
                stage = "enrichment"
                _progress(audio_file, "enriching", "Enriching")
                log_call_event(audio_file, "enrichment", "Enrichment started")
                enriched = enrich_call(audio_file, english_transcript, "English")
                sentiment = enriched.sentiment
                tone_analysis = enriched.tone_analysis
                script_compliance = enriched.script_compliance
                log_call_event(
                    audio_file,
                    "enrichment",
                    f"Done sentiment={len(sentiment)} script={script_compliance}%",
                )

            if intelligence_enabled():
                stage = "intelligence"
                log_call_event(audio_file, "intelligence", "Intelligence extraction started")
                intel = extract_intelligence(english_transcript, "English")
                scoring.scores.update(intel)
                log_call_event(
                    audio_file,
                    "intelligence",
                    f"Done query={intel.get('Primary_Query_Type')} "
                    f"escalated={intel.get('Escalation_Requested')} "
                    f"loan={intel.get('Loan_Type')} "
                    f"prob={intel.get('Loan_Success_Probability')}",
                )

            taboo = analyze_taboo(original_transcript, english_transcript, result.language)
            scoring.scores = apply_taboo_to_scores(scoring.scores, taboo)
            tone_analysis = merge_taboo_into_tone(
                tone_analysis if isinstance(tone_analysis, dict) else {"status": "success", "results": {}},
                taboo,
            )
            if taboo.get("hits"):
                log_call_event(
                    audio_file,
                    "taboo",
                    taboo.get("summary", "Taboo phrase(s) detected"),
                )

            elapsed = time.time() - job_started
            upsert_scoring_result(
                audio_file,
                original_transcript,
                english_transcript,
                result.language,
                result.duration,
                result.diarization_status,
                scoring.raw_text,
                scoring.scores,
                scoring.summary,
                sentiment,
                script_compliance,
                tone_analysis,
                processing_seconds=elapsed,
                asr_engine=result.asr_engine,
                scoring_model=OLLAMA_MODEL,
                translation_model=translation_model or None,
                duration_seconds=result.duration_seconds,
            )
            _progress(audio_file, "complete", "AI Process Complete")
            log_call_event(
                audio_file,
                "complete",
                f"Success overall={scoring.scores.get('Overall_Scoring', 'n/a')} elapsed={elapsed:.1f}s",
            )
    except Exception as exc:
        log_call_event(
            audio_file,
            stage,
            f"Processing failed: {exc}",
            level="ERROR",
            detail=str(exc),
            exc=exc,
        )
        try:
            update_processing_progress(
                audio_file,
                stage="failed",
                progress=100,
                message=str(exc)[:500],
                status="Failed",
            )
            mark_failed(audio_file, str(exc), stage=stage)
        except Exception as db_exc:
            log(f"Could not persist failure for {audio_file}: {db_exc}")


@app.get("/health")
def health():
    if SCORING_ENABLED and ENRICHMENT_ENABLED:
        phase = "2c-enrichment"
    elif SCORING_ENABLED:
        phase = "2b-scoring"
    else:
        phase = "2a-transcribe-only"
    return jsonify(
        {
            "success": True,
            "service": "ai-mvp-orchestrator",
            "phase": phase,
            "ollama_model": OLLAMA_MODEL,
            "translation_enabled": translation_enabled(),
            "transcription": transcription_health(),
            "scoring": ollama_health(),
            "enrichment": enrichment_health(),
            "intelligence": intelligence_health(),
        }
    )


def _start_audio_job(audio_file: str):
    log(f"Accepted job: {audio_file}")
    threading.Thread(target=process_audio_job, args=(audio_file,), daemon=True).start()


@app.post("/process-audio")
def process_audio_endpoint():
    if not _authorized(request):
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    data = request.get_json(silent=True) or {}
    audio_file = data.get("audioFile")
    if not audio_file:
        return jsonify({"success": False, "message": "Missing audioFile"}), 400

    audio_path = Path(AUDIO_UPLOAD_DIR) / audio_file
    if not audio_path.is_file():
        log(f"Audio file not found: {audio_path}")
        return jsonify({"success": False, "message": f"File not found: {audio_file}"}), 404

    _start_audio_job(audio_file)
    msg = (
        "Audio processing started (transcribe + translate + Ollama scoring)."
        if SCORING_ENABLED
        else "Audio processing started (transcribe only)."
    )
    return jsonify({"success": True, "message": msg}), 200


@app.post("/upload-and-process")
def upload_and_process_endpoint():
    if not _authorized(request):
        return jsonify({"success": False, "message": "Unauthorized"}), 401

    audio_file = request.form.get("audioFile")
    if not audio_file:
        return jsonify({"success": False, "message": "Missing audioFile"}), 400

    upload = request.files.get("audio")
    if not upload or not upload.filename:
        return jsonify({"success": False, "message": "Missing audio file"}), 400

    dest = Path(AUDIO_UPLOAD_DIR) / audio_file
    dest.parent.mkdir(parents=True, exist_ok=True)
    upload.save(dest)
    log(f"Uploaded {audio_file} ({dest.stat().st_size} bytes)")

    _start_audio_job(audio_file)
    return jsonify(
        {"success": True, "message": "Audio uploaded and processing started."}
    ), 200


if __name__ == "__main__":
    if SCORING_ENABLED and ENRICHMENT_ENABLED:
        phase = "2c (transcribe + translate + LLM scoring + tone/sentiment/script)"
    elif SCORING_ENABLED:
        phase = "2b (transcribe + translate + LLM scoring)"
    else:
        phase = "2a (transcribe only)"
    log(f"AI MVP orchestrator starting on port {PORT} — Phase {phase} — model={OLLAMA_MODEL}")
    try:
        ensure_consolidated_table()
        log("Database schema ready (progress + metadata columns)")
    except Exception as exc:
        log(f"DB schema warning: {exc}")

    health_info = transcription_health()
    if health_info.get("ready"):
        log(f"ASR backend ready: {health_info.get('active_backend')}")
    else:
        log(f"Model preload warning: {health_info}")

    if SCORING_ENABLED:
        scoring_info = ollama_health()
        backend = scoring_info.get("backend", "openai")
        if scoring_info.get("ready"):
            log(f"LLM scoring ready: {scoring_info.get('model')} via {backend}")
        else:
            log(f"LLM scoring warning: {scoring_info}")

    if ENRICHMENT_ENABLED:
        enrich_info = enrichment_health()
        log(f"Phase 2c enrichment: {enrich_info}")

    app.run(host="0.0.0.0", port=PORT, debug=False, threaded=True)
