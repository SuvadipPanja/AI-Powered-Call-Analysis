<#

  download-indiclid.ps1 - AI4Bharat IndicLID v1.0 + IndicBERT tokenizer (offline prod pack).



  Usage (project root):

    powershell -ExecutionPolicy Bypass -File production\scripts\download-indiclid.ps1

    powershell -ExecutionPolicy Bypass -File production\scripts\download-indiclid.ps1 -SkipTokenizer

#>

param(

    [switch]$SkipTokenizer,

    [switch]$SkipSslVerify

)



$ErrorActionPreference = "Stop"

$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$Dest = Join-Path $Root "production\volumes\models\indiclid"

$Images = Join-Path $Root "production\images"



New-Item -ItemType Directory -Force -Path $Dest, $Images | Out-Null



$Release = "https://github.com/AI4Bharat/IndicLID/releases/download/v1.0"

$Zips = @(

    @{ Name = "indiclid-ftn.zip";  SubDir = "indiclid-ftn" },

    @{ Name = "indiclid-ftr.zip";  SubDir = "indiclid-ftr" },

    @{ Name = "indiclid-bert.zip"; SubDir = "indiclid-bert" }

)



function Download-File($Url, $DestPath) {

    if (Test-Path $DestPath) {

        $size = (Get-Item $DestPath).Length

        if ($size -gt 1048576) {

            Write-Host ('    Already exists ({0:N1} MB) - skip' -f ($size / 1MB))

            return

        }

    }

    Write-Host "    Downloading -> $(Split-Path $DestPath -Leaf)"

    $curlArgs = @("-L", "--retry", "3", "--retry-delay", "5", "-o", $DestPath, $Url)

    if ($SkipSslVerify) { $curlArgs = @("-k") + $curlArgs }

    & curl.exe @curlArgs

    if ($LASTEXITCODE -ne 0) { throw "curl failed: $Url" }

    Write-Host ('    OK {0:N1} MB' -f ((Get-Item $DestPath).Length / 1MB))

}



function Expand-ZipToSubdir($ZipPath, $SubDir) {

    $target = Join-Path $Dest $SubDir

    New-Item -ItemType Directory -Force -Path $target | Out-Null

    $binName = if ($SubDir -eq "indiclid-bert") { "basline_nn_simple.pt" } else { "model_baseline_roman.bin" }

    $expected = Join-Path $target $binName

    if (Test-Path $expected) {

        Write-Host "    Weights already extracted: $expected"

        return

    }

    Write-Host "    Extracting -> $SubDir"

    Expand-Archive -Path $ZipPath -DestinationPath $target -Force

    $nested = Get-ChildItem $target -Recurse -File | Where-Object { $_.Name -eq $binName } | Select-Object -First 1

    if ($nested -and $nested.DirectoryName -ne $target) {

        Copy-Item $nested.FullName $expected -Force

    }

    if (-not (Test-Path $expected)) {

        throw "Expected weight missing after extract: $expected"

    }

    Write-Host "    OK $binName"

}



Write-Host "==> IndicLID download -> $Dest"

Write-Host ""



foreach ($z in $Zips) {

    Write-Host "==> $($z.Name)"

    $zipPath = Join-Path $Dest $z.Name

    Download-File "$Release/$($z.Name)" $zipPath

    Expand-ZipToSubdir $zipPath $z.SubDir

    Write-Host ""

}



if (-not $SkipTokenizer) {

    $tokDir = Join-Path $Dest "IndicBERTv2-MLM-only"

    Write-Host "==> IndicBERT tokenizer -> $tokDir"

    if ((Test-Path (Join-Path $tokDir "tokenizer.json")) -or (Test-Path (Join-Path $tokDir "vocab.txt"))) {

        Write-Host "    Tokenizer already present - skip"

    } else {

        $pyScript = Join-Path $env:TEMP "download_indicbert_tokenizer.py"

        @"

from huggingface_hub import snapshot_download

snapshot_download(

    repo_id='ai4bharat/IndicBERTv2-MLM-only',

    local_dir=r'$tokDir',

    local_dir_use_symlinks=False,

)

print('OK')

"@ | Set-Content -Path $pyScript -Encoding UTF8

        python $pyScript

        if ($LASTEXITCODE -ne 0) {

            throw "HuggingFace tokenizer download failed. Install: pip install huggingface_hub"

        }

        Write-Host "    OK IndicBERTv2-MLM-only"

    }

}



Write-Host ""

Write-Host "==> Verify required files:"

$required = @(

    "indiclid-ftn\model_baseline_roman.bin",

    "indiclid-ftr\model_baseline_roman.bin",

    "indiclid-bert\basline_nn_simple.pt"

)

foreach ($r in $required) {

    $p = Join-Path $Dest $r

    if (-not (Test-Path $p)) { throw "Missing: $p" }

    Write-Host "    OK $r"

}



Write-Host ""

Write-Host "Next: powershell -ExecutionPolicy Bypass -File production\scripts\pack-indiclid.ps1"



