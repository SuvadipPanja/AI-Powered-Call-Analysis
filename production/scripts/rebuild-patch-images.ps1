<#
  rebuild-patch-images.ps1 — build backend + frontend + AI patch tars WITHOUT docker pull.
  Uses existing loaded images as base (same workflow as prior prod hotfixes).

  Prerequisite: load base tars once if images missing:
    docker load -i production\images\02-backend.tar
    docker load -i production\images\03-frontend.tar
    docker load -i production\images\05-ai.tar

  Usage (project root, Docker Desktop running):
    powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-patch-images.ps1
#>

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Images = Join-Path $Root "production\images"
$Frontend = Join-Path $Root "frontend"

New-Item -ItemType Directory -Force -Path $Images | Out-Null

function Require-Image($tag) {
    docker image inspect $tag 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Image $tag not found. Run: docker load -i production\images\<tar>"
    }
}

function Save-Image($legacyTag, $spName, $legacyTarName) {
    $dockerDir = Join-Path $Root "production\docker-images"
    $legacyDir = Join-Path $Root "production\images"
    New-Item -ItemType Directory -Force -Path $dockerDir, $legacyDir | Out-Null
    $spFull = "${spName}:prod"
    docker tag $legacyTag $spFull
    if ($LASTEXITCODE -ne 0) { throw "docker tag failed: $legacyTag -> $spFull" }
    $outSp = Join-Path $dockerDir "$spName.tar"
    Write-Host "==> Saving $spFull -> docker-images/$spName.tar"
    docker save -o $outSp $spFull
    if ($LASTEXITCODE -ne 0) { throw "docker save failed: $spFull" }
    Copy-Item $outSp (Join-Path $legacyDir $legacyTarName) -Force
    $mb = [math]::Round((Get-Item $outSp).Length / 1MB, 1)
    Write-Host "    OK ($mb MB) + legacy images/$legacyTarName"
}

Write-Host "==> Project root: $Root"
Write-Host ""

Write-Host "==> [0/5] Normalizing shell scripts to LF (Linux prod) ..."
& "$Root\production\scripts\normalize-line-endings.ps1"
Write-Host ""

# --- Backend patch ---------------------------------------------------------
Write-Host "==> [1/5] Backend patch (call processing logs) ..."
Require-Image "ai-call-backend:prod"
docker build -t ai-call-backend:prod -f "$Root\production-build\docker\Dockerfile.backend.patch" $Root
if ($LASTEXITCODE -ne 0) { throw "backend patch failed" }
Save-Image "ai-call-backend:prod" "sp-backend" "02-backend.tar"

# --- Frontend: npm build + static patch ------------------------------------
Write-Host "==> [2/5] Frontend npm run build ..."
Require-Image "ai-powered-call-analysis-frontend:prod"
Push-Location $Frontend
if (-not (Test-Path "node_modules")) {
    Write-Host "    Installing npm dependencies (first time) ..."
    npm ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }
}
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
Pop-Location

Write-Host "==> [3/5] Frontend static patch ..."
docker build -t ai-powered-call-analysis-frontend:prod -f "$Root\production-build\docker\Dockerfile.frontend-static.patch" $Frontend
if ($LASTEXITCODE -ne 0) { throw "frontend patch failed" }
Save-Image "ai-powered-call-analysis-frontend:prod" "sp-frontend" "03-frontend.tar"

# --- AI orchestrator patch -------------------------------------------------
Write-Host "==> [4/5] AI orchestrator patch (prod logging + Llama backend) ..."
Require-Image "ai-call-orchestrator:prod"
docker build -t ai-call-orchestrator:prod -f "$Root\production-build\docker\Dockerfile.ai-hotfix.patch" $Root
if ($LASTEXITCODE -ne 0) { throw "ai patch failed" }
Save-Image "ai-call-orchestrator:prod" "sp-aimvp" "05-ai.tar"

Write-Host "==> [5/5] Done. Copy docker-images/ and model-bundles/ to prod:"
Write-Host "    Layout: production/docs/STRUCTURE.md"
Write-Host "    (Optional) pack model bundles into production\model-bundles\"
Get-ChildItem (Join-Path $Root "production\docker-images") -Filter "*.tar" -ErrorAction SilentlyContinue | ForEach-Object {
    $gb = [math]::Round($_.Length / 1GB, 2)
    Write-Host ("  docker-images/{0,-18} {1,8} GB" -f $_.Name, $gb)
}
Get-ChildItem $Images -Filter "*.tar" -ErrorAction SilentlyContinue | ForEach-Object {
    $gb = [math]::Round($_.Length / 1GB, 2)
    Write-Host ("  images/{0,-22} {1,8} GB (legacy)" -f $_.Name, $gb)
}
Write-Host ""
Write-Host "On prod: bash scripts/deploy-prod.sh  (CRLF auto-fixed inside script)"
