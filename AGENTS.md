# AGENTS.md

## Cursor Cloud specific instructions

This repo is an on-prem **AI-Powered Call Analysis** platform with three runtime
components plus shared infrastructure. The cloud dev environment runs the two
web-app services (backend + frontend) against a local MS SQL Server. The heavy
AI pipeline is intentionally out of scope (see below).

### Services & how to run them (dev)

| Service | Dir | Dev run command | Port |
|---|---|---|---|
| MS SQL Server | (Docker) | container `ai_call_db` (see below) | 1433 |
| Backend (Express API + WS) | `backend/` | `node server.js` | 5000 |
| Frontend (React CRA) | `frontend/` | see note on `NODE_OPTIONS` below | 3000 |

Dependencies are installed automatically by the startup update script
(`npm install` in `backend/` and `frontend/`). The notes below are the
non-obvious bits that are easy to get wrong.

### Database — core schema is NOT in the repo
- In production the core tables (`Users`, `ActiveSessions`, `UserSessionLog`,
  `Agents`, `Licenses`, `AudioUploads`, `AI_Processing_Result`) ship inside the
  proprietary `call-analysis-db` image. They are **not** created by the runtime
  migrations (`backend/services/dbMigrate.js`) nor by the numbered SQL files.
- For local dev against a fresh SQL Server, create the DB and apply, in order:
  1. `scripts/sql/dev_bootstrap_core.sql` (added for local dev — the core tables)
  2. `scripts/sql/create_consolidated_audio_analysis.sql`
  3. `backend/migrations/001..005` (idempotent)
  The backend then creates the remaining tables/views/indexes on startup.
- Start SQL Server locally (Docker has no systemd here, so start `dockerd` first):
  ```
  sudo dockerd > /tmp/dockerd.log 2>&1 &
  sudo docker start ai_call_db   # container already created during setup
  ```
  Credentials: `sa` / `Root@1234`, DB `call_analysis_db`, port `1433`.
- Reseed test users any time with `cd backend && node seed-test-users.js`
  (accounts listed in `TEST_ACCOUNTS.md`; e.g. `SUPER001` / `SuperAdmin@2026`,
  security question "Favorite color" = "Blue").

### Backend
- On Linux use **SQL auth** (`DB_USE_WINDOWS_AUTH=false`); Windows auth /
  `msnodesqlv8` does not apply. `backend/.env` is preconfigured (gitignored, so
  it persists in the VM snapshot but is not committed).
- `msnodesqlv8` compiles against unixODBC headers; the system package
  `unixodbc-dev` is installed in the VM image (needed for `npm install`).
- License: the backend validates a MAC-locked license on startup but **login
  still works without a valid license** (it only logs a warning). To produce a
  valid local license, set `HOST_MAC` + `LICENSE_SECRET_KEY` in `backend/.env`
  and run `node generate-local-license.js` (writes `backend/license/license.lic`,
  which is git-tracked — do not commit the dev value).

### Frontend
- The `start`/`build` npm scripts use Windows `set NODE_OPTIONS=... &&` syntax
  and will NOT run as-is on Linux. Run `react-scripts` directly with the env var:
  ```
  # dev server
  cd frontend && HOST=0.0.0.0 PORT=3000 BROWSER=none NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/react-scripts start
  # production build
  cd frontend && CI=false NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/react-scripts build
  # tests
  cd frontend && CI=true NODE_OPTIONS=--openssl-legacy-provider ./node_modules/.bin/react-scripts test --watchAll=false
  ```
- `--openssl-legacy-provider` is required (CRA 5 + modern Node). ESLint runs
  during build; the repo currently compiles with `no-unused-vars` warnings only.

### AI pipeline (`ai-mvp/`) — out of scope for local dev
- The Python Flask orchestrator needs a GPU, an Ollama LLM server (port 11434),
  and ~10GB of offline ML models under `models/`. Without these it cannot
  transcribe/score calls, so it is not run in the cloud dev environment.
- Consequence: dashboard/report widgets that depend on call data and on
  proprietary stored procedures (e.g. `dbo.FetchCallsProcessed7Days`) show empty
  / "no data" / error states locally. This is expected — auth, user/agent
  management, and the app shell all work. `system-monitor/health` may return 500
  in this minimal setup; non-blocking.
