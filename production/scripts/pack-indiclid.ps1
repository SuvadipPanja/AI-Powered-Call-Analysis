<#

  pack-indiclid.ps1 - pack IndicLID weights for offline prod (10-indiclid.tar).



  Usage (project root):

    powershell -ExecutionPolicy Bypass -File production\scripts\pack-indiclid.ps1

    powershell -ExecutionPolicy Bypass -File production\scripts\pack-indiclid.ps1 -ModelDir "production\volumes\models\indiclid"

#>

param(

    [string]$ModelDir = ""

)



$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

if (-not $ModelDir) {

    $ModelDir = Join-Path $Root "production\volumes\models\indiclid"

} else {

    $ModelDir = (Resolve-Path $ModelDir).Path

}

$Images = Join-Path $Root "production\model-bundles"
$LegacyImages = Join-Path $Root "production\images"
New-Item -ItemType Directory -Force -Path $Images, $LegacyImages | Out-Null

$TarName = "10-indiclid.tar"

$TarPath = Join-Path $Images $TarName

$Leaf = Split-Path $ModelDir -Leaf

$Parent = Split-Path $ModelDir -Parent



New-Item -ItemType Directory -Force -Path $Images | Out-Null



$Required = @(

    "indiclid-ftn/model_baseline_roman.bin",

    "indiclid-ftr/model_baseline_roman.bin",

    "indiclid-bert/basline_nn_simple.pt"

)



Write-Host "==> IndicLID pack"

Write-Host "    Source: $ModelDir"

Write-Host "    Output: $TarPath"

Write-Host ""



$missing = @()

foreach ($f in $Required) {

    $p = Join-Path $ModelDir ($f -replace '/', '\')

    if (-not (Test-Path $p)) {

        $missing += $f

    } else {

        $mb = [math]::Round((Get-Item $p).Length / 1MB, 1)

        Write-Host ('    OK {0} ({1} MB)' -f $f, $mb)

    }

}

if ($missing.Count -gt 0) {

    throw "Missing required files. Run download-indiclid.ps1 first: $($missing -join ', ')"

}



$tokDir = Join-Path $ModelDir "IndicBERTv2-MLM-only"

if (Test-Path $tokDir) {

    Write-Host "    OK IndicBERTv2-MLM-only/ (tokenizer)"

} else {

    Write-Host "    WARN: IndicBERT tokenizer missing - IndicLID roman path may fail offline"

}



Write-Host ""

Write-Host "==> Building $TarName ..."



Push-Location $Parent

try {

    $entries = @(

        "$Leaf/indiclid-ftn/model_baseline_roman.bin",

        "$Leaf/indiclid-ftr/model_baseline_roman.bin",

        "$Leaf/indiclid-bert/basline_nn_simple.pt"

    )

    if (Test-Path $tokDir) {

        Get-ChildItem $tokDir -File -Recurse | ForEach-Object {

            $rel = $_.FullName.Substring($ModelDir.Length + 1) -replace '\\', '/'

            $entries += "$Leaf/$rel"

        }

    }

    & tar -cf $TarPath @entries

    if ($LASTEXITCODE -ne 0) { throw "tar failed" }

} finally {

    Pop-Location

}



$mb = [math]::Round((Get-Item $TarPath).Length / 1MB, 1)

$ts = (Get-Item $TarPath).LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")

Write-Host ('==> Created {0} ({1} MB) at {2}' -f $TarName, $mb, $ts)
Copy-Item $TarPath (Join-Path $LegacyImages $TarName) -Force -ErrorAction SilentlyContinue
Write-Host "    Copy model-bundles/$TarName to prod and run: bash scripts/extract-indiclid.sh"



