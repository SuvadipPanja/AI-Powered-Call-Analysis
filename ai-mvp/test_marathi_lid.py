"""Offline regression suite for word-independent Indic acoustic LID.

The tests use synthetic per-window model probabilities, never transcripts,
keywords, translations, or LLM output.  Real model loading is covered by the
container build gate and labelled-audio evaluator.
"""

from pathlib import Path

import pytest
import torch

import acoustic_lid_worker as A
import language_worker as L
import transcribe as T
from scripts import eval_indic_acoustic_lid as E


CORE_LANGUAGES = (
    "English",
    "Hindi",
    "Bengali",
    "Marathi",
    "Assamese",
    "Gujarati",
    "Kannada",
    "Malayalam",
    "Odia",
    "Punjabi",
    "Tamil",
    "Telugu",
)


def _strong_rows(winner: str, runner: str = "English", count: int = 6):
    if runner == winner:
        runner = "Hindi" if winner != "Hindi" else "English"
    return [{winner: 0.92, runner: 0.08} for _ in range(count)]


@pytest.mark.parametrize("language", CORE_LANGUAGES)
def test_every_core_language_can_reach_consensus(language):
    result, debug = A.decide_multiclass(
        _strong_rows(language),
        min_confidence=0.60,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.10,
        strict_confidence=0.72,
        strict_vote_ratio=0.75,
        strict_margin=0.18,
    )
    assert result == language
    assert debug["winner_votes"] == 6


def test_consistent_marathi_acoustics_keep_proven_path():
    result, debug = A.decide_hi_mr([
        (0.08, 0.92),
        (0.20, 0.80),
        (0.35, 0.65),
        (0.15, 0.85),
    ])
    assert result == "Marathi"
    assert debug["mr_votes"] == 4


def test_consistent_hindi_acoustics_stay_hindi():
    result, debug = A.decide_hi_mr([
        (0.95, 0.05),
        (0.78, 0.22),
        (0.70, 0.30),
    ])
    assert result == "Hindi"
    assert debug["hi_votes"] == 3


def test_proven_marathi_gate_ignores_low_confidence_windows():
    result, debug = A.decide_hi_mr([
        (0.05, 0.95),
        (0.10, 0.90),
        (0.51, 0.49),
        (0.49, 0.51),
        (0.52, 0.48),
        (0.48, 0.52),
    ])
    assert result == "Marathi"
    assert debug["mr_votes"] == 2
    assert debug["confident_windows"] == 2


def test_code_switched_windows_abstain():
    result, debug = A.decide_multiclass(
        [
            {"Hindi": 0.90, "Marathi": 0.10},
            {"Marathi": 0.90, "Hindi": 0.10},
            {"Hindi": 0.85, "Marathi": 0.15},
            {"Marathi": 0.85, "Hindi": 0.15},
        ],
        min_confidence=0.60,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.10,
    )
    assert result is None
    assert debug["vote_ratio"] == 0.5


def test_low_confidence_windows_abstain():
    result, debug = A.decide_multiclass(
        [
            {"Gujarati": 0.52, "Hindi": 0.48},
            {"Gujarati": 0.55, "Hindi": 0.45},
            {"Hindi": 0.51, "Gujarati": 0.49},
        ],
        min_confidence=0.60,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.10,
    )
    assert result is None
    assert debug["confident_windows"] == 0


def test_two_strong_windows_out_of_six_cannot_promote():
    result, debug = A.decide_multiclass(
        [{"Gujarati": 0.95, "Hindi": 0.05}] * 2
        + [{"Gujarati": 0.52, "Hindi": 0.48}] * 4,
        min_confidence=0.60,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.10,
    )
    assert result is None
    assert debug["winner_votes"] == 2
    assert debug["usable_windows"] == 6
    assert debug["vote_ratio"] == pytest.approx(2 / 6, abs=0.0001)


def test_extended_ecapa_keeps_absolute_other_language_mass(monkeypatch):
    probabilities = torch.zeros(107)
    probabilities[0] = 0.98
    probabilities[1] = 0.015  # Nepali
    probabilities[2] = 0.005  # Hindi
    log_probabilities = torch.log(probabilities)

    class FakeClassifier:
        def classify_batch(self, _batch, _lengths):
            return (log_probabilities.reshape(1, 1, -1),)

    monkeypatch.setattr(
        A,
        "_ecapa_label_index",
        lambda _classifier, code: {"ne": 1, "hi": 2}[code],
    )
    windows = [torch.zeros(16000)]
    absolute = A._ecapa_window_probabilities(
        FakeClassifier(),
        windows,
        {"Nepali", "Hindi"},
        conditional=False,
    )[0]
    conditional = A._ecapa_window_probabilities(
        FakeClassifier(),
        windows,
        {"Nepali", "Hindi"},
        conditional=True,
    )[0]

    assert absolute["Nepali"] == pytest.approx(0.015, abs=1e-6)
    assert absolute["Other"] == pytest.approx(0.98, abs=1e-6)
    assert conditional["Nepali"] == pytest.approx(0.75, abs=1e-6)


def test_bengali_assamese_requires_strict_confidence():
    result, debug = A.decide_multiclass(
        [{"Assamese": 0.70, "Bengali": 0.30}] * 6,
        min_confidence=0.60,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.10,
        strict_confidence=0.72,
        strict_vote_ratio=0.75,
        strict_margin=0.18,
    )
    assert result is None
    assert debug["thresholds"]["confidence"] == 0.72


def test_dravidian_sibling_split_abstains():
    rows = (
        [{"Tamil": 0.88, "Telugu": 0.12}] * 3
        + [{"Telugu": 0.88, "Tamil": 0.12}] * 3
    )
    result, _debug = A.decide_multiclass(
        rows,
        min_confidence=0.60,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.10,
        strict_confidence=0.72,
        strict_vote_ratio=0.75,
        strict_margin=0.18,
    )
    assert result is None


def test_hindi_punjabi_small_margin_abstains():
    result, debug = A.decide_multiclass(
        [{"Punjabi": 0.58, "Hindi": 0.42}] * 6,
        min_confidence=0.55,
        min_votes=2,
        min_vote_ratio=0.67,
        min_margin=0.05,
        strict_confidence=0.55,
        strict_vote_ratio=0.75,
        strict_margin=0.18,
    )
    assert result is None
    assert debug["confident_windows"] == 0


def test_kannada_rescue_accepts_two_confident_winners_on_one_channel():
    result, debug = A.decide_kannada_rescue([
        {"Kannada": 0.91, "Telugu": 0.09},
        {"Kannada": 0.86, "Tamil": 0.14},
        {"Telugu": 0.64, "Kannada": 0.10, "Tamil": 0.26},
        {"English": 0.70, "Kannada": 0.05, "Bengali": 0.02},
        {"Konkani": 0.60, "Kannada": 0.05, "Bengali": 0.03},
        {"Hindi": 0.70, "Kannada": 0.03, "Bengali": 0.02},
    ])
    assert result == "Kannada"
    assert debug["qualified_channel"] == 0


def test_kannada_rescue_accepts_split_tulu_telugu_support_lane():
    result, debug = A.decide_kannada_rescue([
        {"Telugu": 0.55, "Kannada": 0.25, "Tamil": 0.20},
        {"Telugu": 0.60, "Kannada": 0.20, "Tamil": 0.20},
        {"Telugu": 0.65, "Kannada": 0.15, "Tamil": 0.20},
        {"Kannada": 0.38, "Tulu": 0.34, "Telugu": 0.14, "Bengali": 0.01},
        {"Malvani": 0.28, "Konkani": 0.21, "Kannada": 0.08, "Bengali": 0.02},
        {"Tulu": 0.36, "Kannada": 0.28, "Tamil": 0.17, "Bengali": 0.01},
    ])
    assert result == "Kannada"
    assert debug["qualified_channel"] == 1
    assert debug["channels"][1]["max_competing_votes"] == 1


def test_kannada_rescue_rejects_true_bengali_evidence():
    result, debug = A.decide_kannada_rescue([
        {"Bengali": 0.88, "Kannada": 0.05, "Assamese": 0.07},
        {"Bengali": 0.82, "Kannada": 0.08, "Assamese": 0.10},
        {"Kannada": 0.30, "Bengali": 0.28, "Assamese": 0.22},
    ])
    assert result is None
    assert debug["reason"] == "insufficient_kannada_evidence"


def test_kannada_rescue_rejects_consistent_telugu_winner():
    result, debug = A.decide_kannada_rescue([
        {"Telugu": 0.70, "Kannada": 0.25, "Tamil": 0.05},
        {"Telugu": 0.72, "Kannada": 0.23, "Tamil": 0.05},
        {"Telugu": 0.68, "Kannada": 0.27, "Tamil": 0.05},
    ])
    assert result is None
    assert debug["channels"][0]["max_competing_votes"] == 3


def _patch_acoustic_outputs(
    monkeypatch,
    *,
    core=None,
    core_winner=None,
    hi_mr="Hindi",
    extended=None,
    core_probs=None,
):
    rows = core_probs if core_probs is not None else [{"Hindi": 1.0}]
    monkeypatch.setattr(A, "_extract_windows", lambda _path: [torch.zeros(16000)])
    monkeypatch.setattr(A, "_load_core_classifier", lambda: (object(), object()))
    monkeypatch.setattr(A, "_load_ecapa_classifier", lambda: object())
    monkeypatch.setattr(
        A,
        "_core_decision",
        lambda _processor, _model, _windows: (
            core,
            {"winner": core_winner or core, "mean_confidence": 0.90},
            rows,
        ),
    )
    monkeypatch.setattr(
        A,
        "_ecapa_decisions",
        lambda _classifier, _windows: (
            hi_mr,
            {"winner": hi_mr, "mean_confidence": 0.90},
            extended,
            {"winner": extended, "mean_confidence": 0.90},
            [{"Hindi": 1.0}],
        ),
    )


def test_bengali_kannada_confusion_uses_narrow_vaani_rescue(monkeypatch):
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(
        A,
        "LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES",
        {"Marathi", "Tamil"},
    )
    monkeypatch.setattr(A, "_load_vaani_classifier", lambda: (object(), object()))
    monkeypatch.setattr(
        A,
        "_vaani_window_probabilities",
        lambda _processor, _model, _windows: [
            {"Kannada": 0.90, "Telugu": 0.10},
            {"Kannada": 0.85, "Tamil": 0.15},
            {"Telugu": 0.70, "Kannada": 0.10, "Tamil": 0.20},
        ],
    )
    # Rescue stays available when Vakgyata is NOT hearing Hindi. Hindi mass
    # above Kannada mass must not be turned into Kannada.
    _patch_acoustic_outputs(
        monkeypatch,
        core=None,
        core_winner="Punjabi",
        hi_mr=None,
        core_probs=[
            {"Telugu": 0.34, "Kannada": 0.22, "Bengali": 0.18, "Hindi": 0.04},
            {"Kannada": 0.28, "Tamil": 0.24, "Bengali": 0.16, "Hindi": 0.05},
            {"Bengali": 0.30, "Kannada": 0.20, "Telugu": 0.18, "Hindi": 0.04},
        ],
    )
    result, details = A.verify_acoustic_language(Path("call.wav"), "Bengali")
    assert result == "Kannada"
    assert details["recommendation_source"] == "vaani-kannada-rescue"
    assert details["kannada_rescue_triggered"] is True


def test_hindi_mass_blocks_false_kannada_rescue(monkeypatch):
    """Audio_082 shape: Hindi speech, Vaani still answers Kannada."""
    _patch_acoustic_outputs(
        monkeypatch,
        core=None,
        core_winner="Punjabi",
        hi_mr="Hindi",
        core_probs=[
            {"Punjabi": 0.945, "Hindi": 0.052, "Kannada": 0.0},
            {"Gujarati": 0.62, "Hindi": 0.355, "Kannada": 0.0},
            {"Punjabi": 0.944, "Hindi": 0.015, "Kannada": 0.0},
            {"Telugu": 0.318, "Hindi": 0.133, "Kannada": 0.0},
            {"Hindi": 0.881, "Bengali": 0.016, "Kannada": 0.0},
            {"Bengali": 0.936, "Hindi": 0.022, "Kannada": 0.0},
        ],
    )
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(A, "_load_vaani_classifier", lambda: (object(), object()))
    monkeypatch.setattr(
        A,
        "_vaani_window_probabilities",
        lambda _processor, _model, _windows: [
            {"Kannada": 0.90, "Telugu": 0.10},
            {"Kannada": 0.88, "Tamil": 0.12},
            {"Kannada": 0.80, "Telugu": 0.20},
        ],
    )
    result, details = A.verify_acoustic_language(Path("call.wav"), "Bengali")
    assert result == "Hindi"
    assert details["recommendation_source"] == "vakgyata-hindi-over-kannada"
    assert details["final"] == "Hindi"


def test_upstream_kannada_label_rejected_when_audio_is_hindi(monkeypatch):
    _patch_acoustic_outputs(
        monkeypatch,
        core=None,
        core_winner="Punjabi",
        hi_mr="Hindi",
        core_probs=[
            {"Punjabi": 0.90, "Hindi": 0.08, "Kannada": 0.0},
            {"Hindi": 0.70, "Gujarati": 0.20, "Kannada": 0.01},
            {"Hindi": 0.62, "Bengali": 0.10, "Kannada": 0.0},
        ],
    )
    result, details = A.verify_acoustic_language(Path("call.wav"), "Kannada")
    assert result == "Hindi"
    assert details["decision_source"] == "vakgyata-hindi-over-kannada"


def test_kannada_rescue_does_not_run_for_working_languages(monkeypatch):
    _patch_acoustic_outputs(
        monkeypatch,
        core=None,
        core_winner="Punjabi",
        hi_mr=None,
    )
    monkeypatch.setattr(
        A,
        "_load_vaani_classifier",
        lambda: (_ for _ in ()).throw(AssertionError("rescue must not run")),
    )
    for upstream in ("Hindi", "Marathi", "Tamil", "English"):
        result, details = A.verify_acoustic_language(Path("call.wav"), upstream)
        assert result == upstream
        assert details["kannada_rescue_triggered"] is False


def test_shadow_mode_recommends_without_changing_hindi(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Gujarati")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES", {"Marathi"})
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Hindi"
    assert details["recommendation"] == "Gujarati"
    assert details["applied"] is False


def test_closed_set_hi_mr_cannot_override_different_core_language_in_shadow(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Gujarati", hi_mr="Marathi")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES", {"Marathi"})
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Hindi"
    assert details["baseline"] == "Hindi"
    assert details["recommendation"] == "Gujarati"


def test_primary_core_winner_vetoes_false_marathi_closed_set_result(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="English", hi_mr="Marathi")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES", {"Marathi"})
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Hindi"
    assert details["recommendation"] is None


def test_apply_mode_promotes_strong_regional_winner(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Odia")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "apply")
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Odia"
    assert details["applied"] is True
    assert details["decision_confidence"] == pytest.approx(0.90)


def test_shadow_mode_keeps_proven_marathi_live(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Marathi", hi_mr="Marathi")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES", {"Marathi"})
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Marathi"
    assert details["recommendation_source"] == "vakgyata+ecapa"
    assert details["decision_confidence"] == pytest.approx(0.90)


@pytest.mark.parametrize("language", ("Tamil", "Kannada"))
def test_shadow_mode_keeps_proven_regional_language_live(monkeypatch, language):
    kannada_probs = [
        {"Kannada": 0.86, "Hindi": 0.06, "Telugu": 0.05},
        {"Kannada": 0.81, "Hindi": 0.07, "Tamil": 0.06},
    ]
    _patch_acoustic_outputs(
        monkeypatch,
        core=language,
        hi_mr="Hindi",
        core_probs=kannada_probs if language == "Kannada" else None,
    )
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    monkeypatch.setattr(
        A,
        "LANG_INDIC_ACOUSTIC_PROVEN_APPLY_LANGUAGES",
        {"Marathi", "Tamil", "Kannada"},
    )
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == language
    assert details["recommendation_source"] == "vakgyata"
    assert details["applied"] is True


def test_decide_hi_bn_majority_is_hindi():
    decision, debug = A.decide_hi_bn([
        {"Hindi": 0.70, "Bengali": 0.22},
        {"Hindi": 0.66, "Bengali": 0.25},
        {"Hindi": 0.62, "Bengali": 0.30},
    ])
    assert decision == "Hindi"
    assert debug["hi_votes"] == 3


def test_decide_hi_bn_keeps_bengali():
    decision, _debug = A.decide_hi_bn([
        {"Hindi": 0.20, "Bengali": 0.74},
        {"Hindi": 0.18, "Bengali": 0.70},
        {"Hindi": 0.25, "Bengali": 0.68},
    ])
    assert decision == "Bengali"


def test_moderate_hindi_vote_corrects_false_bengali(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core=None, hi_mr=None)
    monkeypatch.setattr(
        A,
        "_core_decision",
        lambda _processor, _model, _windows: (
            None,
            {"winner": "Hindi", "reason": "insufficient_consensus", "mean_confidence": 0.66},
            [
                {"Hindi": 0.70, "Bengali": 0.22, "English": 0.08},
                {"Hindi": 0.66, "Bengali": 0.25, "English": 0.09},
                {"Hindi": 0.62, "Bengali": 0.30, "English": 0.08},
            ],
        ),
    )
    result, details = A.verify_acoustic_language(Path("call.wav"), "Bengali")
    assert result == "Hindi"
    assert details["decision_source"] == "vakgyata-hindi-over-bengali"


def test_decided_bengali_core_is_not_overruled(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Bengali", hi_mr=None)
    monkeypatch.setattr(
        A,
        "_core_decision",
        lambda _processor, _model, _windows: (
            "Bengali",
            {"winner": "Bengali", "mean_confidence": 0.90},
            [
                {"Hindi": 0.20, "Bengali": 0.74},
                {"Hindi": 0.18, "Bengali": 0.70},
                {"Hindi": 0.22, "Bengali": 0.71},
            ],
        ),
    )
    result, details = A.verify_acoustic_language(Path("call.wav"), "Bengali")
    assert result == "Bengali"
    assert details["decision_source"] != "vakgyata-hindi-over-bengali"


def test_vakgyata_hindi_corrects_false_bengali(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Hindi", hi_mr="Hindi")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    result, details = A.verify_acoustic_language(Path("call.wav"), "Bengali")
    assert result == "Hindi"
    assert details["decision_source"] == "vakgyata-hindi-over-bengali"
    assert details["applied"] is True


def test_bengali_core_does_not_flip_a_hindi_call(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Bengali", hi_mr="Hindi")
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Hindi"
    assert details["recommendation"] is None


def test_upstream_marathi_survives_acoustic_abstention(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core=None, hi_mr=None)
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "shadow")
    result, details = A.verify_acoustic_language(Path("call.wav"), "Marathi")
    assert result == "Marathi"
    assert details["baseline"] == "Marathi"
    assert details["recommendation"] is None


@pytest.mark.parametrize("upstream", ("English", "Hindi", "Bengali"))
def test_primary_languages_never_false_promote_on_primary_winner(monkeypatch, upstream):
    other_primary = {"English": "Hindi", "Hindi": "Bengali", "Bengali": "English"}[upstream]
    _patch_acoustic_outputs(monkeypatch, core=other_primary)
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "apply")
    result, details = A.verify_acoustic_language(Path("call.wav"), upstream)
    assert result == upstream
    assert details["recommendation"] is None


def test_extended_ecapa_language_can_promote_in_apply_mode(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Hindi", extended="Nepali")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "apply")
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Nepali"
    assert details["recommendation_source"] == "ecapa-extended"


def test_conflicting_models_abstain(monkeypatch):
    _patch_acoustic_outputs(monkeypatch, core="Gujarati", extended="Nepali")
    monkeypatch.setattr(A, "LANG_INDIC_ACOUSTIC_MODE", "apply")
    result, details = A.verify_acoustic_language(Path("call.wav"), "Hindi")
    assert result == "Hindi"
    assert details["recommendation"] is None
    assert details["recommendation_source"] == "model_conflict"


def test_model_failure_preserves_upstream_language(monkeypatch):
    monkeypatch.setattr(
        A,
        "_extract_windows",
        lambda _path: (_ for _ in ()).throw(RuntimeError("model unavailable")),
    )
    result, details = A.verify_acoustic_language(Path("missing.wav"), "Bengali")
    assert result == "Bengali"
    assert details["reason"] == "error"


def test_language_worker_accepts_decisive_acoustic_label_without_remap(monkeypatch):
    monkeypatch.setattr(L, "LANG_INDIC_ACOUSTIC_ENABLED", True)
    monkeypatch.setattr(
        A,
        "verify_acoustic_language",
        lambda _path, upstream: ("Assamese", {"upstream": upstream}),
    )
    assert L._verify_indic_acoustic(Path("call.wav"), "Bengali") == "Assamese"


def test_language_worker_failure_keeps_existing_primary(monkeypatch):
    monkeypatch.setattr(L, "LANG_INDIC_ACOUSTIC_ENABLED", True)
    monkeypatch.setattr(
        A,
        "verify_acoustic_language",
        lambda _path, upstream: (upstream, {"reason": "model unavailable"}),
    )
    assert L._verify_indic_acoustic(Path("missing.wav"), "English") == "English"
    assert L._verify_indic_acoustic(Path("missing.wav"), "Hindi") == "Hindi"
    assert L._verify_indic_acoustic(Path("missing.wav"), "Bengali") == "Bengali"


def test_detect_language_runs_acoustic_stage_after_upstream(monkeypatch):
    monkeypatch.setattr(
        L,
        "detect_language_upstream",
        lambda _path, max_seconds=30: "Bengali",
    )
    monkeypatch.setattr(
        L,
        "finalize_language_acoustically",
        lambda _path, upstream: "Assamese" if upstream == "Bengali" else upstream,
    )
    assert L.detect_language(Path("call.wav")) == "Assamese"


@pytest.mark.parametrize(
    "language",
    (
        "Hindi",
        "Bengali",
        "Marathi",
        "Assamese",
        "Gujarati",
        "Kannada",
        "Malayalam",
        "Odia",
        "Punjabi",
        "Tamil",
        "Telugu",
        "Urdu",
        "Nepali",
        "Sanskrit",
        "Sindhi",
    ),
)
def test_all_indic_display_names_route_to_seamless_in_production(monkeypatch, language):
    monkeypatch.setattr(T, "NEMO_ASR_LANGUAGES", {"English"})
    monkeypatch.setattr(T, "NEMOTRON_ASR_LANGUAGES", set())
    monkeypatch.setattr(T, "FASTER_WHISPER_ASR_LANGUAGES", set())
    monkeypatch.setattr(T, "SEAMLESS_M4T_ENABLED", True)
    monkeypatch.setattr(T, "AI_DISTRIBUTED", True)
    monkeypatch.setattr(T, "_SEAMLESS_REMOTE_DISABLED", False)
    monkeypatch.setattr(
        T,
        "asr_service_health",
        lambda service: {"ready": service == "seamless"},
    )
    assert T._resolve_asr_backend(language, "nemo") == "seamless-m4t"


def test_english_remains_on_nemo(monkeypatch):
    monkeypatch.setattr(T, "NEMO_ASR_LANGUAGES", {"English"})
    monkeypatch.setattr(T, "NEMOTRON_ASR_LANGUAGES", set())
    monkeypatch.setattr(T, "FASTER_WHISPER_ASR_LANGUAGES", set())
    monkeypatch.setattr(T, "SEAMLESS_M4T_ENABLED", True)
    assert T._resolve_asr_backend("English", "nemo") == "nemo"


def test_offline_evaluator_reports_primary_false_promotion(monkeypatch, tmp_path):
    audio = tmp_path / "hindi.wav"
    audio.write_bytes(b"fixture")
    manifest = tmp_path / "manifest.csv"
    manifest.write_text(
        "path,expected,upstream\nhindi.wav,Hindi,Hindi\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(
        E,
        "verify_acoustic_language",
        lambda _path, _upstream: (
            "Hindi",
            {
                "recommendation": "Gujarati",
                "applied": False,
                "recommendation_source": "vakgyata",
                "windows": 6,
            },
        ),
    )
    report = E.evaluate(manifest)
    assert report["primary_false_promotion_count"] == 1
    assert report["per_language"]["Hindi"]["abstentions"] == 0


def test_offline_evaluator_enforces_golden_minimums():
    failures = E.golden_failures({
        "per_language": {
            "Hindi": {"calls": 39},
            "English": {"calls": 40},
            "Bengali": {"calls": 40},
            "Marathi": {"calls": 40},
            "Gujarati": {"calls": 19},
        },
        "primary_false_promotion_count": 0,
    })
    assert any("Hindi" in failure for failure in failures)
    assert any("Gujarati" in failure for failure in failures)
