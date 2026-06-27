"""
sp-nemo — IndicConformer ASR microservice (Sherpa-ONNX, NO NeMo dependency).

Replaces the broken in-container NeMo IndicConformer (KeyError: 'dir') for
Hindi/Bengali. Loads AI4Bharat's IndicConformer exported to ONNX-CTC and serves
it via sherpa-onnx. Fully offline; model files are bundled under MODEL_DIR.

Endpoints:
  GET  /health      -> {"ready": bool, ...}
  POST /transcribe  -> multipart file=<wav/mp3> + form lang=<hi|bn|...>
                       returns {"success": true, "text": "...", "engine": "..."}

Env:
  SP_NEMO_MODEL_DIR   default /models/indic-onnx   (model.onnx + tokens.txt)
  SP_NEMO_MODEL_FILE  default model.onnx           (fp32 for best quality on GPU)
  SP_NEMO_TOKENS      default tokens.txt
  SP_NEMO_PROVIDER    default cuda                 (cuda|cpu)
  SP_NEMO_THREADS     default 4
  SP_NEMO_PORT        default 8020
"""

from __future__ import annotations

import io
import logging
import os
import tempfile

import librosa
import numpy as np
import sherpa_onnx
from flask import Flask, jsonify, request

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [sp-nemo] %(levelname)s %(message)s",
)
logger = logging.getLogger("sp-nemo")

MODEL_DIR = os.getenv("SP_NEMO_MODEL_DIR", "/models/indic-onnx")
MODEL_FILE = os.getenv("SP_NEMO_MODEL_FILE", "model.onnx")
TOKENS_FILE = os.getenv("SP_NEMO_TOKENS", "tokens.txt")
PROVIDER = os.getenv("SP_NEMO_PROVIDER", "cuda").lower()
THREADS = int(os.getenv("SP_NEMO_THREADS", "4"))
PORT = int(os.getenv("SP_NEMO_PORT", "8020"))

app = Flask(__name__)
_recognizer: sherpa_onnx.OfflineRecognizer | None = None
_load_error: str | None = None


def _model_path() -> str:
    return os.path.join(MODEL_DIR, MODEL_FILE)


def _tokens_path() -> str:
    return os.path.join(MODEL_DIR, TOKENS_FILE)


def load_recognizer() -> None:
    global _recognizer, _load_error
    model = _model_path()
    tokens = _tokens_path()
    if not os.path.isfile(model):
        _load_error = f"model not found: {model}"
        logger.error(_load_error)
        return
    if not os.path.isfile(tokens):
        _load_error = f"tokens not found: {tokens}"
        logger.error(_load_error)
        return
    try:
        logger.info("Loading IndicConformer ONNX (provider=%s, threads=%d) ...", PROVIDER, THREADS)
        _recognizer = sherpa_onnx.OfflineRecognizer.from_nemo_ctc(
            model=model,
            tokens=tokens,
            num_threads=THREADS,
            provider=PROVIDER,
            debug=False,
        )
        _load_error = None
        logger.info("sp-nemo ready: %s", model)
    except Exception as exc:  # noqa: BLE001
        _load_error = f"load failed: {exc}"
        logger.exception("Failed to load recognizer")


def _read_audio_16k_mono(raw: bytes) -> np.ndarray:
    # librosa handles wav/mp3/flac and resamples to 16k mono float32.
    samples, _sr = librosa.load(io.BytesIO(raw), sr=16000, mono=True)
    return samples.astype(np.float32)


@app.get("/health")
def health():
    return jsonify(
        {
            "ready": _recognizer is not None,
            "error": _load_error,
            "model": _model_path(),
            "provider": PROVIDER,
            "threads": THREADS,
            "engine": "sherpa-onnx/indicconformer-ctc",
        }
    ), (200 if _recognizer is not None else 503)


@app.post("/transcribe")
def transcribe():
    if _recognizer is None:
        return jsonify({"success": False, "message": _load_error or "not ready"}), 503

    lang = (request.form.get("lang") or request.args.get("lang") or "").strip()
    if "file" not in request.files:
        return jsonify({"success": False, "message": "missing file"}), 400

    raw = request.files["file"].read()
    if not raw:
        return jsonify({"success": False, "message": "empty file"}), 400

    try:
        samples = _read_audio_16k_mono(raw)
    except Exception as exc:  # noqa: BLE001
        logger.warning("audio decode failed: %s", exc)
        return jsonify({"success": False, "message": f"decode failed: {exc}"}), 400

    if samples.size < 16000 * 0.2:  # < 0.2s
        return jsonify({"success": True, "text": "", "engine": "sherpa-onnx/indicconformer-ctc"}), 200

    try:
        stream = _recognizer.create_stream()
        stream.accept_waveform(16000, samples)
        _recognizer.decode_stream(stream)
        text = (stream.result.text or "").strip()
    except Exception as exc:  # noqa: BLE001
        logger.exception("transcription failed")
        return jsonify({"success": False, "message": f"transcribe failed: {exc}"}), 500

    logger.info("transcribed lang=%s samples=%d chars=%d", lang, samples.size, len(text))
    return jsonify(
        {"success": True, "text": text, "engine": "sherpa-onnx/indicconformer-ctc"}
    ), 200


load_recognizer()

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)
