"""Validate fixed outbound-calls-weekly SQL against live DB."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()
from db import connect

SQL = """
SELECT 
  CONCAT('Week ', weekNumber) AS week,
  weekNumber,
  callCount
FROM (
  SELECT 
    DATEPART(WEEK, COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))) AS weekNumber,
    YEAR(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))) AS callYear,
    COUNT(*) AS callCount
  FROM Consolidated_Audio_Analysis
  WHERE CallType = 'outbound' 
    AND COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)) >= DATEADD(WEEK, -8, GETDATE())
    AND Status = 'Success'
  GROUP BY
    DATEPART(WEEK, COALESCE(SelectedCallDate, CAST(UploadDate AS DATE))),
    YEAR(COALESCE(SelectedCallDate, CAST(UploadDate AS DATE)))
) weekly
ORDER BY callYear DESC, weekNumber DESC
"""

with connect() as conn:
    cur = conn.cursor()
    cur.execute(SQL)
    rows = cur.fetchall()
    print("outbound weekly rows:", len(rows))
    for row in rows[:5]:
        print(row)
