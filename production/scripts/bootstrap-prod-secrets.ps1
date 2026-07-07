# Populate production/secrets/* and .env.container from production/.env.
# .env.container is the backend env_file — secret keys stripped so printenv stays clean.
$ErrorActionPreference = "Stop"
$ProdDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$EnvFile = Join-Path $ProdDir ".env"
$ContainerEnvFile = Join-Path $ProdDir ".env.container"
$SecretsDir = Join-Path $ProdDir "secrets"

$StripKeys = @(
  "LICENSE_SECRET_KEY",
  "ORCHESTRATOR_SECRET",
  "CALLBACK_SECRET",
  "SERVICE_TOKEN",
  "DB_PASSWORD",
  "SA_PASSWORD"
)

function Get-DotEnvValue([string]$Path, [string]$Key) {
    if (-not (Test-Path $Path)) { return "" }
    $line = Get-Content $Path | Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } | Select-Object -First 1
    if (-not $line) { return "" }
    $val = ($line -split "=", 2)[1].Trim()
    if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
    return $val
}

if (-not (Test-Path $EnvFile)) { Write-Error "Missing $EnvFile" }

New-Item -ItemType Directory -Force -Path $SecretsDir | Out-Null

function Write-SecretFile([string]$Name, [string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { throw "$Name is empty" }
    $path = Join-Path $SecretsDir $Name
    Set-Content -Path $path -Value $Value -NoNewline -Encoding utf8
    Write-Host "[bootstrap-secrets] wrote $path"
}

function Write-ContainerEnv {
    $stripPattern = '^\s*(?:export\s+)?(' + ($StripKeys -join '|') + ')\s*='
    Get-Content $EnvFile |
        Where-Object { $_ -notmatch $stripPattern } |
        Set-Content -Path $ContainerEnvFile -Encoding utf8
    Write-Host "[bootstrap-secrets] wrote $ContainerEnvFile (secret keys stripped - do not edit manually)"
}

Write-SecretFile "license_secret_key" (Get-DotEnvValue $EnvFile "LICENSE_SECRET_KEY")
Write-SecretFile "orchestrator_secret" (Get-DotEnvValue $EnvFile "ORCHESTRATOR_SECRET")
Write-SecretFile "callback_secret" (Get-DotEnvValue $EnvFile "CALLBACK_SECRET")
Write-SecretFile "service_token" (Get-DotEnvValue $EnvFile "SERVICE_TOKEN")
Write-SecretFile "db_password" (Get-DotEnvValue $EnvFile "SA_PASSWORD")

Write-ContainerEnv

Write-Host "[bootstrap-secrets] Done."
