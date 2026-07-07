"""Deterministic cross-turn consistency pre-audit for Transcript Refinement Agent.

Step 0 before LLM Auditor: detects probable name/phrase/honorific mismatches using
phonetic clustering and banking phrase patterns — no hardcoded name→name maps.
"""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from typing import Any

# Honorific / ASR garbage patterns (detection only — fixes come from LLM Fixer)
_HONORIFIC_GARBAGE = re.compile(
    r"\b(?:big\s+papa|big\s+babu|big\s+dada|teacher|mister\s+police|missus\s+police)\b",
    re.I,
)
_ASR_GARBAGE = re.compile(
    r"\b(?:icon\s+pattern|finared|manual\s+good\s+name|manual\s+data\s+bursar|"
    r"date\s+of\s+bursar|postcard\s+number)\b",
    re.I,
)
# Agent-line ASR garbage → banking phrase replacement (deterministic, no LLM)
_AGENT_PHRASE_FIXES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bmanual\s+good\s+name\b", re.I), "may I know your name"),
    (re.compile(r"\bmanual\s+data\s+bursar\b", re.I), "date of birth"),
    (re.compile(r"\bdate\s+of\s+bursar\b", re.I), "date of birth"),
    (re.compile(r"\bfinared\b", re.I), "reward points"),
]
_BANKING_PHRASE = re.compile(
    r"\b(?:account\s+balance|mobile\s+number|registered\s+mobile|date\s+of\s+birth|"
    r"good\s+name|reward\s+points|credit\s+card)\b",
    re.I,
)
_NAME_INTRO = re.compile(
    r"\b(?:my\s+name\s+is|i\s+am|i'?m|name\s+is|mera\s+naam|naam\s+hai)\s+"
    r"([A-Za-z][A-Za-z\s.'-]{1,40})",
    re.I,
)
_AGENT_NAME = re.compile(
    r"\b(?:thank\s+you|thanks)\s+(?:mister|mr|miss|ms|mrs|sir|madam)\s+"
    r"([A-Za-z][A-Za-z\s.'-]{1,30})",
    re.I,
)
_AGENT_INTRO = re.compile(
    r"\b(?:i\s+am|my\s+name\s+is|this\s+is)\s+([A-Za-z][A-Za-z\s.'-]{1,25})",
    re.I,
)
_STOP_NAME = frozenset({
    "sir", "madam", "customer", "agent", "hello", "yes", "no", "okay", "ok",
    "thank", "thanks", "welcome", "bank", "rewards", "calling",
})
_GARBAGE_NAME = frozenset({
    "police", "pattern", "papa", "teacher", "manual", "icon", "finared",
    "wholesale", "bulkkit", "fulkit",
})

# Stop tokens when clipping ASR name captures (avoid "charlie how may i assist you")
_NAME_CLIP_STOP = re.compile(
    r"\b(?:how|from|for|welcome|calling|assist|regarding|today|sir|madam|bank)\b",
    re.I,
)


def _clip_person_name(raw: str, *, max_words: int = 2) -> str:
    """Keep first plausible given-name token(s); drop trailing script phrases."""
    text = (raw or "").strip().split(" and ")[0].split(",")[0].strip()
    m = _NAME_CLIP_STOP.search(text)
    if m:
        text = text[: m.start()].strip()
    parts = [p for p in text.split() if p]
    if not parts:
        return ""
    return " ".join(parts[:max_words])


def _norm_name(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def _name_similar(a: str, b: str) -> float:
    a_n, b_n = _norm_name(a), _norm_name(b)
    if not a_n or not b_n:
        return 0.0
    if a_n == b_n:
        return 1.0
    return SequenceMatcher(None, a_n, b_n).ratio()


def _extract_name_mentions(
    batch: list[tuple[int, str, str]],
) -> list[dict[str, Any]]:
    mentions: list[dict[str, Any]] = []
    for idx, speaker, text in batch:
        for m in _NAME_INTRO.finditer(text):
            name = _clip_person_name(m.group(1))
            tok = name.split()[0] if name else ""
            if tok.lower() in _STOP_NAME or len(tok) < 3:
                continue
            mentions.append({"line": idx, "speaker": speaker, "surface": name, "role": "intro"})
        for m in _AGENT_NAME.finditer(text):
            name = _clip_person_name(m.group(1))
            if name.lower() in _STOP_NAME or len(name) < 3:
                continue
            mentions.append({"line": idx, "speaker": speaker, "surface": name, "role": "address"})
        for m in _AGENT_INTRO.finditer(text):
            name = _clip_person_name(m.group(1), max_words=1)
            if name.lower() in _STOP_NAME or len(name) < 2:
                continue
            mentions.append({"line": idx, "speaker": speaker, "surface": name, "role": "agent_intro"})
    return mentions


def _cluster_names(
    mentions: list[dict[str, Any]],
    threshold: float = 0.52,
) -> list[list[dict[str, Any]]]:
    """Greedy clusters — phonetically similar names grouped."""
    clusters: list[list[dict[str, Any]]] = []
    used: set[int] = set()
    for i, m in enumerate(mentions):
        if i in used:
            continue
        cluster = [m]
        used.add(i)
        for j, other in enumerate(mentions):
            if j in used or i == j:
                continue
            sim = _name_similar(m["surface"], other["surface"])
            if sim >= threshold or (sim >= 0.45 and m["speaker"] != other["speaker"]):
                cluster.append(other)
                used.add(j)
        clusters.append(cluster)
    return clusters


def _pick_canonical(cluster: list[dict[str, Any]]) -> str:
    """Prefer non-garbage surfaces; then agent address/intro; longest plausible token."""
    def score(x: dict[str, Any]) -> tuple:
        first = x["surface"].split()[0].lower() if x["surface"] else ""
        garbage = 1 if first in _GARBAGE_NAME else 0
        return (
            -garbage,
            1 if x["role"] in ("address", "agent_intro") else 0,
            len(x["surface"].split()),
            len(x["surface"]),
        )

    ranked = sorted(cluster, key=score, reverse=True)
    best = ranked[0]["surface"].strip()
    # Title-case multi-word names
    parts = best.split()
    if len(parts) >= 2:
        return " ".join(p.capitalize() for p in parts)
    return best.capitalize()


def detect_pre_audit_issues(
    batch: list[tuple[int, str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return (entities, issues) compatible with LLM auditor schema."""
    entities: list[dict[str, Any]] = []
    issues: list[dict[str, Any]] = []
    issue_n = 0
    entity_n = 0

    mentions = _extract_name_mentions(batch)
    clusters = _cluster_names(mentions)

    for cluster in clusters:
        if len(cluster) < 2:
            continue
        surfaces = {m["surface"].lower() for m in cluster}
        if len(surfaces) < 2:
            sim_pairs = [
                _name_similar(a["surface"], b["surface"])
                for i, a in enumerate(cluster)
                for b in cluster[i + 1:]
            ]
            if sim_pairs and max(sim_pairs) >= 0.85:
                continue
        canonical = _pick_canonical(cluster)
        entity_n += 1
        eid = f"PRE-E{entity_n}"
        entities.append({
            "entity_id": eid,
            "type": "person_name",
            "mentions": [
                {"line": m["line"], "speaker": m["speaker"], "surface": m["surface"]}
                for m in cluster
            ],
            "canonical_hypothesis": canonical,
            "confidence": 0.75,
            "rationale": "Phonetic name cluster across turns (pre-audit)",
            "source": "pre_audit",
        })
        lines = sorted({m["line"] for m in cluster})
        issue_n += 1
        issues.append({
            "issue_id": f"PRE-I{issue_n}",
            "type": "name_mismatch",
            "severity": "high",
            "lines": lines,
            "entity_id": eid,
            "description": (
                f"Name surfaces {sorted(surfaces)} likely refer to same person; "
                f"canonical hypothesis: {canonical}"
            ),
            "evidence_lines": lines,
            "confidence": 0.78,
            "source": "pre_audit",
        })

    # Phrase mismatch: customer ASR garbage + agent banking phrase
    for idx_c, sp_c, text_c in batch:
        if sp_c != "Customer" or not _ASR_GARBAGE.search(text_c):
            continue
        for idx_a, sp_a, text_a in batch:
            if sp_a != "Agent" or not _BANKING_PHRASE.search(text_a):
                continue
            issue_n += 1
            issues.append({
                "issue_id": f"PRE-I{issue_n}",
                "type": "phrase_mismatch",
                "severity": "high",
                "lines": [idx_c, idx_a],
                "entity_id": None,
                "description": (
                    f"Customer line {idx_c} has probable ASR error; "
                    f"agent line {idx_a} confirms banking phrase"
                ),
                "evidence_lines": [idx_c, idx_a],
                "confidence": 0.8,
                "source": "pre_audit",
            })
            break

    # Honorific errors
    agent_names: list[str] = []
    for _, sp, text in batch:
        if sp == "Agent":
            for m in _AGENT_INTRO.finditer(text):
                agent_names.append(m.group(1).strip())

    for idx, sp, text in batch:
        if sp != "Customer" or not _HONORIFIC_GARBAGE.search(text):
            continue
        issue_n += 1
        lines = [idx]
        for i, s, t in batch:
            if s == "Agent" and _AGENT_INTRO.search(t):
                lines.append(i)
                break
        issues.append({
            "issue_id": f"PRE-I{issue_n}",
            "type": "honorific_error",
            "severity": "medium",
            "lines": sorted(set(lines)),
            "entity_id": None,
            "description": "Absurd honorific/address in customer line; use sir/madam or agent name",
            "evidence_lines": sorted(set(lines)),
            "confidence": 0.72,
            "source": "pre_audit",
        })

    # Entity label: postcard number when agent says mobile
    for idx_c, sp_c, text_c in batch:
        if "postcard number" not in text_c.lower():
            continue
        for idx_a, sp_a, text_a in batch:
            if sp_a == "Agent" and "mobile" in text_a.lower():
                issue_n += 1
                issues.append({
                    "issue_id": f"PRE-I{issue_n}",
                    "type": "entity_label_mismatch",
                    "severity": "medium",
                    "lines": [idx_c, idx_a],
                    "entity_id": None,
                    "description": "Customer said postcard number; agent confirms mobile number",
                    "evidence_lines": [idx_c, idx_a],
                    "confidence": 0.7,
                    "source": "pre_audit",
                })
                break

    # Customer intro name vs agent thank-for-name mismatch (fulkid / mister police)
    cust_names: list[tuple[int, str]] = []
    agent_thanks: list[tuple[int, str]] = []
    for idx, sp, text in batch:
        m = _NAME_INTRO.search(text)
        if sp == "Customer" and m:
            n = m.group(1).strip().split(" and ")[0].split()[0]
            if len(n) >= 3 and n.lower() not in _STOP_NAME:
                cust_names.append((idx, n))
        m2 = _AGENT_NAME.search(text)
        if sp == "Agent" and m2 and "name" in text.lower():
            n2 = m2.group(1).strip().split()[0]
            if len(n2) >= 3:
                agent_thanks.append((idx, n2))

    for ci, cn in cust_names:
        for ai, an in agent_thanks:
            if _name_similar(cn, an) < 0.55:
                entity_n += 1
                eid = f"PRE-E{entity_n}"
                if an.lower() in _GARBAGE_NAME:
                    canonical = cn.capitalize()
                elif cn.lower() in _GARBAGE_NAME:
                    canonical = an.capitalize()
                else:
                    canonical = an.capitalize() if len(an) > len(cn) else cn.capitalize()
                entities.append({
                    "entity_id": eid,
                    "type": "person_name",
                    "mentions": [
                        {"line": ci, "speaker": "Customer", "surface": cn},
                        {"line": ai, "speaker": "Agent", "surface": an},
                    ],
                    "canonical_hypothesis": canonical,
                    "confidence": 0.8,
                    "rationale": "Customer name and agent thank-you name differ",
                    "source": "pre_audit",
                })
                issue_n += 1
                issues.append({
                    "issue_id": f"PRE-I{issue_n}",
                    "type": "name_mismatch",
                    "severity": "high",
                    "lines": [ci, ai],
                    "entity_id": eid,
                    "description": f"Customer name '{cn}' vs agent address '{an}'",
                    "evidence_lines": [ci, ai],
                    "confidence": 0.82,
                    "source": "pre_audit",
                })

    return entities, issues


def _line_map(batch: list[tuple[int, str, str]]) -> dict[int, tuple[str, str]]:
    return {idx: (speaker, text) for idx, speaker, text in batch}


def _replace_phrase(text: str, pattern: re.Pattern[str], replacement: str) -> str:
    if not pattern.search(text):
        return text
    return pattern.sub(replacement, text, count=1)


def _extract_banking_phrase(agent_text: str) -> str | None:
    """Return the banking phrase the agent confirmed (longest match)."""
    matches = list(_BANKING_PHRASE.finditer(agent_text))
    if not matches:
        return None
    best = max(matches, key=lambda m: len(m.group(0)))
    return best.group(0).lower()


def _replace_name_token(text: str, old: str, canonical: str, *, prefix_mr: bool = False) -> str:
    if not old or not canonical:
        return text
    repl = f"Mr {canonical}" if prefix_mr else canonical
    pat = re.compile(re.escape(old), re.I)
    if not pat.search(text):
        return text
    return pat.sub(repl, text, count=1)


def apply_deterministic_pre_audit_fixes(
    batch: list[tuple[int, str, str]],
    texts: dict[int, str],
    issues: list[dict[str, Any]],
    entities: list[dict[str, Any]],
) -> tuple[dict[int, str], list[str]]:
    """Apply high-confidence pre-audit fixes without LLM. Returns (line_updates, issue_ids_fixed)."""
    lines = _line_map(batch)
    updates: dict[int, str] = dict(texts)
    fixed_ids: list[str] = []
    entity_by_id = {e.get("entity_id"): e for e in entities if e.get("entity_id")}

    for issue in issues:
        if issue.get("source") != "pre_audit":
            continue
        issue_id = str(issue.get("issue_id") or "")
        issue_type = issue.get("type") or ""
        issue_lines = [int(x) for x in (issue.get("lines") or []) if str(x).isdigit()]
        if not issue_lines:
            continue

        if issue_type == "phrase_mismatch" and len(issue_lines) >= 2:
            cust_ln = next((ln for ln in issue_lines if lines.get(ln, ("", ""))[0] == "Customer"), None)
            agent_ln = next((ln for ln in issue_lines if lines.get(ln, ("", ""))[0] == "Agent"), None)
            if cust_ln is None or agent_ln is None:
                continue
            cust_text = updates.get(cust_ln, lines[cust_ln][1])
            agent_text = updates.get(agent_ln, lines[agent_ln][1])
            banking = _extract_banking_phrase(agent_text)
            garbage_m = _ASR_GARBAGE.search(cust_text)
            if not banking or not garbage_m:
                continue
            new_cust = _replace_phrase(
                cust_text,
                re.compile(re.escape(garbage_m.group(0)), re.I),
                banking,
            )
            if new_cust != cust_text:
                updates[cust_ln] = new_cust
                fixed_ids.append(issue_id)

        elif issue_type == "entity_label_mismatch":
            for ln in issue_lines:
                sp, text = lines.get(ln, ("", ""))
                if sp != "Customer":
                    continue
                new_text = _replace_phrase(
                    updates.get(ln, text),
                    re.compile(r"\bpostcard\s+number\b", re.I),
                    "mobile number",
                )
                if new_text != updates.get(ln, text):
                    updates[ln] = new_text
                    if issue_id not in fixed_ids:
                        fixed_ids.append(issue_id)

        elif issue_type == "honorific_error":
            for ln in issue_lines:
                sp, text = lines.get(ln, ("", ""))
                if sp != "Customer":
                    continue
                cur = updates.get(ln, text)
                new_text = _HONORIFIC_GARBAGE.sub("sir", cur)
                if new_text != cur:
                    updates[ln] = new_text
                    if issue_id not in fixed_ids:
                        fixed_ids.append(issue_id)

        elif issue_type == "name_mismatch":
            entity = entity_by_id.get(issue.get("entity_id"))
            canonical = _clip_person_name(str((entity or {}).get("canonical_hypothesis") or ""))
            if not canonical or len(canonical) < 3:
                continue
            mentions = (entity or {}).get("mentions") or []
            # Only auto-fix when at least one side is ASR garbage (not agent real names)
            has_garbage = any(
                _clip_person_name(str(m.get("surface") or "")).split()[0].lower() in _GARBAGE_NAME
                for m in mentions
            )
            if not has_garbage:
                continue
            # Require cross-speaker mismatch (skip same-line duplicate mentions)
            speakers = {m.get("speaker") for m in mentions}
            if len(speakers) < 2:
                continue
            changed = False
            for ln in issue_lines:
                sp, text = lines.get(ln, ("", ""))
                cur = updates.get(ln, text)
                mentions = (entity or {}).get("mentions") or []
                surface = ""
                for m in mentions:
                    if int(m.get("line", -1)) == ln:
                        surface = str(m.get("surface") or "").strip()
                        break
                if not surface:
                    continue
                if sp == "Agent" and _HONORIFIC_GARBAGE.search(cur):
                    new_text = _HONORIFIC_GARBAGE.sub(f"Mr {canonical}", cur)
                elif surface.split()[0].lower() in _GARBAGE_NAME:
                    garbage_pat = re.compile(re.escape(surface.split()[0]), re.I)
                    repl = f"Mr {canonical}" if sp == "Agent" else canonical
                    new_text = garbage_pat.sub(repl, cur, count=1)
                else:
                    new_text = _replace_name_token(
                        cur, surface.split()[0], canonical, prefix_mr=(sp == "Agent"),
                    )
                if new_text != cur:
                    updates[ln] = new_text
                    changed = True
            if changed and issue_id not in fixed_ids:
                fixed_ids.append(issue_id)

    # Agent-only ASR garbage (e.g. manual good name) — scan all agent lines
    for idx, speaker, text in batch:
        if speaker != "Agent":
            continue
        cur = updates.get(idx, text)
        new_text = cur
        for pat, repl in _AGENT_PHRASE_FIXES:
            new_text = _replace_phrase(new_text, pat, repl)
        if new_text != cur:
            updates[idx] = new_text

    return updates, fixed_ids


def merge_audit_reports(
    llm_audit: dict[str, Any],
    pre_entities: list[dict[str, Any]],
    pre_issues: list[dict[str, Any]],
) -> dict[str, Any]:
    """Merge pre-audit with LLM auditor; pre-audit fills gaps."""
    out = dict(llm_audit)
    llm_entities = list(out.get("entities") or [])
    llm_issues = list(out.get("issues") or [])

    llm_issue_lines = {
        tuple(sorted(int(x) for x in (i.get("lines") or []) if str(x).isdigit()))
        for i in llm_issues
        if isinstance(i, dict)
    }

    for pe in pre_entities:
        llm_entities.append(pe)

    for pi in pre_issues:
        key = tuple(sorted(int(x) for x in (pi.get("lines") or []) if str(x).isdigit()))
        if key and key not in llm_issue_lines:
            llm_issues.append(pi)
            llm_issue_lines.add(key)

    out["entities"] = llm_entities
    out["issues"] = llm_issues
    if pre_issues and not llm_audit.get("issues"):
        out["call_summary"] = out.get("call_summary") or "Pre-audit detected cross-turn inconsistencies"
    return out
