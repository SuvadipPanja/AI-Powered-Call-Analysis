"""Create Phase 2b DB table and verify Ollama scoring."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from dotenv import load_dotenv

load_dotenv()

from db import ensure_consolidated_table
from scoring_worker import ollama_health, score_call

print("=== Phase 2b setup ===")
ensure_consolidated_table()
print("Consolidated_Audio_Analysis: OK")

health = ollama_health()
print("Ollama:", health)

if not health.get("ready"):
    print("\nPull model first: ollama pull", os.getenv("OLLAMA_MODEL", "qwen3:4b"))
    sys.exit(1)

sample = """0.0 - 2.5 (Agent): Good morning, thank you for calling ABC Bank. How may I help you?
2.5 - 8.0 (Customer): I need help with my account balance.
8.0 - 15.0 (Agent): Sure, I can help. May I verify your account number please?
15.0 - 22.0 (Customer): Yes, it is 1234567890.
22.0 - 30.0 (Agent): Thank you. Your balance is fifty thousand rupees. Anything else?
30.0 - 32.0 (Customer): No, thank you.
32.0 - 35.0 (Agent): Thank you for calling ABC Bank. Have a nice day."""

print("\nRunning sample scoring (may take 1-3 min on CPU)...")
result = score_call(sample, "English")
print("Overall:", result.scores.get("Overall_Scoring"))
print("Summary:", result.summary[:120], "...")
print("Script compliance:", result.script_compliance)
print("Sentiment lines:", len(result.sentiment))
print("\nPhase 2b ready.")
