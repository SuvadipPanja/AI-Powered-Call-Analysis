# sp-ai-seamless-m4t:prod — always-loaded SeamlessM4T v2 ASR service (regional languages).
# Base image sp-ai-base:prod carries the full ai-mvp/ code at /app plus gunicorn.
# Build (from repo root, after base exists):
#   docker build -t sp-ai-seamless-m4t:prod -f services/sp-ai-seamless-m4t/Dockerfile services/sp-ai-seamless-m4t
FROM sp-ai-base:prod

COPY server.py /app/seamless_service_server.py

WORKDIR /app

ENV AI_SERVICE_PORT=8030

EXPOSE 8030

# Shell form so ${AI_SERVICE_THREADS} expands at container start.
CMD gunicorn --bind 0.0.0.0:8030 --workers 1 --threads ${AI_SERVICE_THREADS:-4} --timeout 600 seamless_service_server:app
