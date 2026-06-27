"""
Phase 5 - Database reorganization (non-destructive to live data).

Safe operations only (Phase 0 already backed up every table):
  1. Drop confirmed-unused tables (BankingOptionsLog, BankingRates) - not
     referenced anywhere in backend/frontend/ai-mvp.
  2. Add covering indexes on hot report/dashboard columns, but only when the
     column actually exists (defensive against schema drift).

NOTE: AI_Details_Scoring and AI_Processing_Result are intentionally NOT dropped
- they hold the real historical data (150 / 298 rows) while Consolidated_Audio
_Analysis is only partially populated (6 rows). Consolidating them requires a
data backfill and is left as a documented follow-up.
"""

from __future__ import annotations

import os
import sys

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))
AI_MVP = os.path.join(PROJECT_ROOT, "ai-mvp")
sys.path.insert(0, AI_MVP)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(AI_MVP, ".env"))

from db import connect  # noqa: E402

UNUSED_TABLES = ["BankingOptionsLog", "BankingRates"]

# (table, column, index_name)
INDEX_PLAN = [
    ("Consolidated_Audio_Analysis", "SelectedCallDate", "IX_CAA_SelectedCallDate"),
    ("Consolidated_Audio_Analysis", "Status", "IX_CAA_Status"),
    ("Consolidated_Audio_Analysis", "AgentName", "IX_CAA_AgentName"),
    ("Consolidated_Audio_Analysis", "CallType", "IX_CAA_CallType"),
    ("Consolidated_Audio_Analysis", "UploadDate", "IX_CAA_UploadDate"),
    ("AI_Details_Scoring", "AgentName", "IX_ADS_AgentName"),
    ("AI_Processing_Result", "AudioFile", "IX_APR_AudioFile"),
    ("AudioUploads", "AgentName", "IX_AU_AgentName"),
    ("AudioUploads", "UploadDate", "IX_AU_UploadDate"),
    ("ActiveSessions", "Token", "IX_ActiveSessions_Token"),
    ("ActiveSessions", "IsActive", "IX_ActiveSessions_IsActive"),
]


def table_exists(cur, table: str) -> bool:
    cur.execute("SELECT COUNT(*) FROM sys.tables WHERE name = ?", table)
    return cur.fetchone()[0] > 0


def column_exists(cur, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ? AND COLUMN_NAME = ?
        """,
        table,
        column,
    )
    return cur.fetchone()[0] > 0


def index_exists(cur, table: str, index_name: str) -> bool:
    cur.execute(
        "SELECT COUNT(*) FROM sys.indexes WHERE name = ? AND object_id = OBJECT_ID(?)",
        index_name,
        f"dbo.{table}",
    )
    return cur.fetchone()[0] > 0


def main() -> None:
    with connect() as conn:
        cur = conn.cursor()

        print("== Dropping confirmed-unused tables ==")
        for tbl in UNUSED_TABLES:
            if table_exists(cur, tbl):
                cur.execute(f"DROP TABLE [dbo].[{tbl}]")
                conn.commit()
                print(f"  dropped {tbl}")
            else:
                print(f"  skip {tbl} (not present)")

        print("\n== Creating hot-path indexes ==")
        for table, column, index_name in INDEX_PLAN:
            if not table_exists(cur, table):
                print(f"  skip {index_name} (no table {table})")
                continue
            if not column_exists(cur, table, column):
                print(f"  skip {index_name} (no column {table}.{column})")
                continue
            if index_exists(cur, table, index_name):
                print(f"  exists {index_name}")
                continue
            try:
                cur.execute(
                    f"CREATE NONCLUSTERED INDEX [{index_name}] ON [dbo].[{table}] ([{column}])"
                )
                conn.commit()
                print(f"  created {index_name} on {table}({column})")
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                print(f"  skip {index_name}: {str(exc)[:90]}")

    print("\nPhase 5 reorg complete.")


if __name__ == "__main__":
    main()
