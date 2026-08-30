# Running YieldShield (no-model build)

This build is frontend + backend + database **only** — the R yield
prediction service isn't wired up yet. It's for checking the plumbing
end-to-end: auth, farm/plot registration, and the `farm_input_log` DB
writes, without needing R installed or a trained model.

Submitting a field record still works fully — it's saved to
`farm_profile` + `farm_input_log` exactly as normal. The API response
just comes back with `prediction_status: "pending"` and null
prediction fields instead of a real yield number, since there's no
model to call yet.

## Prerequisites

| Tool | Notes |
|---|---|
| PostgreSQL 16 | running locally, with a superuser you can connect as (often `postgres`) |
| Python 3.10+ | for the ETL loader and the FastAPI backend |
| Node.js + npm | for the frontend |
| The dataset | `binalonan_crop_data4.xlsx` — not included in this bundle, source it separately |

(No R install needed for this build.)

## One-time setup, in order

**macOS / Linux / Git Bash / WSL:**
```bash
cd backend
chmod +x scripts/*.sh   # first time only

# 1. Create the DB, roles, and apply all 8 migrations
./scripts/01_setup_db_native.sh

# 2. Configure environment
cp .env.example .env
# edit .env: set PGPASSWORD to yieldshield_app's real password (set via
# ALTER ROLE as printed at the end of step 1), ETL_PGPASSWORD to
# yieldshield_etl's, and JWT_SECRET
# (python3 -c "import secrets; print(secrets.token_urlsafe(48))")

# 3. Load the historical dataset into Postgres
./scripts/02_load_data.sh /path/to/binalonan_crop_data4.xlsx
```

**Windows PowerShell** (same steps, `.ps1` scripts):
```powershell
cd backend

# 1. Create the DB, roles, and apply all 8 migrations
.\scripts\01_setup_db_native.ps1

# 2. Configure environment
copy .env.example .env
# edit .env: set PGPASSWORD to yieldshield_app's real password, ETL_PGPASSWORD
# to yieldshield_etl's, and JWT_SECRET
# (python -c "import secrets; print(secrets.token_urlsafe(48))")

# 3. Load the historical dataset into Postgres
.\scripts\02_load_data.ps1 "C:\path\to\binalonan_crop_data4.xlsx"
```

If PowerShell refuses to run the scripts with a message about execution
policy being disabled, either run once per session:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```
or invoke the script directly through that bypass without changing
your session policy:
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\01_setup_db_native.ps1
```

## Every time you want to run it

Open two terminals (plus a third for the frontend):

**macOS / Linux / Git Bash / WSL:**
```bash
# Terminal 1 — Postgres: however you normally start it locally
#   (brew services start postgresql@16, systemctl start postgresql, etc.)

# Terminal 2 — FastAPI backend (port 8000, docs at /docs)
cd backend && ./scripts/03_run_backend.sh

# Terminal 3 — frontend (port 5173)
cd YieldShield_ui
npm i          # first time only
VITE_API_BASE_URL=http://localhost:8000 npm run dev
```

**Windows PowerShell:**
```powershell
# Terminal 1 — Postgres: however you normally start it locally
#   (services.msc -> postgresql-x64-18, or `net start postgresql-x64-18`)

# Terminal 2 — FastAPI backend (port 8000, docs at /docs)
cd backend
.\scripts\03_run_backend.ps1

# Terminal 3 — frontend (port 5173)
cd YieldShield_ui
npm i          # first time only
$env:VITE_API_BASE_URL = "http://localhost:8000"
npm run dev
```

## What to expect while checking

- Login, registration, and password reset all work normally — full
  auth flow, unaffected by the missing model.
- Submitting a field record (Data Input) succeeds and writes real rows
  to `farm_profile` and `farm_input_log`. The toast/response will say
  a prediction isn't available yet instead of showing a yield number.
- `yieldshield.predictive_model` and `yieldshield.yield_prediction`
  stay empty — that's expected, nothing writes to them in this build.

## Notes

- `PGSSLMODE` in `.env.example` defaults to `verify-full`, which needs
  a real TLS cert. For local dev without TLS set up, use
  `PGSSLMODE=disable` instead.
- Re-running `scripts/02_load_data.sh` is safe — the ETL does
  `ON CONFLICT` upserts keyed on natural business keys, so it won't
  create duplicates.
- `auth/register` only ever creates `Farmer` accounts. To create an
  `Admin` or `Agricultural Technician`, insert the row directly with a
  properly bcrypt/argon2id-hashed password.
