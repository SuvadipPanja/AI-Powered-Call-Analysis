# Build sp-ai-diarization:prod (hybrid stereo + Pyannote community-1)
$ErrorActionPreference = "Stop"
$Root = "C:\Project\AI-Powered Call Analysis project"
Set-Location $Root

Write-Host "=== sp-ai-base (refresh ai-mvp) ==="
docker build -t sp-ai-base:prod -f "services\sp-ai-base\Dockerfile" .
if ($LASTEXITCODE -ne 0) { throw "sp-ai-base failed" }

Write-Host "=== sp-ai-diarization ==="
docker build -t sp-ai-diarization:prod -f "services\sp-ai-diarization\Dockerfile" .
if ($LASTEXITCODE -ne 0) { throw "sp-ai-diarization failed" }

Write-Host "=== sp-ai-controller (includes hybrid diarization code) ==="
docker build -t sp-ai-controller:prod -f "services\sp-ai-controller\Dockerfile" .
if ($LASTEXITCODE -ne 0) { throw "sp-ai-controller failed" }

$out = Join-Path $Root "production\docker-images"
New-Item -ItemType Directory -Force -Path $out | Out-Null
docker save -o "$out\sp-ai-diarization.tar" sp-ai-diarization:prod
Write-Host "Saved $out\sp-ai-diarization.tar"
Write-Host "Also rebuild sp-ai-stack.tar on prod deploy (controller + diarization)."
