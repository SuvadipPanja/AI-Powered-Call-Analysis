# Deploy — IndicConformer ASR Upgrade (Offline)

**Prod:** `10.64.194.130` · `/home/suvadip/Call-Analysis/Project/production`

This upgrade replaces Hindi **medium** NeMo with **IndicConformer Large**, adds **Bengali**, optional **22-language multilingual**, fixes **Bengali→Hindi** language detection, and makes scoring/translation work for **non-banking** calls (bank config still helps when set).

---

## PART A — Dev (with internet): download + build

```powershell
cd "C:\Project\AI-Powered Call Analysis project"

# 1) Download AI4Bharat IndicConformer .nemo + pack tar (~2–3 GB total)
powershell -ExecutionPolicy Bypass -File production\scripts\download-indicconformer.ps1

# 2) Rebuild AI (and backend if needed)
powershell -ExecutionPolicy Bypass -File production\scripts\rebuild-patch-images.ps1
```

---

## PART B — Copy dev → prod

| From (dev) | To (prod) | Why |
|------------|-----------|-----|
| `production\images\05-ai.tar` | `production/images/05-ai.tar` | IndicConformer code + language fix + generic prompts |
| `production\images\08-indicconformer.tar` | `production/images/08-indicconformer.tar` | **New** — Hindi Large + Bengali Large (+ optional 600M multi) ASR weights |
| `production\docker-compose.yml` | `production/docker-compose.yml` | NeMo paths, LANG_DISAMBIGUATE, faster-whisper fallback env |
| `production\scripts\deploy-prod.sh` | `production/scripts/deploy-prod.sh` | Auto-extracts 08-indicconformer.tar |
| `production\scripts\extract-indicconformer.sh` | `production/scripts/extract-indicconformer.sh` | Manual extract if needed |

**Do NOT re-copy** if already on prod and working:
- `01-db.tar`, `04-redis.tar`, `06-qwen-vllm.tar`, `07-llama-awq.tar`
- `02-backend.tar`, `03-frontend.tar` (unless backend/UI changed)

**Keep on prod** (existing data):
- `volumes/models/nemo/parakeet-rnnt-1.1b.nemo` — English ASR
- `volumes/models/nemo/stt_hi_conformer_ctc_medium.nemo` — Hindi **fallback** if Large missing
- `volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ/` — LLM
- `volumes/audio/`, DB volume

---

## PART C — Prod commands (offline)

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

sed -i 's/\r$//' scripts/*.sh
chmod +x scripts/*.sh

# Full deploy: extract ASR models + load tars + restart
bash scripts/deploy-prod.sh
```

**Manual extract ASR only:**
```bash
bash scripts/extract-indicconformer.sh
docker compose up -d --force-recreate ai
```

---

## What improved

| Area | Before | After |
|------|--------|-------|
| Hindi/Hinglish ASR | `stt_hi_conformer_ctc_medium` | **IndicConformer HI Large** (RNNT) |
| Bengali | Detected as Hindi | **Correct LID** + **IndicConformer BN Large** |
| Tamil/Telugu/etc. | Failed or wrong | **600M multilingual** (if in tar) or faster-whisper fallback |
| Non-banking calls | UCO-biased prompts | **Generic call-center** prompts; bank config optional |
| Language detection | Forced unknown → Hindi | **22 languages mapped** + HI/BN script disambiguation |

---

## Verify on prod

```bash
# Models present
ls -lh volumes/models/nemo/indicconformer*.nemo

# AI health (after one test upload)
docker logs ai_call_ai --tail 80 | grep -i nemo

# Test Bengali upload — UI should show Language: Bengali (not Hindi)

# File logs
tail -f volumes/logs/ai/call_processing_$(date +%Y-%m-%d).log
```

---

## ASR routing (offline, no API)

```
Audio → Language detect (Whisper LID + HI/BN disambiguation)
  → Hindi/Hinglish → IndicConformer HI Large
  → Bengali        → IndicConformer BN Large
  → English        → Parakeet RNNT
  → Other Indic    → IndicConformer 600M multi (language_id)
  → Fallback       → faster-whisper (if NeMo missing for language)
```

Bank name in Admin → Bank Config still improves translation glossary and compliance scripts but is **not required** for general calls.
