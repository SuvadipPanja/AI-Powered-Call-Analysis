$ErrorActionPreference = "Stop"
$Root = "C:\Project\AI-Powered Call Analysis project"
Set-Location $Root
$out = Join-Path $Root "production\docker-images"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Step($msg) { Write-Host "===STEP=== $msg" }

# ---------- BACKEND ----------
Step "BACKEND build"
docker build -t ai-call-backend:prod -f "production-build\docker\Dockerfile.backend.patch" .
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }
docker tag ai-call-backend:prod sp-backend:prod
docker save -o "$out\sp-backend.tar" sp-backend:prod
if ($LASTEXITCODE -ne 0) { throw "backend save failed" }
Step ("BACKEND done {0} MB" -f [math]::Round((Get-Item "$out\sp-backend.tar").Length/1MB,1))

# ---------- FRONTEND ----------
Step "FRONTEND npm build"
Push-Location "$Root\frontend"
cmd /c "npm run build"
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "frontend npm build failed" }
Pop-Location
Step "FRONTEND docker build"
docker build -t ai-powered-call-analysis-frontend:prod -f "production-build\docker\Dockerfile.frontend-static.patch" frontend
if ($LASTEXITCODE -ne 0) { throw "frontend docker build failed" }
docker tag ai-powered-call-analysis-frontend:prod sp-frontend:prod
docker save -o "$out\sp-frontend.tar" sp-frontend:prod
if ($LASTEXITCODE -ne 0) { throw "frontend save failed" }
Step ("FRONTEND done {0} MB" -f [math]::Round((Get-Item "$out\sp-frontend.tar").Length/1MB,1))

# ---------- AI ----------
Step "AI build"
docker build -t ai-call-orchestrator:prod -f "production-build\docker\Dockerfile.ai-hotfix.patch" .
if ($LASTEXITCODE -ne 0) { throw "ai build failed" }
docker tag ai-call-orchestrator:prod sp-aimvp:prod
Step "AI save (large ~17GB, be patient)"
docker save -o "$out\sp-aimvp.tar" sp-aimvp:prod
if ($LASTEXITCODE -ne 0) { throw "ai save failed" }
Step ("AI done {0} GB" -f [math]::Round((Get-Item "$out\sp-aimvp.tar").Length/1GB,2))

Step "ALL DONE"
Get-ChildItem "$out\sp-*.tar" | ForEach-Object { Write-Host ("  {0}  {1} GB" -f $_.Name, [math]::Round($_.Length/1GB,2)) }
