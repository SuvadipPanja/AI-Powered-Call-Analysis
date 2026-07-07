"""Admin-managed customer query categories for per-call intelligence.

The taxonomy of "what the customer called about" is no longer hard-coded — it
lives in the dbo.AI_Query_Categories table and is fully manageable from the
admin panel (add / edit / disable / recolour). The AI reads the *active*
categories from the DB (cached) and classifies each call against them, so the
classification grows with the business without code changes.

Mirrors bank_config.py: reads directly from SQL Server (the orchestrator runs
with DB access), caches with a TTL, creates+seeds the table if missing, and
falls back to a built-in industrial-grade banking taxonomy if the DB is
unreachable so the pipeline never breaks.
"""

from __future__ import annotations

import difflib
import logging
import os
import re
import threading
import time
from typing import Any

logger = logging.getLogger(__name__)

_CACHE_TTL_SEC = int(os.getenv("QUERY_CATEGORY_CACHE_SEC", "60"))

# Palette used when auto-adding LLM-discovered categories (picked round-robin,
# skipping colours already in use).
_AUTO_COLOR_PALETTE: tuple[str, ...] = (
    "#e11d48", "#db2777", "#c026d3", "#9333ea", "#7c3aed", "#4f46e5",
    "#2563eb", "#0284c7", "#0891b2", "#0d9488", "#059669", "#16a34a",
    "#65a30d", "#ca8a04", "#d97706", "#ea580c", "#dc2626", "#78716c",
)
_lock = threading.Lock()
_cache: dict[str, Any] = {"loaded_at": 0.0, "categories": None}

# Built-in industrial-grade default taxonomy.
# (name, description, keywords, color) — KEEP IN SYNC with
# backend/services/queryCategoryDefaults.js
DEFAULT_CATEGORIES: tuple[tuple[str, str, str, str], ...] = (
    ("Balance/Account Enquiry", "Customer asks about account balance or account details.",
     "balance, account balance, how much, available balance, account details", "#6366f1"),
    ("Mini Statement/Transaction History", "Customer asks for recent transactions or a mini statement.",
     "last transactions, mini statement, transaction history, last five, recent transactions", "#8b5cf6"),
    ("ATM/Debit Card Issue", "Problem with an existing ATM/debit card — lost, blocked, damaged, stuck.",
     "card blocked, lost card, card not working, card stuck, debit card issue, card damaged", "#0ea5e9"),
    ("ATM/Debit PIN Generation", "Customer wants to generate / reset / change the ATM or debit card PIN.",
     "generate pin, pin generation, reset pin, forgot pin, change pin, green pin, atm pin", "#06b6d4"),
    ("New ATM/Debit Card Request", "Customer requests a brand new ATM/debit card.",
     "new card, apply card, request debit card, new atm card, issue new card", "#14b8a6"),
    ("Credit Card Issue", "Problem with an existing credit card.",
     "credit card issue, credit card blocked, credit card limit, credit card bill", "#f97316"),
    ("Credit Card Request", "Customer wants a new credit card.",
     "new credit card, apply credit card, credit card eligibility", "#fb923c"),
    ("Credit Card Rewards/Redemption", "Redeem or ask about credit card reward points, cashback, points value or offers — not a problem/complaint.",
     "reward points, rewards, redeem, redemption, cashback, cash back, points redemption, redeem points, reward redemption, points balance", "#f59e0b"),
    ("Cheque Book Request", "Customer requests a cheque book or asks about one.",
     "cheque book, chequebook, new cheque book, request cheque", "#a3e635"),
    ("Fund Transfer Issue (NEFT/RTGS/IMPS/UPI)", "Issue or query about transferring money.",
     "neft, rtgs, imps, upi, fund transfer, money transfer, transfer failed", "#22c55e"),
    ("Payment Deducted/Failed Transaction", "Money deducted but transaction failed / not credited.",
     "payment deducted, money deducted, transaction failed, amount debited, not credited, double debit", "#ef4444"),
    ("Failed/Disputed Transaction Refund", "Customer wants a refund or disputes a transaction.",
     "refund, dispute, chargeback, reverse transaction, wrong transaction", "#f43f5e"),
    ("Net Banking/Mobile App Issue", "Login, OTP, or feature problem in net banking or the mobile app.",
     "net banking, mobile app, app not working, login issue, otp not received, application issue", "#3b82f6"),
    ("Account Opening", "Customer wants to open a new account.",
     "open account, new account, account opening, savings account", "#0891b2"),
    ("KYC/Document Update", "KYC, PAN, Aadhaar or other document update.",
     "kyc, pan update, aadhaar, document update, re-kyc, kyc pending", "#7c3aed"),
    ("Address/Mobile Number Update", "Update registered address, mobile number or email.",
     "change mobile number, update address, change email, update contact", "#9333ea"),
    ("Loan Enquiry", "Customer enquires about or requests a loan.",
     "loan, home loan, car loan, personal loan, loan eligibility, loan interest", "#16a34a"),
    ("Loan EMI/Repayment", "Query about loan EMI, repayment, foreclosure or schedule.",
     "emi, loan repayment, foreclosure, prepayment, emi date, loan due", "#15803d"),
    ("Fixed/Recurring Deposit", "Query about FD/RD opening, rates or maturity.",
     "fixed deposit, fd, recurring deposit, rd, deposit maturity, fd rate", "#ca8a04"),
    ("Interest Rate/Charges Enquiry", "Customer asks about interest rates, fees or charges.",
     "interest rate, charges, fees, penalty, service charge", "#d97706"),
    ("Cheque/DD Status", "Status of a cheque or demand draft.",
     "cheque status, dd status, demand draft, cheque clearance, cheque bounce", "#84cc16"),
    ("Complaint/Grievance", "Customer raises a complaint or grievance against service/staff.",
     "complaint, grievance, complain, poor service, want to complain", "#dc2626"),
    ("Fraud/Unauthorized Transaction", "Suspected fraud or unauthorized transaction.",
     "fraud, unauthorized, scam, hacked, stolen money, suspicious transaction", "#b91c1c"),
    ("Branch/ATM Locator/Referral", "Agent refers customer to a branch/ATM or customer asks location.",
     "visit branch, nearest branch, atm location, branch refer, go to branch", "#64748b"),
    ("Bank Server/Technical Issue", "Bank-side server, downtime or technical error.",
     "server down, server issue, technical issue, system down, server problem", "#0d9488"),
    ("Account Statement Request", "Customer requests a full account statement.",
     "account statement, statement request, email statement, passbook update", "#475569"),
    ("Other/General Info", "Any general information request not covered by other categories.",
     "general, information, other, enquiry", "#94a3b8"),
)

_FALLBACK_NAME = "Other/General Info"


def _default_categories() -> list[dict[str, Any]]:
    return [
        {"name": n, "description": d, "keywords": k, "color": c}
        for (n, d, k, c) in DEFAULT_CATEGORIES
    ]


def _ensure_schema(cursor) -> None:
    cursor.execute("""
        IF OBJECT_ID('dbo.AI_Query_Categories', 'U') IS NULL
        BEGIN
            CREATE TABLE dbo.AI_Query_Categories (
                CategoryID  INT IDENTITY(1,1) PRIMARY KEY,
                Name        NVARCHAR(150) NOT NULL,
                Description NVARCHAR(500) NULL,
                Keywords    NVARCHAR(MAX) NULL,
                Color       NVARCHAR(20)  NULL,
                IsActive    BIT NOT NULL DEFAULT 1,
                SortOrder   INT NOT NULL DEFAULT 0,
                CreatedAt   DATETIME NOT NULL DEFAULT GETDATE(),
                UpdatedAt   DATETIME NOT NULL DEFAULT GETDATE(),
                UpdatedBy   NVARCHAR(100) NULL,
                CONSTRAINT UQ_AI_Query_Categories_Name UNIQUE (Name)
            );
        END
    """)
    # Auto-discovery bookkeeping columns (added in-place for existing installs).
    cursor.execute("""
        IF COL_LENGTH('dbo.AI_Query_Categories', 'AutoAdded') IS NULL
            ALTER TABLE dbo.AI_Query_Categories ADD AutoAdded BIT NOT NULL DEFAULT 0;
    """)
    cursor.execute("""
        IF COL_LENGTH('dbo.AI_Query_Categories', 'PendingReview') IS NULL
            ALTER TABLE dbo.AI_Query_Categories ADD PendingReview BIT NOT NULL DEFAULT 0;
    """)


def _seed_if_empty(cursor) -> None:
    cursor.execute("SELECT COUNT(*) FROM dbo.AI_Query_Categories")
    row = cursor.fetchone()
    if row and row[0]:
        return
    for idx, (name, desc, keywords, color) in enumerate(DEFAULT_CATEGORIES):
        cursor.execute(
            """
            IF NOT EXISTS (SELECT 1 FROM dbo.AI_Query_Categories WHERE Name = ?)
                INSERT INTO dbo.AI_Query_Categories (Name, Description, Keywords, Color, IsActive, SortOrder)
                VALUES (?, ?, ?, ?, 1, ?)
            """,
            name, name, desc, keywords, color, idx,
        )


def _load_from_db() -> list[dict[str, Any]]:
    try:
        from db import connect

        conn = connect()
        try:
            cursor = conn.cursor()
            _ensure_schema(cursor)
            _seed_if_empty(cursor)
            conn.commit()
            cursor.execute(
                """
                SELECT Name, Description, Keywords, Color
                FROM dbo.AI_Query_Categories
                WHERE IsActive = 1
                ORDER BY SortOrder, Name
                """
            )
            rows = cursor.fetchall()
            cats = [
                {
                    "name": (r[0] or "").strip(),
                    "description": (r[1] or "").strip(),
                    "keywords": (r[2] or "").strip(),
                    "color": (r[3] or "").strip(),
                }
                for r in rows
                if r and (r[0] or "").strip()
            ]
            return cats or _default_categories()
        finally:
            conn.close()
    except Exception:
        return _default_categories()


def get_query_categories(*, force_refresh: bool = False) -> list[dict[str, Any]]:
    now = time.time()
    with _lock:
        if (
            not force_refresh
            and _cache["categories"] is not None
            and (now - _cache["loaded_at"]) < _CACHE_TTL_SEC
        ):
            return _cache["categories"]

    cats = _load_from_db()
    # Always guarantee the catch-all exists so the LLM has a safe bucket.
    if not any(c["name"] == _FALLBACK_NAME for c in cats):
        cats = cats + [{"name": _FALLBACK_NAME, "description": "General info.", "keywords": "", "color": "#94a3b8"}]
    with _lock:
        _cache["categories"] = cats
        _cache["loaded_at"] = now
    return cats


def category_names() -> tuple[str, ...]:
    return tuple(c["name"] for c in get_query_categories())


def fallback_name() -> str:
    cats = get_query_categories()
    for c in cats:
        if c["name"] == _FALLBACK_NAME:
            return _FALLBACK_NAME
    return cats[-1]["name"] if cats else _FALLBACK_NAME


def invalidate_cache() -> None:
    with _lock:
        _cache["loaded_at"] = 0.0
        _cache["categories"] = None


# ─────────────────────────────────────────────────────────────────────────────
# Auto-discovery of new categories (LLM-proposed, validated + deduped)
# ─────────────────────────────────────────────────────────────────────────────

# Words that make a proposed name too generic to be a real category.
_GENERIC_NAME_TOKENS = frozenset({
    "other", "general", "misc", "miscellaneous", "unknown", "none", "n/a",
    "call", "customer", "query", "question", "info", "information", "various",
})


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()


def _similar(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _norm_name(a), _norm_name(b)).ratio()


def _is_reasonable_name(name: str) -> bool:
    n = (name or "").strip()
    if not (3 <= len(n) <= 80):
        return False
    words = _norm_name(n).split()
    if not words:
        return False
    # Reject purely-generic names ("Other Query", "General Information").
    if all(w in _GENERIC_NAME_TOKENS for w in words):
        return False
    return True


def _pick_color(existing: set[str]) -> str:
    used = {c.lower() for c in existing if c}
    for color in _AUTO_COLOR_PALETTE:
        if color.lower() not in used:
            return color
    return _AUTO_COLOR_PALETTE[len(used) % len(_AUTO_COLOR_PALETTE)]


def add_discovered_category(
    name: str,
    description: str,
    keywords: str,
    *,
    dedupe_similarity: float = 0.82,
    max_auto: int = 60,
) -> str | None:
    """Validate + insert an LLM-discovered category into dbo.AI_Query_Categories.

    Returns the canonical stored name to use for the call, or None if it was
    rejected (invalid, duplicate/too-similar, cap reached, or DB unavailable).
    Duplicates resolve to the existing category name so the call is still tagged.
    """
    name = (name or "").strip()
    if not _is_reasonable_name(name):
        return None

    existing = get_query_categories()
    for c in existing:  # dedupe: reuse an existing near-identical category
        if _similar(name, c["name"]) >= dedupe_similarity:
            logger.info(
                "Query auto-discovery: %r ~ existing %r — reusing existing.",
                name, c["name"],
            )
            return c["name"]

    try:
        from db import connect

        conn = connect()
        try:
            cursor = conn.cursor()
            _ensure_schema(cursor)

            cursor.execute(
                "SELECT COUNT(*) FROM dbo.AI_Query_Categories WHERE AutoAdded = 1"
            )
            row = cursor.fetchone()
            if row and row[0] is not None and int(row[0]) >= max_auto:
                logger.warning(
                    "Query auto-discovery cap reached (%s); not adding %r.",
                    max_auto, name,
                )
                return None

            cursor.execute("SELECT ISNULL(MAX(SortOrder), 0) FROM dbo.AI_Query_Categories")
            max_sort = int((cursor.fetchone() or [0])[0] or 0)
            cursor.execute("SELECT Color FROM dbo.AI_Query_Categories")
            used_colors = {(r[0] or "").strip() for r in cursor.fetchall()}
            color = _pick_color(used_colors)

            cursor.execute(
                """
                IF NOT EXISTS (SELECT 1 FROM dbo.AI_Query_Categories WHERE Name = ?)
                    INSERT INTO dbo.AI_Query_Categories
                        (Name, Description, Keywords, Color, IsActive, SortOrder,
                         AutoAdded, PendingReview, UpdatedBy)
                    VALUES (?, ?, ?, ?, 1, ?, 1, 1, ?)
                """,
                name, name,
                (description or "").strip()[:500] or None,
                (keywords or "").strip() or None,
                color, max_sort + 1, "auto-discovery",
            )
            conn.commit()
        finally:
            conn.close()
    except Exception as exc:  # noqa: BLE001
        logger.warning("Query auto-discovery insert failed for %r: %s", name, exc)
        return None

    invalidate_cache()
    logger.info("Query auto-discovery: added new category %r (color=%s).", name, color)
    return name
