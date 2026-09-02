# Builds the Whisper-referee overlay onto sp-ai-whisper-lang:prod.
$ErrorActionPreference = "Stop"

Write-Host "== Gate: window/client unit tests ==" -ForegroundColor Cyan
python -m pytest ai-mvp/test_whisper_window_asr.py ai-mvp/test_whisper_referee_client.py -q
if ($LASTEXITCODE -ne 0) { throw "Referee unit tests failed - not building." }

Write-Host "== Tagging rollback point ==" -ForegroundColor Cyan
docker tag sp-ai-whisper-lang:prod sp-ai-whisper-lang:pre-whisper-window

Write-Host "== Building patched language service ==" -ForegroundColor Cyan
docker build -t sp-ai-whisper-lang:prod -f production-build/docker/Dockerfile.lang-whisper-window.patch .
if ($LASTEXITCODE -ne 0) { throw "docker build failed." }

Write-Host "== Verifying the new route is registered ==" -ForegroundColor Cyan
docker run --rm --entrypoint python --workdir /app -e PYTHONPATH=/app -e NVIDIA_VISIBLE_DEVICES=void sp-ai-whisper-lang:prod -c @"
import ast
src = open('/app/lang_service_server.py', encoding='utf-8').read()
ast.parse(src)
assert '/transcribe-window' in src, 'route missing from image'
import whisper_window_asr
assert whisper_window_asr.whisper_window_lang_code('Hindi') == 'hi'
print('lang image OK: /transcribe-window present')
"@
if ($LASTEXITCODE -ne 0) { throw "Image verification failed." }

Write-Host "Done." -ForegroundColor Green
