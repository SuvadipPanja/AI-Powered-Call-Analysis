import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()

from db import connect, upsert_scoring_result
from scoring_worker import score_call

SAMPLE = """0.0 - 2.5 (Agent): Good morning, thank you for calling ABC Bank.
2.5 - 8.0 (Customer): I need help with my account balance.
8.0 - 15.0 (Agent): May I verify your account number please?"""

TEST_FILE = "phase2b-test-sample.mp3"
r = score_call(SAMPLE, "English")
upsert_scoring_result(
    TEST_FILE,
    SAMPLE,
    "English",
    "00:00:15",
    "Stereo",
    r.raw_text,
    r.scores,
    r.summary or "Test summary",
    r.sentiment,
    r.script_compliance,
    r.tone_analysis,
    20.0,
)

with connect() as c:
    cur = c.cursor()
    cur.execute(
        "SELECT Status, AI_Summary, AI_Overall_Scoring FROM Consolidated_Audio_Analysis WHERE AudioFileName = ?",
        TEST_FILE,
    )
    print("CAA:", cur.fetchone())
    cur.execute(
        "SELECT Status FROM AI_Processing_Result WHERE AudioFileName = ?",
        TEST_FILE,
    )
    print("APR:", cur.fetchone())
