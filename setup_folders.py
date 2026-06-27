import os

# Get the current working directory (where the script and compose file are)
base_dir = os.getcwd()

# List of data subfolders (extracted and uniqued from compose file)
data_subdirs = [
    'Sample_Audio',
    'Audio_Chunks',
    'Language_Detection_Results',
    'diarization_output',
    'Transcriptions',
    'Translated',
    'Call Scoring with llama',
    'Tone_Analysis_Result',
    'Sentiment',
    'Sentence_Similarity'
]

# List of logs subfolders
logs_subdirs = [
    'Chatbot_Logs',
    'backend server log',
    'Main',
    'Audio_chunk_log',
    'Language_Detection',
    'diarization',
    'Transcription',
    'Seamless_Transcription',
    'Nemo_Transcription',
    'Translate',
    'Tone_Analysis',
    'Call_Scoring_with_llama',
    'Sentiment',
    'Sentence_Similarity'
]

# List of models subfolders (flattened for consistency)
models_subdirs = [
    'DeepSeek-R1-Distill-Qwen-1.5B',
    'Whisper-large-v3',
    'seamless-m4t-v2-large',
    'nemo',
    'indictrans2-en-indic-1B',
    'Llama-3.2-3B-Instruct',
    'Google/muril-large-cased',
    'Sentence Similarity/all-MiniLM-L6-v2'
]

# Create data folders
for subdir in data_subdirs:
    os.makedirs(os.path.join(base_dir, 'data', subdir), exist_ok=True)

# Create logs folders
for subdir in logs_subdirs:
    os.makedirs(os.path.join(base_dir, 'logs', subdir), exist_ok=True)

# Create models folders
for subdir in models_subdirs:
    os.makedirs(os.path.join(base_dir, 'models', subdir), exist_ok=True)

# Create other folders
os.makedirs(os.path.join(base_dir, 'license'), exist_ok=True)

print("All folders created successfully!")