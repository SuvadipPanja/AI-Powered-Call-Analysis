# Build fixed backend + AI images and save to production/images/
# Run from project ROOT in PowerShell (Docker Desktop running):
#   .\production-build\build-fixed-images.ps1
#
# AI stage-1 base must exist OR pass -BuildAiBase (slow, ~30+ min first time).

param(
    [switch]$BuildAiBase,
    [switch]$BackendOnly,
    [switch]$AiOnly
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path "$Root\backend\server.js")) {
    throw "Project root not found (expected backend\server.js under $Root)"
}

$ImagesDir = Join-Path $Root "production\images"
New-Item -ItemType Directory -Force -Path $ImagesDir | Out-Null

function Save-Image($tag, $outFile) {
    Write-Host "==> Saving $tag -> $outFile"
    docker save -o $outFile $tag
    if ($LASTEXITCODE -ne 0) { throw "docker save failed: $tag" }
    $mb = [math]::Round((Get-Item $outFile).Length / 1MB, 1)
    Write-Host "    OK ($mb MB)"
}

if (-not $AiOnly) {
    Write-Host "`n=== Building backend (02-backend.tar) ==="
    docker build -t ai-call-backend:prod "$Root\backend"
    if ($LASTEXITCODE -ne 0) { throw "backend build failed" }
    Save-Image "ai-call-backend:prod" (Join-Path $ImagesDir "02-backend.tar")
}

if (-not $BackendOnly) {
    if ($BuildAiBase) {
        Write-Host "`n=== Building AI GPU base (slow) ==="
        docker build -t ai-orchestrator-gpu-base:prod -f "$Root\ai-mvp\Dockerfile.gpu" "$Root\ai-mvp"
        if ($LASTEXITCODE -ne 0) { throw "ai base build failed" }
    } else {
        docker image inspect ai-orchestrator-gpu-base:prod 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) {
            Write-Host "!! ai-orchestrator-gpu-base:prod not found. Re-run with -BuildAiBase"
            exit 1
        }
    }

    Write-Host "`n=== Building AI prod overlay (05-ai.tar) ==="
    docker build -t ai-call-orchestrator:prod -f "$Root\production-build\docker\Dockerfile.orchestrator.prod" $Root
    if ($LASTEXITCODE -ne 0) { throw "ai overlay build failed" }
    Save-Image "ai-call-orchestrator:prod" (Join-Path $ImagesDir "05-ai.tar")
}

Write-Host "`n=== Done ==="
Write-Host "Copy production/ folder to prod server (see COPY-TO-PROD.md)"
Get-ChildItem $ImagesDir\*.tar | ForEach-Object { Write-Host "  $($_.Name)  $([math]::Round($_.Length/1GB,2)) GB" }
