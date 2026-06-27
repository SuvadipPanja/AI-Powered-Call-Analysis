# Download NeMo ASR models (run on GPU server with NGC CLI or browser)
$root = "C:\Project\AI-Powered Call Analysis project"
$nemoDir = Join-Path $root "models\nemo"
New-Item -ItemType Directory -Force -Path $nemoDir | Out-Null

Write-Host "NeMo models required (same as old AI pipeline):" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Hindi:   stt_hi_conformer_ctc_medium.nemo"
Write-Host "  English: parakeet-rnnt-1.1b.nemo"
Write-Host ""
Write-Host "Download from NVIDIA NGC:" -ForegroundColor Yellow
Write-Host "  https://catalog.ngc.nvidia.com/orgs/nvidia/models/stt_hi_conformer_ctc_medium"
Write-Host "  https://catalog.ngc.nvidia.com/orgs/nvidia/models/parakeet_rnnt_1_1b"
Write-Host ""
Write-Host "Save to: $nemoDir"
Write-Host ""
Write-Host "Whisper Large V3 (language detection only) should already exist at:"
Write-Host "  $(Join-Path $root 'models\Whisper-large-v3')"
