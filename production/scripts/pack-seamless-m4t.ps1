<#
  pack-seamless-m4t.ps1 — pack SeamlessM4T v2 Large weights for offline prod.
  Creates production/images/09-seamless-m4t.tar (model weights only, NOT docker load).

  Usage (project root):
    powershell -ExecutionPolicy Bypass -File production\scripts\pack-seamless-m4t.ps1
    powershell -ExecutionPolicy Bypass -File production\scripts\pack-seamless-m4t.ps1 -ModelDir "D:\models\seamless-m4t-v2-large"
#>
param(
    [string]$ModelDir = ""
)

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $ModelDir) {
    $ModelDir = Join-Path $Root "models\seamless-m4t-v2-large"
}
$ModelDir = (Resolve-Path $ModelDir).Path
$Images = Join-Path $Root "production\images"
$TarName = "09-seamless-m4t.tar"
$TarPath = Join-Path $Images $TarName
$Leaf = Split-Path $ModelDir -Leaf
$Parent = Split-Path $ModelDir -Parent

New-Item -ItemType Directory -Force -Path $Images | Out-Null

$Required = @(
    "config.json",
    "generation_config.json",
    "model.safetensors.index.json",
    "model-00001-of-00002.safetensors",
    "model-00002-of-00002.safetensors",
    "preprocessor_config.json",
    "tokenizer_config.json",
    "tokenizer.model",
    "sentencepiece.bpe.model",
    "special_tokens_map.json",
    "added_tokens.json",
    "spm_char_lang38_tc.model"
)

Write-Host "==> SeamlessM4T pack"
Write-Host "    Source: $ModelDir"
Write-Host "    Output: $TarPath"
Write-Host ""

$missing = @()
foreach ($f in $Required) {
    $p = Join-Path $ModelDir $f
    if (-not (Test-Path $p)) {
        $missing += $f
    } else {
        $mb = [math]::Round((Get-Item $p).Length / 1MB, 1)
        Write-Host "    OK $f ($mb MB)"
    }
}
if ($missing.Count -gt 0) {
    throw "Missing required files: $($missing -join ', ')"
}

Write-Host ""
Write-Host "==> Building $TarName (safetensors + tokenizer only; excludes .pt / .git) ..."

Push-Location $Parent
try {
    $entries = $Required | ForEach-Object { "$Leaf/$_" }
    & tar -cf $TarPath @entries
    if ($LASTEXITCODE -ne 0) { throw "tar failed" }
} finally {
    Pop-Location
}

$gb = [math]::Round((Get-Item $TarPath).Length / 1GB, 2)
$ts = (Get-Item $TarPath).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
Write-Host "==> Created $TarName ($gb GB) at $ts"
Write-Host "    Copy to prod production/images/ and run: bash scripts/extract-seamless-m4t.sh"
