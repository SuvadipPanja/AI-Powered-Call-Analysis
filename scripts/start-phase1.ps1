# Phase 1 local dev — start backend, AI MVP, frontend (3 terminals)
$root = "C:\Project\AI-Powered Call Analysis project"

Write-Host "=== AI Call Analysis — Phase 1 ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "1) Backend:  cd `"$root\backend`" ; npm start"
Write-Host "2) AI MVP:   NeMo Docker: .\scripts\start-nemo-docker.ps1"
Write-Host "             Or dev (no NeMo): cd `"$root\ai-mvp`" ; pip install -r requirements.txt ; python orchestrator.py"
Write-Host "3) Frontend: cd `"$root\frontend`" ; npm start"
Write-Host ""
Write-Host "Optional Redis: docker compose -f `"$root\docker-compose.dev.yml`" up redis -d"
Write-Host "Login: http://localhost:3000/login  (admin / Admin@1234)"
Write-Host ""
