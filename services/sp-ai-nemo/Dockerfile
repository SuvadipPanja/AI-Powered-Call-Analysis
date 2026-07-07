# sp-ai-nemo:prod — always-loaded NeMo ASR service (English parakeet + Hindi conformer).
# Base image sp-ai-base:prod carries the full ai-mvp/ code at /app plus gunicorn.
# Build (from repo root, after base exists):
#   docker build -t sp-ai-nemo:prod -f services/sp-ai-nemo/Dockerfile services/sp-ai-nemo
FROM sp-ai-base:prod

COPY server.py /app/nemo_service_server.py

WORKDIR /app

ENV AI_SERVICE_PORT=8020

EXPOSE 8020

# Shell form so ${AI_SERVICE_THREADS} expands at container start.
CMD gunicorn --bind 0.0.0.0:8020 --workers 1 --threads ${AI_SERVICE_THREADS:-4} --timeout 600 nemo_service_server:app
