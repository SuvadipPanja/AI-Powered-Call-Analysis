"""Unit tests for Silero VAD device resolution."""

from unittest.mock import patch

import pytest

import diarization_worker as dw


def test_resolve_silero_device_auto_cuda():
    with patch.object(dw, "SILERO_VAD_DEVICE", "auto"), patch.object(
        dw.torch.cuda, "is_available", return_value=True
    ):
        assert dw._resolve_silero_device() == "cuda"


def test_resolve_silero_device_auto_cpu():
    with patch.object(dw, "SILERO_VAD_DEVICE", "auto"), patch.object(
        dw.torch.cuda, "is_available", return_value=False
    ):
        assert dw._resolve_silero_device() == "cpu"


def test_resolve_silero_device_cuda_requires_gpu():
    with patch.object(dw, "SILERO_VAD_DEVICE", "cuda"), patch.object(
        dw.torch.cuda, "is_available", return_value=False
    ):
        with pytest.raises(RuntimeError, match="SILERO_VAD_DEVICE=cuda"):
            dw._resolve_silero_device()


def test_resolve_silero_device_cuda_ok():
    with patch.object(dw, "SILERO_VAD_DEVICE", "cuda"), patch.object(
        dw.torch.cuda, "is_available", return_value=True
    ):
        assert dw._resolve_silero_device() == "cuda"


def test_resolve_silero_device_cpu():
    with patch.object(dw, "SILERO_VAD_DEVICE", "cpu"):
        assert dw._resolve_silero_device() == "cpu"


def test_resolve_silero_device_invalid():
    with patch.object(dw, "SILERO_VAD_DEVICE", "tpu"):
        with pytest.raises(RuntimeError, match="Invalid SILERO_VAD_DEVICE"):
            dw._resolve_silero_device()
