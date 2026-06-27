# Start ai-mvp orchestrator with NeMo inside Docker (port 8000)
# Replaces WSL native NeMo install — uses existing Dockerfile.gpu + nvcr.io/nvidia/nemo:23.04
param(
    [switch]$Gpu,
    [switch]$Foreground
)

$root = Split-Path $PSScriptRoot -Parent
$composeBase = Join-Path $root "docker-compose.nemo.yml"
$composeGpu = Join-Path $root "docker-compose.nemo.gpu.yml"

Write-Host "=== NeMo via Docker (ai-mvp on port 8000) ===" -ForegroundColor Cyan
Write-Host "Laptop without GPU: prefer WSL (no image pull): .\scripts\start-nemo-wsl.ps1" -ForegroundColor Yellow

$nemoBase = (& docker images -q "nvcr.io/nvidia/nemo:23.04" 2>$null)
$appImage = (& docker images -q "ai-call-mvp-nemo" 2>$null)
if (-not $nemoBase -and -not $appImage) {
    Write-Host "WARNING: nvcr.io/nvidia/nemo:23.04 not cached — first run downloads ~10GB from NVIDIA registry." -ForegroundColor Red
    Write-Host "Models in models/ are mounted locally; only the Docker BASE image was missing." -ForegroundColor Yellow
    $tar = Join-Path $root "docker-images\nemo-23.04.tar"
    if (Test-Path $tar) {
        Write-Host "Loading cached image from $tar ..." -ForegroundColor Green
        docker load -i $tar
    }
} else {
    Write-Host "Docker image cached — no base-image pull expected." -ForegroundColor Green
}
Write-Host "Stop any native ai-mvp or WSL process on port 8000 first." -ForegroundColor Yellow
Write-Host ""

Push-Location $root
try {
    $args = @("compose", "-f", $composeBase)
    if ($Gpu) {
        Write-Host "GPU mode: NEMO_DEVICE=cuda" -ForegroundColor Green
        $args += @("-f", $composeGpu)
    } else {
        Write-Host "CPU mode (slow). For GPU: .\scripts\start-nemo-docker.ps1 -Gpu" -ForegroundColor Yellow
    }
    $args += @("up", "--build")
    if (-not $Foreground) { $args += "-d" }

    & docker @args
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    Write-Host ""
    Write-Host "Health check: http://localhost:8000/health" -ForegroundColor Green
    Write-Host "Backend AI_MAIN_URL: http://localhost:8000" -ForegroundColor Green
    if (-not $Foreground) {
        Write-Host "Logs: docker compose -f docker-compose.nemo.yml logs -f ai-mvp-nemo" -ForegroundColor Gray
    }
} finally {
    Pop-Location
}
