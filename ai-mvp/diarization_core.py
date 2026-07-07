"""Hybrid diarization — stereo VAD + exclusive overlap resolver + optional Pyannote.

Picks a non-overlapping Agent/Customer timeline for call-center stereo audio.
Pyannote community-1 (exclusive mode, num_speakers=2) is used when available and
scores better than stereo-only on overlap / flip metrics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import torch

from config import (
    DIAR_BACKEND,
    DIAR_MIN_SPEAKER_MERGE_SEC,
    DIAR_PYANNOTE_ENABLED,
    DIAR_PYANNOTE_NUM_SPEAKERS,
    DIAR_RMS_DOMINANCE_RATIO,
    DIAR_SAME_SPEAKER_MERGE_GAP_SEC,
    DIAR_STEREO_FIRST_SPEAKER_AGENT,
    MIN_SPEECH_DURATION_MS,
)


@dataclass
class DiarizationMetrics:
    segments: int
    overlaps: int
    rapid_flips: int
    micro_turns: int
    agent_secs: float
    customer_secs: float

    @property
    def score(self) -> float:
        """Lower is better."""
        return (
            self.overlaps * 100.0
            + self.rapid_flips * 3.0
            + self.micro_turns * 2.0
            + max(0, self.segments - 40) * 0.5
        )


@dataclass
class TimelineResult:
    segments: list[tuple[str, float, float]]
    method: str
    metrics: DiarizationMetrics


def segment_rms(
    waveform: torch.Tensor,
    start_sec: float,
    end_sec: float,
    sample_rate: int,
) -> float:
    start_sample = int(start_sec * sample_rate)
    end_sample = int(end_sec * sample_rate)
    if end_sample <= start_sample:
        return 0.0
    chunk = waveform[:, start_sample:end_sample]
    if chunk.numel() == 0:
        return 0.0
    return float(torch.sqrt(torch.mean(chunk ** 2)).item())


def compute_metrics(segments: list[tuple[str, float, float]]) -> DiarizationMetrics:
    overlaps = 0
    rapid_flips = 0
    micro = 0
    agent_secs = 0.0
    customer_secs = 0.0
    for i, (spk, start, end) in enumerate(segments):
        dur = max(0.0, end - start)
        if dur < 0.25:
            micro += 1
        if spk == "Agent":
            agent_secs += dur
        else:
            customer_secs += dur
        if i > 0:
            p_spk, p_start, p_end = segments[i - 1]
            if start < p_end - 0.01:
                overlaps += 1
            if spk != p_spk and (start - p_end) < 0.5:
                rapid_flips += 1
    return DiarizationMetrics(
        segments=len(segments),
        overlaps=overlaps,
        rapid_flips=rapid_flips,
        micro_turns=micro,
        agent_secs=agent_secs,
        customer_secs=customer_secs,
    )


def merge_consecutive(
    segments: list[tuple[str, float, float]],
) -> list[tuple[str, float, float]]:
    if not segments:
        return []
    merged: list[tuple[str, float, float]] = []
    speaker, start, end = segments[0]
    for spk, seg_start, seg_end in segments[1:]:
        if spk == speaker:
            end = max(end, seg_end)
        else:
            merged.append((speaker, start, end))
            speaker, start, end = spk, seg_start, seg_end
    merged.append((speaker, start, end))
    return merged


def merge_same_speaker_gap(
    segments: list[tuple[str, float, float]],
    gap_sec: float = DIAR_SAME_SPEAKER_MERGE_GAP_SEC,
) -> list[tuple[str, float, float]]:
    if gap_sec <= 0 or len(segments) < 2:
        return segments
    out = [segments[0]]
    for spk, start, end in segments[1:]:
        p_spk, p_start, p_end = out[-1]
        if spk == p_spk and (start - p_end) <= gap_sec:
            out[-1] = (p_spk, p_start, max(p_end, end))
        else:
            out.append((spk, start, end))
    return out


def merge_short_same_speaker(
    segments: list[tuple[str, float, float]],
    min_sec: float = DIAR_MIN_SPEAKER_MERGE_SEC,
) -> list[tuple[str, float, float]]:
    """Absorb sub-second blips into neighbours when sandwiched."""
    if len(segments) < 3 or min_sec <= 0:
        return segments
    out = list(segments)
    changed = True
    while changed and len(out) >= 3:
        changed = False
        for i in range(1, len(out) - 1):
            spk, start, end = out[i]
            if (end - start) >= min_sec:
                continue
            prev_spk = out[i - 1][0]
            next_spk = out[i + 1][0]
            if prev_spk == next_spk != spk:
                out[i - 1] = (prev_spk, out[i - 1][1], out[i + 1][2])
                del out[i : i + 2]
                changed = True
                break
    return out


def resolve_vad_overlaps(
    agent_segments: list[tuple[float, float]],
    customer_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
    total_duration: float,
) -> list[tuple[str, float, float]]:
    """Exclusive timeline from dual-channel VAD using per-interval RMS."""
    if not agent_segments and not customer_segments:
        return []

    boundaries: set[float] = {0.0, total_duration}
    for start, end in agent_segments + customer_segments:
        boundaries.add(start)
        boundaries.add(end)
    points = sorted(boundaries)
    min_interval = max(MIN_SPEECH_DURATION_MS / 1000.0, 0.08)

    intervals: list[tuple[str, float, float]] = []
    for i in range(len(points) - 1):
        start, end = points[i], points[i + 1]
        if (end - start) < min_interval:
            continue
        in_agent = any(s <= start and e >= end for s, e in agent_segments)
        in_customer = any(s <= start and e >= end for s, e in customer_segments)
        if not in_agent and not in_customer:
            continue
        if in_agent and not in_customer:
            speaker = "Agent"
        elif in_customer and not in_agent:
            speaker = "Customer"
        else:
            a_rms = segment_rms(agent_ch, start, end, sample_rate)
            c_rms = segment_rms(customer_ch, start, end, sample_rate)
            if a_rms >= c_rms * DIAR_RMS_DOMINANCE_RATIO:
                speaker = "Agent"
            elif c_rms >= a_rms * DIAR_RMS_DOMINANCE_RATIO:
                speaker = "Customer"
            else:
                speaker = "Agent" if a_rms >= c_rms else "Customer"
        intervals.append((speaker, start, end))

    return merge_consecutive(intervals)


def map_anonymous_speakers_to_roles(
    segments: list[tuple[str, float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
    *,
    first_speaker_is_agent: bool = DIAR_STEREO_FIRST_SPEAKER_AGENT,
) -> list[tuple[str, float, float]]:
    """Map SPEAKER_00/01 (or similar) → Agent/Customer via stereo channel energy."""
    labels = sorted({spk for spk, _, _ in segments})
    if not labels:
        return segments
    if labels == ["Agent", "Customer"]:
        return segments

    scores: dict[str, tuple[float, float]] = {}
    for label in labels:
        agent_energy = 0.0
        cust_energy = 0.0
        for spk, start, end in segments:
            if spk != label:
                continue
            dur = max(end - start, 0.01)
            agent_energy += segment_rms(agent_ch, start, end, sample_rate) * dur
            cust_energy += segment_rms(customer_ch, start, end, sample_rate) * dur
        scores[label] = (agent_energy, cust_energy)

    ranked = sorted(
        labels,
        key=lambda lb: scores[lb][0] - scores[lb][1],
        reverse=True,
    )
    agent_label = ranked[0]
    customer_label = ranked[1] if len(ranked) > 1 else ranked[0]

    if not first_speaker_is_agent:
        # Opening turn heuristic: first label in time order is agent greeting.
        first_label = segments[0][0]
        if first_label in labels and first_label != agent_label:
            customer_label = agent_label
            agent_label = first_label

    mapping = {agent_label: "Agent", customer_label: "Customer"}
    for lb in labels:
        mapping.setdefault(lb, "Customer" if lb != agent_label else "Agent")

    return [(mapping.get(spk, spk), start, end) for spk, start, end in segments]


def clip_exclusive_timeline(
    segments: list[tuple[str, float, float]],
    min_sec: float = 0.15,
) -> list[tuple[str, float, float]]:
    """Remove cross-speaker time overlap (e.g. after chunk padding)."""
    if not segments:
        return []
    out: list[tuple[str, float, float]] = [segments[0]]
    for spk, start, end in segments[1:]:
        p_spk, p_start, p_end = out[-1]
        if start < p_end - 1e-3:
            if spk == p_spk:
                out[-1] = (p_spk, p_start, max(p_end, end))
                continue
            mid = (p_end + start) / 2.0
            out[-1] = (p_spk, p_start, mid)
            start = mid
        if end - start >= min_sec:
            out.append((spk, start, end))
    return merge_consecutive(out)


def choose_best_timeline(candidates: list[TimelineResult]) -> TimelineResult:
    if not candidates:
        return TimelineResult([], "none", DiarizationMetrics(0, 0, 0, 0, 0.0, 0.0))
    valid = [c for c in candidates if c.segments]
    if not valid:
        return candidates[0]
    return min(valid, key=lambda c: c.metrics.score)


def build_stereo_timeline(
    agent_segments: list[tuple[float, float]],
    customer_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
    total_duration: float,
    *,
    post_process: Callable[[list[tuple[str, float, float]]], list[tuple[str, float, float]]] | None = None,
) -> TimelineResult:
    labeled = resolve_vad_overlaps(
        agent_segments, customer_segments, agent_ch, customer_ch, sample_rate, total_duration
    )
    if post_process:
        labeled = post_process(labeled)
    labeled = merge_short_same_speaker(labeled)
    labeled = merge_same_speaker_gap(labeled)
    labeled = merge_consecutive(labeled)
    metrics = compute_metrics(labeled)
    return TimelineResult(labeled, "stereo_exclusive", metrics)


def build_hybrid_timeline(
    agent_segments: list[tuple[float, float]],
    customer_segments: list[tuple[float, float]],
    agent_ch: torch.Tensor,
    customer_ch: torch.Tensor,
    sample_rate: int,
    total_duration: float,
    audio_path,
    *,
    post_process: Callable[[list[tuple[str, float, float]]], list[tuple[str, float, float]]] | None = None,
) -> TimelineResult:
    candidates: list[TimelineResult] = []

    stereo = build_stereo_timeline(
        agent_segments,
        customer_segments,
        agent_ch,
        customer_ch,
        sample_rate,
        total_duration,
        post_process=post_process,
    )
    candidates.append(stereo)

    if DIAR_PYANNOTE_ENABLED and DIAR_BACKEND in ("hybrid", "pyannote"):
        try:
            from pyannote_diarizer import diarize_with_pyannote

            raw = diarize_with_pyannote(
                audio_path,
                num_speakers=DIAR_PYANNOTE_NUM_SPEAKERS,
                sample_rate=sample_rate,
            )
            if raw:
                mapped = map_anonymous_speakers_to_roles(
                    raw, agent_ch, customer_ch, sample_rate
                )
                if post_process:
                    mapped = post_process(mapped)
                mapped = merge_short_same_speaker(mapped)
                mapped = merge_same_speaker_gap(mapped)
                mapped = merge_consecutive(mapped)
                candidates.append(
                    TimelineResult(mapped, "pyannote_community1", compute_metrics(mapped))
                )
        except Exception:
            pass

    if DIAR_BACKEND == "stereo":
        return stereo

    chosen = choose_best_timeline(candidates)
    if chosen.method == "stereo_exclusive" and stereo.metrics.overlaps > 0:
        pyannote_candidates = [c for c in candidates if c.method.startswith("pyannote")]
        if pyannote_candidates:
            best_pyannote = min(pyannote_candidates, key=lambda c: c.metrics.score)
            if best_pyannote.metrics.score < stereo.metrics.score:
                return best_pyannote
    return chosen
