"""Shared logging bootstrap for all sp-ai-* services.

Every container calls ``init_service_logging("<service-name>")`` once at
startup. It configures the root logger with:

  * a size-rotated file handler  →  /app/logs/<service>.log
       (LOG_MAX_MB megabytes per file × LOG_BACKUP_COUNT backups, auto-rotated)
  * a stdout stream handler      →  visible via `docker logs <container>`

Level comes from LOG_LEVEL (default INFO). Idempotent: safe to call twice.
"""

from __future__ import annotations

import logging
import os
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

_FORMAT = "%(asctime)s [%(name)s] %(levelname)s %(message)s"
_INITIALIZED: set[str] = set()


def init_service_logging(service_name: str) -> logging.Logger:
    """Configure root logging for a service; returns the service logger."""
    root = logging.getLogger()
    if service_name in _INITIALIZED:
        return logging.getLogger(service_name)

    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    max_mb = float(os.getenv("LOG_MAX_MB", "20"))
    backups = int(os.getenv("LOG_BACKUP_COUNT", "10"))
    log_dir = Path(os.getenv("SERVICE_LOG_DIR", "/app/logs"))

    root.setLevel(level)
    formatter = logging.Formatter(_FORMAT)

    stream = logging.StreamHandler(sys.stdout)
    stream.setFormatter(formatter)
    root.addHandler(stream)

    try:
        log_dir.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_dir / f"{service_name}.log",
            maxBytes=int(max_mb * 1024 * 1024),
            backupCount=backups,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        root.addHandler(file_handler)
    except OSError as exc:  # read-only fs / permission — stdout still works
        root.warning("File logging disabled for %s: %s", service_name, exc)

    # Quieten noisy third-party loggers; our own stay at LOG_LEVEL.
    for noisy in ("urllib3", "werkzeug", "matplotlib", "numba"):
        logging.getLogger(noisy).setLevel(max(level, logging.WARNING))

    _INITIALIZED.add(service_name)
    logger = logging.getLogger(service_name)
    logger.info(
        "Logging initialized (level=%s, file=%s/%s.log, rotate=%sMB x %d)",
        level_name, log_dir, service_name, max_mb, backups,
    )
    return logger
