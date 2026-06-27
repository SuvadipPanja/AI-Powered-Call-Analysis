@echo off
cd /d "%~dp0.."
echo Starting NeMo orchestrator in WSL (port 8000)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-nemo-wsl.ps1"
pause
