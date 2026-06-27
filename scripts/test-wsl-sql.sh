#!/usr/bin/env bash
set -euo pipefail
WIN_HOST="$(ip route show default | awk '{print $3}')"
source "/mnt/c/Project/AI-Powered Call Analysis project/ai-mvp/.venv-wsl/bin/activate"
python - <<PY
import pyodbc
host = "${WIN_HOST},${DB_TCP_PORT:-1434}"
conn = pyodbc.connect(
    "DRIVER={ODBC Driver 18 for SQL Server};"
    f"SERVER={host};DATABASE=call_analysis_db;"
    "UID=sa;PWD=Root@1234;TrustServerCertificate=yes;Encrypt=no",
    timeout=10,
)
cur = conn.cursor()
cur.execute("SELECT 1")
print("SQL OK from WSL via", host)
conn.close()
PY
