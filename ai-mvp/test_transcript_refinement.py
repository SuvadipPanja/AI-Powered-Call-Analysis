"""Unit tests for Transcript Refinement Agent validators and merge logic."""

import json

import pytest

from transcript_refinement_agent import (
    RefinementAudit,
    _deterministic_validate,
    _filter_issues,
    _issue_line_set,
    _lines_to_transcript,
    _merge_approved,
    _parse_transcript,
    _reject_digit_invention,
    refinement_for_english,
    refinement_for_native,
)


PULKIT_TRANSCRIPT = """\
0.0 - 8.0 (Customer): my name is fulkid and my postcard number is 9854281137
8.0 - 14.0 (Agent): thank you mister police for providing your name and registered mobile number how may i assist you"""


ICON_PATTERN_TRANSCRIPT = """\
0.0 - 6.0 (Customer): hello charlie can you tell me my icon pattern
6.0 - 12.0 (Agent): yes sir as i understood that you want to know your account balance we definitely help you regarding this"""


def test_parse_transcript_lines():
    ordered, batch = _parse_transcript(PULKIT_TRANSCRIPT)
    assert len(batch) == 2
    assert batch[0][1] == "Customer"
    assert "fulkid" in batch[0][2]


def test_filter_issues_by_confidence():
    audit = {
        "issues": [
            {"issue_id": "I1", "confidence": 0.9, "lines": [1, 2]},
            {"issue_id": "I2", "confidence": 0.2, "lines": [3]},
        ]
    }
    kept = _filter_issues(audit, 0.55)
    assert len(kept["issues"]) == 1
    assert kept["issues"][0]["issue_id"] == "I1"


def test_reject_digit_invention():
    assert _reject_digit_invention(
        "my number is nine eight five",
        "my number is 1234567890123456",
        "thank you for calling",
    )


def test_deterministic_validate_accepts_name_fix():
    issue_lines = {1, 2}
    corr = {
        "line": 2,
        "issue_id": "I1",
        "corrected": "thank you Mr Pulkit for providing your name and registered mobile number",
    }
    original = "thank you mister police for providing your name and registered mobile number"
    ok, _ = _deterministic_validate(corr, original, issue_lines, PULKIT_TRANSCRIPT)
    assert ok


def test_deterministic_rejects_line_not_in_issue():
    corr = {"line": 99, "issue_id": "I1", "corrected": "hello"}
    ok, reason = _deterministic_validate(corr, "x", {1, 2}, "")
    assert not ok
    assert "not in auditor" in reason


def test_merge_partial_name_fix_rejected():
    batch = [(1, "Customer", "fulkid"), (2, "Agent", "mister police")]
    originals = {1: "my name is fulkid", 2: "thank you mister police"}
    corrections = [
        {
            "line": 2,
            "issue_id": "I1",
            "corrected": "thank you Mr Pulkit",
            "edit_type": "name_alignment",
        },
    ]
    verifier = {
        "decisions": [
            {"line": 2, "issue_id": "I1", "decision": "approve", "reason": "ok"},
        ]
    }
    audit = RefinementAudit(language="English", issues=[
        {"issue_id": "I1", "type": "name_mismatch", "lines": [1, 2]},
    ])
    applied = _merge_approved(
        batch, originals, corrections, verifier, {1, 2}, audit,
    )
    assert applied == {}
    assert any("partial name fix" in (r.get("reason") or "") for r in audit.rejected)


def test_merge_full_name_fix_applied():
    batch = [(1, "Customer", "fulkid"), (2, "Agent", "mister police")]
    originals = {
        1: "my name is fulkid and my postcard number is 9854281137",
        2: "thank you mister police for providing your name and registered mobile number",
    }
    corrections = [
        {
            "line": 1,
            "issue_id": "I1",
            "corrected": "my name is Pulkit and my mobile number is 9854281137",
            "edit_type": "name_alignment",
        },
        {
            "line": 2,
            "issue_id": "I1",
            "corrected": "thank you Mr Pulkit for providing your name and registered mobile number",
            "edit_type": "name_alignment",
        },
    ]
    verifier = {
        "decisions": [
            {"line": 1, "issue_id": "I1", "decision": "approve", "reason": "ok"},
            {"line": 2, "issue_id": "I1", "decision": "approve", "reason": "ok"},
        ]
    }
    audit = RefinementAudit(language="English", issues=[
        {"issue_id": "I1", "type": "name_mismatch", "lines": [1, 2]},
    ])
    applied = _merge_approved(
        batch, originals, corrections, verifier, {1, 2}, audit,
    )
    assert 1 in applied and 2 in applied
    assert "Pulkit" in applied[2]


def test_lines_to_transcript_roundtrip():
    ordered, batch = _parse_transcript(PULKIT_TRANSCRIPT)
    texts = {idx: text for idx, _, text in batch}
    out = _lines_to_transcript(ordered, texts)
    assert "fulkid" in out
    assert "(Customer):" in out


def test_golden_fixtures_file_exists():
    path = "test_data/transcript_refinement_golden.json"
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        pytest.skip("golden file optional in CI")
    assert isinstance(data, list)
    assert len(data) >= 3


@pytest.mark.parametrize("lang,expected", [
    ("Hindi", True),
    ("English", False),
])
def test_refinement_for_native(monkeypatch, lang, expected):
    monkeypatch.setenv("TRANSCRIPT_REFINEMENT_ENABLED", "true")
    monkeypatch.setenv("TRANSCRIPT_REFINEMENT_NATIVE", "true")
    import importlib
    import config
    import transcript_refinement_agent as tra
    importlib.reload(config)
    importlib.reload(tra)
    assert tra.refinement_for_native(lang) is expected


def test_refinement_for_english(monkeypatch):
    monkeypatch.setenv("TRANSCRIPT_REFINEMENT_ENABLED", "true")
    monkeypatch.setenv("TRANSCRIPT_REFINEMENT_ENGLISH", "true")
    import importlib
    import config
    import transcript_refinement_agent as tra
    importlib.reload(config)
    importlib.reload(tra)
    assert tra.refinement_for_english() is True
