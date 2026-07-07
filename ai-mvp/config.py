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
SILERO_VAD_DEVICE = os.getenv("SILERO_VAD_DEVICE", "cuda").lower()
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
# Anti-oversplit: drop a short opposite-speaker segment that is SANDWICHED between two
# turns of the same other speaker when it is really channel bleed (the other channel is
# louder). This stops one continuous speaker being chopped into several transcript turns.
DIAR_SUPPRESS_SANDWICHED_CROSSTALK = os.getenv("DIAR_SUPPRESS_SANDWICHED_CROSSTALK", "true").lower() == "true"
DIAR_SANDWICH_MAX_DURATION_SEC = float(os.getenv("DIAR_SANDWICH_MAX_DURATION_SEC", "0.6"))
DIAR_SANDWICH_RMS_RATIO = float(os.getenv("DIAR_SANDWICH_RMS_RATIO", "1.4"))
# Merge two same-speaker turns separated only by a short pause (after crosstalk removal).
DIAR_SAME_SPEAKER_MERGE_GAP_SEC = float(os.getenv("DIAR_SAME_SPEAKER_MERGE_GAP_SEC", "0.8"))
# When both channels' VAD fire on the same time range, assign each frame to whichever
# channel has higher RMS — stops agent/customer labels flipping on crosstalk bleed.
DIAR_RMS_DOMINANCE_ENABLED = os.getenv("DIAR_RMS_DOMINANCE_ENABLED", "false").lower() == "true"
DIAR_RMS_FRAME_MS = int(os.getenv("DIAR_RMS_FRAME_MS", "50"))
DIAR_RMS_DOMINANCE_RATIO = float(os.getenv("DIAR_RMS_DOMINANCE_RATIO", "1.15"))
# Diarization backend: stereo (exclusive VAD), pyannote, hybrid (pick best score).
DIAR_BACKEND = os.getenv("DIAR_BACKEND", "hybrid").strip().lower()
DIAR_PYANNOTE_ENABLED = os.getenv("DIAR_PYANNOTE_ENABLED", "true").lower() == "true"
DIAR_PYANNOTE_NUM_SPEAKERS = int(os.getenv("DIAR_PYANNOTE_NUM_SPEAKERS", "2"))
DIAR_PYANNOTE_EXCLUSIVE = os.getenv("DIAR_PYANNOTE_EXCLUSIVE", "true").lower() == "true"
DIAR_MIN_SPEAKER_MERGE_SEC = float(os.getenv("DIAR_MIN_SPEAKER_MERGE_SEC", "0.35"))
DIAR_STEREO_FIRST_SPEAKER_AGENT = os.getenv("DIAR_STEREO_FIRST_SPEAKER_AGENT", "true").lower() == "true"
PYANNOTE_MODEL_PATH = os.getenv(
    "PYANNOTE_MODEL_PATH",
    str(PROJECT_ROOT / "models/pyannote/speaker-diarization-3.1"),
)
PYANNOTE_DEVICE = os.getenv("PYANNOTE_DEVICE", "auto").lower()
AI_DIAR_SERVICE_URL = os.getenv("AI_DIAR_SERVICE_URL", "http://ai-diarization:8040").rstrip("/")
AI_DIAR_SERVICE_TIMEOUT_SEC = float(os.getenv("AI_DIAR_SERVICE_TIMEOUT_SEC", "300"))
DIARIZATION_REMOTE_ENABLED = os.getenv("DIARIZATION_REMOTE_ENABLED", "false").lower() == "true"

# Language detection — same as old pipeline (Whisper Large V3, detect only)
WHISPER_LANG_MODEL_PATH = Path(
    os.getenv(
        "WHISPER_LANG_MODEL_PATH",
        str(PROJECT_ROOT / "models/Whisper-large-v3"),
    )
)
# cpu | cuda | auto — use cpu on prod when transformers+cuDNN crashes on shared GPU
WHISPER_LANG_DEVICE = os.getenv("WHISPER_LANG_DEVICE", "auto").lower()

# NeMo ASR — Hindi Conformer-CTC medium + English Parakeet (offline prod under volumes/models/nemo/)
# Hindi default is the plain Conformer-CTC medium: it loads cleanly in NeMo,
# unlike the hybrid IndicConformer large that failed with KeyError: 'dir'.
HINDI_NEMO_MODEL_PATH = os.getenv(
    "HINDI_NEMO_MODEL_PATH",
    str(PROJECT_ROOT / "models/nemo/stt_hi_conformer_ctc_medium.nemo"),
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
# Used for Hindi instead of the in-container NeMo IndicConformer that fails with
# KeyError: 'dir'. English keeps using in-container NeMo parakeet.
# Bengali is intentionally NOT routed here: the sp-nemo IndicConformer emits
# space-separated Bengali grapheme clusters (e.g. "হ ্ য া ল ো"), so Bengali now
# goes to SeamlessM4T v2 via _resolve_asr_backend. Add Bengali back to
# SP_NEMO_LANGUAGES only if the sp-nemo grapheme spacing is fixed.
SP_NEMO_ENABLED = os.getenv("SP_NEMO_ENABLED", "false").lower() == "true"
SP_NEMO_URL = os.getenv("SP_NEMO_URL", "http://sp-nemo:8020").rstrip("/")
SP_NEMO_TIMEOUT_SEC = float(os.getenv("SP_NEMO_TIMEOUT_SEC", "60"))
SP_NEMO_LANGUAGES = {
    x.strip()
    for x in os.getenv("SP_NEMO_LANGUAGES", "Hindi").split(",")
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

# Language detection mode:
#   enhanced       — Whisper-native LID + guards/verification layers (default)
#   whisper-native — Whisper Large V3's built-in <|lang|> token probabilities
#                    ONLY, restricted to LANG_REGIONAL_LANGUAGES (no custom
#                    remaps/guards). Pair with the lang service's multi-window
#                    vote for robustness.
LANG_DETECT_MODE = os.getenv("LANG_DETECT_MODE", "enhanced").strip().lower()

# Regional confirm (Tamil/Telugu/...): forcing Whisper to a language always
# yields that language's script, so script presence alone cannot confirm it.
# Accept a regional detection only when its acoustic fit is not clearly worse
# than Hindi's (call-center prior) by more than this avg-logprob margin.
LANG_REGIONAL_ACOUSTIC_MARGIN = float(os.getenv("LANG_REGIONAL_ACOUSTIC_MARGIN", "0.18"))

# Language detection — script verification + Hindi call-center priority
LANG_DETECT_CONFIDENCE_MIN = float(os.getenv("LANG_DETECT_CONFIDENCE_MIN", "0.55"))
LANG_DETECT_HIGH_CONFIDENCE = float(os.getenv("LANG_DETECT_HIGH_CONFIDENCE", "0.82"))
LANG_DETECT_SAMPLE_SEC = float(os.getenv("LANG_DETECT_SAMPLE_SEC", "12"))
LANG_VERIFY_SAMPLE_SEC = float(os.getenv("LANG_VERIFY_SAMPLE_SEC", "12"))
LANG_LID_MAX_TRANSCRIPT_TOKENS = int(os.getenv("LANG_LID_MAX_TRANSCRIPT_TOKENS", "96"))
# Mixed call-center calls: agent often greets in Hindi while customer speaks the
# regional language. Detect on the customer channel (right) so LID reflects the customer.
LANG_DETECT_CHANNEL = os.getenv("LANG_DETECT_CHANNEL", "agent").strip().lower()
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
# English guard: BEFORE any hi/bn call-center remap, confirm English on calls where
# English is at least plausible (Whisper top == en, or en prob >= this floor). Fixes
# "agent speaks full English but detected as Hindi" (hi/bn branch used to swallow it).
LANG_ENGLISH_GUARD_ENABLED = os.getenv("LANG_ENGLISH_GUARD_ENABLED", "true").lower() == "true"
LANG_ENGLISH_GUARD_MIN_PROB = float(os.getenv("LANG_ENGLISH_GUARD_MIN_PROB", "0.12"))
# Min fraction of real English words in the forced-English transcript to accept English.
LANG_ENGLISH_GUARD_WORD_RATIO = float(os.getenv("LANG_ENGLISH_GUARD_WORD_RATIO", "0.40"))
# Bengali guard: run BEFORE the English guard so Bengali banking calls are not
# swallowed when forced-English romanization hits common banking English words.
LANG_BENGALI_GUARD_ENABLED = os.getenv("LANG_BENGALI_GUARD_ENABLED", "true").lower() == "true"
LANG_BENGALI_GUARD_MIN_PROB = float(os.getenv("LANG_BENGALI_GUARD_MIN_PROB", "0.12"))
LANG_BENGALI_GUARD_MIN_ROMAN = int(os.getenv("LANG_BENGALI_GUARD_MIN_ROMAN", "1"))
# Hindi guard: Whisper often mislabels Hindi banking calls as Telugu/Tamil/Kannada/Malayalam.
LANG_HINDI_GUARD_ENABLED = os.getenv("LANG_HINDI_GUARD_ENABLED", "true").lower() == "true"
LANG_HINDI_GUARD_MIN_PROB = float(os.getenv("LANG_HINDI_GUARD_MIN_PROB", "0.10"))
# Skip heavy guards when Whisper is already confident on Hindi (major latency win).
LANG_FAST_PATH_HI_CONFIDENCE = float(os.getenv("LANG_FAST_PATH_HI_CONFIDENCE", "0.72"))
LANG_FAST_PATH_BN_CONFIDENCE = float(os.getenv("LANG_FAST_PATH_BN_CONFIDENCE", "0.72"))
# Banking call centers that only need Hindi/Bengali/English: disable regional confirm paths.
LANG_PRIMARY_ONLY = os.getenv("LANG_PRIMARY_ONLY", "false").lower() == "true"
# Language detection — Whisper Large V3 only (transformers native LID token)
SEAMLESS_LID_ENABLED = os.getenv("SEAMLESS_LID_ENABLED", "true").lower() == "true"
SEAMLESS_LID_SAMPLE_SEC = float(os.getenv("SEAMLESS_LID_SAMPLE_SEC", "22"))
SEAMLESS_LID_PROBE_LANGUAGES = [
    x.strip()
    for x in os.getenv("SEAMLESS_LID_PROBE_LANGUAGES", "Hindi,Bengali,English").split(",")
    if x.strip()
]
# LID backend: wordmatch (default — transcribe first agent/customer chunks and
# match against per-language word dictionaries; legacy AI/src idea) | restricted
# (renormalized closed-set) | ensemble | whisper | indiclid | seamless
LANG_LID_BACKEND = os.getenv("LANG_LID_BACKEND", "wordmatch").strip().lower()
# restricted mode: accept the renormalized winner directly at/above this
# probability (skips acoustic probes); below it, forced-decode scoring decides.
LANG_RESTRICTED_CONFIDENT = float(os.getenv("LANG_RESTRICTED_CONFIDENT", "0.75"))
# wordmatch mode: chunk length + how many chunks per channel (agent & customer),
# minimum total word-evidence score to trust the result (else restricted fallback),
# and the hi/bn score gap under which the forced-decode word tiebreak runs.
LANG_WORDMATCH_CHUNK_SEC = float(os.getenv("LANG_WORDMATCH_CHUNK_SEC", "10"))
LANG_WORDMATCH_CHUNKS_PER_CHANNEL = int(os.getenv("LANG_WORDMATCH_CHUNKS_PER_CHANNEL", "2"))
LANG_WORDMATCH_MIN_EVIDENCE = float(os.getenv("LANG_WORDMATCH_MIN_EVIDENCE", "4"))
LANG_WORDMATCH_TIEBREAK_MARGIN = float(os.getenv("LANG_WORDMATCH_TIEBREAK_MARGIN", "6"))
# Fast mode: agent-first + skip Seamless/IndicLID unless ambiguous (~5-15s vs ~60s).
LANG_LID_FAST_MODE = os.getenv("LANG_LID_FAST_MODE", "true").lower() == "true"
# Stereo calls: agent often speaks Hindi while customer speaks English — probe all channels.
LANG_DETECT_MULTI_CHANNEL = os.getenv("LANG_DETECT_MULTI_CHANNEL", "true").lower() == "true"
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
# North-Indian banking calls: Whisper token/display "Urdu" is almost always Hindi (Hindustani).
LANG_MAP_URDU_TO_HINDI = os.getenv("LANG_MAP_URDU_TO_HINDI", "true").lower() == "true"
LANG_MAP_NEPALI_TO_HINDI = os.getenv("LANG_MAP_NEPALI_TO_HINDI", "true").lower() == "true"
# Bengali banking calls mislabeled Assamese (same script, close acoustics) → Bengali.
LANG_MAP_ASSAMESE_TO_BENGALI = os.getenv("LANG_MAP_ASSAMESE_TO_BENGALI", "true").lower() == "true"
# Whisper constantly mislabels Hindi as Dravidian languages on North-Indian banking audio.
LANG_DRAVIDIAN_CONFUSABLE_CODES = {
    x.strip().lower()
    for x in os.getenv("LANG_DRAVIDIAN_CONFUSABLE_CODES", "ta,te,kn,ml").split(",")
    if x.strip()
}

# LLM post-correction of the native ASR transcript (fix misheard/broken words
# in-script, before translation). Conservative; falls back to raw ASR on failure.
TRANSCRIPT_CLEANUP_ENABLED = os.getenv("TRANSCRIPT_CLEANUP_ENABLED", "true").lower() == "true"
TRANSCRIPT_CLEANUP_LANGUAGES = {
    x.strip()
    for x in os.getenv(
        "TRANSCRIPT_CLEANUP_LANGUAGES",
        "English,Hindi,Bengali,Tamil,Telugu,Kannada,Malayalam,Marathi,"
        "Gujarati,Punjabi,Odia,Assamese",
    ).split(",")
    if x.strip()
}
TRANSCRIPT_CLEANUP_MIN_SIMILARITY = float(os.getenv("TRANSCRIPT_CLEANUP_MIN_SIMILARITY", "0.55"))
# Lower bar when adjacent turns provide evidence (e.g. icon pattern → account balance).
TRANSCRIPT_CLEANUP_CONTEXT_MIN_SIMILARITY = float(
    os.getenv("TRANSCRIPT_CLEANUP_CONTEXT_MIN_SIMILARITY", "0.28")
)
# Lower bar when correction converts spoken numbers/amounts/dates to digits (entity norm).
TRANSCRIPT_CLEANUP_ENTITY_MIN_SIMILARITY = float(
    os.getenv("TRANSCRIPT_CLEANUP_ENTITY_MIN_SIMILARITY", "0.22")
)
# Send entire call in one LLM request when line count is at/below this (better context).
TRANSCRIPT_CLEANUP_FULL_CALL_MAX_LINES = int(
    os.getenv("TRANSCRIPT_CLEANUP_FULL_CALL_MAX_LINES", "45")
)
# Full-call contextual cleanup (names, honorifics, garbled ASR) — LLM brain pass.
TRANSCRIPT_CONTEXT_ENABLED = os.getenv(
    "TRANSCRIPT_CONTEXT_ENABLED",
    os.getenv("TRANSCRIPT_CLEANUP_ENABLED", "true"),
).lower() == "true"
TRANSCRIPT_CONTEXT_LANGUAGES = {
    x.strip()
    for x in os.getenv(
        "TRANSCRIPT_CONTEXT_LANGUAGES",
        os.getenv(
            "TRANSCRIPT_CLEANUP_LANGUAGES",
            "English,Hindi,Bengali,Tamil,Telugu,Kannada,Malayalam,Marathi,"
            "Gujarati,Punjabi,Odia,Assamese,Urdu",
        ),
    ).split(",")
    if x.strip()
}
TRANSCRIPT_CONTEXT_FULL_CALL_MAX_LINES = int(
    os.getenv("TRANSCRIPT_CONTEXT_FULL_CALL_MAX_LINES", "100")
)
TRANSCRIPT_CONTEXT_BATCH_SIZE = int(os.getenv("TRANSCRIPT_CONTEXT_BATCH_SIZE", "36"))
TRANSCRIPT_CONTEXT_BATCH_OVERLAP = int(os.getenv("TRANSCRIPT_CONTEXT_BATCH_OVERLAP", "8"))
TRANSCRIPT_CONTEXT_MIN_SIMILARITY = float(
    os.getenv("TRANSCRIPT_CONTEXT_MIN_SIMILARITY", "0.12")
)
TRANSCRIPT_CONTEXT_EVIDENCE_MIN_SIMILARITY = float(
    os.getenv("TRANSCRIPT_CONTEXT_EVIDENCE_MIN_SIMILARITY", "0.10")
)
# 3-step Transcript Refinement Agent — disabled by default (legacy context cleanup used).
TRANSCRIPT_REFINEMENT_ENABLED = os.getenv("TRANSCRIPT_REFINEMENT_ENABLED", "false").lower() == "true"
TRANSCRIPT_REFINEMENT_NATIVE = os.getenv("TRANSCRIPT_REFINEMENT_NATIVE", "true").lower() == "true"
TRANSCRIPT_REFINEMENT_ENGLISH = os.getenv("TRANSCRIPT_REFINEMENT_ENGLISH", "true").lower() == "true"
TRANSCRIPT_REFINEMENT_LANGUAGES = {
    x.strip()
    for x in os.getenv(
        "TRANSCRIPT_REFINEMENT_LANGUAGES",
        os.getenv(
            "TRANSCRIPT_CLEANUP_LANGUAGES",
            "English,Hindi,Bengali,Tamil,Telugu,Kannada,Malayalam,Marathi,"
            "Gujarati,Punjabi,Odia,Assamese,Urdu",
        ),
    ).split(",")
    if x.strip()
}
TRANSCRIPT_REFINEMENT_FULL_CALL_MAX_LINES = int(
    os.getenv("TRANSCRIPT_REFINEMENT_FULL_CALL_MAX_LINES", "100")
)
TRANSCRIPT_REFINEMENT_MIN_ISSUE_CONFIDENCE = float(
    os.getenv("TRANSCRIPT_REFINEMENT_MIN_ISSUE_CONFIDENCE", "0.40")
)
TRANSCRIPT_REFINEMENT_PRE_AUDIT_ENABLED = os.getenv(
    "TRANSCRIPT_REFINEMENT_PRE_AUDIT_ENABLED", "true"
).lower() == "true"
TRANSCRIPT_REFINEMENT_VERIFIER_FALLBACK = os.getenv(
    "TRANSCRIPT_REFINEMENT_VERIFIER_FALLBACK", "true"
).lower() == "true"
# Deterministic number/amount/abbrev formatting — enabled on prod for rupee lines.
TRANSCRIPT_FORMAT_NUMBERS_ENABLED = os.getenv("TRANSCRIPT_FORMAT_NUMBERS_ENABLED", "true").lower() == "true"
# Mandatory LLM entity pass: numbers/amounts/dates → digits (native + English translation).
TRANSCRIPT_ENTITY_ENABLED = os.getenv("TRANSCRIPT_ENTITY_ENABLED", "true").lower() == "true"
TRANSCRIPT_ENTITY_FULL_CALL_MAX_LINES = int(os.getenv("TRANSCRIPT_ENTITY_FULL_CALL_MAX_LINES", "50"))

# Deterministic pre-analysis transcript normalization: strip filler tokens (mm, hmm,
# uh, um ...) and collapse immediately-repeated words ("basically basically" -> once).
# Runs BEFORE cleanup/translation for every language.
TRANSCRIPT_NORMALIZE_ENABLED = os.getenv("TRANSCRIPT_NORMALIZE_ENABLED", "true").lower() == "true"
TRANSCRIPT_NORMALIZE_DROP_FILLER_TURNS = os.getenv("TRANSCRIPT_NORMALIZE_DROP_FILLER_TURNS", "true").lower() == "true"

# Auto-discovery of new query categories: when a call does not match any existing
# category, ask the LLM to propose a genuine, reusable new category (name +
# description + keywords). Validated + deduped, then inserted into
# dbo.AI_Query_Categories (flagged AutoAdded) so it appears in the admin page.
QUERY_CATEGORY_AUTODISCOVER_ENABLED = os.getenv("QUERY_CATEGORY_AUTODISCOVER_ENABLED", "true").lower() == "true"
QUERY_CATEGORY_AUTODISCOVER_MAX = int(os.getenv("QUERY_CATEGORY_AUTODISCOVER_MAX", "60"))
# Reject a proposed name this similar (or more) to an existing name — reuse instead.
QUERY_CATEGORY_DEDUPE_SIMILARITY = float(os.getenv("QUERY_CATEGORY_DEDUPE_SIMILARITY", "0.82"))

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

# Distributed AI stack (production/docs/AI-STACK-SPEC.md): language detection and
# ASR run as separate HTTP services; the controller keeps diarization/chunking,
# WPM/duration, LLM tasks, DB writes, enrichment and taboo in-process.
# Code default is FALSE (legacy in-process pipeline); prod compose sets true.
AI_DISTRIBUTED = os.getenv("AI_DISTRIBUTED", "false").lower() == "true"
# sp-ai-whisper-lang — remote Whisper-V3 language detection service
AI_LANG_SERVICE_URL = os.getenv("AI_LANG_SERVICE_URL", "http://ai-whisper-lang:8010").rstrip("/")
AI_LANG_SERVICE_TIMEOUT_SEC = float(os.getenv("AI_LANG_SERVICE_TIMEOUT_SEC", "180"))
# sp-ai-nemo (English/Hindi) and sp-ai-seamless-m4t (Bengali/regional) ASR services
AI_NEMO_SERVICE_URL = os.getenv("AI_NEMO_SERVICE_URL", "http://ai-nemo:8020").rstrip("/")
AI_SEAMLESS_SERVICE_URL = os.getenv("AI_SEAMLESS_SERVICE_URL", "http://ai-seamless:8030").rstrip("/")
AI_ASR_SERVICE_TIMEOUT_SEC = float(os.getenv("AI_ASR_SERVICE_TIMEOUT_SEC", "300"))
# Remote-mode per-chunk ASR fan-out width (ThreadPoolExecutor max_workers).
# 1 = sequential like legacy mode; >1 only applies when AI_DISTRIBUTED=true.
ASR_CHUNK_PARALLELISM = int(os.getenv("ASR_CHUNK_PARALLELISM", "2"))
# Retry with alternate ASR when diarized chunks exist but almost all lines are empty.
ASR_SPARSE_FALLBACK_ENABLED = os.getenv("ASR_SPARSE_FALLBACK_ENABLED", "true").lower() == "true"
ASR_SPARSE_MIN_LINE_RATIO = float(os.getenv("ASR_SPARSE_MIN_LINE_RATIO", "0.15"))
MIN_USABLE_TRANSCRIPT_WORDS = int(os.getenv("MIN_USABLE_TRANSCRIPT_WORDS", "10"))

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

# Hold-time detection from diarized transcript (phrase + silence gap).
HOLD_DETECTION_ENABLED = os.getenv("HOLD_DETECTION_ENABLED", "true").lower() == "true"
HOLD_MIN_GAP_AFTER_PHRASE_SEC = float(os.getenv("HOLD_MIN_GAP_AFTER_PHRASE_SEC", "8"))
HOLD_MIN_SILENCE_GAP_SEC = float(os.getenv("HOLD_MIN_SILENCE_GAP_SEC", "18"))
HOLD_MAX_EPISODE_SEC = float(os.getenv("HOLD_MAX_EPISODE_SEC", "600"))

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

# --- Sentiment backend (accuracy upgrade) ---
# "llm"          — per-utterance sentiment via the shared scoring LLM (vLLM in
#                  prod, Ollama in dev), banking-context aware. Automatically
#                  falls back to the transformers path on any failure.
# "transformers" — HF pipelines only (previous behavior).
SENTIMENT_BACKEND = os.getenv("SENTIMENT_BACKEND", "llm").strip().lower()
# Utterances per LLM request (bounds prompt size on long calls).
SENTIMENT_LLM_BATCH_SIZE = int(os.getenv("SENTIMENT_LLM_BATCH_SIZE", "40"))

# --- Tone backend ---
# "emotion2vec" — real speech-emotion model (angry/happy/neutral/sad/...) per
#                 diarized chunk, merged with the librosa pitch/energy levels.
#                 Falls back to librosa when the model or funasr is unavailable.
# "librosa"     — pitch/energy heuristic only (previous behavior).
TONE_BACKEND = os.getenv("TONE_BACKEND", "emotion2vec").strip().lower()
EMOTION2VEC_MODEL_PATH = os.getenv(
    "EMOTION2VEC_MODEL_PATH", "/models/emotion2vec_plus_large"
).strip()
EMOTION2VEC_DEVICE = os.getenv("EMOTION2VEC_DEVICE", "cpu").strip().lower()

# Second LLM pass that re-checks Primary_Query_Type against keyword-candidate
# categories with quoted evidence (fixes balance vs mini-statement mixups).
INTELLIGENCE_VERIFY_ENABLED = (
    os.getenv("INTELLIGENCE_VERIFY_ENABLED", "true").lower() == "true"
)

# Phase 1 — shared secrets with backend (orchestrator auth + transcription callback)
ORCHESTRATOR_SECRET = os.getenv("ORCHESTRATOR_SECRET", "").strip()
CALLBACK_SECRET = os.getenv("CALLBACK_SECRET", "").strip()
BACKEND_CALLBACK_URL = os.getenv("BACKEND_CALLBACK_URL", "").strip()

LOG_DIR.mkdir(parents=True, exist_ok=True)
AUDIO_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
WORK_DIR.mkdir(parents=True, exist_ok=True)
DIARIZATION_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
