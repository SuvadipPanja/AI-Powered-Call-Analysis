# Run NeMo WSL one-time setup (requires admin for apt in WSL)
$script = "/mnt/c/Project/AI-Powered Call Analysis project/scripts/setup-nemo-wsl.sh"
Write-Host "Installing NeMo in WSL Ubuntu (10-20 min)..." -ForegroundColor Cyan
wsl -d Ubuntu-22.04 -u root bash $script
