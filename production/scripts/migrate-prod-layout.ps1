<#
  migrate-prod-layout.ps1 - split production/images into docker-images + model-bundles; move docs.

  Usage:
    powershell -ExecutionPolicy Bypass -File production\scripts\migrate-prod-layout.ps1
#>
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Prod = Join-Path $Root "production"
$Legacy = Join-Path $Prod "images"
$DockerImages = Join-Path $Prod "docker-images"
$ModelBundles = Join-Path $Prod "model-bundles"
$Docs = Join-Path $Prod "docs"

New-Item -ItemType Directory -Force -Path $DockerImages, $ModelBundles, $Docs | Out-Null

$dockerMap = @{
    "01-db.tar"        = "sp-db.tar"
    "02-backend.tar"   = "sp-backend.tar"
    "03-frontend.tar"  = "sp-frontend.tar"
    "05-ai.tar"        = "sp-aimvp.tar"
    "06-qwen-vllm.tar" = "sp-llm.tar"
}
$modelTars = @(
    "07-llama-awq.tar", "09-seamless-m4t.tar", "10-indiclid.tar"
)

if (-not (Test-Path $Legacy)) {
    Write-Host "No legacy images folder - nothing to migrate."
    exit 0
}

Write-Host "==> Migrating from $Legacy"

foreach ($entry in $dockerMap.GetEnumerator()) {
    $src = Join-Path $Legacy $entry.Key
    if (-not (Test-Path $src)) { continue }
    $dest = Join-Path $DockerImages $entry.Value
    if (-not (Test-Path $dest)) {
        Move-Item $src $dest
        Write-Host ("    docker: {0} -> docker-images/{1}" -f $entry.Key, $entry.Value)
    }
}

foreach ($name in $modelTars) {
    $src = Join-Path $Legacy $name
    if (-not (Test-Path $src)) { continue }
    $dest = Join-Path $ModelBundles $name
    if (-not (Test-Path $dest)) {
        Move-Item $src $dest
        Write-Host ("    model: {0} -> model-bundles/" -f $name)
    }
}

Get-ChildItem $Prod -Filter "*.md" -File | ForEach-Object {
    $dest = Join-Path $Docs $_.Name
    if (-not (Test-Path $dest)) {
        Move-Item $_.FullName $dest
        Write-Host ("    doc: {0} -> docs/" -f $_.Name)
    }
}

Write-Host ""
Write-Host "==> Done. docker-images/ has SP image tars, model-bundles/ has model weights, docs/ has markdown."
Write-Host "    On prod run: ./scripts/01-create-folders.sh && ./scripts/validate-prod-layout.sh"
