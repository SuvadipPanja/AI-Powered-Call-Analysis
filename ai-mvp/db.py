from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any

import pyodbc

from db_schema import (
    ALTER_AI_RESULT_METADATA_SQL,
    ALTER_AUDIO_UPLOADS_PROGRESS_SQL,
    ALTER_CAA_INTELLIGENCE_SQL,
    CREATE_CAA_INDEX_SQL,
    CREATE_CONSOLIDATED_SQL,
)

DB_ENABLED = os.getenv("DB_ENABLED", "true").lower() != "false"
BACKEND_CALLBACK_URL = os.getenv("BACKEND_CALLBACK_URL", "").strip()
CALLBACK_SECRET = os.getenv("CALLBACK_SECRET", "")
PROCESS_STATUS_MAX_LEN = 50


def _compact_process_status(status: str) -> str:
    text = (status or "").strip()
    if len(text) <= PROCESS_STATUS_MAX_LEN:
        return text
    return text[: PROCESS_STATUS_MAX_LEN - 3] + "..."


def _build_failed_status(error: str, stage: str | None = None) -> str:
    err = (error or "Unknown error").strip().replace("\n", " ").replace("\r", " ")
    lower = err.lower()

    if "unsupported call language" in lower or ("language" in lower and "unknown" in lower):
        return "Failed: Language detection"
    if "llm http" in lower or ("openai" in lower and "http" in lower):
        return "Failed: LLM error"
    if "vllm" in lower:
        return "Failed: LLM unavailable"
    if "memory layout cannot be allocated" in lower or ("ollama" in lower and "memory" in lower):
        return "Failed: Ollama out of memory"
    if "ollama http 500" in lower:
        return "Failed: Ollama scoring error"
    if "ollama" in lower:
        return "Failed: Ollama unavailable"
    if stage:
        stage_labels = {
            "upload": "Upload",
            "transcription": "Transcription",
            "translation": "Translation",
            "scoring": "AI scoring",
            "enrichment": "Enrichment",
        }
        label = stage_labels.get(stage, stage.title())
        short = f"Failed: {label}"
        if len(short) <= PROCESS_STATUS_MAX_LEN:
            return short

    prefix = "Failed: "
    max_detail = PROCESS_STATUS_MAX_LEN - len(prefix)
    detail = err if len(err) <= max_detail else err[: max_detail - 3] + "..."
    return _compact_process_status(prefix + detail)


def _odbc_driver() -> str:
    preferred = ("ODBC Driver 18 for SQL Server", "ODBC Driver 17 for SQL Server")
    installed = {d.strip() for d in pyodbc.drivers()}
    for name in preferred:
        if name in installed:
            return name
    raise RuntimeError(
        f"No SQL Server ODBC driver found. Installed: {sorted(installed)}"
    )


def _post_callback(payload: dict) -> None:
    if not BACKEND_CALLBACK_URL:
        raise RuntimeError("DB_ENABLED=false but BACKEND_CALLBACK_URL is not set")
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        BACKEND_CALLBACK_URL,
        data=data,
        headers={
            "Content-Type": "application/json",
            "X-Callback-Secret": CALLBACK_SECRET,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            if resp.status >= 400:
                body = resp.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"Callback failed: HTTP {resp.status} — {body[:200]}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Callback failed: HTTP {exc.code} — {body[:200]}") from exc


def connect():
    server = os.getenv("DB_SERVER", "localhost")
    database = os.getenv("DB_DATABASE", "call_analysis_db")
    driver = _odbc_driver()
    if os.getenv("DB_USE_WINDOWS_AUTH", "false").lower() == "true":
        conn_str = (
            f"DRIVER={{{driver}}};"
            f"SERVER={server};DATABASE={database};"
            "Trusted_Connection=yes;TrustServerCertificate=yes;"
        )
    else:
        user = os.getenv("DB_USER", "sa")
        password = os.getenv("DB_PASSWORD", "")
        conn_str = (
            f"DRIVER={{{driver}}};"
            f"SERVER={server};DATABASE={database};"
            f"UID={user};PWD={password};"
            "TrustServerCertificate=yes;Encrypt=no;"
        )
    return pyodbc.connect(conn_str)


def update_process_status(audio_file: str, status: str) -> None:
    status = _compact_process_status(status)
    if not DB_ENABLED:
        _post_callback(
            {
                "audioFile": audio_file,
                "type": "status",
                "processStatus": status,
            }
        )
        return

    with connect() as conn:
        conn.cursor().execute(
            "UPDATE AudioUploads SET ProcessStatus = ? WHERE AudioFileName = ?",
            status,
            audio_file,
        )
        conn.commit()


def ensure_progress_columns() -> None:
    if not DB_ENABLED:
        return
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(ALTER_AUDIO_UPLOADS_PROGRESS_SQL)
        cur.execute(ALTER_AI_RESULT_METADATA_SQL)
        conn.commit()


def update_detected_language(audio_file: str, language: str) -> None:
    """Persist detected call language as soon as identification finishes (before full transcript)."""
    lang = (language or "").strip()
    if not lang or lang.lower() == "unknown":
        return

    if not DB_ENABLED:
        _post_callback(
            {
                "audioFile": audio_file,
                "type": "language",
                "language": lang[:50],
            }
        )
        return

    ensure_progress_columns()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM AI_Processing_Result WHERE AudioFileName = ?",
            audio_file,
        )
        exists = cur.fetchone()[0] > 0
        if exists:
            cur.execute(
                """
                UPDATE AI_Processing_Result
                SET OriginalLanguage = ?, AudioLanguage = ?
                WHERE AudioFileName = ?
                """,
                lang[:50],
                lang[:50],
                audio_file,
            )
        else:
            cur.execute(
                """
                INSERT INTO AI_Processing_Result (
                    AudioFileName, OriginalLanguage, AudioLanguage, Status, Timestamp
                )
                VALUES (?, ?, ?, 'Processing', GETDATE())
                """,
                audio_file,
                lang[:50],
                lang[:50],
            )
        conn.commit()


def update_processing_progress(
    audio_file: str,
    *,
    stage: str,
    progress: int,
    message: str,
    status: str | None = None,
    language: str | None = None,
) -> None:
    ensure_progress_columns()
    pct = max(0, min(100, int(progress)))
    msg = (message or "")[:500]
    stg = (stage or "")[:50]
    proc_status = _compact_process_status(status or stg.replace("_", " ").title())

    if language:
        update_detected_language(audio_file, language)

    if not DB_ENABLED:
        payload = {
            "audioFile": audio_file,
            "type": "status",
            "processStatus": proc_status,
            "stage": stg,
            "progress": pct,
            "message": msg,
        }
        if language:
            payload["language"] = language.strip()[:50]
        _post_callback(payload)
        return

    with connect() as conn:
        conn.cursor().execute(
            """
            UPDATE AudioUploads
            SET ProcessStatus = ?,
                ProcessStage = ?,
                ProcessProgress = ?,
                ProcessMessage = ?
            WHERE AudioFileName = ?
            """,
            proc_status,
            stg,
            pct,
            msg,
            audio_file,
        )
        conn.commit()


def upsert_transcription_result(
    audio_file: str,
    original_transcript: str,
    english_transcript: str,
    language: str,
    duration: str,
    diarization_status: str = "Unknown",
    asr_engine: str = "",
    duration_seconds: float = 0.0,
) -> None:
    if not DB_ENABLED:
        _post_callback(
            {
                "audioFile": audio_file,
                "type": "result",
                "processStatus": "Transcribed",
                "transcript": original_transcript,
                "translateOutput": english_transcript,
                "language": language,
                "duration": duration,
                "diarizationStatus": diarization_status,
            }
        )
        return

    ensure_progress_columns()
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM AI_Processing_Result WHERE AudioFileName = ?",
            audio_file,
        )
        exists = cur.fetchone()[0] > 0
        if exists:
            cur.execute(
                """
                UPDATE AI_Processing_Result
                SET TranscribeOutput = ?, TranslateOutput = ?, AudioLanguage = ?,
                    OriginalLanguage = ?, AudioDuration = ?, AudioDiarization = ?,
                    ASREngine = ?, AIScoring = NULL, Sentiment = NULL,
                    Status = ?, Timestamp = GETDATE()
                WHERE AudioFileName = ?
                """,
                original_transcript,
                english_transcript,
                language,
                language,
                duration,
                diarization_status,
                asr_engine[:200] if asr_engine else None,
                "Transcribed",
                audio_file,
            )
        else:
            cur.execute(
                """
                INSERT INTO AI_Processing_Result (
                    AudioFileName, TranscribeOutput, TranslateOutput,
                    AudioLanguage, OriginalLanguage, AudioDuration,
                    AudioDiarization, ASREngine, Status, Timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE())
                """,
                audio_file,
                original_transcript,
                english_transcript,
                language,
                language,
                duration,
                diarization_status,
                asr_engine[:200] if asr_engine else None,
                "Transcribed",
            )
        conn.commit()


def ensure_consolidated_table() -> None:
    if not DB_ENABLED:
        return
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(CREATE_CONSOLIDATED_SQL)
        cur.execute(CREATE_CAA_INDEX_SQL)
        cur.execute(ALTER_AUDIO_UPLOADS_PROGRESS_SQL)
        cur.execute(ALTER_AI_RESULT_METADATA_SQL)
        cur.execute(ALTER_CAA_INTELLIGENCE_SQL)
        conn.commit()


def _calc_wpm(transcript: str, duration_seconds: float) -> float | None:
    """Words per minute = speech words / (duration in minutes)."""
    if not transcript or not duration_seconds or duration_seconds <= 0:
        return None
    try:
        from llm_utils import count_speech_words
        words = count_speech_words(transcript)
    except ImportError:
        import re
        clean = re.sub(
            r"^\s*[\d.]+\s*-\s*[\d.]+\s*\([^)]*\)\s*:\s*",
            "",
            transcript,
            flags=re.MULTILINE,
        )
        words = len(clean.split())
    if words == 0:
        return None
    return round(words / (duration_seconds / 60.0), 2)


def _safe_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _write_call_intelligence(cur, audio_file: str, scores: dict[str, Any]) -> None:
    """Persist Phase 2d intelligence fields onto Consolidated_Audio_Analysis.

    Done as an isolated UPDATE (after the main scoring upsert) so the large
    positional scoring tuple stays untouched. Safe if a key is missing — falls
    back to neutral defaults. Never raises out of the caller's transaction for a
    non-critical field: missing columns / parse issues are swallowed.
    """
    secondary = scores.get("Secondary_Query_Types")
    if not isinstance(secondary, (list, tuple)):
        secondary = []
    secondary_json = json.dumps(list(secondary), ensure_ascii=False)

    intel_blob = {
        "Primary_Query_Type": scores.get("Primary_Query_Type"),
        "Secondary_Query_Types": list(secondary),
        "Escalation_Requested": scores.get("Escalation_Requested"),
        "Escalation_Actioned": scores.get("Escalation_Actioned"),
        "Escalation_Category": scores.get("Escalation_Category"),
        "CSAT_Transferred": scores.get("CSAT_Transferred"),
        "Loan_Is_Loan_Call": scores.get("Loan_Is_Loan_Call"),
        "Loan_Type": scores.get("Loan_Type"),
        "Loan_Interest": scores.get("Loan_Interest"),
        "EMI_Affordability": scores.get("EMI_Affordability"),
        "EMI_Amount": scores.get("EMI_Amount"),
        "Loan_Amount": scores.get("Loan_Amount"),
        "Agent_Convinced": scores.get("Agent_Convinced"),
        "Loan_Success_Probability": scores.get("Loan_Success_Probability"),
        "Intelligence_Summary": scores.get("Intelligence_Summary"),
    }

    try:
        cur.execute(
            """
            UPDATE Consolidated_Audio_Analysis
            SET AI_Primary_Query_Type = ?,
                AI_Secondary_Query_Types = ?,
                AI_Escalation_Requested = ?,
                AI_Escalation_Actioned = ?,
                AI_Escalation_Category = ?,
                AI_CSAT_Transferred = ?,
                AI_Loan_Is_Loan_Call = ?,
                AI_Loan_Type = ?,
                AI_Loan_Interest = ?,
                AI_EMI_Affordability = ?,
                AI_EMI_Amount = ?,
                AI_Loan_Amount = ?,
                AI_Agent_Convinced = ?,
                AI_Loan_Success_Probability = ?,
                AI_Intelligence_Summary = ?,
                AI_Call_Intelligence = ?
            WHERE AudioFileName = ?
            """,
            str(scores.get("Primary_Query_Type", "Other/General Info"))[:100],
            secondary_json,
            str(scores.get("Escalation_Requested", "No"))[:10],
            str(scores.get("Escalation_Actioned", "N/A"))[:10],
            str(scores.get("Escalation_Category", "None"))[:50],
            str(scores.get("CSAT_Transferred", "No"))[:10],
            str(scores.get("Loan_Is_Loan_Call", "No"))[:10],
            str(scores.get("Loan_Type", "None"))[:50],
            str(scores.get("Loan_Interest", "None"))[:20],
            str(scores.get("EMI_Affordability", "Not Discussed"))[:20],
            _safe_float(scores.get("EMI_Amount")) if scores.get("EMI_Amount") is not None else None,
            _safe_float(scores.get("Loan_Amount")) if scores.get("Loan_Amount") is not None else None,
            str(scores.get("Agent_Convinced", "N/A"))[:20],
            _safe_float(scores.get("Loan_Success_Probability")),
            str(scores.get("Intelligence_Summary", ""))[:4000],
            json.dumps(intel_blob, ensure_ascii=False),
            audio_file,
        )
    except Exception:
        # Intelligence columns may not exist on a not-yet-migrated DB; never let
        # this break the scoring write.
        pass


def _fetch_upload_metadata(audio_file: str) -> dict[str, Any]:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT UploadDate, SelectedAgent, SelectedCallDate, CallType
            FROM AudioUploads
            WHERE AudioFileName = ?
            """,
            audio_file,
        )
        row = cur.fetchone()
        if not row:
            return {
                "UploadDate": None,
                "AgentName": "Unknown",
                "SelectedCallDate": None,
                "CallType": "inbound",
            }
        return {
            "UploadDate": row[0],
            "AgentName": row[1] or "Unknown",
            "SelectedCallDate": row[2],
            "CallType": row[3] or "inbound",
        }


def upsert_scoring_result(
    audio_file: str,
    original_transcript: str,
    english_transcript: str,
    language: str,
    duration: str,
    diarization_status: str,
    scoring_raw: str,
    scores: dict[str, Any],
    summary: str,
    sentiment: list[dict[str, Any]],
    script_compliance: str,
    tone_analysis: dict[str, Any],
    processing_seconds: float | None = None,
    asr_engine: str = "",
    scoring_model: str = "",
    translation_model: str = "",
    duration_seconds: float = 0.0,
) -> None:
    sentiment_json = json.dumps(sentiment, ensure_ascii=False)
    tone_json = json.dumps(tone_analysis, ensure_ascii=False)
    overall = _safe_float(scores.get("Overall_Scoring"))
    wpm = _calc_wpm(english_transcript, duration_seconds)
    proc_time = (
        f"{int(processing_seconds)}s"
        if processing_seconds is not None
        else None
    )

    if not DB_ENABLED:
        _post_callback(
            {
                "audioFile": audio_file,
                "type": "scoring",
                "processStatus": "AI Process Complete",
                "transcript": original_transcript,
                "translateOutput": english_transcript,
                "language": language,
                "duration": duration,
                "diarizationStatus": diarization_status,
                "scoringRaw": scoring_raw,
                "scores": scores,
                "summary": summary,
                "sentiment": sentiment,
                "scriptCompliance": script_compliance,
                "toneAnalysis": tone_analysis,
                "processingSeconds": processing_seconds,
            }
        )
        return

    ensure_consolidated_table()
    meta = _fetch_upload_metadata(audio_file)

    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE AI_Processing_Result
            SET TranscribeOutput = ?, TranslateOutput = ?, AudioLanguage = ?,
                OriginalLanguage = ?, AudioDuration = ?, AudioDiarization = ?,
                ASREngine = ?, ScoringModel = ?, TranslationModel = ?,
                ToneAnalysis = ?, AIScoring = ?, Sentiment = ?, ScriptCompliance = ?,
                Status = 'Success', Timestamp = GETDATE()
            WHERE AudioFileName = ?
            """,
            original_transcript,
            english_transcript,
            language,
            language,
            duration,
            diarization_status,
            asr_engine[:200] if asr_engine else None,
            scoring_model[:100] if scoring_model else None,
            translation_model[:100] if translation_model else None,
            tone_json,
            scoring_raw,
            sentiment_json,
            script_compliance,
            audio_file,
        )
        if cur.rowcount == 0:
            cur.execute(
                """
                INSERT INTO AI_Processing_Result (
                    AudioFileName, TranscribeOutput, TranslateOutput,
                    AudioLanguage, OriginalLanguage, AudioDuration, AudioDiarization,
                    ASREngine, ScoringModel, TranslationModel,
                    ToneAnalysis, AIScoring, Sentiment, ScriptCompliance,
                    Status, Timestamp
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Success', GETDATE())
                """,
                audio_file,
                original_transcript,
                english_transcript,
                language,
                language,
                duration,
                diarization_status,
                asr_engine[:200] if asr_engine else None,
                scoring_model[:100] if scoring_model else None,
                translation_model[:100] if translation_model else None,
                tone_json,
                scoring_raw,
                sentiment_json,
                script_compliance,
            )

        cur.execute(
            "SELECT UploadID FROM Consolidated_Audio_Analysis WHERE AudioFileName = ?",
            audio_file,
        )
        existing = cur.fetchone()

        score_values = (
            english_transcript,
            tone_json,
            sentiment_json,
            script_compliance,
            overall,
            overall,
            _safe_float(scores.get("Opening_Speech")),
            _safe_float(scores.get("Empathy")),
            _safe_float(scores.get("Query_Handling")),
            _safe_float(scores.get("Adherence_to_Protocol")),
            _safe_float(scores.get("Resolution_Assurance")),
            _safe_float(scores.get("Query_Resolution")),
            _safe_float(scores.get("Polite_Tone")),
            _safe_float(scores.get("Authentication_Verification")),
            _safe_float(scores.get("Escalation_Handling")),
            _safe_float(scores.get("Closing_Speech")),
            str(scores.get("Rude_Behavior", "No")),
            str(scores.get("Call_Type", "Inquiry")),
            str(scores.get("Lead_Classification", "Not a Lead")),
            str(scores.get("Resolution_Status", "Pending")),
            str(scores.get("Feedback", "")),
            summary,
            language,
            duration,
            wpm,
            proc_time,
            "Success",
        )

        if existing:
            cur.execute(
                """
                UPDATE Consolidated_Audio_Analysis
                SET UploadDate = COALESCE(UploadDate, ?),
                    AgentName = COALESCE(NULLIF(AgentName, 'Unknown'), ?),
                    SelectedCallDate = COALESCE(SelectedCallDate, ?),
                    CallType = COALESCE(NULLIF(CallType, ''), ?),
                    TranslateOutput = ?, ToneAnalysis = ?, Sentiment = ?,
                    ScriptCompliance = ?, AIScoring = ?, AI_Overall_Scoring = ?,
                    AI_Opening_Speech = ?, AI_Empathy = ?, AI_Query_Handling = ?,
                    AI_Adherence_to_Protocol = ?, AI_Resolution_Assurance = ?,
                    AI_Query_Resolution = ?, AI_Polite_Tone = ?,
                    AI_Authentication_Verification = ?, AI_Escalation_Handling = ?,
                    AI_Closing_Speech = ?, AI_Rude_Behavior = ?,
                    AI_Call_Type = ?, AI_Lead_Classification = ?,
                    AI_Resolution_Status = ?, AI_Feedback = ?, AI_Summary = ?,
                    AudioLanguage = ?, AudioDuration = ?,
                    AudioWPM = ?,
                    TotalDurationOfAIProcessing = ?, Status = ?
                WHERE AudioFileName = ?
                """,
                (
                    meta["UploadDate"],
                    meta["AgentName"],
                    meta["SelectedCallDate"],
                    meta["CallType"],
                    *score_values,
                    audio_file,
                ),
            )
        else:
            cur.execute(
                """
                INSERT INTO Consolidated_Audio_Analysis (
                    UploadDate, AudioFileName, AgentName, SelectedCallDate, CallType,
                    TranslateOutput, ToneAnalysis, Sentiment, ScriptCompliance,
                    AIScoring, AI_Overall_Scoring,
                    AI_Opening_Speech, AI_Empathy, AI_Query_Handling,
                    AI_Adherence_to_Protocol, AI_Resolution_Assurance, AI_Query_Resolution,
                    AI_Polite_Tone, AI_Authentication_Verification, AI_Escalation_Handling,
                    AI_Closing_Speech, AI_Rude_Behavior,
                    AI_Call_Type, AI_Lead_Classification, AI_Resolution_Status,
                    AI_Feedback, AI_Summary,
                    AudioLanguage, AudioDuration, AudioWPM,
                    TotalDurationOfAIProcessing, Status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    meta["UploadDate"],
                    audio_file,
                    meta["AgentName"],
                    meta["SelectedCallDate"],
                    meta["CallType"],
                    *score_values,
                ),
            )

        _write_call_intelligence(cur, audio_file, scores)

        cur.execute(
            "SELECT COUNT(*) FROM AI_Details_Scoring WHERE AudioFileName = ?",
            audio_file,
        )
        ads_exists = cur.fetchone()[0] > 0
        if ads_exists:
            cur.execute(
                """
                UPDATE AI_Details_Scoring
                SET AudioDuration = ?, AudioLanguage = ?, AIScoring = ?,
                    Opening_Speech = ?, Empathy = ?, Query_Handling = ?,
                    Adherence_to_Protocol = ?, Resolution_Assurance = ?,
                    Query_Resolution = ?, Polite_Tone = ?,
                    Authentication_Verification = ?, Escalation_Handling = ?,
                    Closing_Speech = ?, Rude_Behavior = ?, Overall_Scoring = ?,
                    Call_Type = ?, Lead_Classification = ?, Resolution_Status = ?,
                    Feedback = ?, Summary = ?, AgentName = ?, CallType = ?,
                    CallDate = ?, UploadDate = ?, CreatedAt = GETDATE()
                WHERE AudioFileName = ?
                """,
                duration,
                language,
                overall,
                _safe_float(scores.get("Opening_Speech")),
                _safe_float(scores.get("Empathy")),
                _safe_float(scores.get("Query_Handling")),
                _safe_float(scores.get("Adherence_to_Protocol")),
                _safe_float(scores.get("Resolution_Assurance")),
                _safe_float(scores.get("Query_Resolution")),
                _safe_float(scores.get("Polite_Tone")),
                _safe_float(scores.get("Authentication_Verification")),
                _safe_float(scores.get("Escalation_Handling")),
                _safe_float(scores.get("Closing_Speech")),
                str(scores.get("Rude_Behavior", "No")),
                overall,
                str(scores.get("Call_Type", "Inquiry")),
                str(scores.get("Lead_Classification", "Not a Lead")),
                str(scores.get("Resolution_Status", "Pending")),
                str(scores.get("Feedback", "")),
                summary,
                meta["AgentName"],
                meta["CallType"],
                meta["SelectedCallDate"],
                meta["UploadDate"],
                audio_file,
            )
        else:
            cur.execute(
                """
                INSERT INTO AI_Details_Scoring (
                    AudioFileName, AudioDuration, AudioLanguage, AIScoring,
                    Opening_Speech, Empathy, Query_Handling, Adherence_to_Protocol,
                    Resolution_Assurance, Query_Resolution, Polite_Tone,
                    Authentication_Verification, Escalation_Handling, Closing_Speech,
                    Rude_Behavior, Overall_Scoring, Call_Type, Lead_Classification,
                    Resolution_Status, Feedback, Summary, CreatedAt,
                    AgentName, CallType, CallDate, UploadDate
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, GETDATE(), ?, ?, ?, ?)
                """,
                audio_file,
                duration,
                language,
                overall,
                _safe_float(scores.get("Opening_Speech")),
                _safe_float(scores.get("Empathy")),
                _safe_float(scores.get("Query_Handling")),
                _safe_float(scores.get("Adherence_to_Protocol")),
                _safe_float(scores.get("Resolution_Assurance")),
                _safe_float(scores.get("Query_Resolution")),
                _safe_float(scores.get("Polite_Tone")),
                _safe_float(scores.get("Authentication_Verification")),
                _safe_float(scores.get("Escalation_Handling")),
                _safe_float(scores.get("Closing_Speech")),
                str(scores.get("Rude_Behavior", "No")),
                overall,
                str(scores.get("Call_Type", "Inquiry")),
                str(scores.get("Lead_Classification", "Not a Lead")),
                str(scores.get("Resolution_Status", "Pending")),
                str(scores.get("Feedback", "")),
                summary,
                meta["AgentName"],
                meta["CallType"],
                meta["SelectedCallDate"],
                meta["UploadDate"],
            )

        cur.execute(
            "UPDATE AudioUploads SET ProcessStatus = ? WHERE AudioFileName = ?",
            "AI Process Complete",
            audio_file,
        )
        conn.commit()


def mark_failed(audio_file: str, error: str, stage: str | None = None) -> None:
    status = _build_failed_status(error, stage)
    full_error = (error or "Unknown error").strip()
    if not DB_ENABLED:
        _post_callback(
            {
                "audioFile": audio_file,
                "type": "failed",
                "processStatus": status,
                "error": full_error[:500],
            }
        )
        return

    update_process_status(audio_file, status)

    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            "SELECT COUNT(*) FROM AI_Processing_Result WHERE AudioFileName = ?",
            audio_file,
        )
        exists = cur.fetchone()[0] > 0
        if exists:
            cur.execute(
                """
                UPDATE AI_Processing_Result
                SET Status = 'Failed', Timestamp = GETDATE()
                WHERE AudioFileName = ?
                """,
                audio_file,
            )
        else:
            cur.execute(
                """
                INSERT INTO AI_Processing_Result (
                    AudioFileName, Status, Timestamp, TranscribeOutput
                )
                VALUES (?, 'Failed', GETDATE(), ?)
                """,
                audio_file,
                full_error[:4000],
            )

        ensure_consolidated_table()
        meta = _fetch_upload_metadata(audio_file)
        cur.execute(
            "SELECT UploadID FROM Consolidated_Audio_Analysis WHERE AudioFileName = ?",
            audio_file,
        )
        consolidated_exists = cur.fetchone()
        if consolidated_exists:
            cur.execute(
                """
                UPDATE Consolidated_Audio_Analysis
                SET Status = 'Failed',
                    ErrorReason = ?,
                    UploadDate = COALESCE(UploadDate, ?),
                    AgentName = COALESCE(NULLIF(AgentName, 'Unknown'), ?),
                    SelectedCallDate = COALESCE(SelectedCallDate, ?),
                    CallType = COALESCE(NULLIF(CallType, ''), ?)
                WHERE AudioFileName = ?
                """,
                full_error[:4000],
                meta["UploadDate"],
                meta["AgentName"],
                meta["SelectedCallDate"],
                meta["CallType"],
                audio_file,
            )
        else:
            cur.execute(
                """
                INSERT INTO Consolidated_Audio_Analysis (
                    UploadDate, AudioFileName, AgentName, SelectedCallDate,
                    CallType, Status, ErrorReason
                )
                VALUES (?, ?, ?, ?, ?, 'Failed', ?)
                """,
                meta["UploadDate"],
                audio_file,
                meta["AgentName"],
                meta["SelectedCallDate"],
                meta["CallType"],
                full_error[:4000],
            )
        conn.commit()
