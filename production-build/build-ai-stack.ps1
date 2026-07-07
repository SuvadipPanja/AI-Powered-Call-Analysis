# =============================================================================
#  Build the distributed AI stack images (dev box) and save one combined tar.
#  Spec: production/docs/AI-STACK-SPEC.md section 2
#
#    sp-ai-base:prod          shared base (ai-mvp code + tools; NOT shipped)
#    sp-ai-controller:prod    orchestrator            :8000
#    sp-ai-whisper-lang:prod  language detection      :8010
#    sp-ai-nemo:prod          NeMo ASR                :8020
#    sp-ai-seamless-m4t:prod  SeamlessM4T v2 ASR      :8030
#
#  Output: production/docker-images/sp-ai-stack.tar (layers dedupe via base).
#  Usage:  powershell -File production-build\build-ai-stack.ps1
# =============================================================================

$ErrorActionPreference = "Stop"
$Root = "C:\Project\AI-Powered Call Analysis project"
Set-Location $Root

$out = Join-Path $Root "production\docker-images"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Step($msg) { Write-Host "===STEP=== $msg" }

# ---------- shared base (context = repo root: needs ai-mvp/) ----------------
Step "sp-ai-base build"
docker build -t sp-ai-base:prod -f "services\sp-ai-base\Dockerfile" .
if ($LASTEXITCODE -ne 0) { throw "sp-ai-base build failed" }

# ---------- controller (context = repo root: needs ai-mvp/) -----------------
Step "sp-ai-controller build"
docker build -t sp-ai-controller:prod -f "services\sp-ai-controller\Dockerfile" .
if ($LASTEXITCODE -ne 0) { throw "sp-ai-controller build failed" }

# ---------- model services (context = own folder: only COPY server.py) ------
Step "sp-ai-whisper-lang build"
docker build -t sp-ai-whisper-lang:prod -f "services\sp-ai-whisper-lang\Dockerfile" "services\sp-ai-whisper-lang"
if ($LASTEXITCODE -ne 0) { throw "sp-ai-whisper-lang build failed" }

Step "sp-ai-nemo build"
docker build -t sp-ai-nemo:prod -f "services\sp-ai-nemo\Dockerfile" "services\sp-ai-nemo"
if ($LASTEXITCODE -ne 0) { throw "sp-ai-nemo build failed" }

Step "sp-ai-seamless-m4t build"
docker build -t sp-ai-seamless-m4t:prod -f "services\sp-ai-seamless-m4t\Dockerfile" "services\sp-ai-seamless-m4t"
if ($LASTEXITCODE -ne 0) { throw "sp-ai-seamless-m4t build failed" }

# ---------- combined tar (base layers stored once) ---------------------------
Step "docker save sp-ai-stack.tar (large, base layers ~17GB, be patient)"
docker save -o "$out\sp-ai-stack.tar" `
    sp-ai-controller:prod `
    sp-ai-whisper-lang:prod `
    sp-ai-nemo:prod `
    sp-ai-seamless-m4t:prod
if ($LASTEXITCODE -ne 0) { throw "docker save sp-ai-stack.tar failed" }

Step "ALL DONE"
$tar = Get-Item "$out\sp-ai-stack.tar"
Write-Host ("  {0}  {1} GB" -f $tar.Name, [math]::Round($tar.Length / 1GB, 2))
Write-Host ""
Write-Host "Next: copy production/docker-images/sp-ai-stack.tar to prod and run"
Write-Host "      bash scripts/02-load-images.sh   (see docs/AI-STACK-RUNBOOK.md)"
