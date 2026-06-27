<#
  normalize-line-endings.ps1 — force LF on all Linux deploy scripts before copying to prod.
  Run automatically from rebuild-patch-images.ps1, or manually:
    powershell -ExecutionPolicy Bypass -File production\scripts\normalize-line-endings.ps1
#>
$ErrorActionPreference = "Stop"
$Root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$Prod = Join-Path $Root "production"

function Set-LfFile($path) {
    $bytes = [System.IO.File]::ReadAllBytes($path)
    if ($bytes.Length -eq 0) { return $false }
    $text = [System.Text.Encoding]::UTF8.GetString($bytes)
    $normalized = ($text -replace "`r`n", "`n") -replace "`r", "`n"
    if ($text -eq $normalized) { return $false }
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($path, $normalized, $utf8NoBom)
    return $true
}

$patterns = @(
    (Join-Path $Prod "deploy.sh"),
    (Join-Path $Prod "fix-line-endings.sh"),
    (Join-Path $Prod "scripts\*.sh"),
    (Join-Path $Prod "scripts\lib\*.sh")
)

$fixed = 0
foreach ($pattern in $patterns) {
    Get-Item -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
        if (Set-LfFile $_.FullName) {
            Write-Host "  LF  $($_.FullName.Substring($Root.Length + 1))"
            $fixed++
        }
    }
}

if ($fixed -eq 0) {
    Write-Host "==> All production shell scripts already LF."
} else {
    Write-Host "==> Normalized $fixed file(s) to LF (safe to copy to Linux prod)."
}
