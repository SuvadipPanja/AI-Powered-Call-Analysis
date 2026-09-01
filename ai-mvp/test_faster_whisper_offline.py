"""Loader guards for the air-gapped CPU referee. faster_whisper is stubbed."""

import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import faster_whisper_worker as worker  # noqa: E402


def _reset():
    worker._model = None
    worker._load_error = None


def test_configured_path_is_used_when_it_exists(tmp_path, monkeypatch):
    _reset()
    model_dir = tmp_path / "faster-whisper-large-v3"
    model_dir.mkdir()
    monkeypatch.setattr(worker, "FASTER_WHISPER_MODEL_PATH", str(model_dir))
    assert worker._model_id() == str(model_dir)


def test_missing_configured_path_raises_instead_of_downloading(tmp_path, monkeypatch):
    _reset()
    monkeypatch.setattr(
        worker, "FASTER_WHISPER_MODEL_PATH", str(tmp_path / "not-there")
    )
    try:
        worker._model_id()
    except RuntimeError as exc:
        assert "not-there" in str(exc)
        assert "download" in str(exc).lower()
    else:
        raise AssertionError("_model_id must refuse a missing configured path")


def test_offline_only_refuses_a_bare_model_name(monkeypatch):
    _reset()
    monkeypatch.setattr(worker, "FASTER_WHISPER_MODEL_PATH", "")
    monkeypatch.setattr(worker, "FASTER_WHISPER_OFFLINE_ONLY", True)
    try:
        worker._model_id()
    except RuntimeError as exc:
        assert "FASTER_WHISPER_MODEL_PATH" in str(exc)
    else:
        raise AssertionError("offline mode must refuse a download-by-name")


def test_bare_model_name_still_allowed_when_offline_only_is_off(monkeypatch):
    _reset()
    monkeypatch.setattr(worker, "FASTER_WHISPER_MODEL_PATH", "")
    monkeypatch.setattr(worker, "FASTER_WHISPER_OFFLINE_ONLY", False)
    monkeypatch.setattr(worker, "FASTER_WHISPER_MODEL_SIZE", "large-v3")
    assert worker._model_id() == "large-v3"


def test_health_reports_the_guard_error_without_raising(tmp_path, monkeypatch):
    _reset()
    monkeypatch.setattr(
        worker, "FASTER_WHISPER_MODEL_PATH", str(tmp_path / "absent")
    )
    health = worker.faster_whisper_health()
    assert health["ready"] is False
    assert "absent" in health["error"]


def test_loader_passes_cpu_threads_to_ctranslate2(tmp_path, monkeypatch):
    _reset()
    model_dir = tmp_path / "faster-whisper-large-v3"
    model_dir.mkdir()
    monkeypatch.setattr(worker, "FASTER_WHISPER_MODEL_PATH", str(model_dir))
    monkeypatch.setattr(worker, "FASTER_WHISPER_CPU_THREADS", 3)
    monkeypatch.setattr(worker, "_resolve_device", lambda: "cpu")

    seen = {}

    class _FakeModel:
        def __init__(self, model_id, **kwargs):
            seen["model_id"] = model_id
            seen.update(kwargs)

    monkeypatch.setitem(
        sys.modules,
        "faster_whisper",
        types.SimpleNamespace(WhisperModel=_FakeModel),
    )
    worker._load()
    assert seen["cpu_threads"] == 3
    assert seen["device"] == "cpu"
    assert seen["compute_type"] == "int8"


def test_referee_can_override_beam_size(tmp_path, monkeypatch):
    _reset()
    captured = {}

    class _Info:
        language = "hi"

    def _fake_transcribe(path, **kwargs):
        captured.update(kwargs)
        return ([], _Info())

    model = types.SimpleNamespace(transcribe=_fake_transcribe)
    worker._run_transcribe(
        model,
        Path("x.wav"),
        "hi",
        no_speech_threshold=0.28,
        vad_filter=False,
        beam_size=1,
    )
    assert captured["beam_size"] == 1
