"""Load bank configuration from SQL Server for AI prompts and script compliance."""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from typing import Any

from banking_script_targets import build_target_sentences, DEFAULT_BANK_NAME

_CACHE_TTL_SEC = int(os.getenv("BANK_CONFIG_CACHE_SEC", "120"))
_lock = threading.Lock()
_cache: dict[str, Any] = {"loaded_at": 0.0, "config": None}


@dataclass
class BankConfig:
    bank_name: str = DEFAULT_BANK_NAME
    bank_name_local: str = ""
    glossary: list[dict[str, str]] = field(default_factory=list)
    product_terms: list[str] = field(default_factory=list)
    non_banking_terms: list[str] = field(default_factory=list)
    taboo_words: list[dict[str, str]] = field(default_factory=list)
    script_targets: dict[str, Any] | None = None

    def org_label(self) -> str:
        name = (self.bank_name or "").strip()
        if name and name.lower() not in ("call center", "generic", "unknown", ""):
            return name
        return "the organization"

    def org_context_line(self) -> str:
        label = self.org_label()
        if label == "the organization":
            return "Works for any call-center domain (sales, support, collections, general inquiry)."
        return f'Organization / brand context: "{label}".'

    def glossary_block(self, max_items: int = 40) -> str:
        if not self.glossary:
            return ""
        lines = []
        for row in self.glossary[:max_items]:
            src = (row.get("source") or row.get("term") or "").strip()
            tgt = (row.get("target") or row.get("translation") or "").strip()
            note = (row.get("note") or row.get("context") or "").strip()
            if src and tgt:
                line = f"- {src} → {tgt}"
            elif tgt:
                line = f"- {tgt}"
            elif src:
                line = f"- {src}"
            else:
                continue
            if note:
                line += f" ({note})"
            lines.append(line)
        return "\n".join(lines)

    def product_terms_line(self) -> str:
        if not self.product_terms:
            return ""
        return ", ".join(self.product_terms[:60])

    def non_banking_terms_line(self) -> str:
        if not self.non_banking_terms:
            return ""
        return ", ".join(self.non_banking_terms[:60])

    def get_script_targets(self) -> dict[str, dict[str, list[str]]]:
        if self.script_targets and isinstance(self.script_targets, dict):
            return self.script_targets
        return build_target_sentences(self.bank_name, self.bank_name_local)


def _default_config() -> BankConfig:
    return BankConfig(
        bank_name="Call Center",
        bank_name_local="",
        product_terms=[
            "account", "balance", "NEFT", "RTGS", "IMPS", "UPI", "KYC", "OTP",
            "FD", "loan", "EMI", "branch", "IFSC", "passbook", "cheque",
            "debit card", "credit card", "RBI",
        ],
        non_banking_terms=[
            "order", "tracking", "delivery", "return", "refund", "warranty",
            "subscription", "invoice", "support ticket", "escalation", "callback",
            "complaint", "activation", "recharge", "plan upgrade",
        ],
        glossary=[
            {"source": "खाता", "target": "account", "language": "Hindi", "note": "banking"},
            {"source": "बैलेंस", "target": "balance", "language": "Hindi", "note": "banking"},
            {"source": "অ্যাকাউন্ট", "target": "account", "language": "Bengali", "note": "banking"},
            {"source": "বিরাট বাবু", "target": "sir", "language": "Bengali", "note": "honorific"},
            {"source": "দাদা", "target": "sir", "language": "Bengali", "note": "honorific"},
            {"source": "কি প্লাস", "target": "T Plus", "language": "Bengali", "note": "product"},
            {"source": "T plus", "target": "T Plus application", "language": "Bengali", "note": "product"},
            {"source": "order cancel", "target": "cancel order", "language": "English", "note": "non-banking"},
        ],
        taboo_words=[
            {"word": "stupid", "language": "English", "severity": "medium", "appliesTo": "agent", "category": "rude"},
            {"word": "guaranteed profit", "language": "English", "severity": "high", "appliesTo": "agent", "category": "compliance"},
            {"word": "पागल", "language": "Hindi", "severity": "high", "appliesTo": "agent", "category": "rude"},
            {"word": "বোকা", "language": "Bengali", "severity": "medium", "appliesTo": "agent", "category": "rude"},
        ],
    )


def _row_to_config(row: dict[str, Any]) -> BankConfig:
    defaults = _default_config()
    glossary_raw = row.get("GlossaryJson") or "[]"
    products_raw = row.get("ProductTermsJson") or "[]"
    non_banking_raw = row.get("NonBankingTermsJson") or "[]"
    taboo_raw = row.get("TabooWordsJson") or "[]"
    script_raw = row.get("ScriptTargetsJson")

    try:
        glossary = json.loads(glossary_raw) if isinstance(glossary_raw, str) else glossary_raw
    except json.JSONDecodeError:
        glossary = []
    try:
        product_terms = json.loads(products_raw) if isinstance(products_raw, str) else products_raw
    except json.JSONDecodeError:
        product_terms = []
    try:
        non_banking_terms = json.loads(non_banking_raw) if isinstance(non_banking_raw, str) else non_banking_raw
    except json.JSONDecodeError:
        non_banking_terms = []
    try:
        taboo_words = json.loads(taboo_raw) if isinstance(taboo_raw, str) else taboo_raw
    except json.JSONDecodeError:
        taboo_words = []
    script_targets = None
    if script_raw:
        try:
            script_targets = json.loads(script_raw) if isinstance(script_raw, str) else script_raw
        except json.JSONDecodeError:
            script_targets = None

    if not isinstance(glossary, list):
        glossary = []
    if not isinstance(product_terms, list):
        product_terms = [t.strip() for t in str(product_terms).split(",") if t.strip()]
    if not isinstance(non_banking_terms, list):
        non_banking_terms = [t.strip() for t in str(non_banking_terms).split(",") if t.strip()]
    if not isinstance(taboo_words, list):
        taboo_words = []

    glossary = [g for g in glossary if isinstance(g, dict)]
    product_terms = [str(t).strip() for t in product_terms if str(t).strip()]
    non_banking_terms = [str(t).strip() for t in non_banking_terms if str(t).strip()]
    taboo_words = [t for t in taboo_words if isinstance(t, dict) and (t.get("word") or t.get("term"))]

    if not glossary:
        glossary = defaults.glossary
    if not product_terms:
        product_terms = defaults.product_terms
    if not non_banking_terms:
        non_banking_terms = defaults.non_banking_terms
    if not taboo_words:
        taboo_words = defaults.taboo_words

    return BankConfig(
        bank_name=(row.get("BankName") or DEFAULT_BANK_NAME).strip(),
        bank_name_local=(row.get("BankNameLocal") or "").strip(),
        glossary=glossary,
        product_terms=product_terms,
        non_banking_terms=non_banking_terms,
        taboo_words=taboo_words,
        script_targets=script_targets if isinstance(script_targets, dict) else None,
    )


def _ensure_schema(cursor) -> None:
    cursor.execute("""
        IF OBJECT_ID('dbo.BankSettings', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.BankSettings (
                SettingID          INT NOT NULL PRIMARY KEY DEFAULT 1,
                BankName           NVARCHAR(200) NOT NULL DEFAULT N'UCO Bank',
                BankNameLocal      NVARCHAR(200) NULL,
                GlossaryJson       NVARCHAR(MAX) NULL,
                ProductTermsJson   NVARCHAR(MAX) NULL,
                ScriptTargetsJson      NVARCHAR(MAX) NULL,
                NonBankingTermsJson    NVARCHAR(MAX) NULL,
                TabooWordsJson         NVARCHAR(MAX) NULL,
                UpdatedAt              DATETIME NOT NULL DEFAULT GETDATE(),
                UpdatedBy              NVARCHAR(100) NULL,
                CONSTRAINT CK_BankSettings_SingleRow CHECK (SettingID = 1)
            );
            INSERT INTO dbo.BankSettings (SettingID, BankName, BankNameLocal, GlossaryJson, ProductTermsJson)
            VALUES (1, N'UCO Bank', N'यूको बैंक', N'[]', N'[]');
        END
    """)
    cursor.execute("""
        IF COL_LENGTH('dbo.BankSettings', 'NonBankingTermsJson') IS NULL
            ALTER TABLE dbo.BankSettings ADD NonBankingTermsJson NVARCHAR(MAX) NULL;
        IF COL_LENGTH('dbo.BankSettings', 'TabooWordsJson') IS NULL
            ALTER TABLE dbo.BankSettings ADD TabooWordsJson NVARCHAR(MAX) NULL;
    """)


def _load_from_db() -> BankConfig:
    try:
        from db import connect

        conn = connect()
        try:
            cursor = conn.cursor()
            _ensure_schema(cursor)
            conn.commit()
            cursor.execute("""
                SELECT TOP 1 BankName, BankNameLocal, GlossaryJson, ProductTermsJson,
                       ScriptTargetsJson, NonBankingTermsJson, TabooWordsJson
                FROM dbo.BankSettings WHERE SettingID = 1
            """)
            row = cursor.fetchone()
            if not row:
                return _default_config()
            columns = [c[0] for c in cursor.description]
            return _row_to_config(dict(zip(columns, row)))
        finally:
            conn.close()
    except Exception:
        return _default_config()


def get_bank_config(*, force_refresh: bool = False) -> BankConfig:
    now = time.time()
    with _lock:
        if (
            not force_refresh
            and _cache["config"] is not None
            and (now - _cache["loaded_at"]) < _CACHE_TTL_SEC
        ):
            return _cache["config"]

    config = _load_from_db()
    with _lock:
        _cache["config"] = config
        _cache["loaded_at"] = now
    return config


def invalidate_bank_config_cache() -> None:
    with _lock:
        _cache["loaded_at"] = 0.0
        _cache["config"] = None
