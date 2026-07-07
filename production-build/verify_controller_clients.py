"""Dev verification: controller -> services round trip via shared clients.

Run INSIDE sp_ai_controller (docker exec) after /tmp/mid.wav exists:
    python3 /tmp/verify_controller_clients.py
"""
from pathlib import Path

from asr_client import asr_service_health, transcribe_remote
from lang_client import lang_service_health

print("NEMO_HEALTH_READY:", asr_service_health("nemo").get("ready"))
print("SEAM_HEALTH_READY:", asr_service_health("seamless").get("ready"))
print("LANG_HEALTH_READY:", lang_service_health().get("ready"))

text, engine = transcribe_remote(Path("/tmp/mid.wav"), "English", "nemo", "ctrl-verify")
print("REMOTE_ASR_OK:", engine, "|", text[:100])

# Seamless is model-less on dev -> must raise RuntimeError (503), which the
# controller treats as fallback trigger. Confirm the error path is clean.
try:
    transcribe_remote(Path("/tmp/mid.wav"), "Bengali", "seamless", "ctrl-verify")
    print("SEAMLESS_UNEXPECTED_SUCCESS")
except RuntimeError as exc:
    print("SEAMLESS_EXPECTED_FAILURE:", str(exc)[:120])
