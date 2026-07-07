# AI Call Analysis — Product & Engineering Roadmap

**Last updated:** 2026-07-06  
**Prod server:** `10.64.194.130` · UI `:8081` · API `:5000`  
**Status:** Processing UI (orbital) deployed · Admin System health removed from Settings · Docker frontend uses `sp-frontend:prod` / `sp_frontend`

---

## Guiding principles

1. **Do not disturb the AI pipeline** unless there is a dedicated AI task and regression test on sample audio. See [AI do-not-touch](#ai-stack-do-not-touch).
2. **Verify before prod** — tests → build → local Docker → visual check → then tar + deploy commands.
3. **sp-* naming** for images, containers, and tars (`sp_frontend`, `sp_backend`, `sp_db`, `sp_llm`, `sp_ai`, `sp_redis`).
4. **Banking-grade security** (air-gap, RBAC, license gate) before wide rollout.

---

## Completed (recent)

| Area | Done |
|------|------|
| Live processing UI | Design 2 orbital radial, compact, 0% start, sequential language → transcribe |
| Language display | Detecting… → language name (green), no "confirming" |
| Dashboard filters | Default **Last 1 month** |
| Admin Settings | System health panel removed (use System Health page) |
| Docker stack | Images `sp-*:prod`; containers `sp_*` (`sp_frontend`, `sp_backend`, `sp_db`, `sp_llm`, `sp_ai`, `sp_redis`) |
| Tone chart backend | Aligned filters with metrics-overview |
| Stereo diarization hotfix | `stereo_exclusive` overlap fix in `sp_ai_controller`; optional `sp_ai_diarization` + offline Pyannote 3.1 bundle |

---

## Phase 1 — Foundation (weeks 1–2) · *Highest ROI*

### 1.1 AuthContext & session (frontend)

**Problem:** Role/token read from many places → stale UI, wrong dashboards.  
**Deliverables:**
- Single `AuthContext`: user, role, token, logout, refresh profile
- Replace scattered `localStorage` reads in reports, upload, admin
- Session expiry → redirect to login with message

**Verify:** Login as Admin, Agent, TL — correct nav and API headers; logout clears state.  
**Deploy:** `sp-frontend.tar` only. **AI:** not touched.

### 1.2 API layer cleanup

**Deliverables:**
- `apiClient.js` — base URL, auth header, 401 handling, error normalization
- `services/*` — one module per domain (upload, reports, admin, agents)
- Remove duplicate fetch logic from large components

**Verify:** Upload flow, one report page, admin locations CRUD.  
**Deploy:** frontend tar; backend only if new endpoints added.

### 1.3 Shared dashboard hooks

**Deliverables:**
- `useDashboardMetrics` — KPIs with consistent date/agent filters
- `useReportFilters` — used on Admin dashboard, TL reports, agent view
- Subtitles show human labels ("Last 1 month") not raw ISO ranges

**Verify:** Same date range → same counts across KPI blocks and charts.  
**Deploy:** frontend tar.

### 1.4 Full sp_* container naming ✅

**Done:**
- Compose: `sp_db`, `sp_redis`, `sp_backend`, `sp_frontend`, `sp_llm`, `sp_ai`
- Deploy scripts use `SP_CONTAINER_*` from `scripts/lib/common.sh`; `remove_legacy_containers` drops old `ai_call_*` names

**Verify on prod:** `docker compose ps` shows `sp_*` names; health unchanged.  
**Deploy:** copy `docker-compose.yml` + updated scripts → `remove_legacy_containers` runs automatically in `03-up.sh` / `deploy-prod.sh`.

---

## Phase 2 — UX polish (weeks 2–4)

### 2.1 Result page tab extraction

Split `ResultPage` into `result/tabs/*`:
- Tone · Sentiment · Scoring · Compliance · Intelligence

**Verify:** Open existing result URLs; all tabs load same data as today.  
**Deploy:** frontend tar.

### 2.2 Empty & error states

- Reports: no data in range → clear message + adjust filters CTA
- Upload: failed AI / timeout → retry + support hint
- Processing modal: failed stage shows red node + reason

**Verify:** Mock empty API responses; failed upload path.  
**Deploy:** frontend (+ backend if new error codes).

### 2.3 Mobile / tablet reports

- Responsive tables (horizontal scroll or card layout)
- Processing orbit: smaller breakpoints tested

**Verify:** 375px and 768px widths in browser.  
**Deploy:** frontend tar.

### 2.4 Mono call diarization via Pyannote Docker *(planned — not started)*
`sp_ai_diarization` loads Pyannote on `/health` but call processing runs in
`sp_ai_controller` via local `diarize()` — Pyannote does not run per call unless
`POST /diarize` is used.

**Current (2026-07):**
- **Stereo calls (2-channel)** — fixed in controller (`stereo_exclusive`, 0 overlaps on sample gate).
- **Pyannote bundle** — offline `pyannote-offline-bundle.tar.gz` on prod; service `sp_ai_diarization:8040`.
- **Mono calls** — no diarization/chunking yet.

**Future deliverables:**
1. **Mono branch** in pipeline — detect `channels == 1`, route to `sp_ai_diarization` (`POST /diarize`) or in-service Pyannote path.
2. **Agent/Customer mapping** for mono — map `SPEAKER_00/01` → Agent/Customer (energy/heuristic or first-speaker rule + LLM optional).
3. **Chunk export** — same Agent/Customer WAV + metadata format as stereo for downstream ASR.
4. **Controller wiring** — use `AI_DIAR_SERVICE_URL` for mono (and optionally hard stereo fallback); log `Method: pyannote_*` in metadata.
5. **Regression gate** — labeled mono sample(s) + DER/overlap metrics before prod promote.

**Verify:** Re-process mono sample; logs show Pyannote inference (not just load); chunks + transcript have correct speaker labels.  
**Deploy:** `sp-ai-diarization.tar` + `sp-ai-stack.tar` + model bundle; **dedicated AI task** with sample-audio regression.  
**Do not claim 95% accuracy** until benchmarked on client mono calls.

### 2.5 Admin Settings enhancements

- Backup tab: last run time, file size, path validation
- License tab: expiry warning banner on login if &lt; 30 days
- Branding preview already exists — keep in sync with login page

**Verify:** Super Admin flows only.  
**Deploy:** frontend ± backend tar.

---

## Phase 3 — Security & scale (weeks 4–8) · *Required for 500+ agents*

Aligned with `.cursor/rules/production-security-master.mdc`.

### 3.1 Sprint 1 — P0 security (backend)

- [ ] `GET /audio/:filename` — auth + RBAC + path sanitization
- [ ] Agent mutations — Super Admin / Admin / Manager only
- [ ] License admin — `req.user`, never body username
- [ ] Session endpoints — token must match userId
- [ ] Profile upload — self-or-elevated + MIME/size limits
- [ ] Prod startup fails if weak CORS/secrets
- [ ] Remove `?token=` query auth

**Verify:** Automated tests for 403/401 paths; manual pen-test checklist.  
**Deploy:** `sp-backend.tar` + frontend if API contract changes. **AI:** not touched.

### 3.2 Sprint 2 — Secrets & reports RBAC

- Log redaction (no tokens/transcripts in logs)
- Report endpoints filtered by role (Agent sees own calls only)

### 3.3 Sprint 3 — Scale

- Redis queue (Bull/BullMQ) for AI jobs — reduces stuck "processing"
- PM2 cluster or split WebSocket process
- Report read replica / cache TTL for hot dashboards

**Verify:** Load test upload queue with N concurrent files.  
**Deploy:** backend + redis config; **do not rebuild aimvp/llm** unless queue consumer moves into AI container (separate design).

### 3.4 Sprint 4 — License & Docker gate

- RSA-signed licenses, hardware bind, docker entrypoint refuses invalid license
- Grace read-only mode + audit log

---

## Phase 4 — Quality & maintenance (ongoing)

| Item | Notes |
|------|--------|
| Frontend smoke tests | Login, upload modal states, one report |
| ESLint + trim package.json | Smaller bundles, faster builds |
| Dead code removal | NavBar, frontend-pulse decision, unused deps |
| Icon/CSS consolidation | One icon set, fewer CSS files |
| REACT_APP env README | Document all build-time vars for white-label builds |

---

## AI stack — do not touch

**Unless user explicitly requests an AI change and accepts regression testing:**

| Component | Path / service |
|-----------|----------------|
| Orchestrator | `AI/src/Backend main/`, Docker `ai` → `sp-aimvp:prod` |
| Diarization (stereo hotfix) | `ai-mvp/diarization_*`, `sp_ai_controller`, optional `sp_ai_diarization` |
| Pipeline steps | `AI/src/1st step …` through `9th step …` |
| LLM | Docker `llm` → `sp-llm:prod`, `volumes/models/` |
| Compose AI env | `TRANSCRIBE_BACKEND`, `NEMO_*`, `OPENAI_*`, GPU reservations |
| Model bundles | `production/model-bundles/*.tar` |

**Frontend/backend changes must not:**
- Change AI service URLs in compose without coordination
- Rebuild or replace `sp-aimvp.tar` / `sp-llm.tar` during UI hotfixes
- Alter processing stage names in backend without updating `processingStepStates.js`

---

## Standard deploy checklist (every release)

### On dev (Windows)

```powershell
cd "C:\Project\AI-Powered Call Analysis project\frontend"
npm test -- --watchAll=false   # or targeted tests
npm run build
docker build -t sp-frontend:prod `
  -f "..\production-build\docker\Dockerfile.frontend-static.patch" .
docker run -d --name sp-frontend-local --add-host backend:host-gateway -p 8099:80 sp-frontend:prod
# Browser: http://localhost:8099 — verify changed screens
docker rm -f sp-frontend-local
docker save -o "..\production\docker-images\sp-frontend.tar" sp-frontend:prod
```

### Copy to prod

| Copy this (dev) | To prod |
|-----------------|---------|
| `production/docker-images/sp-frontend.tar` | `/home/suvadip/Call-Analysis/Project/production/docker-images/sp-frontend.tar` |

Backend-only: `sp-backend.tar` same folder. **Do not copy aimvp/llm** for UI work.

```powershell
scp "C:\Project\AI-Powered Call Analysis project\production\docker-images\sp-frontend.tar" `
  suvadip@10.64.194.130:/home/suvadip/Call-Analysis/Project/production/docker-images/
```

### On prod (Linux)

```bash
cd /home/suvadip/Call-Analysis/Project/production
docker load -i docker-images/sp-frontend.tar
bash scripts/deploy-frontend-hotfix.sh
docker compose ps frontend
docker images | grep sp-frontend
```

**Confirm:** only `sp-frontend:prod`; container `sp_frontend`; hard refresh browser.

---

## Suggested order (pick next task)

```
1. AuthContext + apiClient          ← start here
2. useDashboardMetrics / filters parity
3. Result page tabs
4. P0 security (backend sprint 1)
5. Redis job queue (when agent count grows)
6. Full sp_* container rename
7. Mono diarization via Pyannote Docker (when mono recordings required)
8. Scoring/intelligence/hold roadmap — see production/docs/SCORING-INTELLIGENCE-ROADMAP.md
```

---

## Success metrics

- Upload → processing UI accurate on 10 sample calls (Hindi/Bengali/English)
- Dashboard KPIs match within same filter on one date range
- Zero unauthorized audio download in security test
- Frontend hotfix deploy &lt; 15 minutes copy-to-verify on prod
- AI containers uptime unchanged during frontend-only releases
