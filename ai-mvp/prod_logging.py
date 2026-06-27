"""Production-grade structured logging for call processing (file + SQL Server)."""

from __future__ import annotations

import json
import traceback
from datetime import datetime
from typing import Any

from config import LOG_DIR

_LOG_TABLE_READY = False


def _log_file_path() -> "Path":
    from pathlib import Path
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    return LOG_DIR / f"call_processing_{datetime.now():%Y-%m-%d}.log"


def _ensure_log_table(cursor) -> None:
    global _LOG_TABLE_READY
    if _LOG_TABLE_READY:
        return
    cursor.execute("""
        IF OBJECT_ID('dbo.CallProcessingLog', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.CallProcessingLog (
                LogID         BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                AudioFileName NVARCHAR(500) NULL,
                Service       NVARCHAR(50) NOT NULL,
                Stage         NVARCHAR(50) NULL,
                Level         NVARCHAR(20) NOT NULL,
                Message       NVARCHAR(MAX) NOT NULL,
                Detail        NVARCHAR(MAX) NULL,
                CreatedAt     DATETIME NOT NULL DEFAULT GETDATE()
            );
            CREATE INDEX IX_CallProcessingLog_AudioFileName
                ON dbo.CallProcessingLog (AudioFileName, CreatedAt DESC);
        END
    """)
    _LOG_TABLE_READY = True


def log_call_event(
    audio_file: str | None,
    stage: str,
    message: str,
    *,
    level: str = "INFO",
    service: str = "ai",
    detail: str | None = None,
    exc: BaseException | None = None,
) -> None:
    """Write JSON line to daily log file and persist to CallProcessingLog when DB enabled."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    if exc and not detail:
        detail = traceback.format_exc()
    payload: dict[str, Any] = {
        "ts": ts,
        "service": service,
        "level": level.upper(),
        "audioFile": audio_file or "",
        "stage": stage,
        "message": message,
    }
    if detail:
        payload["detail"] = detail[:8000]

    line = json.dumps(payload, ensure_ascii=False)
    print(line, flush=True)
    try:
        with open(_log_file_path(), "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass

    try:
        from db import DB_ENABLED, connect

        if not DB_ENABLED:
            return
        with connect() as conn:
            cur = conn.cursor()
            _ensure_log_table(cur)
            cur.execute(
                """
                INSERT INTO dbo.CallProcessingLog (
                    AudioFileName, Service, Stage, Level, Message, Detail
                ) VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    (audio_file or "")[:500] or None,
                    service[:50],
                    (stage or "")[:50] or None,
                    level.upper()[:20],
                    message[:4000],
                    (detail or "")[:8000] or None,
                ),
            )
            conn.commit()
    except Exception:
        pass
