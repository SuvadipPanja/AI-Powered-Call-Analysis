# Bundle Pyannote offline models (no .cache / lock files) for prod transfer.
$ErrorActionPreference = "Stop"
$Root = "C:\Project\AI-Powered Call Analysis project"
$Src = Join-Path $Root "production\volumes\models\pyannote"
$OutDir = Join-Path $Root "production\model-bundles"
$Bundle = Join-Path $OutDir "pyannote-offline-bundle.tar.gz"
$Script = Join-Path $OutDir "extract-pyannote-offline.sh"

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

python "$Root\production-build\bundle_pyannote_offline.py" --src $Src --out $Bundle --extract-script $Script

Write-Host ""
Write-Host "Bundle ready: $Bundle"
Get-Item $Bundle | Format-Table Name, @{N='MB';E={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
Write-Host "Prod extract script: $Script"
