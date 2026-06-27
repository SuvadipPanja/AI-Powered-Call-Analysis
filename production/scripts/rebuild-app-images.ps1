<#
  rebuild-app-images.ps1  (run on the Windows DEV/build machine)

  Rebuilds ONLY the backend + frontend images and saves them as tars for
  transfer to the air-gapped prod server (10.64.194.130). Does NOT touch
  db / redis / qwen / ai images — those are unchanged.

  Frontend host is baked from frontend/.env.production
  (REACT_APP_API_BASE_URL=http://10.64.194.130:5000). Edit that file if the
  prod IP changes, then re-run.

  Usage (from anywhere):
    powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-app-images.ps1
#>

$ErrorActionPreference = "Stop"

# Resolve project root = two levels up from this script (production/scripts -> root)
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root      = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$Images    = Join-Path $Root "production\images"

New-Item -ItemType Directory -Force -Path $Images | Out-Null

Write-Host "==> Project root: $Root"
Write-Host "==> Images out:   $Images"
Write-Host ""

# --- Backend ---------------------------------------------------------------
Write-Host "==> [1/4] Building ai-call-backend:prod ..."
docker build -t ai-call-backend:prod (Join-Path $Root "backend")
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }

# --- Frontend (bakes 10.64.194.130 from .env.production) --------------------
Write-Host "==> [2/4] Building ai-powered-call-analysis-frontend:prod ..."
docker build -t ai-powered-call-analysis-frontend:prod (Join-Path $Root "frontend")
if ($LASTEXITCODE -ne 0) { throw "frontend build failed" }

# --- Save tars -------------------------------------------------------------
Write-Host "==> [3/4] Saving 02-backend.tar ..."
docker save -o (Join-Path $Images "02-backend.tar") ai-call-backend:prod
if ($LASTEXITCODE -ne 0) { throw "backend save failed" }

Write-Host "==> [4/4] Saving 03-frontend.tar ..."
docker save -o (Join-Path $Images "03-frontend.tar") ai-powered-call-analysis-frontend:prod
if ($LASTEXITCODE -ne 0) { throw "frontend save failed" }

Write-Host ""
Write-Host "DONE. Transfer these two files to prod (production/images/):"
Get-ChildItem $Images -Filter "0*-*.tar" | Select-Object Name, @{N="Size(MB)";E={[math]::Round($_.Length/1MB,1)}} | Format-Table -AutoSize
Write-Host ""
Write-Host "Next: copy 02-backend.tar + 03-frontend.tar to the prod server, then run the"
Write-Host "      deploy commands in production/DEPLOY-TRANSCRIPT-UPDATE.md"
