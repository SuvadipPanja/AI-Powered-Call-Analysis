# sp-ai-controller:prod — pipeline controller (orchestrator.py on Flask :8000).
# Keeps diarization/chunking, WPM/duration, LLM tasks, DB writes, enrichment and
# taboo in-process; language detection + ASR go to remote services when
# AI_DISTRIBUTED=true (see production/docs/AI-STACK-SPEC.md).
#
# Build from repo root (requires sp-ai-base:prod built first):
#   docker build -t sp-ai-controller:prod -f services/sp-ai-controller/Dockerfile .

FROM sp-ai-base:prod

EXPOSE 8000

# Same entry as the monolith: patches the LLM backend for vLLM/OpenAI, then runs
# the orchestrator module in-process (Flask threaded serves the controller fine).
CMD ["python3", "run_orchestrator_prod.py"]
