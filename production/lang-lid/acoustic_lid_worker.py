"""Word-independent acoustic language verification for Indian call audio.

Three local CPU models consume raw 16 kHz audio only:

* ``onecxi/vakgyata-base`` — India-specific 12-language core classifier,
  including Odia.
* ``speechbrain/lang-id-voxlingua107-ecapa`` — the already-proven
  Hindi↔Marathi verifier plus conservative evidence for Nepali, Sanskrit,
  Sindhi and Urdu.
* ``ARTPARK-IISc/Vaani-LID_v0`` — a narrow Kannada rescue used only for the
  observed Bengali-upstream abstention pattern.

The existing Whisper/wordmatch result remains the stable fallback.  A regional
language is promoted only after several voiced windows across both call channels
agree with sufficient confidence and margin.  No transcript, keyword list,
translation, or LLM output participates in this decision.
"""

from __future__ import annotations

import json
import logging
import math
from collections import Counter
from pathlib import Path
from typing import Optional

import torch
import torchaudio

from audio_io import load_audio
from config import (
    LANG_INDIC_ACOUSTIC_CORE_MODEL_PATH,
    LANG_INDIC_ACOUSTIC_DEVICE,
    LANG_INDIC_ACOUSTIC_ECAPA_MODEL_PATH,
    LANG_INDIC_ACOUSTIC_ENABLED,
    LANG_INDIC_ACOUSTIC_EXTENDED_MIN_CONFIDENCE,
    LANG_INDIC_ACOUSTIC_EXTENDED_MIN_MARGIN,
    LANG_INDIC_ACOUSTIC_EXTENDED_MIN_VOTE_RATIO,
    LANG_INDIC_ACOUSTIC_EXTENDED_MIN_VOTES,
    LANG_INDIC_ACOUSTIC_LANGUAGES,
    LANG_INDIC_ACOUSTIC_KANNADA_MIN_CONFIDENCE,
    LANG_INDIC_ACOUSTIC_KANNADA_MIN_MEAN_PROBABILITY,
    LANG_INDIC_ACOUSTIC_KANNADA_MIN_TOP2_SUPPORT,
    LANG_INDIC_ACOUSTIC_KANNADA_MIN_WINNER_VOTES,
    LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_ENABLED,
    LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_UPSTREAM_LANGUAGES,
    LANG_INDIC_ACOUSTIC_MIN_MARGIN,
    LANG_INDIC_ACOUSTIC_MIN_VOTE_RATIO,
    LANG_INDIC_ACOUSTIC_MIN_VOTES,
    LANG_INDIC_ACOUSTIC_MIN_WINDOW_CONFIDENCE,
    LANG_INDIC_ACOUSTIC_MODE,
    LANG_INDIC_ACOUSTIC_PRIMARY_LANGUAGES,
    LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES,
    LANG_INDIC_ACOUSTIC_STRICT_MIN_CONFIDENCE,
    LANG_INDIC_ACOUSTIC_STRICT_MIN_MARGIN,
    LANG_INDIC_ACOUSTIC_STRICT_MIN_VOTE_RATIO,
    LANG_INDIC_ACOUSTIC_VAANI_MODEL_PATH,
    LANG_INDIC_ACOUSTIC_WINDOW_SEC,
    LANG_INDIC_ACOUSTIC_WINDOWS_PER_CHANNEL,
)

logger = logging.getLogger(__name__)

_ecapa_classifier = None
_ecapa_load_error: Optional[str] = None
_core_processor = None
_core_model = None
_core_load_error: Optional[str] = None
_vaani_processor = None
_vaani_model = None
_vaani_load_error: Optional[str] = None

_TARGET_SAMPLE_RATE = 16_000
_MIN_WINDOW_SEC = 3.0
_FRAME_SEC = 0.5
_MIN_FRAME_RMS = 0.0025

CORE_CODE_TO_DISPLAY = {
    "en-IN": "English",
    "hi-IN": "Hindi",
    "or-IN": "Odia",
    "bn-IN": "Bengali",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "mr-IN": "Marathi",
    "gu-IN": "Gujarati",
    "pa-IN": "Punjabi",
    "as-IN": "Assamese",
}

ECAPA_CODE_TO_DISPLAY = {
    "as": "Assamese",
    "bn": "Bengali",
    "en": "English",
    "gu": "Gujarati",
    "hi": "Hindi",
    "kn": "Kannada",
    "ml": "Malayalam",
    "mr": "Marathi",
    "ne": "Nepali",
    "pa": "Punjabi",
    "sa": "Sanskrit",
    "sd": "Sindhi",
    "ta": "Tamil",
    "te": "Telugu",
    "ur": "Urdu",
}

EXTENDED_LANGUAGES = frozenset({"Nepali", "Sanskrit", "Sindhi", "Urdu"})
CONFUSABLE_GROUPS = (
    frozenset({"Bengali", "Assamese"}),
    frozenset({"Hindi", "Punjabi", "Nepali", "Urdu"}),
    frozenset({"Tamil", "Telugu", "Kannada", "Malayalam"}),
)
_KANNADA_RESCUE_CORE_CONFUSIONS = frozenset({
    "Assamese",
    "Hindi",
    "Kannada",
    "Malayalam",
    "Marathi",
    "Punjabi",
    "Tamil",
    "Telugu",
})


class _VaaniSelfAttentionPooling(torch.nn.Module):
    def __init__(self, input_dim: int):
        super().__init__()
        self.attention = torch.nn.Linear(input_dim, 1)

    def forward(self, hidden: torch.Tensor) -> torch.Tensor:
        weights = torch.softmax(self.attention(hidden).squeeze(-1), dim=-1)
        return torch.sum(hidden * weights.unsqueeze(-1), dim=1)


class _VaaniWhisperModelHolder(torch.nn.Module):
    """Preserve upstream checkpoint key names without constructing a decoder."""

    def __init__(self, whisper_config):
        super().__init__()
        from transformers.models.whisper.modeling_whisper import WhisperEncoder

        self.encoder = WhisperEncoder(whisper_config)


class _VaaniEncoderHolder(torch.nn.Module):
    def __init__(self, whisper_config):
        super().__init__()
        self.model = _VaaniWhisperModelHolder(whisper_config)


class _VaaniLidModel(torch.nn.Module):
    """Audited inference-only form of ARTPARK-IISc/Vaani-LID_v0."""

    def __init__(
        self,
        whisper_config,
        *,
        hidden_size: int,
        id2label: dict[int, str],
    ):
        super().__init__()
        self.encoder = _VaaniEncoderHolder(whisper_config)
        self.pool = _VaaniSelfAttentionPooling(int(whisper_config.d_model))
        self.dense = torch.nn.Linear(int(whisper_config.d_model), hidden_size)
        self.dropout = torch.nn.Dropout(0.2)
        self.out_proj = torch.nn.Linear(hidden_size, len(id2label))
        self.id2label = id2label

    def forward(self, input_features: torch.Tensor) -> torch.Tensor:
        hidden = self.encoder.model.encoder(input_features).last_hidden_state
        pooled = self.pool(hidden)
        return self.out_proj(self.dropout(torch.relu(self.dense(pooled))))


def _resolve_device() -> str:
    requested = (LANG_INDIC_ACOUSTIC_DEVICE or "cpu").strip().lower()
    if requested == "cuda" and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _required_files(model_dir: Path, filenames: tuple[str, ...], label: str) -> None:
    missing = [name for name in filenames if not (model_dir / name).is_file()]
    if missing:
        raise RuntimeError(f"{label} model incomplete at {model_dir}: missing {missing}")


def _load_ecapa_classifier():
    """Load the pinned local Apache-2.0 ECAPA checkpoint without network access."""
    global _ecapa_classifier, _ecapa_load_error
    if _ecapa_classifier is not None:
        return _ecapa_classifier
    if _ecapa_load_error:
        raise RuntimeError(_ecapa_load_error)
    if not LANG_INDIC_ACOUSTIC_ENABLED:
        raise RuntimeError("Indic acoustic LID disabled")

    model_dir = Path(LANG_INDIC_ACOUSTIC_ECAPA_MODEL_PATH)
    try:
        _required_files(
            model_dir,
            (
                "hyperparams.yaml",
                "embedding_model.ckpt",
                "classifier.ckpt",
                "label_encoder.txt",
            ),
            "ECAPA",
        )
        from speechbrain.inference.classifiers import EncoderClassifier

        _ecapa_classifier = EncoderClassifier.from_hparams(
            source=str(model_dir),
            savedir=str(model_dir),
            run_opts={"device": _resolve_device()},
        )
        _ecapa_classifier.hparams.label_encoder.expect_len(107)
        for code in ECAPA_CODE_TO_DISPLAY:
            _ecapa_label_index(_ecapa_classifier, code)
        logger.info("ECAPA Indic LID loaded from %s on %s", model_dir, _resolve_device())
        return _ecapa_classifier
    except Exception as exc:
        _ecapa_load_error = str(exc)
        raise RuntimeError(_ecapa_load_error) from exc


def _load_core_classifier():
    """Load the pinned local Apache-2.0 Vakgyata model via safe tensors."""
    global _core_processor, _core_model, _core_load_error
    if _core_model is not None and _core_processor is not None:
        return _core_processor, _core_model
    if _core_load_error:
        raise RuntimeError(_core_load_error)
    if not LANG_INDIC_ACOUSTIC_ENABLED:
        raise RuntimeError("Indic acoustic LID disabled")

    model_dir = Path(LANG_INDIC_ACOUSTIC_CORE_MODEL_PATH)
    try:
        _required_files(
            model_dir,
            ("model.safetensors", "config.json", "preprocessor_config.json"),
            "Vakgyata",
        )
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification

        _core_processor = AutoFeatureExtractor.from_pretrained(
            str(model_dir), local_files_only=True
        )
        _core_model = AutoModelForAudioClassification.from_pretrained(
            str(model_dir),
            local_files_only=True,
            use_safetensors=True,
        )
        _core_model = _core_model.to(_resolve_device())
        _core_model.eval()

        labels = {
            CORE_CODE_TO_DISPLAY.get(str(value), str(value))
            for value in _core_model.config.id2label.values()
        }
        expected = set(CORE_CODE_TO_DISPLAY.values())
        if labels != expected:
            raise RuntimeError(
                f"Vakgyata label mismatch: expected {sorted(expected)}, got {sorted(labels)}"
            )
        logger.info(
            "Vakgyata core Indic LID loaded from %s on %s",
            model_dir,
            _resolve_device(),
        )
        return _core_processor, _core_model
    except Exception as exc:
        _core_load_error = str(exc)
        raise RuntimeError(_core_load_error) from exc


def _load_vaani_classifier():
    """Load the pinned MIT Vaani Kannada rescue model without remote code."""
    global _vaani_processor, _vaani_model, _vaani_load_error
    if _vaani_model is not None and _vaani_processor is not None:
        return _vaani_processor, _vaani_model
    if _vaani_load_error:
        raise RuntimeError(_vaani_load_error)
    if not LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_ENABLED:
        raise RuntimeError("Kannada rescue disabled")

    model_dir = Path(LANG_INDIC_ACOUSTIC_VAANI_MODEL_PATH)
    try:
        _required_files(
            model_dir,
            (
                "model.safetensors",
                "config.json",
                "preprocessor_config.json",
                "whisper_config.json",
            ),
            "Vaani",
        )
        from safetensors.torch import load_model
        from transformers import WhisperConfig, WhisperFeatureExtractor

        metadata = json.loads(
            (model_dir / "config.json").read_text(encoding="utf-8")
        )
        id2label = {
            int(index): str(language)
            for index, language in metadata["id2label"].items()
        }
        expected_labels = {"Bengali", "Kannada", "Tamil", "Telugu", "Tulu"}
        if not expected_labels.issubset(set(id2label.values())):
            raise RuntimeError(
                "Vaani checkpoint is missing required Kannada confusion classes"
            )

        whisper_config = WhisperConfig.from_json_file(
            str(model_dir / "whisper_config.json")
        )
        _vaani_processor = WhisperFeatureExtractor.from_pretrained(
            str(model_dir),
            local_files_only=True,
        )
        _vaani_model = _VaaniLidModel(
            whisper_config,
            hidden_size=int(metadata.get("hidden_size", 512)),
            id2label=id2label,
        )
        load_model(
            _vaani_model,
            str(model_dir / "model.safetensors"),
            strict=True,
        )
        _vaani_model = _vaani_model.to(_resolve_device())
        _vaani_model.eval()
        logger.info(
            "Vaani Kannada rescue LID loaded from %s on %s",
            model_dir,
            _resolve_device(),
        )
        return _vaani_processor, _vaani_model
    except Exception as exc:
        _vaani_load_error = str(exc)
        raise RuntimeError(_vaani_load_error) from exc


def _window_candidates(channel: torch.Tensor, sample_rate: int) -> list[torch.Tensor]:
    """Select energetic, substantially voiced, non-overlapping windows."""
    mono = channel.mean(dim=0).float()
    window_samples = max(1, int(LANG_INDIC_ACOUSTIC_WINDOW_SEC * sample_rate))
    min_samples = int(_MIN_WINDOW_SEC * sample_rate)
    frame_samples = max(1, int(_FRAME_SEC * sample_rate))
    if mono.numel() < min_samples:
        return []
    if mono.numel() < window_samples:
        mono = torch.nn.functional.pad(mono, (0, window_samples - mono.numel()))

    hop = max(frame_samples, window_samples // 2)
    last_start = max(0, mono.numel() - window_samples)
    starts = list(range(0, last_start + 1, hop))
    if starts[-1] != last_start:
        starts.append(last_start)

    candidates: list[tuple[float, int, torch.Tensor]] = []
    for start in starts:
        piece = mono[start:start + window_samples]
        frames = piece.unfold(0, frame_samples, frame_samples)
        if frames.numel() == 0:
            continue
        frame_rms = frames.pow(2).mean(dim=1).sqrt()
        voiced = frame_rms >= _MIN_FRAME_RMS
        voiced_fraction = float(voiced.float().mean())
        if voiced_fraction < 0.25:
            continue
        score = float(frame_rms[voiced].median()) * voiced_fraction
        candidates.append((score, start, piece))

    selected: list[tuple[int, torch.Tensor]] = []
    for _score, start, piece in sorted(candidates, key=lambda item: item[0], reverse=True):
        if any(abs(start - old_start) < window_samples // 2 for old_start, _ in selected):
            continue
        selected.append((start, piece))
        if len(selected) >= LANG_INDIC_ACOUSTIC_WINDOWS_PER_CHANNEL:
            break
    return [piece for _start, piece in sorted(selected, key=lambda item: item[0])]


def _extract_windows(audio_path: Path) -> list[torch.Tensor]:
    waveform, sample_rate = load_audio(audio_path)
    if sample_rate != _TARGET_SAMPLE_RATE:
        waveform = torchaudio.transforms.Resample(sample_rate, _TARGET_SAMPLE_RATE)(waveform)
        sample_rate = _TARGET_SAMPLE_RATE
    channels = (
        (waveform[0:1], waveform[1:2])
        if waveform.shape[0] >= 2
        else (waveform[0:1],)
    )
    windows: list[torch.Tensor] = []
    for channel in channels:
        if float(channel.abs().mean()) >= 1e-4:
            windows.extend(_window_candidates(channel, sample_rate))
    return windows


def _padded_batch(windows: list[torch.Tensor]) -> tuple[torch.Tensor, torch.Tensor]:
    lengths = torch.tensor([window.numel() for window in windows], dtype=torch.float32)
    max_len = int(lengths.max().item())
    batch = torch.zeros((len(windows), max_len), dtype=torch.float32)
    for index, window in enumerate(windows):
        batch[index, : window.numel()] = window
    return batch, lengths / float(max_len)


def _ecapa_label_index(classifier, code: str) -> int:
    encoder = classifier.hparams.label_encoder
    for stored_label, index in encoder.lab2ind.items():
        iso = str(stored_label).split(":", 1)[0].strip().lower()
        if iso == code.strip().lower():
            return int(index.item()) if hasattr(index, "item") else int(index)
    raise RuntimeError(f"ECAPA checkpoint has no {code!r} class")


def _ecapa_window_probabilities(
    classifier,
    windows: list[torch.Tensor],
    display_languages: set[str],
    *,
    conditional: bool = True,
) -> list[dict[str, float]]:
    """ECAPA probabilities over selected production languages.

    SpeechBrain returns log-posteriors across all 107 classes.  The proven
    Hindi/Marathi lane deliberately uses a conditional closed set.  Extended
    language promotion retains absolute model mass and adds an ``Other`` class,
    preventing tiny Nepali/Urdu/etc. evidence from being inflated by renormalizing
    only the selected Indic labels.
    """
    if not windows:
        return []
    batch, relative_lengths = _padded_batch(windows)
    device = _resolve_device()
    with torch.inference_mode():
        output = classifier.classify_batch(
            batch.to(device), relative_lengths.to(device)
        )[0]
    scores = output.detach().float().cpu()
    if scores.ndim == 3:
        scores = scores[:, 0, :]

    selected = [
        (code, display, _ecapa_label_index(classifier, code))
        for code, display in ECAPA_CODE_TO_DISPLAY.items()
        if display in display_languages
    ]
    probabilities: list[dict[str, float]] = []
    for row in scores:
        selected_scores = torch.stack(
            [row[index] for _code, _display, index in selected]
        )
        if conditional:
            selected_probs = torch.softmax(selected_scores, dim=0)
        else:
            selected_probs = torch.exp(selected_scores)
        result = {
            display: float(selected_probs[offset])
            for offset, (_code, display, _index) in enumerate(selected)
        }
        if not conditional:
            result["Other"] = max(0.0, 1.0 - sum(result.values()))
        probabilities.append(result)
    return probabilities


def _core_window_probabilities(
    processor,
    model,
    windows: list[torch.Tensor],
) -> list[dict[str, float]]:
    if not windows:
        return []
    arrays = [window.detach().cpu().numpy() for window in windows]
    inputs = processor(
        arrays,
        sampling_rate=_TARGET_SAMPLE_RATE,
        return_tensors="pt",
        padding=True,
    )
    device = _resolve_device()
    inputs = {
        key: value.to(device) if hasattr(value, "to") else value
        for key, value in inputs.items()
    }
    with torch.inference_mode():
        logits = model(**inputs).logits.detach().float().cpu()
    probs = torch.softmax(logits, dim=-1)

    probabilities: list[dict[str, float]] = []
    for row in probs:
        language_probs: dict[str, float] = {}
        for index, value in enumerate(row):
            raw_label = str(model.config.id2label[int(index)])
            display = CORE_CODE_TO_DISPLAY.get(raw_label)
            if display and display in LANG_INDIC_ACOUSTIC_LANGUAGES:
                language_probs[display] = float(value)
        total = sum(language_probs.values())
        if total > 0:
            language_probs = {
                language: probability / total
                for language, probability in language_probs.items()
            }
        probabilities.append(language_probs)
    return probabilities


def _vaani_window_probabilities(
    processor,
    model,
    windows: list[torch.Tensor],
) -> list[dict[str, float]]:
    """Run sequentially to bound CPU RAM for the 809M-parameter verifier."""
    probabilities: list[dict[str, float]] = []
    device = _resolve_device()
    for window in windows:
        inputs = processor(
            window.detach().cpu().numpy(),
            sampling_rate=_TARGET_SAMPLE_RATE,
            return_tensors="pt",
        )
        input_features = inputs.input_features.to(device)
        with torch.inference_mode():
            logits = model(input_features)[0].detach().float().cpu()
        row = torch.softmax(logits, dim=-1)
        probabilities.append({
            model.id2label[int(index)]: float(value)
            for index, value in enumerate(row)
        })
    return probabilities


def _is_confusable(language: str) -> bool:
    return any(language in group for group in CONFUSABLE_GROUPS)


def decide_multiclass(
    probabilities: list[dict[str, float]],
    *,
    min_confidence: float,
    min_votes: int,
    min_vote_ratio: float,
    min_margin: float,
    strict_confidence: float | None = None,
    strict_vote_ratio: float | None = None,
    strict_margin: float | None = None,
) -> tuple[str | None, dict]:
    """Aggregate per-window language probabilities with conservative abstention."""
    usable: list[tuple[str, float, float, dict[str, float]]] = []
    for row in probabilities:
        finite = {
            language: float(probability)
            for language, probability in row.items()
            if math.isfinite(float(probability)) and float(probability) >= 0
        }
        total = sum(finite.values())
        if total <= 0 or len(finite) < 2:
            continue
        normalized = {
            language: probability / total
            for language, probability in finite.items()
        }
        ranking = sorted(normalized.items(), key=lambda item: item[1], reverse=True)
        winner, confidence = ranking[0]
        margin = confidence - ranking[1][1]
        usable.append((winner, confidence, margin, normalized))

    if not usable:
        return None, {
            "windows": len(probabilities),
            "confident_windows": 0,
            "votes": {},
            "reason": "no_usable_windows",
        }

    votes = Counter(winner for winner, _confidence, _margin, _row in usable)
    winner, winner_votes = votes.most_common(1)[0]
    required_confidence = (
        strict_confidence
        if _is_confusable(winner) and strict_confidence is not None
        else min_confidence
    )
    required_ratio = (
        strict_vote_ratio
        if _is_confusable(winner) and strict_vote_ratio is not None
        else min_vote_ratio
    )
    required_margin = (
        strict_margin
        if _is_confusable(winner) and strict_margin is not None
        else min_margin
    )

    confident = [
        (language, confidence, margin, row)
        for language, confidence, margin, row in usable
        if confidence >= required_confidence and margin >= required_margin
    ]
    confident_votes = Counter(language for language, _c, _m, _r in confident)
    winner_votes = confident_votes.get(winner, 0)
    # Consensus is measured against every usable acoustic window, including
    # uncertain/conflicting ones. Two strong windows out of six must not promote.
    vote_count = len(usable)
    vote_ratio = winner_votes / vote_count if vote_count else 0.0
    winner_confidences = [
        confidence
        for language, confidence, _margin, _row in confident
        if language == winner
    ]
    winner_margins = [
        margin
        for language, _confidence, margin, _row in confident
        if language == winner
    ]
    mean_confidence = (
        sum(winner_confidences) / len(winner_confidences)
        if winner_confidences
        else 0.0
    )
    mean_margin = (
        sum(winner_margins) / len(winner_margins)
        if winner_margins
        else 0.0
    )
    debug = {
        "windows": len(probabilities),
        "usable_windows": vote_count,
        "confident_windows": len(confident),
        "winner": winner,
        "votes": dict(confident_votes),
        "winner_votes": winner_votes,
        "vote_ratio": round(vote_ratio, 4),
        "mean_confidence": round(mean_confidence, 4),
        "mean_margin": round(mean_margin, 4),
        "thresholds": {
            "confidence": required_confidence,
            "votes": min_votes,
            "vote_ratio": required_ratio,
            "margin": required_margin,
        },
    }
    if (
        winner_votes >= min_votes
        and vote_ratio >= required_ratio
        and mean_confidence >= required_confidence
        and mean_margin >= required_margin
    ):
        return winner, debug
    debug["reason"] = "insufficient_consensus"
    return None, debug


def decide_hi_mr(probabilities: list[tuple[float, float]]) -> tuple[str | None, dict]:
    """Preserve the proven binary Hindi/Marathi consensus policy.

    General regional promotion counts every extracted window in its denominator.
    The already field-validated hi/mr lane instead ignores low-confidence windows
    and votes only among decisive binary windows, matching its previous production
    behavior.
    """
    votes: list[str] = []
    confidences: dict[str, list[float]] = {"Hindi": [], "Marathi": []}
    for p_hi, p_mr in probabilities:
        total = float(p_hi) + float(p_mr)
        if total <= 0:
            continue
        normalized_hi = float(p_hi) / total
        normalized_mr = float(p_mr) / total
        confidence = max(normalized_hi, normalized_mr)
        if confidence < LANG_INDIC_ACOUSTIC_MIN_WINDOW_CONFIDENCE:
            continue
        language = "Marathi" if normalized_mr > normalized_hi else "Hindi"
        votes.append(language)
        confidences[language].append(confidence)

    counts = Counter(votes)
    winner, winner_votes = counts.most_common(1)[0] if counts else (None, 0)
    vote_ratio = winner_votes / len(votes) if votes else 0.0
    winner_confidences = confidences.get(winner or "", [])
    mean_confidence = (
        sum(winner_confidences) / len(winner_confidences)
        if winner_confidences
        else 0.0
    )
    decision = (
        winner
        if (
            winner_votes >= LANG_INDIC_ACOUSTIC_MIN_VOTES
            and vote_ratio >= LANG_INDIC_ACOUSTIC_MIN_VOTE_RATIO
        )
        else None
    )
    debug = {
        "windows": len(probabilities),
        "confident_windows": len(votes),
        "votes": dict(counts),
        "winner": winner,
        "winner_votes": winner_votes,
        "vote_ratio": round(vote_ratio, 4),
        "mean_confidence": round(mean_confidence, 4),
        "mr_votes": int(counts.get("Marathi", 0)),
        "hi_votes": int(counts.get("Hindi", 0)),
        "mr_vote_ratio": round(
            counts.get("Marathi", 0) / max(1, len(votes)), 4
        ),
    }
    if decision is None:
        debug["reason"] = "insufficient_consensus"
    return decision, debug


def decide_hi_bn(probabilities: list[dict[str, float]]) -> tuple[str | None, dict]:
    """Binary Hindi vs Bengali vote.

    The multiclass gate treats Hindi as confusable and demands a strict
    margin, so a real Hindi call often abstains and a false Bengali label
    stays. This vote uses the same bar as the proven Hindi/Marathi lane.
    """
    pairs = [
        (float(row.get("Hindi", 0.0)), float(row.get("Bengali", 0.0)))
        for row in probabilities
    ]
    votes: list[str] = []
    confidences: dict[str, list[float]] = {"Hindi": [], "Bengali": []}
    for p_hi, p_bn in pairs:
        total = p_hi + p_bn
        if total <= 0:
            continue
        normalized_hi = p_hi / total
        normalized_bn = p_bn / total
        confidence = max(normalized_hi, normalized_bn)
        if confidence < LANG_INDIC_ACOUSTIC_MIN_WINDOW_CONFIDENCE:
            continue
        language = "Bengali" if normalized_bn > normalized_hi else "Hindi"
        votes.append(language)
        confidences[language].append(confidence)
    counts = Counter(votes)
    winner, winner_votes = counts.most_common(1)[0] if counts else (None, 0)
    vote_ratio = winner_votes / len(votes) if votes else 0.0
    decision = (
        winner
        if (
            winner_votes >= LANG_INDIC_ACOUSTIC_MIN_VOTES
            and vote_ratio >= LANG_INDIC_ACOUSTIC_MIN_VOTE_RATIO
        )
        else None
    )
    debug = {
        "windows": len(probabilities),
        "confident_windows": len(votes),
        "votes": dict(counts),
        "winner": winner,
        "winner_votes": winner_votes,
        "vote_ratio": round(vote_ratio, 4),
        "hi_votes": int(counts.get("Hindi", 0)),
        "bn_votes": int(counts.get("Bengali", 0)),
    }
    if decision is None:
        debug["reason"] = "insufficient_consensus"
    return decision, debug


def hindi_outranks_kannada(probabilities: list[dict[str, float]]) -> bool:
    """True when Vakgyata hears Hindi clearly more than Kannada.

    Whisper can write Kannada script for Hindi telephone speech, and the
    narrow Vaani rescue has no Hindi class, so it can only answer Kannada,
    Tamil, Telugu, Tulu, or Bengali. A Kannada label is kept only when
    Kannada mass is at least competitive with Hindi.
    """
    if not probabilities:
        return False
    count = len(probabilities)
    mean_hindi = sum(float(row.get("Hindi", 0.0)) for row in probabilities) / count
    mean_kannada = sum(float(row.get("Kannada", 0.0)) for row in probabilities) / count
    return mean_hindi >= 0.08 and mean_hindi >= mean_kannada + 0.05


def decide_kannada_rescue(
    probabilities: list[dict[str, float]],
    *,
    windows_per_channel: int | None = None,
) -> tuple[str | None, dict]:
    """Recognize the observed Kannada-vs-Bengali telephony confusion safely.

    Each call channel is judged independently.  A channel qualifies either with
    two confident Kannada winners or with broad top-two Kannada support and no
    repeated competing winner.  This second lane handles Kannada windows that
    Vaani intermittently ranks as Telugu/Tulu on narrow-band calls.
    """
    per_channel = max(
        1,
        int(windows_per_channel or LANG_INDIC_ACOUSTIC_WINDOWS_PER_CHANNEL),
    )
    channel_rows = [
        probabilities[index:index + per_channel]
        for index in range(0, len(probabilities), per_channel)
    ]
    channel_debug = []
    decision_score = 0.0
    qualified_channel = None

    for channel_index, rows in enumerate(channel_rows):
        if len(rows) < 2:
            continue
        winner_votes: Counter[str] = Counter()
        confident_kannada_votes = 0
        top2_support = 0
        kannada_scores = []
        bengali_scores = []
        for row in rows:
            finite = {
                language: float(probability)
                for language, probability in row.items()
                if math.isfinite(float(probability)) and float(probability) >= 0
            }
            total = sum(finite.values())
            if total <= 0:
                continue
            normalized = {
                language: probability / total
                for language, probability in finite.items()
            }
            ranking = sorted(
                normalized.items(),
                key=lambda item: item[1],
                reverse=True,
            )
            winner, confidence = ranking[0]
            winner_votes[winner] += 1
            kannada_probability = normalized.get("Kannada", 0.0)
            kannada_scores.append(kannada_probability)
            bengali_scores.append(normalized.get("Bengali", 0.0))
            if (
                winner == "Kannada"
                and confidence >= LANG_INDIC_ACOUSTIC_KANNADA_MIN_CONFIDENCE
            ):
                confident_kannada_votes += 1
            if any(language == "Kannada" for language, _score in ranking[:2]):
                top2_support += 1

        usable = len(kannada_scores)
        mean_kannada = sum(kannada_scores) / usable if usable else 0.0
        mean_bengali = sum(bengali_scores) / usable if usable else 0.0
        competing_votes = max(
            (
                count
                for language, count in winner_votes.items()
                if language != "Kannada"
            ),
            default=0,
        )
        has_bengali_winner = winner_votes.get("Bengali", 0) > 0
        winner_lane = (
            confident_kannada_votes
            >= LANG_INDIC_ACOUSTIC_KANNADA_MIN_WINNER_VOTES
        )
        support_lane = (
            top2_support >= LANG_INDIC_ACOUSTIC_KANNADA_MIN_TOP2_SUPPORT
            and mean_kannada
            >= LANG_INDIC_ACOUSTIC_KANNADA_MIN_MEAN_PROBABILITY
            and competing_votes <= 1
        )
        qualified = bool(
            usable >= 2
            and not has_bengali_winner
            and mean_bengali < 0.15
            and (winner_lane or support_lane)
        )
        score = mean_kannada
        channel_debug.append({
            "channel": channel_index,
            "windows": usable,
            "winner_votes": dict(winner_votes),
            "confident_kannada_votes": confident_kannada_votes,
            "top2_kannada_support": top2_support,
            "mean_kannada_probability": round(mean_kannada, 4),
            "mean_bengali_probability": round(mean_bengali, 4),
            "max_competing_votes": competing_votes,
            "qualified": qualified,
        })
        if qualified and score >= decision_score:
            decision_score = score
            qualified_channel = channel_index

    debug = {
        "windows": len(probabilities),
        "channels": channel_debug,
        "qualified_channel": qualified_channel,
        "mean_kannada_probability": round(decision_score, 4),
        "thresholds": {
            "confidence": LANG_INDIC_ACOUSTIC_KANNADA_MIN_CONFIDENCE,
            "winner_votes": LANG_INDIC_ACOUSTIC_KANNADA_MIN_WINNER_VOTES,
            "top2_support": LANG_INDIC_ACOUSTIC_KANNADA_MIN_TOP2_SUPPORT,
            "mean_probability": (
                LANG_INDIC_ACOUSTIC_KANNADA_MIN_MEAN_PROBABILITY
            ),
        },
    }
    if qualified_channel is None:
        debug["reason"] = "insufficient_kannada_evidence"
        return None, debug
    return "Kannada", debug


def _core_decision(
    processor,
    model,
    windows: list[torch.Tensor],
) -> tuple[str | None, dict, list[dict[str, float]]]:
    probabilities = _core_window_probabilities(processor, model, windows)
    decision, debug = decide_multiclass(
        probabilities,
        min_confidence=LANG_INDIC_ACOUSTIC_MIN_WINDOW_CONFIDENCE,
        min_votes=LANG_INDIC_ACOUSTIC_MIN_VOTES,
        min_vote_ratio=LANG_INDIC_ACOUSTIC_MIN_VOTE_RATIO,
        min_margin=LANG_INDIC_ACOUSTIC_MIN_MARGIN,
        strict_confidence=LANG_INDIC_ACOUSTIC_STRICT_MIN_CONFIDENCE,
        strict_vote_ratio=LANG_INDIC_ACOUSTIC_STRICT_MIN_VOTE_RATIO,
        strict_margin=LANG_INDIC_ACOUSTIC_STRICT_MIN_MARGIN,
    )
    return decision, debug, probabilities


def _ecapa_decisions(
    classifier,
    windows: list[torch.Tensor],
) -> tuple[str | None, dict, str | None, dict, list[dict[str, float]]]:
    supported = set(ECAPA_CODE_TO_DISPLAY.values()) & LANG_INDIC_ACOUSTIC_LANGUAGES
    probabilities = _ecapa_window_probabilities(
        classifier,
        windows,
        supported,
        conditional=False,
    )
    extended, extended_debug = decide_multiclass(
        probabilities,
        min_confidence=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_CONFIDENCE,
        min_votes=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_VOTES,
        min_vote_ratio=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_VOTE_RATIO,
        min_margin=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_MARGIN,
        strict_confidence=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_CONFIDENCE,
        strict_vote_ratio=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_VOTE_RATIO,
        strict_margin=LANG_INDIC_ACOUSTIC_EXTENDED_MIN_MARGIN,
    )
    if extended not in EXTENDED_LANGUAGES:
        extended = None

    hi_mr_rows = [
        {
            "Hindi": row.get("Hindi", 0.0),
            "Marathi": row.get("Marathi", 0.0),
        }
        for row in probabilities
    ]
    hi_mr_pairs = [
        (row["Hindi"], row["Marathi"])
        for row in hi_mr_rows
    ]
    hi_mr, hi_mr_debug = decide_hi_mr(hi_mr_pairs)
    return hi_mr, hi_mr_debug, extended, extended_debug, probabilities


def _regional_recommendation(
    upstream_language: str,
    core: str | None,
    hi_mr: str | None,
    extended: str | None,
) -> tuple[str | None, str]:
    """Resolve model outputs without allowing weak or conflicting promotions."""
    recommendations: list[tuple[str, str]] = []

    if core and core not in LANG_INDIC_ACOUSTIC_PRIMARY_LANGUAGES:
        if core == "Marathi":
            if hi_mr == "Marathi":
                recommendations.append(("Marathi", "vakgyata+ecapa"))
        else:
            recommendations.append((core, "vakgyata"))
    if extended:
        recommendations.append((extended, "ecapa-extended"))

    unique = {language for language, _source in recommendations}
    if len(unique) > 1:
        return None, "model_conflict"
    if recommendations:
        return recommendations[0]

    # Preserve the already-proven hi/mr correction even when the core model's
    # regional promotion gate abstains.
    if (
        upstream_language in {"Hindi", "Marathi"}
        and hi_mr == "Marathi"
        and core in {None, "Hindi", "Marathi"}
    ):
        return "Marathi", "ecapa-hi-mr"
    return None, "none"


def verify_acoustic_language(
    audio_path: Path,
    upstream_language: str,
) -> tuple[str, dict]:
    """Return the final conservative language plus auditable acoustic details."""
    if not LANG_INDIC_ACOUSTIC_ENABLED:
        return upstream_language, {
            "enabled": False,
            "mode": LANG_INDIC_ACOUSTIC_MODE,
            "upstream": upstream_language,
        }
    try:
        windows = _extract_windows(audio_path)
        if not windows:
            return upstream_language, {
                "enabled": True,
                "mode": LANG_INDIC_ACOUSTIC_MODE,
                "upstream": upstream_language,
                "reason": "no_voiced_windows",
            }

        processor, core_model = _load_core_classifier()
        ecapa = _load_ecapa_classifier()
        core, core_debug, core_probs = _core_decision(processor, core_model, windows)
        hi_mr, hi_mr_debug, extended, extended_debug, ecapa_probs = _ecapa_decisions(
            ecapa, windows
        )

        baseline = upstream_language
        # The proven binary lane is authoritative only when Vakgyata does not
        # identify a different language. This prevents a closed-set hi/mr model
        # from turning a true Gujarati/Tamil/etc. shadow recommendation into
        # Marathi merely because it was forced to choose between two labels.
        if (
            upstream_language in {"Hindi", "Marathi"}
            and core in {None, "Hindi", "Marathi"}
        ):
            baseline = (
                hi_mr if hi_mr in {"Hindi", "Marathi"} else upstream_language
            )

        recommendation, source = _regional_recommendation(
            upstream_language, core, hi_mr, extended
        )
        kannada_rescue = None
        kannada_debug = None
        va_with_probs: list[dict[str, float]] = []
        kannada_rescue_triggered = bool(
            LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_ENABLED
            and upstream_language
            in LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_UPSTREAM_LANGUAGES
            and recommendation is None
            and extended is None
            and core_debug.get("winner") in _KANNADA_RESCUE_CORE_CONFUSIONS
        )
        if kannada_rescue_triggered:
            try:
                va_processor, va_model = _load_vaani_classifier()
                va_with_probs = _vaani_window_probabilities(
                    va_processor,
                    va_model,
                    windows,
                )
                kannada_rescue, kannada_debug = decide_kannada_rescue(va_with_probs)
                if kannada_rescue:
                    recommendation = kannada_rescue
                    source = "vaani-kannada-rescue"
            except Exception as exc:
                logger.warning("Kannada rescue skipped: %s", exc)
                kannada_rescue_triggered = False
        should_apply = (
            LANG_INDIC_ACOUSTIC_MODE == "apply"
            or recommendation in LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES
            or source == "vaani-kannada-rescue"
        )
        recommendation_applied = bool(recommendation and should_apply)
        final = recommendation if recommendation_applied else baseline
        decision_confidence = None
        decision_source = "upstream"
        if recommendation_applied:
            decision_source = source
            if source == "vakgyata+ecapa":
                decision_confidence = min(
                    float(core_debug.get("mean_confidence") or 0.0),
                    float(hi_mr_debug.get("mean_confidence") or 0.0),
                )
            elif source == "vakgyata":
                decision_confidence = float(
                    core_debug.get("mean_confidence") or 0.0
                )
            elif source == "ecapa-extended":
                decision_confidence = float(
                    extended_debug.get("mean_confidence") or 0.0
                )
            elif source == "ecapa-hi-mr":
                decision_confidence = float(
                    hi_mr_debug.get("mean_confidence") or 0.0
                )
            elif source == "vaani-kannada-rescue":
                decision_confidence = float(
                    (kannada_debug or {}).get("mean_kannada_probability") or 0.0
                )
        hi_bn_decision, hi_bn_debug = decide_hi_bn(core_probs)
        hindi_corrects_bengali = (
            final == "Bengali"
            and upstream_language == "Bengali"
            and core not in {"Bengali", "Assamese"}
            and hi_mr in {None, "Hindi"}
            and (core == "Hindi" or hi_bn_decision == "Hindi")
        )
        if hindi_corrects_bengali:
            # Wordmatch can lock Hindi telephone speech as Bengali. Hindi is
            # on the strict multiclass bar, so a moderate Hindi-vs-Bengali
            # majority must still be able to correct it. A decided Bengali
            # or Assamese core vote is left alone.
            final = "Hindi"
            recommendation = "Hindi"
            source = "vakgyata-hindi-over-bengali"
            recommendation_applied = True
            decision_source = source
            decision_confidence = float(
                hi_bn_debug.get("vote_ratio") or core_debug.get("mean_confidence") or 0.0
            )
        elif final == "Kannada" and hindi_outranks_kannada(core_probs):
            # Audio_082: Hindi speech, Kannada probability about 0, label still
            # Kannada. Do not keep that label from wordmatch or from Vaani.
            final = "Hindi"
            recommendation = "Hindi"
            source = "vakgyata-hindi-over-kannada"
            recommendation_applied = True
            decision_source = source
            decision_confidence = float(
                hi_bn_debug.get("vote_ratio") or core_debug.get("mean_confidence") or 0.0
            )
        elif (
            not recommendation_applied
            and final in {"Hindi", "Marathi"}
            and hi_mr == final
            and upstream_language in {"Hindi", "Marathi"}
            and core in {None, "Hindi", "Marathi"}
        ):
            decision_source = "ecapa-hi-mr-baseline"
            decision_confidence = float(
                hi_mr_debug.get("mean_confidence") or 0.0
            )
        details = {
            "enabled": True,
            "mode": LANG_INDIC_ACOUSTIC_MODE,
            "upstream": upstream_language,
            "baseline": baseline,
            "recommendation": recommendation,
            "recommendation_source": source,
            "applied": recommendation_applied,
            "final": final,
            "decision_source": decision_source,
            "decision_confidence": (
                round(decision_confidence, 4)
                if decision_confidence is not None
                else None
            ),
            "windows": len(windows),
            "core_decision": core,
            "core": core_debug,
            "hi_mr_decision": hi_mr,
            "hi_mr": hi_mr_debug,
            "extended_decision": extended,
            "extended": extended_debug,
            "kannada_rescue_triggered": kannada_rescue_triggered,
            "kannada_rescue_decision": kannada_rescue,
            "kannada_rescue": kannada_debug,
            "core_window_probabilities": [
                {key: round(value, 4) for key, value in row.items()}
                for row in core_probs
            ],
            "ecapa_window_probabilities": [
                {key: round(value, 4) for key, value in row.items()}
                for row in ecapa_probs
            ],
            "vaani_window_probabilities": [
                {key: round(value, 4) for key, value in row.items()}
                for row in va_with_probs
            ],
        }
        logger.info("Indic acoustic LID details=%s", details)
        return final, details
    except Exception as exc:
        logger.warning("Indic acoustic verifier unavailable: %s", exc)
        return upstream_language, {
            "enabled": True,
            "mode": LANG_INDIC_ACOUSTIC_MODE,
            "upstream": upstream_language,
            "final": upstream_language,
            "reason": "error",
            "error": str(exc),
        }


def verify_hindi_or_marathi(audio_path: Path) -> tuple[str | None, dict]:
    """Backward-compatible focused verifier used by operational diagnostics."""
    if not LANG_INDIC_ACOUSTIC_ENABLED:
        return None, {"reason": "disabled"}
    try:
        windows = _extract_windows(audio_path)
        if not windows:
            return None, {"reason": "no_voiced_windows"}
        classifier = _load_ecapa_classifier()
        probabilities = _ecapa_window_probabilities(
            classifier, windows, {"Hindi", "Marathi"}
        )
        pairs = [
            (row.get("Hindi", 0.0), row.get("Marathi", 0.0))
            for row in probabilities
        ]
        decision, debug = decide_hi_mr(pairs)
        debug["window_probabilities"] = [
            {
                "hi": round(row.get("Hindi", 0.0), 4),
                "mr": round(row.get("Marathi", 0.0), 4),
            }
            for row in probabilities
        ]
        return decision, debug
    except Exception as exc:
        logger.warning("Focused hi/mr verifier unavailable: %s", exc)
        return None, {"reason": "error", "error": str(exc)}


def acoustic_lid_health() -> dict:
    info = {
        "enabled": LANG_INDIC_ACOUSTIC_ENABLED,
        "mode": LANG_INDIC_ACOUSTIC_MODE,
        "device": _resolve_device(),
        "method": (
            "Vakgyata core + VoxLingua ECAPA + Vaani Kannada rescue "
            "acoustic Indic LID"
        ),
        "transcript_or_keywords_used": False,
        "supported_languages": sorted(LANG_INDIC_ACOUSTIC_LANGUAGES),
        "core_model_path": str(LANG_INDIC_ACOUSTIC_CORE_MODEL_PATH),
        "ecapa_model_path": str(LANG_INDIC_ACOUSTIC_ECAPA_MODEL_PATH),
        "vaani_model_path": str(LANG_INDIC_ACOUSTIC_VAANI_MODEL_PATH),
        "kannada_rescue_enabled": (
            LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_ENABLED
        ),
    }
    if not LANG_INDIC_ACOUSTIC_ENABLED:
        info["ready"] = False
        return info

    errors: dict[str, str] = {}
    try:
        _load_core_classifier()
        info["core_ready"] = True
    except Exception as exc:
        info["core_ready"] = False
        errors["core"] = str(exc)
    try:
        _load_ecapa_classifier()
        info["ecapa_ready"] = True
    except Exception as exc:
        info["ecapa_ready"] = False
        errors["ecapa"] = str(exc)
    if LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_ENABLED:
        try:
            _load_vaani_classifier()
            info["vaani_ready"] = True
        except Exception as exc:
            info["vaani_ready"] = False
            errors["vaani"] = str(exc)
    else:
        info["vaani_ready"] = False
    info["ready"] = bool(
        info.get("core_ready")
        and info.get("ecapa_ready")
        and (
            info.get("vaani_ready")
            or not LANG_INDIC_ACOUSTIC_KANNADA_RESCUE_ENABLED
        )
    )
    if errors:
        info["errors"] = errors
        info["error"] = "; ".join(f"{key}: {value}" for key, value in errors.items())
    return info
