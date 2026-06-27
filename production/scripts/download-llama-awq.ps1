<#
  Download Llama-3.1-8B-Instruct AWQ on DEV (offline prod has no internet).
  Then pack as tar for copy to prod.

  Usage:
    powershell -ExecutionPolicy Bypass -File production\scripts\download-llama-awq.ps1

  Optional: set a Hugging Face token for higher rate limits / faster downloads:
    $env:HF_TOKEN = "hf_xxx"
#>

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ModelDir = Join-Path $Root "production\volumes\models\Meta-Llama-3.1-8B-Instruct-AWQ"
$ImagesDir = Join-Path $Root "production\images"
$TarOut = Join-Path $ImagesDir "07-llama-awq.tar"
$HFRepo = "hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4"

New-Item -ItemType Directory -Force -Path $ModelDir | Out-Null
New-Item -ItemType Directory -Force -Path $ImagesDir | Out-Null

# Verify that ALL weight shards listed in the index are present (not just config.json).
# A previous bug skipped the download when only config.json existed, leaving the
# model without its .safetensors weights.
function Test-ModelComplete {
    param([string]$Dir)
    $indexPath = Join-Path $Dir "model.safetensors.index.json"
    if (-not (Test-Path $indexPath)) { return $false }
    try {
        $index = Get-Content $indexPath -Raw | ConvertFrom-Json
    } catch {
        return $false
    }
    $weightMap = $index.weight_map
    if ($null -eq $weightMap) { return $false }
    $shards = $weightMap.PSObject.Properties.Value | Sort-Object -Unique
    foreach ($shard in $shards) {
        $shardPath = Join-Path $Dir $shard
        if (-not (Test-Path $shardPath) -or (Get-Item $shardPath).Length -eq 0) {
            Write-Host "    missing/empty weight shard: $shard"
            return $false
        }
    }
    return $true
}

if (Test-ModelComplete -Dir $ModelDir) {
    Write-Host "==> Model already downloaded (all weight shards present) at $ModelDir"
} else {
    Write-Host "==> Downloading $HFRepo (~6 GB, needs internet) ..."
    # snapshot_download resumes partial downloads automatically.
    python -c @"
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='$HFRepo',
    local_dir=r'$ModelDir',
    max_workers=4,
)
print('Download OK')
"@
    if ($LASTEXITCODE -ne 0) {
        Write-Host ""
        Write-Host "If download failed (401/gated or rate limit):"
        Write-Host "  python -m pip install -U huggingface_hub"
        Write-Host "  `$env:HF_TOKEN = 'hf_xxx'   # or: python -m huggingface_hub.commands.huggingface_cli login"
        Write-Host "  Accept license at https://huggingface.co/$HFRepo"
        throw "Model download failed"
    }
    if (-not (Test-ModelComplete -Dir $ModelDir)) {
        throw "Download finished but weight shards are still missing/incomplete in $ModelDir"
    }
}

Write-Host "==> Creating tar: $TarOut"
if (Test-Path $TarOut) { Remove-Item $TarOut -Force }
Push-Location (Join-Path $Root "production\volumes\models")
# Exclude .git (git-lfs clones keep a second full-size copy of the weights here)
# and .cache (huggingface partial-download bookkeeping) to avoid bloating the tar.
tar --exclude='Meta-Llama-3.1-8B-Instruct-AWQ/.git' --exclude='Meta-Llama-3.1-8B-Instruct-AWQ/.cache' -cf $TarOut Meta-Llama-3.1-8B-Instruct-AWQ
Pop-Location

$gb = [math]::Round((Get-Item $TarOut).Length / 1GB, 2)
Write-Host "==> Done: 07-llama-awq.tar ($gb GB)"
Get-ChildItem $ModelDir | Select-Object Name, @{N='MB';E={[math]::Round($_.Length/1MB,1)}} | Format-Table
