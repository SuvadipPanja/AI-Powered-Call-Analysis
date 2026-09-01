# One-time fetch of the CTranslate2 Whisper large-v3 weights for the offline
# referee. Run on the dev laptop (needs internet); the output tar.gz is copied
# to prod once and extracted into volumes/models/.
$ErrorActionPreference = "Stop"

$modelDir = "production/model-bundles/faster-whisper-large-v3"
$bundle   = "production/model-bundles/faster-whisper-large-v3.tar.gz"

New-Item -ItemType Directory -Force -Path "production/model-bundles" | Out-Null

Write-Host "== Downloading Systran/faster-whisper-large-v3 ==" -ForegroundColor Cyan
# Use curl.exe, NOT huggingface_hub. Verified on this laptop:
#   * huggingface-cli is not on PATH.
#   * huggingface_hub with the cached token -> 401 "OAuth token signature
#     verification failed" (the token at ~/.cache/huggingface/token is stale).
#   * huggingface_hub with token=False -> WinError 10054, connection reset.
#     Python's httpx does not trust the corporate TLS-inspection certificate.
#   * curl.exe against the same URL -> HTTP 200 in ~1.2s.
# The repo is public, so no token is needed. -C - allows resume on retry.
New-Item -ItemType Directory -Force -Path $modelDir | Out-Null
$base = "https://huggingface.co/Systran/faster-whisper-large-v3/resolve/main"
curl.exe -sS -L --retry 3 --retry-delay 5 -C - `
  -o "$modelDir/config.json"               "$base/config.json" `
  -o "$modelDir/preprocessor_config.json"  "$base/preprocessor_config.json" `
  -o "$modelDir/tokenizer.json"            "$base/tokenizer.json" `
  -o "$modelDir/vocabulary.json"           "$base/vocabulary.json" `
  -o "$modelDir/model.bin"                 "$base/model.bin"
if ($LASTEXITCODE -ne 0) { throw "curl download failed with code $LASTEXITCODE." }

Write-Host "== Verifying bundle contents ==" -ForegroundColor Cyan
$required = @("model.bin", "config.json", "tokenizer.json", "vocabulary.json", "preprocessor_config.json")
foreach ($f in $required) {
    if (-not (Test-Path (Join-Path $modelDir $f))) { throw "Missing required file: $f" }
}
$sizeGb = [math]::Round((Get-Item (Join-Path $modelDir "model.bin")).Length / 1GB, 2)
Write-Host "model.bin = $sizeGb GB" -ForegroundColor Green
if ($sizeGb -lt 1.0) { throw "model.bin looks truncated ($sizeGb GB)." }

Write-Host "== Smoke test: load on CPU int8 and decode 3s of silence ==" -ForegroundColor Cyan
docker run --rm --entrypoint python --workdir /app -e PYTHONPATH=/app `
  -v "${PWD}/${modelDir}:/models/faster-whisper-large-v3:ro" `
  sp-ai-controller:prod -c @"
from faster_whisper import WhisperModel
import numpy as np
m = WhisperModel('/models/faster-whisper-large-v3', device='cpu', compute_type='int8', cpu_threads=4)
segments, info = m.transcribe(np.zeros(48000, dtype='float32'), language='hi', beam_size=1)
list(segments)
print('CT2 bundle loads and decodes on CPU int8 OK')
"@
if ($LASTEXITCODE -ne 0) { throw "CT2 smoke test failed." }

Write-Host "== Packaging ==" -ForegroundColor Cyan
tar -czf $bundle -C production/model-bundles faster-whisper-large-v3
Write-Host "Wrote $bundle" -ForegroundColor Green
