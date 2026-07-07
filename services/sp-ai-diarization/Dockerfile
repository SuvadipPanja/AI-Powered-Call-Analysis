# sp-ai-diarization — hybrid stereo VAD + Pyannote community-1 (port 8040)
FROM sp-ai-base:prod

WORKDIR /app

# Pyannote 3.1 — uses existing torch in sp-ai-base (no torch 2.12 upgrade).
# Model: pyannote/speaker-diarization-3.1 at /models/pyannote/speaker-diarization-3.1
RUN pip install --no-cache-dir "pyannote.audio>=3.1.1,<4.0.0"

COPY services/sp-ai-diarization/server.py /app/diar_service_server.py

ENV AI_SERVICE_PORT=8040
ENV DIAR_BACKEND=hybrid
ENV DIAR_PYANNOTE_ENABLED=true
ENV PYANNOTE_MODEL_PATH=/models/pyannote/speaker-diarization-3.1
ENV HF_HUB_OFFLINE=1

EXPOSE 8040

CMD gunicorn --bind 0.0.0.0:8040 --workers 1 --threads ${AI_SERVICE_THREADS:-2} --timeout 600 --graceful-timeout 60 diar_service_server:app
