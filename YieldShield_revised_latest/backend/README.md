# YieldShield API

The missing middle layer between `YieldShield_ui` (React, currently all
in-memory mock data) and the `01_schema.sql` / `02_security.sql`
Postgres database: real login with role checking, forgot/reset
password email, and a farm-input endpoint that writes to the DB.

## Setup

```bash
# 1. Apply the base DB project first (see files_3/README.md), then these two:
psql "dbname=yieldshield sslmode=require" -U yieldshield_owner -f migrations/03_auth_reset.sql
psql "dbname=yieldshield sslmode=require" -U yieldshield_owner -f migrations/04_farm_input_extra.sql

# 2. Install deps
pip install -r requirements.txt --break-system-packages   # or use a venv

# 3. Configure
cp .env.example .env
# fill in PGPASSWORD (yieldshield_app's real password),
# JWT_SECRET (python -c "import secrets; print(secrets.token_urlsafe(48))"),
# and SMTP_* if you want real emails (leave SMTP_HOST blank to just
# log the reset link to the console during local dev)

# 4. Run
export $(grep -v '^#' .env | xargs)
uvicorn app.main:app --reload --port 8000
```

Docs at `http://localhost:8000/docs` once it's running.

## Yield prediction — not connected yet in this build

This build is frontend + backend + database only. `app/routers/farm_input.py`
inserts `farm_profile` + `farm_input_log` and returns
`prediction_status: "pending"` with null prediction fields — there's
no R model service call here yet. `yieldshield.predictive_model` and
`yieldshield.yield_prediction` stay empty. This is intentional, for
checking the DB + API + frontend flow before the model is added back.

To run everything together, see `RUNNING.md` for the full
walkthrough. Short version:

```bash
cd backend
./scripts/01_setup_db_native.sh                        # Postgres, roles, migrations 01-08
cp .env.example .env                                    # then fill in PGPASSWORD, JWT_SECRET
./scripts/02_load_data.sh /path/to/binalonan_crop_data4.xlsx
./scripts/03_run_backend.sh                              # terminal 2 — FastAPI, port 8000
```

Then run the frontend separately (`npm run dev`, with
`VITE_API_BASE_URL=http://localhost:8000`).

## What's here

- `migrations/03_auth_reset.sql` — adds `user_account.email`, a
  `password_reset_token` table, and a handful of narrow
  `SECURITY DEFINER` functions for the pre-auth operations (login
  lookup, register, issue/consume reset token) that the existing
  Row-Level-Security policies correctly block for an unauthenticated
  connection.
- `migrations/04_farm_input_extra.sql` — adds the fields
  `DataInput.tsx` actually submits (plot code, pH, soil moisture,
  quantity, notes) that the base ERD didn't carry.
- `app/routers/auth.py` — `POST /auth/login` (checks the password AND
  that the account's DB role matches the Farmer/Admin tab the user
  picked), `POST /auth/register`, `POST /auth/forgot-password` (always
  returns the same generic response so it can't be used to enumerate
  accounts; only sends an email if the account is real),
  `POST /auth/reset-password`.
- `app/routers/farm_input.py` — `POST /farm-input`, auth-required,
  writes one `farm_profile` + `farm_input_log` row per submission,
  scoped by RLS to the logged-in user. Yield prediction isn't wired
  up in this build — the response comes back with
  `prediction_status: "pending"` and null prediction fields.
- `app/db.py` — every request sets `app.current_user_id` / `app.role`
  for its transaction, so Postgres's own RLS policies do the row
  scoping, not just app-layer checks.

## Notes / things to decide before production

- Login lockout is 5 failed attempts → 15 min lock (`auth_record_login_failure`
  in the migration) — adjust to your policy.
- `auth/register` always creates a `Farmer` — there's intentionally no
  self-serve path to `Admin`/`Agricultural Technician`; create those
  rows directly (with a properly hashed password) as an ops task.
- Reset tokens expire in 30 min by default (`RESET_TOKEN_EXPIRE_MINUTES`).
- CORS is locked to `APP_BASE_URL`/`CORS_ORIGINS` — update for your
  deployed frontend origin.
