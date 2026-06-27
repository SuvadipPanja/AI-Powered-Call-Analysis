# Llama AWQ + Bank Config — Production Deploy

## What changed

1. **LLM**: Qwen3-4B → **Meta-Llama-3.1-8B-Instruct AWQ** (vLLM, `--quantization awq`)
2. **Bank settings**: Super Admin → Admin Settings → **Bank Config** tab
3. **AI prompts**: Translation/scoring/script compliance read bank name + glossary from `dbo.BankSettings`

## Prerequisites (offline prod)

1. **Copy from dev** to prod `production/` folder:
   - `images/02-backend.tar` (~112 MB)
   - `images/03-frontend.tar` (~60 MB)
   - `images/05-ai.tar` (~5.4 GB)
   - `.env`, `docker-compose.prod.yml`
   - `scripts/download-llama-awq.sh`, `scripts/deploy-llama-bank-config.sh`

2. **Download AWQ weights on prod** (while internet is available):
   ```bash
   # Accept Llama license + login once:
   pip install -U huggingface_hub
   huggingface-cli login

   cd /home/suvadip/Call-Analysis/Project/production
   bash scripts/download-llama-awq.sh
   ```
   Source repo: `hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4`  
   Local folder: `volumes/models/Meta-Llama-3.1-8B-Instruct-AWQ/`

   Or run the all-in-one deploy script (loads tars + download + recreate stack):
   ```bash
   sudo su
   conda activate speech-analytics
   cd /home/suvadip/Call-Analysis/Project/production
   bash scripts/deploy-llama-bank-config.sh
   ```

## Deploy on prod (10.64.194.130)

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

docker load -i images/02-backend.tar
docker load -i images/03-frontend.tar
docker load -i images/05-ai.tar

# Start LLM first (loads AWQ weights on GPU 1)
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen

# Wait until healthy (~5–8 min first load)
until docker inspect ai_call_qwen --format='{{.State.Health.Status}}' 2>/dev/null | grep -q healthy; do
  echo "Waiting for vLLM..."; sleep 15
done

docker compose -f docker-compose.prod.yml up -d --force-recreate backend frontend ai
```

## Configure bank (Super Admin)

1. Open `http://10.64.194.130:8081` → Admin Settings → **Bank Config**
2. Set **Bank name**, **local name** (Hindi), **product terms**, and **glossary**
3. Save — new uploads use updated prompts within ~60 seconds (AI cache TTL)

## Rollback to Qwen3-4B

In `.env`:
```env
LLM_SERVED_NAME=Qwen3-4B
LLM_MODEL_PATH=/models/Qwen3-4B
LLM_MAX_MODEL_LEN=16384
LLM_GPU_MEMORY_UTIL=0.40
LLM_QUANTIZATION=
```
Remove `--quantization awq` from compose or set `LLM_QUANTIZATION=` empty and edit compose if vLLM rejects empty flag.

## Re-process existing calls

Bank/LLM changes apply to **new** processing. Re-upload audio or trigger re-analysis to refresh DB rows.
