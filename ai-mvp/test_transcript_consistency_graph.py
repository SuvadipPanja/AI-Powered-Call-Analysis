"""Tests for Step 0 consistency pre-audit graph."""

from transcript_consistency_graph import (
    apply_deterministic_pre_audit_fixes,
    detect_pre_audit_issues,
    merge_audit_reports,
    _name_similar,
)
from transcript_refinement_agent import _parse_transcript

PULKIT = """\
0.0 - 8.0 (Customer): my name is fulkid and my postcard number is 9854281137
8.0 - 14.0 (Agent): thank you mister police for providing your name and registered mobile number how may i assist you"""

ICON = """\
0.0 - 6.0 (Customer): hello charlie can you tell me my icon pattern
6.0 - 12.0 (Agent): yes sir as i understood that you want to know your account balance we definitely help you regarding this
12.0 - 18.0 (Agent): manual good name sir for your account safety
18.0 - 24.0 (Customer): my name is leonardo daphne"""

CHARLIE_AGENT = """\
0.0 - 6.0 (Agent): welcome to x y z bank my name is charlie how may i assist you
6.0 - 12.0 (Customer): hello charlie can you tell me my icon pattern
12.0 - 18.0 (Agent): yes sir as i understood that you want to know your account balance we definitely help you regarding this
18.0 - 24.0 (Agent): manual good name sir for your account safety"""

XYZ = """\
0.0 - 6.0 (Agent): Hello welcome to XYZ Bank I am Vinod How can I assist you
6.0 - 14.0 (Customer): Yes big Papa I can't access my account balance"""


def _batch(transcript: str):
    _, batch = _parse_transcript(transcript)
    return batch


def test_pulkit_pre_audit_name_mismatch():
    _, issues = detect_pre_audit_issues(_batch(PULKIT))
    types = {i["type"] for i in issues}
    assert "name_mismatch" in types
    assert any("postcard" in str(i.get("type")) or i.get("type") == "entity_label_mismatch" for i in issues)


def test_icon_pattern_pre_audit():
    _, issues = detect_pre_audit_issues(_batch(ICON))
    assert any(i["type"] == "phrase_mismatch" for i in issues)


def test_big_papa_honorific():
    _, issues = detect_pre_audit_issues(_batch(XYZ))
    assert any(i["type"] == "honorific_error" for i in issues)


def test_merge_pre_audit_with_empty_llm():
    pre_e, pre_i = detect_pre_audit_issues(_batch(PULKIT))
    merged = merge_audit_reports({"issues": [], "entities": []}, pre_e, pre_i)
    assert len(merged["issues"]) >= 1


def test_name_similar_phonetic():
    assert _name_similar("Deep Gadhuli", "Deepak Adhikari") > 0.45


def test_verifier_fallback_merge():
    from transcript_refinement_agent import RefinementAudit, _merge_approved

    batch = _batch(PULKIT)
    originals = {1: batch[0][2], 2: batch[1][2]}
    corrections = [
        {
            "line": 1,
            "issue_id": "I1",
            "corrected": "my name is Pulkit and my mobile number is 9854281137",
        },
        {
            "line": 2,
            "issue_id": "I1",
            "corrected": "thank you Mr Pulkit for providing your name and registered mobile number",
        },
    ]
    audit = RefinementAudit(language="English", issues=[
        {"issue_id": "I1", "type": "name_mismatch", "lines": [1, 2]},
    ])
    applied = _merge_approved(
        batch, originals, corrections, {"decisions": []}, {1, 2}, audit,
        verifier_fallback=True,
    )
    assert len(applied) == 2


def test_deterministic_icon_pattern_fix():
    _, batch = _parse_transcript(ICON)
    originals = {idx: text for idx, _, text in batch}
    entities, issues = detect_pre_audit_issues(batch)
    updates, fixed = apply_deterministic_pre_audit_fixes(batch, originals, issues, entities)
    assert updates[1] != originals[1]
    assert "account balance" in updates[1].lower()
    assert "icon pattern" not in updates[1].lower()
    assert len(fixed) >= 1


def test_deterministic_manual_good_name_fix():
    _, batch = _parse_transcript(ICON)
    originals = {idx: text for idx, _, text in batch}
    entities, issues = detect_pre_audit_issues(batch)
    updates, _ = apply_deterministic_pre_audit_fixes(batch, originals, issues, entities)
    assert "may i know your name" in updates[3].lower()
    assert "manual good name" not in updates[3].lower()


def test_deterministic_pulkit_postcard():
    _, batch = _parse_transcript(PULKIT)
    originals = {idx: text for idx, _, text in batch}
    entities, issues = detect_pre_audit_issues(batch)
    updates, _ = apply_deterministic_pre_audit_fixes(batch, originals, issues, entities)
    assert "postcard" not in updates[1].lower()
    assert "mobile" in updates[1].lower()


def test_agent_intro_charlie_not_corrupted():
    _, batch = _parse_transcript(CHARLIE_AGENT)
    originals = {idx: text for idx, _, text in batch}
    entities, issues = detect_pre_audit_issues(batch)
    updates, _ = apply_deterministic_pre_audit_fixes(batch, originals, issues, entities)
    assert updates[1] == originals[1]
    assert "account balance" in updates[2].lower()


def test_refine_fail_open_keeps_deterministic(monkeypatch):
    from transcript_refinement_agent import refine_transcript

    def _boom(*_a, **_k):
        raise RuntimeError("LLM HTTP 400: context length")

    monkeypatch.setenv("TRANSCRIPT_REFINEMENT_PRE_AUDIT_ENABLED", "true")
    import importlib
    import config
    import transcript_refinement_agent as tra
    importlib.reload(config)
    importlib.reload(tra)
    monkeypatch.setattr(tra, "_run_auditor", _boom)
    out, audit = tra.refine_transcript(CHARLIE_AGENT, "English")
    assert audit.deterministic_applied >= 2
    assert audit.corrections_applied >= 2
    assert "account balance" in out.lower()
    assert "icon pattern" not in out.lower()
    assert "may i know your name" in out.lower()
