"""Phase 2c DB write test — enrichment + upsert without full Ollama wait."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()

from db import connect, upsert_scoring_result
from enrichment_worker import enrich_call

TRANSCRIPT = """0.0 - 2.5 (Agent): Good morning, thank you for calling UCO Bank. How may I assist you today?
2.5 - 8.0 (Customer): I am frustrated with a delay on my account balance update.
8.0 - 15.0 (Agent): I understand your concern. May I verify your account number please?
15.0 - 22.0 (Customer): Yes, my account number is 1234567890.
22.0 - 30.0 (Agent): Thank you. Your balance is fifty thousand rupees. Is there anything else?
30.0 - 32.0 (Customer): No, thank you.
32.0 - 35.0 (Agent): Thank you for calling UCO Bank. Have a nice day."""

TEST_FILE = "phase2c-e2e-test.wav"
enriched = enrich_call(TEST_FILE, TRANSCRIPT, "English")

upsert_scoring_result(
    TEST_FILE,
    TRANSCRIPT,
    "English",
    "00:00:35",
    "Success",
    "Ollama scoring skipped in e2e test",
    {"Overall_Scoring": 82, "Opening_Speech": 8, "Summary": "Agent verified account and shared balance."},
    "Agent verified account and shared balance.",
    enriched.sentiment,
    enriched.script_compliance,
    enriched.tone_analysis,
    45.0,
)

with connect() as c:
    cur = c.cursor()
    cur.execute(
        "SELECT Status, ScriptCompliance, LEN(Sentiment) FROM AI_Processing_Result WHERE AudioFileName=?",
        TEST_FILE,
    )
    print("APR:", cur.fetchone())
    cur.execute(
        "SELECT Status, ScriptCompliance, AI_Overall_Scoring FROM Consolidated_Audio_Analysis WHERE AudioFileName=?",
        TEST_FILE,
    )
    print("CAA:", cur.fetchone())
