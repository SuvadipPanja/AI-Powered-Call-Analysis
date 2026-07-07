# Build + save ONLY the app images (backend + frontend) — no AI stack.
# Usage: powershell -ExecutionPolicy Bypass -File production-build\build-app-images.ps1

$ErrorActionPreference = "Stop"
$Root = "C:\Project\AI-Powered Call Analysis project"
Set-Location $Root
$out = Join-Path $Root "production\docker-images"
New-Item -ItemType Directory -Force -Path $out | Out-Null

function Step($msg) { Write-Host "===STEP=== $msg" }

# ---------- BACKEND ----------
# Rebase onto the FLATTENED image first: the patch stacks ~50 layers per run
# on top of ai-call-backend:prod, which otherwise accumulates layers across
# rebuilds until overlayfs fails with "mount options is too long".
$spLayers = 0
if (docker image inspect sp-backend:prod 2>$null) {
  $spLayers = (docker inspect sp-backend:prod --format '{{json .RootFS.Layers}}' | ConvertFrom-Json).Count
}
$baseLayers = 999
if (docker image inspect ai-call-backend:prod 2>$null) {
  $baseLayers = (docker inspect ai-call-backend:prod --format '{{json .RootFS.Layers}}' | ConvertFrom-Json).Count
}
if ($spLayers -gt 0 -and $spLayers -lt $baseLayers) {
  Step ("BACKEND rebase: ai-call-backend:prod ({0} layers) <- sp-backend:prod ({1} layers)" -f $baseLayers, $spLayers)
  docker tag sp-backend:prod ai-call-backend:prod
}

Step "BACKEND build (patch)"
docker build -t ai-call-backend:prod -f "production-build\docker\Dockerfile.backend.patch" .
if ($LASTEXITCODE -ne 0) { throw "backend build failed" }
docker tag ai-call-backend:prod sp-backend:prod

# Flatten to a single layer (overlayfs mount-options limit on prod).
Step "BACKEND flatten -> single layer"
docker build --provenance=false -t sp-backend:prod -f "production-build\docker\Dockerfile.backend.flatten" .
if ($LASTEXITCODE -ne 0) { throw "backend flatten failed" }

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
docker build -t sp-frontend:prod -f "production-build\docker\Dockerfile.frontend-static.patch" frontend
if ($LASTEXITCODE -ne 0) { throw "frontend docker build failed" }
docker save -o "$out\sp-frontend.tar" sp-frontend:prod
if ($LASTEXITCODE -ne 0) { throw "frontend save failed" }
Step ("FRONTEND done {0} MB" -f [math]::Round((Get-Item "$out\sp-frontend.tar").Length/1MB,1))

Step "APP IMAGES DONE"
Get-ChildItem "$out\sp-backend.tar", "$out\sp-frontend.tar" | ForEach-Object {
  Write-Host ("  {0}  {1} MB" -f $_.Name, [math]::Round($_.Length/1MB,1))
}
