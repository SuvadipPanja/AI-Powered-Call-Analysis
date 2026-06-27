"""Parse diarized transcript lines shared across workers."""

from __future__ import annotations

import re
from dataclasses import dataclass

LINE_RE = re.compile(
    r"^\s*([\d.]+)\s*-\s*([\d.]+)\s*\((Agent|Customer|Call)\)\s*:\s*(.+)$",
    re.MULTILINE,
)


@dataclass
class Utterance:
    start: float
    end: float
    role: str
    text: str


def parse_transcript(transcript: str) -> list[Utterance]:
    utterances: list[Utterance] = []
    for match in LINE_RE.finditer(transcript):
        start, end, role, text = match.groups()
        utterances.append(
            Utterance(
                start=float(start),
                end=float(end),
                role=role,
                text=text.strip(),
            )
        )
    return utterances


def agent_lines(transcript: str) -> list[str]:
    return [u.text for u in parse_transcript(transcript) if u.role == "Agent" and u.text]
