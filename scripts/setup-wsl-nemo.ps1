# Run from PowerShell as Administrator (first time only for WSL)
Write-Host "=== WSL NeMo setup ===" -ForegroundColor Cyan
wsl -l -v
Write-Host ""
Write-Host "Installing NeMo inside Ubuntu-22.04 (10-20 min)..." -ForegroundColor Yellow
wsl -d Ubuntu-22.04 -u root bash "/mnt/c/Project/AI-Powered Call Analysis project/scripts/setup-wsl-nemo.sh"
Write-Host ""
Write-Host "Done. Start with:" -ForegroundColor Green
Write-Host '  wsl -d Ubuntu-22.04 bash "/mnt/c/Project/AI-Powered Call Analysis project/scripts/start-wsl-nemo.sh"'
