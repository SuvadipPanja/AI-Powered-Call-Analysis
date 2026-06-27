# Quick deploy checklist — 10.64.194.130

1. On **dev**: build images — see `COPY-TO-PROD.md`

2. Copy `production/` folder to server — include `scripts/` and `docs/`

3. On **prod**:
   ```bash
   ./scripts/01-create-folders.sh
   ./scripts/validate-prod-layout.sh
   ./scripts/deploy.sh --with-up
   ```
   Or follow **`PROD-SERVER-STEPS.md`**

4. Open http://10.64.194.130:8081 — change default passwords

5. Super Admin → Auto Upload: metadata `/app/data/batch_metadata`, audio `/app/data/batch_audio`

6. Profile pics / logo: stored under `volumes/profile_pictures/` and `volumes/branding/` on host

Credentials are in `.env` only.

