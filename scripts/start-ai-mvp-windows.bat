@echo off
cd /d "%~dp0..\ai-mvp"
echo Starting AI orchestrator on port 8000 (Windows, faster-whisper Large v3)...
echo Uses same SQL as backend — no WSL required.
python orchestrator.py
pause
