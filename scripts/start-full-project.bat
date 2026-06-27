@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0.."
set "ROOT=%CD%"

title AI Call Analysis - Full Stack Launcher
color 0A

echo.
echo ============================================================
echo   AI Call Analysis - Full End-to-End Stack
echo ============================================================
echo   Project: %ROOT%
echo   AI      : faster-whisper + Ollama + Phase 2c (port 8000)
echo   Scoring : Ollama gemma3:4b (must be running)
echo   Enrich  : librosa tone + DistilBERT sentiment + MiniLM script
echo   Backend : Express API             (port 5000)
echo   Frontend: React UI                (port 3000)
echo ============================================================
echo.

REM --- Prerequisites ---
where python >nul 2>&1 || (
  echo [ERROR] Python not found. Install Python 3.10+ and add to PATH.
  pause & exit /b 1
)
where node >nul 2>&1 || (
  echo [ERROR] Node.js not found. Install Node.js LTS.
  pause & exit /b 1
)
where npm >nul 2>&1 || (
  echo [ERROR] npm not found.
  pause & exit /b 1
)

if not exist "%ROOT%\models\faster-whisper-large-v3\model.bin" (
  echo [WARN] faster-whisper model not found at models\faster-whisper-large-v3\model.bin
  echo        Run: python scripts\download-faster-whisper-model.py
  echo        Or set TRANSCRIBE_BACKEND=whisper-large-v3 in ai-mvp\.env
  echo.
)

if not exist "%ROOT%\backend\node_modules" (
  echo [INFO] Installing backend dependencies...
  pushd "%ROOT%\backend" && call npm install && popd
)

if not exist "%ROOT%\frontend\node_modules" (
  echo [INFO] Installing frontend dependencies...
  pushd "%ROOT%\frontend" && call npm install && popd
)

echo [INFO] Starting services in 3 separate windows...
echo.

REM --- AI orchestrator (loads models on first request; window stays open) ---
start "AI MVP :8000" cmd /k "cd /d ""%ROOT%\ai-mvp"" && echo. && echo === AI Orchestrator :8000 === && echo Phase 2a: faster-whisper ^| Phase 2b: Ollama scoring && echo Health: http://localhost:8000/health && echo. && python orchestrator.py"
timeout /t 4 /nobreak >nul

REM --- Backend API ---
start "Backend :5000" cmd /k "cd /d ""%ROOT%\backend"" && echo. && echo === Backend API :5000 === && echo AI_MAIN_URL=http://localhost:8000 && echo. && npm start"
timeout /t 3 /nobreak >nul

REM --- Frontend UI ---
start "Frontend :3000" cmd /k "cd /d ""%ROOT%\frontend"" && echo. && echo === Frontend UI :3000 === && echo Login: http://localhost:3000/login && echo. && npm start"

echo [INFO] Waiting for services to come up (AI models may take 1-3 min on first run)...
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ai='http://localhost:8000/health'; $be='http://localhost:5000'; $okAi=$false; $okBe=$false; " ^
  "for ($i=1; $i -le 60; $i++) { " ^
  "  if (-not $okAi) { try { $r=Invoke-RestMethod -Uri $ai -TimeoutSec 5; if ($r.success) { $okAi=$true; Write-Host ('[OK] AI orchestrator ready - backend: ' + $r.transcription.active_backend) -ForegroundColor Green } } catch {} } " ^
  "  if (-not $okBe) { if (Test-NetConnection -ComputerName localhost -Port 5000 -WarningAction SilentlyContinue -InformationLevel Quiet) { $okBe=$true; Write-Host '[OK] Backend API ready on :5000' -ForegroundColor Green } } " ^
  "  if ($okAi -and $okBe) { break } " ^
  "  Write-Host ('  waiting... ' + $i + '/60') -ForegroundColor DarkGray; Start-Sleep -Seconds 5 " ^
  "} " ^
  "if (-not $okAi) { Write-Host '[WARN] AI :8000 not ready yet - check the AI MVP window' -ForegroundColor Yellow } " ^
  "if (-not $okBe) { Write-Host '[WARN] Backend :5000 not ready yet - check the Backend window' -ForegroundColor Yellow }"

echo.
echo ============================================================
echo   READY TO TEST
echo ============================================================
echo   Login   : http://localhost:3000/login
echo   User    : admin
echo   Password: Admin@1234
echo.
echo   Health  : http://localhost:8000/health
echo   Upload  : Upload page after login - use STEREO audio
echo             (Agent = left channel, Customer = right channel)
echo.
echo   Status flow: Pending -^> In Progress -^> Transcribed
echo.
echo   Logs:
echo     %ROOT%\logs\Backend Log\python_script.log
echo     %ROOT%\logs\ai-mvp\
echo ============================================================
echo.

start "" "http://localhost:3000/login"

echo Browser opened. Keep all 3 service windows running.
echo Close those windows to stop the stack.
echo.
pause
