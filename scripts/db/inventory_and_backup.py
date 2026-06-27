"""
Phase 0 - DB safety net.

1. Inventories every user table in the live database (name + row count).
2. Backs up every table to a timestamped table `<name>_backup_<YYYYMMDD_HHMMSS>`
   via SELECT * INTO (data + structure snapshot).
3. Scripts the CREATE TABLE DDL for every table into scripts/sql/exported/.
4. Writes a JSON inventory report into scripts/db/reports/.

Safe and idempotent for the inventory/DDL parts; backup creates new tables only.
Run from anywhere; uses ai-mvp/.env for connection settings.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime

THIS_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(os.path.dirname(THIS_DIR))
AI_MVP = os.path.join(PROJECT_ROOT, "ai-mvp")
sys.path.insert(0, AI_MVP)

from dotenv import load_dotenv  # noqa: E402

load_dotenv(os.path.join(AI_MVP, ".env"))

from db import connect  # noqa: E402

STAMP = datetime.now().strftime("%Y%m%d_%H%M%S")
EXPORT_DIR = os.path.join(PROJECT_ROOT, "scripts", "sql", "exported")
REPORT_DIR = os.path.join(THIS_DIR, "reports")
os.makedirs(EXPORT_DIR, exist_ok=True)
os.makedirs(REPORT_DIR, exist_ok=True)


def list_tables(cur) -> list[str]:
    cur.execute(
        """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA = 'dbo'
        ORDER BY TABLE_NAME
        """
    )
    return [r[0] for r in cur.fetchall()]


def row_count(cur, table: str) -> int:
    cur.execute(f"SELECT COUNT(*) FROM [dbo].[{table}]")
    return int(cur.fetchone()[0])


def script_table_ddl(cur, table: str) -> str:
    """Build a CREATE TABLE statement from INFORMATION_SCHEMA metadata."""
    cur.execute(
        """
        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH,
               NUMERIC_PRECISION, NUMERIC_SCALE, IS_NULLABLE, COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ? AND TABLE_SCHEMA = 'dbo'
        ORDER BY ORDINAL_POSITION
        """,
        table,
    )
    cols = cur.fetchall()
    lines = []
    for name, dtype, char_len, num_prec, num_scale, nullable, default in cols:
        t = dtype.lower()
        if t in ("varchar", "nvarchar", "char", "nchar", "varbinary", "binary"):
            length = "MAX" if char_len in (-1, None) else str(char_len)
            type_str = f"{dtype}({length})"
        elif t in ("decimal", "numeric"):
            type_str = f"{dtype}({num_prec},{num_scale})"
        else:
            type_str = dtype
        null_str = "NULL" if nullable == "YES" else "NOT NULL"
        default_str = f" DEFAULT {default}" if default else ""
        lines.append(f"    [{name}] {type_str}{default_str} {null_str}")
    body = ",\n".join(lines)
    return (
        f"IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = '{table}')\n"
        f"CREATE TABLE [dbo].[{table}] (\n{body}\n);\nGO\n"
    )


def main() -> None:
    do_backup = "--no-backup" not in sys.argv
    inventory: dict[str, object] = {"timestamp": STAMP, "tables": []}

    with connect() as conn:
        cur = conn.cursor()
        tables = list_tables(cur)
        print(f"Found {len(tables)} base tables.")

        for table in tables:
            if "_backup_" in table:
                continue
            count = row_count(cur, table)
            ddl = script_table_ddl(cur, table)
            ddl_path = os.path.join(EXPORT_DIR, f"{table}.sql")
            with open(ddl_path, "w", encoding="utf-8") as f:
                f.write(ddl)

            backup_name = None
            if do_backup:
                backup_name = f"{table}_backup_{STAMP}"
                cur.execute(
                    f"SELECT * INTO [dbo].[{backup_name}] FROM [dbo].[{table}]"
                )
                conn.commit()

            inventory["tables"].append(
                {
                    "name": table,
                    "rows": count,
                    "ddl_file": os.path.relpath(ddl_path, PROJECT_ROOT),
                    "backup_table": backup_name,
                }
            )
            print(f"  {table}: {count} rows -> DDL exported"
                  + (f", backed up as {backup_name}" if backup_name else ""))

    report_path = os.path.join(REPORT_DIR, f"inventory_{STAMP}.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(inventory, f, indent=2)
    print(f"\nInventory report: {report_path}")
    print(f"DDL exports: {EXPORT_DIR}")


if __name__ == "__main__":
    main()
