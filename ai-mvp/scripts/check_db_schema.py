import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()
from db import connect

with connect() as c:
    cur = c.cursor()
    cur.execute(
        """
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME IN ('Consolidated_Audio_Analysis','AI_Details_Scoring','AI_Processing_Result')
        """
    )
    print("tables:", [r[0] for r in cur.fetchall()])
    cur.execute(
        """
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='AI_Processing_Result' ORDER BY ORDINAL_POSITION
        """
    )
    print("APR cols:", [r[0] for r in cur.fetchall()])
    cur.execute(
        """
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME='Consolidated_Audio_Analysis' ORDER BY ORDINAL_POSITION
        """
    )
    rows = cur.fetchall()
    print("CAA cols:", [r[0] for r in rows] if rows else "TABLE MISSING")
    for table in ("AudioUploads", "AI_Details_Scoring", "ActiveSessions"):
        cur.execute(
            f"""
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME='{table}' ORDER BY ORDINAL_POSITION
            """
        )
        print(f"{table}:", [r[0] for r in cur.fetchall()])
