# sp-ai-base:prod — shared base for all sp-ai-* services (AI-STACK-SPEC.md §2).
# = ai-call-orchestrator:prod (CUDA/Ubuntu, all ML deps + models code) refreshed
# with the CURRENT ai-mvp/ source at /app, debug tools, and gunicorn.
#
# Build from repo root (context = repo root; requires ai-call-orchestrator:prod loaded):
#   docker build -t sp-ai-base:prod -f services/sp-ai-base/Dockerfile .
#
# NOTE: files are copied via an explicit list (NOT `COPY ai-mvp/ /app/`) because
# ai-mvp/ contains .venv-wsl with symlinks that break docker builds on Windows.

FROM ai-call-orchestrator:prod

WORKDIR /app

COPY ai-mvp/asr_client.py \
     ai-mvp/audio_io.py \
     ai-mvp/audio_utils.py \
     ai-mvp/bank_config.py \
     ai-mvp/banking_script_targets.py \
     ai-mvp/config.py \
     ai-mvp/db.py \
     ai-mvp/db_schema.py \
     ai-mvp/diarization_worker.py \
     ai-mvp/diarization_core.py \
     ai-mvp/pyannote_diarizer.py \
     ai-mvp/diar_client.py \
     ai-mvp/enrichment_worker.py \
     ai-mvp/entitlement.py \
     ai-mvp/faster_whisper_worker.py \
     ai-mvp/indiclid_worker.py \
     ai-mvp/hold_worker.py \
     ai-mvp/intelligence_worker.py \
     ai-mvp/lang_client.py \
     ai-mvp/lang_word_dictionaries.py \
     ai-mvp/language_worker.py \
     ai-mvp/llm_utils.py \
     ai-mvp/log_setup.py \
     ai-mvp/model_memory.py \
     ai-mvp/nemo_worker.py \
     ai-mvp/orchestrator.py \
     ai-mvp/prod_logging.py \
     ai-mvp/progress.py \
     ai-mvp/query_categories.py \
     ai-mvp/scoring_worker.py \
     ai-mvp/script_worker.py \
     ai-mvp/seamless_lid_client.py \
     ai-mvp/seamless_worker.py \
     ai-mvp/secrets_hydrate.py \
     ai-mvp/sentiment_worker.py \
     ai-mvp/sp_nemo_client.py \
     ai-mvp/taboo_worker.py \
     ai-mvp/test_improvements.py \
     ai-mvp/test_hold_detection.py \
     ai-mvp/test_transcript_format.py \
     ai-mvp/test_lead_reconciliation.py \
     ai-mvp/tone_worker.py \
     ai-mvp/transcribe.py \
     ai-mvp/transcript_cleanup_worker.py \
     ai-mvp/transcript_consistency_graph.py \
     ai-mvp/transcript_context_worker.py \
     ai-mvp/transcript_refinement_agent.py \
     ai-mvp/transcript_entity_worker.py \
     ai-mvp/transcript_format_worker.py \
     ai-mvp/transcript_normalize.py \
     ai-mvp/transcript_utils.py \
     ai-mvp/translation_worker.py \
     ai-mvp/whisper_asr_worker.py \
     ai-mvp/wordmatch_lid.py \
     ai-mvp/work_token.py \
     ./

COPY ai-mvp/prompts/ ./prompts/

COPY ai-mvp/indiclid/ ./indiclid/

# Prod LLM overlay (vLLM/OpenAI backend patch + entrypoint), same as the monolith.
COPY production-build/ai-overlay/llm_openai_backend.py \
     production-build/ai-overlay/bootstrap_prod_llm.py \
     production-build/ai-overlay/run_orchestrator_prod.py \
     ./

# gunicorn for the model services + debug/ops tools, in one layer.
RUN pip install --no-cache-dir gunicorn \
    && apt-get update \
    && apt-get install -y --no-install-recommends vim less curl htop procps net-tools \
    && rm -rf /var/lib/apt/lists/*

# funasr powers the emotion2vec+ tone backend (TONE_BACKEND=emotion2vec).
# Core ML libs already in the base image are frozen into a constraints file so
# funasr's loose requirements can NOT upgrade/downgrade them (torch etc.).
RUN pip freeze 2>/dev/null | grep -iE '^(torch|torchaudio|torchvision|numpy|scipy|librosa|soundfile|transformers|huggingface-hub)==' > /tmp/pins.txt \
    && cat /tmp/pins.txt \
    && pip install --no-cache-dir "funasr==1.2.7" -c /tmp/pins.txt \
    && python -c "from funasr import AutoModel; print('funasr OK')" \
    && rm /tmp/pins.txt

# Gate hold detection regressions before image is tagged prod-ready.
RUN python test_hold_detection.py && python test_transcript_format.py
