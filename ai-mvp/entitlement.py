"""Sprint 9 — poll backend license entitlement for ai-mvp."""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import requests

_lock = threading.Lock()
_state: dict[str, Any] = {
    "ai_allowed": True,
    "license_state": "active",
    "enabled_modules": [],
    "max_concurrent_jobs": 0,
    "last_sync": None,
    "last_error": None,
}

# In-process active job counter (complements backend DB slot count).
_active_jobs = 0
_active_lock = threading.Lock()


def _backend_url() -> str:
    return (
        os.getenv("BACKEND_INTERNAL_URL")
        or os.getenv("BACKEND_URL")
        or "http://backend:5000"
    ).rstrip("/")


def _auth_headers() -> dict[str, str]:
    token = (os.getenv("SERVICE_TOKEN") or os.getenv("CALLBACK_SECRET") or "").strip()
    if not token:
        return {}
    return {"Authorization": f"Bearer {token}"}


def refresh(timeout: float = 8.0) -> bool:
    url = f"{_backend_url()}/api/internal/ai-entitlement"
    try:
        resp = requests.get(url, headers=_auth_headers(), timeout=timeout)
        if resp.status_code != 200:
            with _lock:
                _state["last_error"] = f"HTTP {resp.status_code}"
            return False
        data = resp.json()
        with _lock:
            _state["ai_allowed"] = bool(data.get("aiAllowed", False))
            _state["license_state"] = str(data.get("licenseState") or "unknown")
            mods = data.get("enabledModules") or data.get("effectiveModules") or []
            _state["enabled_modules"] = list(mods) if isinstance(mods, list) else []
            try:
                _state["max_concurrent_jobs"] = int(data.get("maxConcurrentJobs") or 0)
            except (TypeError, ValueError):
                _state["max_concurrent_jobs"] = 0
            _state["last_sync"] = time.time()
            _state["last_error"] = None
        return True
    except Exception as exc:  # noqa: BLE001
        with _lock:
            _state["last_error"] = str(exc)
        return False


def snapshot() -> dict[str, Any]:
    with _lock:
        return dict(_state)


def ai_allowed() -> bool:
    with _lock:
        return bool(_state.get("ai_allowed"))


def max_jobs() -> int:
    env_cap = 0
    try:
        env_cap = int(os.getenv("AI_MAX_CONCURRENT_JOBS") or "0")
    except (TypeError, ValueError):
        env_cap = 0
    with _lock:
        try:
            lic = int(_state.get("max_concurrent_jobs") or 0)
        except (TypeError, ValueError):
            lic = 0
    if env_cap > 0 and lic > 0:
        return min(env_cap, lic)
    if env_cap > 0:
        return env_cap
    return lic


def module_enabled(mod: str) -> bool:
    with _lock:
        mods = _state.get("enabled_modules") or []
    if not mods:
        return True
    return mod in mods


def try_acquire_job() -> tuple[bool, str]:
    if not ai_allowed():
        return False, "AI not licensed"
    cap = max_jobs()
    if cap <= 0:
        return True, "ok"
    with _active_lock:
        global _active_jobs
        if _active_jobs >= cap:
            return False, f"AI concurrency limit ({_active_jobs}/{cap})"
        _active_jobs += 1
    return True, "ok"


def release_job() -> None:
    global _active_jobs
    with _active_lock:
        if _active_jobs > 0:
            _active_jobs -= 1


def active_job_count() -> int:
    with _active_lock:
        return _active_jobs


def start_poll_thread(interval_sec: float | None = None) -> None:
    sec = interval_sec
    if sec is None:
        try:
            sec = float(os.getenv("AI_ENTITLEMENT_POLL_SEC", "90"))
        except ValueError:
            sec = 90.0
    if sec <= 0:
        return

    def _loop() -> None:
        while True:
            refresh()
            time.sleep(sec)

    t = threading.Thread(target=_loop, name="entitlement-poll", daemon=True)
    t.start()
