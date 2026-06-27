# Start ai-mvp orchestrator with NeMo in WSL (port 8000) — preferred on laptop (no GPU).
# Uses local models under models/ and ai-mvp/.venv-wsl (no Docker image pull).
param(
    [switch]$Background
)

Write-Host "=== NeMo via WSL (ai-mvp on port 8000) ===" -ForegroundColor Cyan
Write-Host "Local: models/nemo/*.nemo, models/Whisper-large-v3/, .venv-wsl" -ForegroundColor Green
Write-Host "Stop any process on port 8000 first." -ForegroundColor Yellow
Write-Host ""

$script = "/mnt/c/Project/AI-Powered Call Analysis project/scripts/start-nemo-wsl.sh"
if ($Background) {
    Start-Process wsl -ArgumentList "-d", "Ubuntu-22.04", "-u", "root", "bash", $script -WindowStyle Hidden
    Write-Host "Started in background. Health: http://localhost:8000/health (models load ~1-3 min on CPU)" -ForegroundColor Green
} else {
    wsl -d Ubuntu-22.04 -u root bash $script
}
