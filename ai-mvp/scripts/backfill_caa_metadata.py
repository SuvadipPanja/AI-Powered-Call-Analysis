"""Backfill Consolidated_Audio_Analysis metadata from AudioUploads."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()
from db import connect


def main() -> None:
    with connect() as conn:
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE caa
            SET
              caa.UploadDate = COALESCE(caa.UploadDate, au.UploadDate),
              caa.AgentName = CASE
                WHEN caa.AgentName IS NULL OR caa.AgentName = 'Unknown'
                THEN COALESCE(au.SelectedAgent, caa.AgentName)
                ELSE caa.AgentName
              END,
              caa.SelectedCallDate = COALESCE(caa.SelectedCallDate, au.SelectedCallDate),
              caa.CallType = COALESCE(NULLIF(caa.CallType, ''), au.CallType, 'inbound')
            FROM Consolidated_Audio_Analysis caa
            INNER JOIN AudioUploads au ON au.AudioFileName = caa.AudioFileName
            """
        )
        updated = cur.rowcount
        conn.commit()
        print(f"Backfilled metadata for {updated} row(s).")

        cur.execute(
            "SELECT COUNT(*) FROM Consolidated_Audio_Analysis WHERE SelectedCallDate IS NULL AND Status = 'Success'"
        )
        print("Success rows still missing SelectedCallDate:", cur.fetchone()[0])


if __name__ == "__main__":
    main()
