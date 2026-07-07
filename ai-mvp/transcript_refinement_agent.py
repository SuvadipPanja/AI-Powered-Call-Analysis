"""3-step Transcript Refinement Agent — Auditor → Fixer → Verifier.

Production-grade cross-turn transcript repair for diarized call-center ASR.
Uses local Qwen via ollama_generate; fail-open on any step failure.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any

from bank_config import get_bank_config
from config import (
    TRANSCRIPT_REFINEMENT_ENABLED,
    TRANSCRIPT_REFINEMENT_ENGLISH,
    TRANSCRIPT_REFINEMENT_FULL_CALL_MAX_LINES,
    TRANSCRIPT_REFINEMENT_LANGUAGES,
    TRANSCRIPT_REFINEMENT_MIN_ISSUE_CONFIDENCE,
    TRANSCRIPT_REFINEMENT_NATIVE,
    TRANSCRIPT_REFINEMENT_PRE_AUDIT_ENABLED,
    TRANSCRIPT_REFINEMENT_VERIFIER_FALLBACK,
)
from llm_utils import is_meta_line, strip_llm_thinking
from prompts.transcript_refinement import (
    REFINEMENT_FULL_CALL_MAX_LINES,
    auditor_system_prompt,
    auditor_user_prompt,
    fixer_system_prompt,
    fixer_user_prompt,
    fixer_issue_prompt,
    verifier_system_prompt,
    verifier_user_prompt,
)
from scoring_worker import ollama_generate
from transcript_consistency_graph import (
    apply_deterministic_pre_audit_fixes,
    detect_pre_audit_issues,
    merge_audit_reports,
)
from transcript_cleanup_worker import (
    LINE_RE,
    SPEAKER_RE,
    _digit_count,
    _is_correctable,
    _is_repetitive_line,
)

logger = logging.getLogger(__name__)


@dataclass
class ParsedLine:
    prefix: str | None
    speaker: str
    text: str
    idx: int | None  # 1-based speech index


@dataclass
class RefinementAudit:
    language: str
    issues_found: int = 0
    corrections_proposed: int = 0
    corrections_applied: int = 0
    entities: list[dict[str, Any]] = field(default_factory=list)
    issues: list[dict[str, Any]] = field(default_factory=list)
    applied: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)
    pre_audit_issues: int = 0
    deterministic_applied: int = 0
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "issues_found": self.issues_found,
            "pre_audit_issues": self.pre_audit_issues,
            "deterministic_applied": self.deterministic_applied,
            "corrections_proposed": self.corrections_proposed,
            "corrections_applied": self.corrections_applied,
            "entities": self.entities,
            "issues": self.issues,
            "applied": self.applied,
            "rejected": self.rejected,
            "error": self.error,
        }


def refinement_enabled() -> bool:
    return TRANSCRIPT_REFINEMENT_ENABLED


def refinement_supported(language: str) -> bool:
    return (language or "").strip() in TRANSCRIPT_REFINEMENT_LANGUAGES


def refinement_for_native(language: str) -> bool:
    return (
        refinement_enabled()
        and TRANSCRIPT_REFINEMENT_NATIVE
        and refinement_supported(language)
        and (language or "").strip() != "English"
    )


def refinement_for_english() -> bool:
    return refinement_enabled() and TRANSCRIPT_REFINEMENT_ENGLISH


def _speaker_from_prefix(prefix: str) -> str:
    m = SPEAKER_RE.search(prefix or "")
    return m.group(1).strip() if m else "Speaker"


def _parse_json_object(raw: str) -> dict[str, Any]:
    cleaned = strip_llm_thinking(raw).strip()
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end == -1:
        return {}
    try:
        data = json.loads(cleaned[start : end + 1])
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def _parse_transcript(transcript: str) -> tuple[list[ParsedLine], list[tuple[int, str, str]]]:
    """Return ordered lines and batch items (idx, speaker, text)."""
    ordered: list[ParsedLine] = []
    batch: list[tuple[int, str, str]] = []
    for raw_line in (transcript or "").strip().splitlines():
        line = raw_line.strip()
        if not line:
            continue
        match = LINE_RE.match(line)
        if match:
            prefix, speech = match.group(1), match.group(2).strip()
            if _is_correctable(speech) and not _is_repetitive_line(speech):
                idx = len(batch) + 1
                speaker = _speaker_from_prefix(prefix)
                batch.append((idx, speaker, speech))
                ordered.append(ParsedLine(prefix, speaker, speech, idx))
            else:
                ordered.append(ParsedLine(prefix, _speaker_from_prefix(prefix), speech, None))
        else:
            ordered.append(ParsedLine(None, "Speaker", line, None))
    return ordered, batch


def _lines_to_transcript(ordered: list[ParsedLine], texts: dict[int, str]) -> str:
    out: list[str] = []
    for pl in ordered:
        if pl.idx and pl.idx in texts:
            speech = texts[pl.idx]
        elif pl.idx:
            speech = pl.text
        else:
            speech = pl.text
        if pl.prefix is not None:
            out.append(f"{pl.prefix} {speech}".rstrip())
        else:
            out.append(speech)
    return "\n".join(out).strip()


def _filter_issues(audit: dict[str, Any], min_conf: float) -> dict[str, Any]:
    issues = audit.get("issues") or []
    if not isinstance(issues, list):
        issues = []
    kept = [
        i for i in issues
        if isinstance(i, dict)
        and float(i.get("confidence") or 0) >= min_conf
        and i.get("lines")
    ]
    out = dict(audit)
    out["issues"] = kept
    return out


def _issue_line_set(audit: dict[str, Any]) -> set[int]:
    lines: set[int] = set()
    for issue in audit.get("issues") or []:
        if not isinstance(issue, dict):
            continue
        for ln in issue.get("lines") or []:
            try:
                lines.add(int(ln))
            except (TypeError, ValueError):
                continue
    return lines


def _all_speech_text(batch: list[tuple[int, str, str]]) -> str:
    return " ".join(t for _, _, t in batch)


def _reject_digit_invention(
    original: str,
    corrected: str,
    context_blob: str,
) -> bool:
    orig_d = _digit_count(original)
    new_d = _digit_count(corrected)
    if new_d <= orig_d + 5:
        return False
    ctx_d = _digit_count(context_blob)
    return new_d > ctx_d + 2


def _deterministic_validate(
    correction: dict[str, Any],
    original: str,
    issue_lines: set[int],
    context_blob: str,
) -> tuple[bool, str]:
    try:
        line_no = int(correction.get("line"))
    except (TypeError, ValueError):
        return False, "missing line number"
    if line_no not in issue_lines:
        return False, "line not in auditor issues"
    corrected = str(correction.get("corrected") or "").strip()
    if not corrected or is_meta_line(corrected):
        return False, "empty or meta correction"
    if corrected == original:
        return False, "unchanged"
    if _reject_digit_invention(original, corrected, context_blob):
        return False, "digit invention blocked"
    if len(corrected) > len(original) * 2 + 40:
        return False, "correction too long vs original"
    return True, "ok"


def _run_auditor(
    batch: list[tuple[int, str, str]],
    language: str,
) -> dict[str, Any]:
    cfg = get_bank_config()
    system = auditor_system_prompt(language)
    prompt = auditor_user_prompt(
        batch,
        language,
        glossary_block=cfg.glossary_block(max_items=25),
        products=cfg.product_terms_line(),
    )
    raw = ollama_generate(
        prompt, system=system, json_mode=True, max_tokens=2048, temperature=0.08,
    )
    return _parse_json_object(raw)


def _run_fixer(
    batch: list[tuple[int, str, str]],
    audit: dict[str, Any],
    language: str,
) -> list[dict[str, Any]]:
    if not audit.get("issues"):
        return []
    system = fixer_system_prompt(language)
    prompt = fixer_user_prompt(batch, audit, language)
    raw = ollama_generate(
        prompt, system=system, json_mode=True, max_tokens=2048, temperature=0.05,
    )
    data = _parse_json_object(raw)
    corrections = data.get("corrections")
    if not isinstance(corrections, list):
        corrections = []
    corrections = [c for c in corrections if isinstance(c, dict)]

    # Per-issue retry for name_mismatch if partial line coverage
    covered: set[int] = set()
    for c in corrections:
        try:
            covered.add(int(c.get("line")))
        except (TypeError, ValueError):
            pass
    extra: list[dict[str, Any]] = []
    for issue in audit.get("issues") or []:
        if issue.get("type") != "name_mismatch":
            continue
        need = {int(x) for x in (issue.get("lines") or []) if str(x).isdigit()}
        if need and need.issubset(covered):
            continue
        prompt_i = fixer_issue_prompt(batch, audit, issue, language)
        raw_i = ollama_generate(
            prompt_i, system=system, json_mode=True, max_tokens=1024, temperature=0.05,
        )
        data_i = _parse_json_object(raw_i)
        part = data_i.get("corrections") or []
        if isinstance(part, list):
            extra.extend(c for c in part if isinstance(c, dict))
    corrections.extend(extra)
    return corrections


def _run_verifier(
    batch: list[tuple[int, str, str]],
    audit: dict[str, Any],
    corrections: list[dict[str, Any]],
    language: str,
) -> dict[str, Any]:
    if not corrections:
        return {"decisions": [], "residual_issues": []}
    system = verifier_system_prompt(language)
    prompt = verifier_user_prompt(batch, audit, corrections, language)
    raw = ollama_generate(
        prompt, system=system, json_mode=True, max_tokens=1024, temperature=0.0,
    )
    return _parse_json_object(raw)


def _merge_approved(
    batch: list[tuple[int, str, str]],
    originals: dict[int, str],
    corrections: list[dict[str, Any]],
    verifier: dict[str, Any],
    issue_lines: set[int],
    audit: RefinementAudit,
    *,
    verifier_fallback: bool = True,
) -> dict[int, str]:
    context_blob = _all_speech_text(batch)
    approved_lines: set[int] = set()
    decisions = verifier.get("decisions") or []

    for dec in decisions:
        if not isinstance(dec, dict):
            continue
        if str(dec.get("decision", "")).lower() != "approve":
            audit.rejected.append({
                "line": dec.get("line"),
                "issue_id": dec.get("issue_id"),
                "reason": dec.get("reason") or "verifier rejected",
            })
            continue
        try:
            approved_lines.add(int(dec.get("line")))
        except (TypeError, ValueError):
            continue

    # Verifier fallback: if LLM verifier silent, approve deterministic-safe fixes
    if verifier_fallback and not approved_lines and corrections:
        for corr in corrections:
            try:
                line_no = int(corr.get("line"))
            except (TypeError, ValueError):
                continue
            original = originals.get(line_no, "")
            ok, reason = _deterministic_validate(corr, original, issue_lines, context_blob)
            if ok:
                approved_lines.add(line_no)
                audit.applied.append({
                    "line": line_no,
                    "issue_id": corr.get("issue_id"),
                    "fallback": "verifier_silent",
                    "reason": reason,
                })

    applied: dict[int, str] = {}
    corr_by_line: dict[int, dict[str, Any]] = {}
    for c in corrections:
        if "line" not in c:
            continue
        try:
            corr_by_line[int(c["line"])] = c
        except (TypeError, ValueError):
            continue

    for line_no, corr in corr_by_line.items():
        if line_no not in approved_lines:
            if any(d.get("line") == line_no for d in decisions):
                continue
            audit.rejected.append({
                "line": line_no,
                "issue_id": corr.get("issue_id"),
                "reason": "verifier did not approve",
            })
            continue
        original = originals.get(line_no, "")
        ok, reason = _deterministic_validate(corr, original, issue_lines, context_blob)
        corrected = str(corr.get("corrected") or "").strip()
        if not ok:
            audit.rejected.append({
                "line": line_no,
                "issue_id": corr.get("issue_id"),
                "reason": reason,
            })
            continue
        applied[line_no] = corrected
        if not any(a.get("line") == line_no and a.get("fallback") for a in audit.applied):
            audit.applied.append({
                "line": line_no,
                "issue_id": corr.get("issue_id"),
                "before": original[:120],
                "after": corrected[:120],
                "edit_type": corr.get("edit_type"),
            })
        logger.info(
            "TRA applied line %s (%s): %r -> %r",
            line_no, audit.language, original[:55], corrected[:55],
        )

    # Consistency: for name_mismatch issues, all lines must be fixed together or none
    for issue in audit.issues:
        if issue.get("type") != "name_mismatch":
            continue
        issue_lns = {int(x) for x in (issue.get("lines") or []) if str(x).isdigit()}
        fixed = issue_lns.intersection(applied.keys())
        if fixed and fixed != issue_lns:
            for ln in fixed:
                applied.pop(ln, None)
                audit.rejected.append({
                    "line": ln,
                    "issue_id": issue.get("issue_id"),
                    "reason": "partial name fix rejected — all issue lines must align",
                })
            audit.applied = [a for a in audit.applied if a.get("line") not in issue_lns]

    return applied


def _apply_line_edits(
    transcript: str,
    ordered: list[ParsedLine],
    originals: dict[int, str],
    audit_log: RefinementAudit,
) -> str:
    """Rebuild transcript from edited line map."""
    result = _lines_to_transcript(ordered, originals)
    if result and result != transcript:
        audit_log.corrections_applied = max(
            audit_log.corrections_applied,
            audit_log.deterministic_applied,
        )
        return result
    return transcript


def refine_transcript(transcript: str, language: str) -> tuple[str, RefinementAudit | None]:
    """Run Auditor → Fixer → Verifier. Returns (transcript, audit) — fail-open."""
    audit_log = RefinementAudit(language=language)
    trimmed = (transcript or "").strip()
    if not trimmed:
        return transcript, None

    ordered, batch = _parse_transcript(trimmed)
    if not batch:
        return transcript, None

    full_max = TRANSCRIPT_REFINEMENT_FULL_CALL_MAX_LINES or REFINEMENT_FULL_CALL_MAX_LINES
    if len(batch) > full_max:
        audit_log.error = f"call too long ({len(batch)} lines > {full_max})"
        logger.warning("TRA skipped: %s", audit_log.error)
        return transcript, audit_log

    originals = {idx: text for idx, _, text in batch}

    try:
        pre_entities: list[dict[str, Any]] = []
        pre_issues: list[dict[str, Any]] = []
        if TRANSCRIPT_REFINEMENT_PRE_AUDIT_ENABLED:
            pre_entities, pre_issues = detect_pre_audit_issues(batch)
            audit_log.pre_audit_issues = len(pre_issues)
            det_texts, det_fixed = apply_deterministic_pre_audit_fixes(
                batch, originals, pre_issues, pre_entities,
            )
            det_changed = {
                ln: t for ln, t in det_texts.items()
                if t != originals.get(ln, "")
            }
            if det_changed:
                for ln, after in det_changed.items():
                    before = originals.get(ln, "")
                    audit_log.applied.append({
                        "line": ln,
                        "issue_id": "PRE-DET",
                        "fallback": "deterministic_pre_audit",
                        "before": before[:120],
                        "after": after[:120],
                    })
                originals.update(det_changed)
                batch = [(idx, sp, originals[idx]) for idx, sp, _ in batch]
                audit_log.deterministic_applied = len(det_changed)
                logger.info(
                    "TRA deterministic pre-audit applied %s line(s) for %s",
                    len(det_changed), language,
                )
            # Drop pre-audit issues fully resolved deterministically
            if det_fixed:
                fixed_set = set(det_fixed)
                pre_issues = [i for i in pre_issues if i.get("issue_id") not in fixed_set]

            # All pre-audit issues resolved — skip LLM (avoids token-limit failures)
            if not pre_issues and audit_log.deterministic_applied:
                return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log

        try:
            raw_audit = _run_auditor(batch, language)
        except Exception as aud_exc:  # noqa: BLE001
            audit_log.error = f"auditor: {aud_exc}"
            logger.warning("TRA auditor failed (%s): %s", language, aud_exc)
            if audit_log.deterministic_applied:
                return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log
            return transcript, audit_log

        merged = merge_audit_reports(raw_audit, pre_entities, pre_issues)
        filtered = _filter_issues(merged, TRANSCRIPT_REFINEMENT_MIN_ISSUE_CONFIDENCE)
        audit_log.entities = list(filtered.get("entities") or [])
        audit_log.issues = list(filtered.get("issues") or [])
        audit_log.issues_found = len(audit_log.issues)

        if not audit_log.issues:
            logger.info("TRA auditor: no issues above threshold for %s", language)
            if audit_log.deterministic_applied:
                return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log
            return transcript, audit_log

        try:
            corrections = _run_fixer(batch, filtered, language)
        except Exception as fix_exc:  # noqa: BLE001
            audit_log.error = f"fixer: {fix_exc}"
            logger.warning("TRA fixer failed (%s): %s", language, fix_exc)
            if audit_log.deterministic_applied:
                return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log
            return transcript, audit_log

        audit_log.corrections_proposed = len(corrections)
        if not corrections:
            logger.info("TRA fixer: no corrections proposed for %s", language)
            if audit_log.deterministic_applied:
                return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log
            return transcript, audit_log

        try:
            verifier = _run_verifier(batch, filtered, corrections, language)
        except Exception as ver_exc:  # noqa: BLE001
            audit_log.error = f"verifier: {ver_exc}"
            logger.warning("TRA verifier failed (%s): %s", language, ver_exc)
            verifier = {"decisions": []}
        issue_lines = _issue_line_set(filtered)
        applied = _merge_approved(
            batch, originals, corrections, verifier, issue_lines, audit_log,
            verifier_fallback=TRANSCRIPT_REFINEMENT_VERIFIER_FALLBACK,
        )
        audit_log.corrections_applied = len(applied) + audit_log.deterministic_applied

        if not applied:
            if audit_log.deterministic_applied:
                return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log
            return transcript, audit_log

        merged = dict(originals)
        merged.update(applied)
        result = _lines_to_transcript(ordered, merged)
        audit_log.corrections_applied = len(applied) + audit_log.deterministic_applied
        return result or _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log

    except Exception as exc:  # noqa: BLE001
        audit_log.error = str(exc)
        logger.warning("TRA failed (%s): %s", language, exc)
        if audit_log.deterministic_applied:
            return _apply_line_edits(trimmed, ordered, originals, audit_log), audit_log
        return transcript, audit_log
