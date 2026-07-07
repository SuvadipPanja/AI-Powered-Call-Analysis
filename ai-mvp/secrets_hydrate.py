"""Sprint 6 — hydrate secrets from Docker secret files before other imports read os.environ."""
from __future__ import annotations

import os
from pathlib import Path

MANAGED = (
    "ORCHESTRATOR_SECRET",
    "CALLBACK_SECRET",
    "SERVICE_TOKEN",
    "DB_PASSWORD",
)


def _read_file(path: Path) -> str | None:
    try:
        if not path.is_file():
            return None
        value = path.read_text(encoding="utf-8").strip()
        return value or None
    except OSError:
        return None


def hydrate_secrets() -> list[str]:
    """Load managed secrets from *_FILE or /run/secrets/<lowercase>. Returns names loaded."""
    loaded: list[str] = []
    secrets_dir = Path(os.environ.get("RUN_SECRETS_DIR", "/run/secrets"))

    for name in MANAGED:
        value = None
        file_env = os.environ.get(f"{name}_FILE", "").strip()
        if file_env:
            value = _read_file(Path(file_env))
        if not value:
            value = _read_file(secrets_dir / name.lower())
        if value:
            os.environ[name] = value
            loaded.append(name)

    return loaded
