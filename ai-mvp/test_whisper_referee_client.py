"""Client tests for the GPU Whisper referee. HTTP is stubbed."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import whisper_referee_client as client  # noqa: E402


class _Resp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def json(self):
        return self._payload


def test_health_not_ready_until_window_model_is_advertised(monkeypatch):
    monkeypatch.setattr(
        client.requests,
        "get",
        lambda *a, **k: _Resp({"ready": True, "models": {"whisper-large-v3-lid": "loaded"}}),
    )
    assert client.whisper_referee_health()["ready"] is False


def test_health_ready_when_whisper_window_loaded(monkeypatch):
    monkeypatch.setattr(
        client.requests,
        "get",
        lambda *a, **k: _Resp({"ready": True, "models": {"whisper-window": "loaded"}}),
    )
    assert client.whisper_referee_health()["ready"] is True


def test_transcribe_returns_empty_on_transport_failure(monkeypatch, tmp_path):
    wav = tmp_path / "window.wav"
    wav.write_bytes(b"RIFF0000WAVE")

    def _boom(*a, **k):
        raise OSError("timeout")

    monkeypatch.setattr(client.requests, "post", _boom)
    assert client.transcribe_window_remote(wav, "Hindi") == ""
