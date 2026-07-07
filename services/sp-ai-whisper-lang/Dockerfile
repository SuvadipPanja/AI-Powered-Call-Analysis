# sp-ai-whisper-lang — language-detection service (SPEC §2/§3, port 8010)
# Base image ships the full ai-mvp code base at /app plus gunicorn.
FROM sp-ai-base:prod

WORKDIR /app

# Distinct module name so nothing in /app (ai-mvp code) is clobbered.
COPY server.py /app/lang_service_server.py

ENV AI_SERVICE_PORT=8010

EXPOSE 8010

# Shell form so ${AI_SERVICE_THREADS} expands at container start.
CMD gunicorn --bind 0.0.0.0:8010 --workers 1 --threads ${AI_SERVICE_THREADS:-4} --timeout 300 --graceful-timeout 30 lang_service_server:app
