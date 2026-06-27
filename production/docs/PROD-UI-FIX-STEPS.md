# Prod UI fix — transcript, WPM, sentiment, compliance, dashboard (Jun 2026)

## Root cause (all linked)

Qwen3 on vLLM was outputting **chain-of-thought** (`...`) into
translation/scoring text. That garbage was saved as `TranslateOutput`, which broke:

| Symptom | Why |
|---------|-----|
| Transcript shows "CALL" + thinking text | UI couldn't parse diarized lines |
| WPM ~1566 | Word count included thousands of thinking words |
| Sentiment empty | `parse_transcript()` found no utterances |
| Script compliance 0% | No agent lines to compare |
| Summary wrong | Scoring JSON polluted by thinking |
| Dashboard error | Client compared end-of-day to *now* (before midnight) |

## Fixes in repo

**AI (`05-ai.tar`):**
- `llm_utils.py` — strip thinking, extract diarized lines, correct WPM word count
- `translation_worker.py` — **line-by-line** translation (preserves timestamps)
- `llm_openai_backend.py` — `enable_thinking: false` for Qwen3 on vLLM
- `scoring_worker.py`, `db.py` — use cleaned text

**Backend (`02-backend.tar`):**
- `server.js` — WPM ignores thinking/meta text

**Frontend (`04-frontend.tar`):**
- `dashboardFilters.js`, `AfterLogin.js` — dashboard date range fix
- `ConversationTranscript.jsx` — filter meta/thinking lines

---

## Step 1 — Build on dev laptop

```powershell
cd "C:\Project\AI-Powered Call Analysis project"

# AI hotfix (fast — layers cached)
docker build -t ai-call-orchestrator:prod -f production-build/docker/Dockerfile.ai-hotfix.patch .
docker save ai-call-orchestrator:prod -o production\images\05-ai.tar

# Backend hotfix
docker build -t ai-call-backend:prod -f production-build/docker/Dockerfile.backend.patch .
docker save ai-call-backend:prod -o production\images\02-backend.tar

# Frontend (full rebuild — nginx serves static bundle)
docker build -t ai-powered-call-analysis-frontend:prod frontend
docker save ai-powered-call-analysis-frontend:prod -o production\images\04-frontend.tar
```

Copy to prod via WinSCP:
- `production\images\05-ai.tar`
- `production\images\02-backend.tar`
- `production\images\04-frontend.tar`

---

## Step 2 — Deploy on prod

```bash
sudo su
conda activate speech-analytics
cd /home/suvadip/Call-Analysis/Project/production

docker load -i images/02-backend.tar
docker load -i images/04-frontend.tar
docker load -i images/05-ai.tar

docker stop ai_call_ai 2>/dev/null || true
docker compose -f docker-compose.prod.yml up -d --force-recreate qwen
for i in $(seq 1 20); do S=$(docker inspect ai_call_qwen --format '{{.State.Health.Status}}' 2>/dev/null || echo starting); echo "qwen: $S"; [ "$S" = "healthy" ] && break; sleep 15; done

docker compose -f docker-compose.prod.yml up -d --force-recreate backend frontend ai
docker ps --filter name=ai_call_
```

Dashboard: hard-refresh browser (`Ctrl+F5`) — metrics should load without "future date" error.

---

## Step 3 — Fix already-processed calls (bad translation in DB)

Calls processed **before** this fix still have polluted `TranslateOutput`. Re-upload those MP3s
(same filenames) from Admin UI → Audio Upload, or delete the row and re-upload.

After backend fix, backfill WPM for rows that had wrong values:

```bash
curl -X POST http://127.0.0.1:5000/api/backfill-wpm
```

(Re-upload is required for transcript/sentiment/compliance — backfill only fixes WPM math on existing text.)

---

## Step 4 — Verify one call

```bash
docker logs -f ai_call_ai 2>&1 | grep -iE "Transcrib|Transl|scoring|Complete|Error"
```

In UI (Call Results):
- Transcript tab → Agent/Customer bubbles with English text (not "Okay let's tackle…")
- WPM → ~120–180 (not 1500+)
- Sentiment tab → agent/customer bars populated
- Compliance tab → non-zero category scores
- Summary tab → 2–3 sentence call summary
