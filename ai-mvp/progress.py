"""Processing stage definitions and subtask progress for UI + DB."""

from __future__ import annotations

PIPELINE_STAGES = [
    {"key": "upload", "label": "Upload", "order": 0},
    {"key": "transcribe", "label": "Transcription", "order": 1},
    {"key": "translate", "label": "Translation", "order": 2},
    {"key": "scoring", "label": "AI Scoring", "order": 3},
    {"key": "enrichment", "label": "Enrichment", "order": 4},
    {"key": "complete", "label": "Report", "order": 5},
]

STAGE_PROGRESS = {
    "upload": (5, "Audio file received by processing worker."),
    "queued": (8, "Waiting in processing queue."),
    "detecting_language": (15, "Detecting call language."),
    "diarizing": (28, "Speaker diarization is running."),
    "transcribing": (35, "Converting speech to text with speaker labels."),
    "translating": (50, "Translating Hindi transcript to English for analysis."),
    "scoring": (72, "AI quality scoring is running on English transcript."),
    "enriching": (88, "Tone, sentiment, and script compliance analysis."),
    "complete": (100, "All processing finished. Report is ready."),
    "failed": (100, "Processing failed."),
}


def stage_message(stage: str, fallback: str = "") -> str:
    return STAGE_PROGRESS.get(stage, (0, fallback))[1] or fallback


def stage_percent(stage: str, fallback: int = 0) -> int:
    return STAGE_PROGRESS.get(stage, (fallback, ""))[0]


def build_subtasks(current_stage: str, overall_percent: int, *, include_translate: bool = True) -> list[dict]:
    stages = [s for s in PIPELINE_STAGES if include_translate or s["key"] != "translate"]
    order_map = {s["key"]: i for i, s in enumerate(stages)}
    current_order = order_map.get(current_stage, 0)

    subtasks = []
    for idx, stage in enumerate(stages):
        if idx < current_order:
            pct, status = 100, "done"
        elif idx == current_order:
            pct, status = overall_percent, "active"
        else:
            pct, status = 0, "pending"
        subtasks.append(
            {
                "key": stage["key"],
                "label": stage["label"],
                "percent": pct,
                "status": status,
            }
        )
    return subtasks
