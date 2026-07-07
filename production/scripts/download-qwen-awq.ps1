<#
  Download Qwen3 AWQ models on DEV and pack model-bundles for air-gapped prod.
  Resumes partial downloads automatically.

  Usage:
    powershell -ExecutionPolicy Bypass -File production\scripts\download-qwen-awq.ps1

  Optional: $env:HF_TOKEN = "hf_xxx" for faster / gated downloads.
#>

$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$ModelsRoot = Join-Path $Root "production\volumes\models"
$BundleDir = Join-Path $Root "production\model-bundles"
New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null

function Test-ModelComplete {
    param([string]$Dir)
    $single = Join-Path $Dir "model.safetensors"
    if ((Test-Path $single) -and (Get-Item $single).Length -gt 1MB) { return $true }
    $indexPath = Join-Path $Dir "model.safetensors.index.json"
    if (-not (Test-Path $indexPath)) { return $false }
    try {
        $index = Get-Content $indexPath -Raw | ConvertFrom-Json
    } catch {
        return $false
    }
    $shards = $index.weight_map.PSObject.Properties.Value | Sort-Object -Unique
    foreach ($shard in $shards) {
        $shardPath = Join-Path $Dir $shard
        if (-not (Test-Path $shardPath) -or (Get-Item $shardPath).Length -eq 0) {
            Write-Host "    missing/empty shard: $shard"
            return $false
        }
    }
    return $true
}

function Ensure-Model {
    param(
        [string]$Repo,
        [string]$DirName
    )
    $dir = Join-Path $ModelsRoot $DirName
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    if (Test-ModelComplete -Dir $dir) {
        Write-Host "==> $DirName already complete"
        return
    }
    Write-Host "==> Downloading $Repo -> $DirName ..."
    python -c @"
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='$Repo',
    local_dir=r'$dir',
    max_workers=4,
)
print('Download OK')
"@
    if ($LASTEXITCODE -ne 0) { throw "Download failed for $Repo" }
    if (-not (Test-ModelComplete -Dir $dir)) {
        throw "Download finished but weight shards still missing in $dir"
    }
}

function Pack-ModelTar {
    param(
        [string]$DirName,
        [string]$TarName
    )
    $dir = Join-Path $ModelsRoot $DirName
    if (-not (Test-ModelComplete -Dir $dir)) {
        Write-Host "!! SKIP tar $TarName - model incomplete"
        return
    }
    $tarOut = Join-Path $BundleDir $TarName
    Write-Host "==> Packing $TarName ..."
    if (Test-Path $tarOut) { Remove-Item $tarOut -Force }
    Push-Location $ModelsRoot
    tar --exclude="$DirName/.git" --exclude="$DirName/.cache" -cf $tarOut $DirName
    Pop-Location
    $gb = [math]::Round((Get-Item $tarOut).Length / 1GB, 2)
    Write-Host ('==> {0} ({1} GB)' -f $TarName, $gb)
}

Ensure-Model -Repo "Qwen/Qwen3-14B-AWQ" -DirName "Qwen3-14B-AWQ"
Ensure-Model -Repo "Qwen/Qwen3-8B-AWQ"  -DirName "Qwen3-8B-AWQ"

Pack-ModelTar -DirName "Qwen3-14B-AWQ" -TarName "14-qwen3-14b-awq.tar"
Pack-ModelTar -DirName "Qwen3-8B-AWQ"  -TarName "15-qwen3-8b-awq.tar"

# emotion2vec+ (tone backend) - model.pt already on disk from prior download.
$emoDir = Join-Path $ModelsRoot "emotion2vec_plus_large"
if (Test-Path (Join-Path $emoDir "model.pt")) {
    $emoTar = Join-Path $BundleDir "16-emotion2vec-plus-large.tar"
    if (-not (Test-Path $emoTar)) {
        Write-Host "==> Packing 16-emotion2vec-plus-large.tar ..."
        Push-Location $ModelsRoot
        tar --exclude="emotion2vec_plus_large/.git" --exclude="emotion2vec_plus_large/.cache" -cf $emoTar emotion2vec_plus_large
        Pop-Location
        $gb = [math]::Round((Get-Item $emoTar).Length / 1GB, 2)
        Write-Host ('==> 16-emotion2vec-plus-large.tar ({0} GB)' -f $gb)
    } else {
        Write-Host "==> 16-emotion2vec-plus-large.tar already exists"
    }
} else {
    Write-Host "!! emotion2vec_plus_large/model.pt missing - tone falls back to librosa on prod"
}

Write-Host "==> Qwen + emotion2vec bundle step done"
