import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

PROJECT_ROOT = Path(
    os.getenv(
        "PROJECT_ROOT",
        "C:/Project/AI-Powered Call Analysis project",
    )
)
AUDIO_UPLOAD_DIR = Path(
    os.getenv(
        "AUDIO_UPLOAD_DIR",
        str(PROJECT_ROOT / "data/Sample_Audio"),
    )
)
LOG_DIR = Path(
    os.getenv(
        "LOG_DIR",
        str(PROJECT_ROOT / "logs/ai-mvp"),
    )
)
WORK_DIR = Path(os.getenv("AI_WORK_DIR", str(PROJECT_ROOT / "data/ai-mvp-work")))
DIARIZATION_OUTPUT_DIR = Path(
    os.getenv(
        "DIARIZATION_OUTPUT_DIR",
        str(PROJECT_ROOT / "data/diarization_output/Chunk"),
    )
)
PORT = int(os.getenv("PORT", "8000"))

# Silero VAD diarization (same defaults as old pipeline)
SILERO_THRESHOLD = float(os.getenv("SILERO_THRESHOLD", "0.3"))
MIN_SPEECH_DURATION_MS = int(os.getenv("MIN_SPEECH_DURATION_MS", "150"))
CUSTOMER_GAIN_DB = float(os.getenv("CUSTOMER_GAIN_DB", "5"))
AGENT_CHANNEL_INDEX = int(os.getenv("AGENT_CHANNEL_INDEX", "0"))
CUSTOMER_CHANNEL_INDEX = int(os.getenv("CUSTOMER_CHANNEL_INDEX", "1"))
CUSTOMER_ENHANCE_ENABLED = os.getenv("CUSTOMER_ENHANCE_ENABLED", "true").lower() == "true"
# Only drop very short, very quiet customer hits (not normal "ok"/"haan" replies).
MIN_CUSTOMER_SPEECH_DURATION_SEC = float(os.getenv("MIN_CUSTOMER_SPEECH_DURATION_SEC", "0.25"))
CUSTOMER_CROSSTALK_SUPPRESS = os.getenv("CUSTOMER_CROSSTALK_SUPPRESS", "true").lower() == "true"
# Crosstalk filter applies only to micro-segments (agent bleed), not real customer speech.
CROSSTALK_MAX_DURATION_SEC = float(os.getenv("CROSSTALK_MAX_DURATION_SEC", "0.45"))
CROSSTALK_AGENT_RMS_RATIO = float(os.getenv("CROSSTALK_AGENT_RMS_RATIO", "2.0"))
CUSTOMER_MIN_RMS = float(os.getenv("CUSTOMER_MIN_RMS", "0.002"))

# Language detection — same as old pipeline (Whisper Large V3, detect only)
WHISPER_LANG_MODEL_PATH = Path(
    os.getenv(
        "WHISPER_LANG_MODEL_PATH",
        str(PROJECT_ROOT / "models/Whisper-large-v3"),
    )
)
# cpu | cuda | auto — use cpu on prod when transformers+cuDNN crashes on shared GPU
WHISPER_LANG_DEVICE = os.getenv("WHISPER_LANG_DEVICE", "auto").lower()

# NeMo ASR — IndicConformer Large (offline prod under volumes/models/nemo/)
HINDI_NEMO_MODEL_PATH = os.getenv(
    "HINDI_NEMO_MODEL_PATH",
    str(PROJECT_ROOT / "models/nemo/indicconformer_stt_hi_hybrid_rnnt_large.nemo"),
)
HINDI_NEMO_FALLBACK_PATH = os.getenv(
    "HINDI_NEMO_FALLBACK_PATH",
    str(PROJECT_ROOT / "models/nemo/stt_hi_conformer_ctc_medium.nemo"),
)
ENGLISH_NEMO_MODEL_PATH = os.getenv(
    "ENGLISH_NEMO_MODEL_PATH",
    str(PROJECT_ROOT / "models/nemo/parakeet-rnnt-1.1b.nemo"),
)
HINDI_NEMO_MODEL_NAME = os.getenv(
    "HINDI_NEMO_MODEL_NAME",
    "ai4bharat/indicconformer_stt_hi_hybrid_rnnt_large",
)
ENGLISH_NEMO_MODEL_NAME = os.getenv("ENGLISH_NEMO_MODEL_NAME", "nvidia/parakeet-rnnt-1.1b")
BENGALI_NEMO_MODEL_PATH = os.getenv(
    "BENGALI_NEMO_MODEL_PATH",
    str(PROJECT_ROOT / "models/nemo/indicconformer_stt_bn_hybrid_rnnt_large.nemo"),
)
BENGALI_NEMO_MODEL_NAME = os.getenv(
    "BENGALI_NEMO_MODEL_NAME",
    "ai4bharat/indicconformer_stt_bn_hybrid_rnnt_large",
)
MULTILINGUAL_NEMO_MODEL_PATH = os.getenv(
    "MULTILINGUAL_NEMO_MODEL_PATH",
    str(PROJECT_ROOT / "models/nemo/indicconformer_stt_multi_hybrid_rnnt_600m.nemo"),
)
MULTILINGUAL_NEMO_MODEL_NAME = os.getenv(
    "MULTILINGUAL_NEMO_MODEL_NAME",
    "ai4bharat/indicconformer_stt_multi_hybrid_rnnt_600m",
)
NEMO_DECODER = os.getenv("NEMO_DECODER", "rnnt").lower()  # rnnt | ctc | best (dual for Indic)

# Dual RNNT+CTC pick-best for Indic languages (Bengali quality improves vs RNNT-only)
NEMO_DUAL_DECODER = os.getenv("NEMO_DUAL_DECODER", "true").lower() == "true"
NEMO_DUAL_DECODER_LANGUAGES = {
    x.strip()
    for x in os.getenv("NEMO_DUAL_DECODER_LANGUAGES", "Bengali,Hindi,Assamese").split(",")
    if x.strip()
}
BENGALI_MULTILINGUAL_FALLBACK = os.getenv("BENGALI_MULTILINGUAL_FALLBACK", "true").lower() == "true"
BENGALI_ASR_EXTRA_PADDING_SEC = float(os.getenv("BENGALI_ASR_EXTRA_PADDING_SEC", "0.45"))
ASR_INDIC_MIN_CHUNK_SEC = float(os.getenv("ASR_INDIC_MIN_CHUNK_SEC", "1.2"))

# Trim leading/trailing dead air from each ASR chunk. Whisper/SeamlessM4T tend to
# "continue" a short real phrase into a fluent HALLUCINATION when fed trailing
# silence (e.g. the fabricated closing line at call end). Trimming the silence —
# keeping a small margin so word edges survive — stops that. Pure-silence chunks
# are skipped entirely.
ASR_CHUNK_TRIM_SILENCE = os.getenv("ASR_CHUNK_TRIM_SILENCE", "true").lower() == "true"
ASR_CHUNK_TRIM_MARGIN_SEC = float(os.getenv("ASR_CHUNK_TRIM_MARGIN_SEC", "0.15"))
# A frame counts as speech when its RMS >= peak_rms * REL_THRESHOLD (and >= ABS_FLOOR).
ASR_CHUNK_SILENCE_REL_THRESHOLD = float(os.getenv("ASR_CHUNK_SILENCE_REL_THRESHOLD", "0.08"))
ASR_CHUNK_SILENCE_ABS_FLOOR = float(os.getenv("ASR_CHUNK_SILENCE_ABS_FLOOR", "0.001"))
# Drop a chunk whose total voiced span is below this (0 = never drop on this basis;
# keeps short "ji"/"haan" acks). Pure-silence chunks are always dropped.
ASR_CHUNK_MIN_VOICED_SEC = float(os.getenv("ASR_CHUNK_MIN_VOICED_SEC", "0"))

NEMO_DEVICE = os.getenv("NEMO_DEVICE", "cuda" if os.getenv("CUDA_VISIBLE_DEVICES", "") != "" else "auto")

# Languages that stay on NeMo ASR (Hindi IndicConformer + English Parakeet)
NEMO_ASR_LANGUAGES = {
    x.strip()
    for x in os.getenv("NEMO_ASR_LANGUAGES", "Hindi,English").split(",")
    if x.strip()
}

# Languages forced to faster-whisper large-v3 (overrides NeMo/SeamlessM4T routing).
# Best for heavily code-mixed speech (e.g. Hindi bank calls with English banking
# terms) where pure-Indic CTC models mangle the English words.
FASTER_WHISPER_ASR_LANGUAGES = {
    x.strip()
    for x in os.getenv("FASTER_WHISPER_ASR_LANGUAGES", "").split(",")
    if x.strip()
}

# sp-nemo: external IndicConformer ASR microservice (Sherpa-ONNX, no NeMo).
# Used for Hindi/Bengali instead of the in-container NeMo IndicConformer that
# fails with KeyError: 'dir'. English keeps using in-container NeMo parakeet.
SP_NEMO_ENABLED = os.getenv("SP_NEMO_ENABLED", "false").lower() == "true"
SP_NEMO_URL = os.getenv("SP_NEMO_URL", "http://sp-nemo:8020").rstrip("/")
SP_NEMO_TIMEOUT_SEC = float(os.getenv("SP_NEMO_TIMEOUT_SEC", "60"))
SP_NEMO_LANGUAGES = {
    x.strip()
    for x in os.getenv("SP_NEMO_LANGUAGES", "Hindi,Bengali").split(",")
    if x.strip()
}

# SeamlessM4T v2 — ASR for all other detected languages (Bengali, Tamil, Telugu, …)
SEAMLESS_M4T_ENABLED = os.getenv("SEAMLESS_M4T_ENABLED", "true").lower() == "true"
SEAMLESS_M4T_MODEL_PATH = Path(
    os.getenv(
        "SEAMLESS_M4T_MODEL_PATH",
        str(PROJECT_ROOT / "models/seamless-m4t-v2-large"),
    )
)
SEAMLESS_M4T_DEVICE = os.getenv("SEAMLESS_M4T_DEVICE", "auto").lower()

# faster-whisper — Whisper Large v3 via CTranslate2 (recommended for Jarvis / laptop)
FASTER_WHISPER_MODEL_SIZE = os.getenv("FASTER_WHISPER_MODEL_SIZE", "large-v3")
FASTER_WHISPER_MODEL_PATH = os.getenv("FASTER_WHISPER_MODEL_PATH", "")
FASTER_WHISPER_DOWNLOAD_ROOT = Path(
    os.getenv(
        "FASTER_WHISPER_DOWNLOAD_ROOT",
        str(PROJECT_ROOT / "models"),
    )
)
FASTER_WHISPER_DEVICE = os.getenv("FASTER_WHISPER_DEVICE", "auto")
FASTER_WHISPER_COMPUTE_TYPE = os.getenv("FASTER_WHISPER_COMPUTE_TYPE", "auto")
FASTER_WHISPER_BEAM_SIZE = int(os.getenv("FASTER_WHISPER_BEAM_SIZE", "5"))
FASTER_WHISPER_USE_LANG_HINT = os.getenv("FASTER_WHISPER_USE_LANG_HINT", "true").lower() == "true"
FASTER_WHISPER_VAD_FILTER = os.getenv("FASTER_WHISPER_VAD_FILTER", "false").lower() == "true"
WHISPER_NO_SPEECH_THRESHOLD = float(os.getenv("WHISPER_NO_SPEECH_THRESHOLD", "0.28"))

# Language detection — script verification + Hindi call-center priority
LANG_DETECT_CONFIDENCE_MIN = float(os.getenv("LANG_DETECT_CONFIDENCE_MIN", "0.55"))
LANG_DETECT_HIGH_CONFIDENCE = float(os.getenv("LANG_DETECT_HIGH_CONFIDENCE", "0.82"))
LANG_DETECT_SAMPLE_SEC = float(os.getenv("LANG_DETECT_SAMPLE_SEC", "20"))
LANG_VERIFY_SAMPLE_SEC = float(os.getenv("LANG_VERIFY_SAMPLE_SEC", "20"))
LANG_LID_MAX_TRANSCRIPT_TOKENS = int(os.getenv("LANG_LID_MAX_TRANSCRIPT_TOKENS", "96"))
# Mixed call-center calls: agent often greets in Hindi while customer speaks the
# regional language. Detect on the customer channel (right) so LID reflects the customer.
LANG_DETECT_CHANNEL = os.getenv("LANG_DETECT_CHANNEL", "customer").strip().lower()
LANG_DETECT_AGENT_CHANNEL_INDEX = int(os.getenv("LANG_DETECT_AGENT_CHANNEL_INDEX", "0"))
LANG_DETECT_CUSTOMER_CHANNEL_INDEX = int(os.getenv("LANG_DETECT_CUSTOMER_CHANNEL_INDEX", "1"))
LANG_DETECT_VOICE_TRIM = os.getenv("LANG_DETECT_VOICE_TRIM", "true").lower() == "true"
# hi/bn disambiguation: trust Whisper's detected language token; only FLIP to the
# other language when its forced-transcription acoustic fit (avg token log-prob,
# adjusted for repetition/garbage) beats the detected one by this clear margin.
LANG_HI_BN_FLIP_MARGIN = float(os.getenv("LANG_HI_BN_FLIP_MARGIN", "0.06"))
LANG_HI_BN_MIN_SCRIPT = int(os.getenv("LANG_HI_BN_MIN_SCRIPT", "6"))
# Repetition guard: forcing the wrong language often yields repeated tokens
# ("अपना अपना अपना"). Penalize candidates whose unique-word ratio is low.
LANG_REPETITION_MIN_UNIQUE = float(os.getenv("LANG_REPETITION_MIN_UNIQUE", "0.5"))
LANG_REPETITION_PENALTY = float(os.getenv("LANG_REPETITION_PENALTY", "0.6"))
LANG_SCRIPT_VERIFY = os.getenv("LANG_SCRIPT_VERIFY", "true").lower() == "true"
LANG_VERIFY_ALWAYS = os.getenv("LANG_VERIFY_ALWAYS", "false").lower() == "true"
LANG_VERIFY_ALWAYS_FOR_ENGLISH = os.getenv("LANG_VERIFY_ALWAYS_FOR_ENGLISH", "true").lower() == "true"
LANG_VERIFY_ALWAYS_FOR_DRAVIDIAN = os.getenv("LANG_VERIFY_ALWAYS_FOR_DRAVIDIAN", "true").lower() == "true"
LANG_HINDI_PRIORITY_BONUS = float(os.getenv("LANG_HINDI_PRIORITY_BONUS", "8"))
LANG_BENGALI_PRIORITY_BONUS = float(os.getenv("LANG_BENGALI_PRIORITY_BONUS", "8"))
LANG_ENGLISH_PLAUSIBILITY_MIN = float(os.getenv("LANG_ENGLISH_PLAUSIBILITY_MIN", "0.35"))
LANG_DISAMBIGUATE_HI_BN = os.getenv("LANG_DISAMBIGUATE_HI_BN", "true").lower() == "true"
# Language detection — Whisper Large V3 only (transformers native LID token)
SEAMLESS_LID_ENABLED = os.getenv("SEAMLESS_LID_ENABLED", "false").lower() == "true"
SEAMLESS_LID_SAMPLE_SEC = float(os.getenv("SEAMLESS_LID_SAMPLE_SEC", "22"))
INDICLID_ENABLED = os.getenv("INDICLID_ENABLED", "true").lower() == "true"
INDICLID_MODEL_DIR = Path(
    os.getenv(
        "INDICLID_MODEL_DIR",
        str(PROJECT_ROOT / "models/indiclid"),
    )
)
INDICLID_BERT_TOKENIZER_PATH = Path(
    os.getenv(
        "INDICLID_BERT_TOKENIZER_PATH",
        str(INDICLID_MODEL_DIR / "IndicBERTv2-MLM-only"),
    )
)
INDICLID_ROMAN_THRESHOLD = float(os.getenv("INDICLID_ROMAN_THRESHOLD", "0.6"))
INDICLID_MIN_SCORE = float(os.getenv("INDICLID_MIN_SCORE", "0.45"))
LANG_MIN_SCRIPT_CHARS = int(os.getenv("LANG_MIN_SCRIPT_CHARS", "12"))
LANG_CALL_CENTER_MODE = os.getenv("LANG_CALL_CENTER_MODE", "true").lower() == "true"
LANG_PRIMARY_LANGUAGES = {
    x.strip()
    for x in os.getenv("LANG_PRIMARY_LANGUAGES", "Hindi,Bengali,English").split(",")
    if x.strip()
}

# Robust regional LID: allow these languages to be detected (not just hi/bn/en),
# verified via Whisper forced-transcribe + native-script scoring. Keeps the same
# Whisper-v3 method; just widens the candidate set and softens the call-center
# guard so a confidently-detected regional language with real native script wins.
LANG_REGIONAL_DETECTION = os.getenv("LANG_REGIONAL_DETECTION", "true").lower() == "true"
LANG_REGIONAL_LANGUAGES = {
    x.strip()
    for x in os.getenv(
        "LANG_REGIONAL_LANGUAGES",
        "Hindi,Bengali,English,Tamil,Telugu,Kannada,Malayalam,"
        "Gujarati,Punjabi,Odia,Marathi,Assamese",
    ).split(",")
    if x.strip()
}
# Native-script chars required to trust a unique-script regional detection directly
# (Tamil/Telugu/Kannada/Malayalam/Gujarati/Punjabi/Odia each have an exclusive script).
LANG_SCRIPT_FIRST_MIN_CHARS = int(os.getenv("LANG_SCRIPT_FIRST_MIN_CHARS", "8"))
# How many top Whisper-probable language codes to add as verification candidates.
LANG_VERIFY_TOPK = int(os.getenv("LANG_VERIFY_TOPK", "4"))

# Whisper LID frequently mislabels Hindi as Urdu/Nepali (Hindustani is the same
# spoken language; the difference is script). In a Hindi/Bengali/English call
# center, these detections are almost always Hindi, so re-run the proven hi/bn
# acoustic probe (seeded as Hindi) instead of trusting the raw token.
LANG_HINDI_CONFUSABLE_CODES = {
    x.strip().lower()
    for x in os.getenv("LANG_HINDI_CONFUSABLE_CODES", "ur,ne").split(",")
    if x.strip()
}

# LLM post-correction of the native ASR transcript (fix misheard/broken words
# in-script, before translation). Conservative; falls back to raw ASR on failure.
TRANSCRIPT_CLEANUP_ENABLED = os.getenv("TRANSCRIPT_CLEANUP_ENABLED", "false").lower() == "true"
TRANSCRIPT_CLEANUP_LANGUAGES = {
    x.strip()
    for x in os.getenv("TRANSCRIPT_CLEANUP_LANGUAGES", "Hindi,Bengali").split(",")
    if x.strip()
}
TRANSCRIPT_CLEANUP_MIN_SIMILARITY = float(os.getenv("TRANSCRIPT_CLEANUP_MIN_SIMILARITY", "0.55"))

# Empty-segment handling
TRANSCRIPTION_RETRY_EMPTY = os.getenv("TRANSCRIPTION_RETRY_EMPTY", "true").lower() == "true"
MIN_CHUNK_DURATION_SEC = float(os.getenv("MIN_CHUNK_DURATION_SEC", "0.8"))
CHUNK_PADDING_SEC = float(os.getenv("CHUNK_PADDING_SEC", "0.3"))
# Symmetric padding added to EVERY diarized segment (not just short ones) so word
# onsets/offsets at VAD boundaries are not clipped ("voice cut"). Set 0 to disable.
CHUNK_BOUNDARY_PAD_SEC = float(os.getenv("CHUNK_BOUNDARY_PAD_SEC", "0.2"))
HIDE_EMPTY_TRANSCRIPT_SEGMENTS = os.getenv("HIDE_EMPTY_TRANSCRIPT_SEGMENTS", "true").lower() == "true"

# faster-whisper | nemo | whisper-large-v3 | auto
TRANSCRIBE_BACKEND = os.getenv("TRANSCRIBE_BACKEND", "auto").lower()

# Phase 2b — Ollama call scoring
SCORING_ENABLED = os.getenv("SCORING_ENABLED", "true").lower() == "true"
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen3:4b")
OLLAMA_VERIFICATION_MODEL = os.getenv("OLLAMA_VERIFICATION_MODEL", "")
OLLAMA_TIMEOUT_SEC = int(os.getenv("OLLAMA_TIMEOUT_SEC", "300"))
SCORING_MAX_TRANSCRIPT_CHARS = int(os.getenv("SCORING_MAX_TRANSCRIPT_CHARS", "12000"))
TRANSLATION_ENABLED = os.getenv("TRANSLATION_ENABLED", "true").lower() == "true"
SCORING_VERIFICATION_ENABLED = os.getenv("SCORING_VERIFICATION_ENABLED", "true").lower() == "true"

# Phase 2d — per-call intelligence (escalation, query category, loan/lead).
# Uses the same LLM backend as scoring (Ollama in dev, vLLM/OpenAI in prod).
INTELLIGENCE_ENABLED = os.getenv("INTELLIGENCE_ENABLED", "true").lower() == "true"
SCORING_CONFIDENCE_THRESHOLD = float(os.getenv("SCORING_CONFIDENCE_THRESHOLD", "0.6"))
SENTIMENT_ENSEMBLE_ENABLED = os.getenv("SENTIMENT_ENSEMBLE_ENABLED", "true").lower() == "true"

# Phase 2c — audio tone, transformer sentiment, script similarity
ENRICHMENT_ENABLED = os.getenv("ENRICHMENT_ENABLED", "true").lower() == "true"
TONE_ENABLED = os.getenv("TONE_ENABLED", "true").lower() == "true"
SENTIMENT_ENABLED = os.getenv("SENTIMENT_ENABLED", "true").lower() == "true"
SCRIPT_COMPLIANCE_ENABLED = os.getenv("SCRIPT_COMPLIANCE_ENABLED", "true").lower() == "true"
SENTIMENT_MODEL = os.getenv(
    "SENTIMENT_MODEL",
    "distilbert-base-uncased-finetuned-sst-2-english",
)
SENTIMENT_MODEL_EN = os.getenv(
    "SENTIMENT_MODEL_EN",
    SENTIMENT_MODEL,
)
SENTIMENT_MODEL_MULTILINGUAL = os.getenv(
    "SENTIMENT_MODEL_MULTILINGUAL",
    "nlptown/bert-base-multilingual-uncased-sentiment",
)
SCRIPT_MODEL_NAME = os.getenv(
    "SCRIPT_MODEL_NAME",
    "sentence-transformers/all-MiniLM-L6-v2",
)
_script_local = os.getenv("SCRIPT_MODEL_LOCAL", "").strip()
SCRIPT_MODEL_LOCAL = Path(_script_local) if _script_local else None

# Phase 1 — shared secrets with backend (orchestrator auth + transcription callback)
ORCHESTRATOR_SECRET = os.getenv("ORCHESTRATOR_SECRET", "").strip()
CALLBACK_SECRET = os.getenv("CALLBACK_SECRET", "").strip()
BACKEND_CALLBACK_URL = os.getenv("BACKEND_CALLBACK_URL", "").strip()

LOG_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)
DIARIZATION_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
