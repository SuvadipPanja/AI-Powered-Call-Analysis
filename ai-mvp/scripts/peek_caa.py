import os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv
load_dotenv()
from db import connect
with connect() as c:
    cur = c.cursor()
    cur.execute("SELECT COUNT(*) FROM Consolidated_Audio_Analysis WHERE Status='Success'")
    print('success', cur.fetchone()[0])
    cur.execute("SELECT COUNT(*) FROM Consolidated_Audio_Analysis WHERE SelectedCallDate IS NULL")
    print('null SelectedCallDate', cur.fetchone()[0])
    cur.execute("SELECT TOP 3 AudioFileName, SelectedCallDate, AgentName, AI_Overall_Scoring, Status FROM Consolidated_Audio_Analysis")
    for r in cur.fetchall():
        print(r)
