# YieldShield PostgreSQL Database

A PostgreSQL implementation of the YieldShield ERD (Predictive Crop Yield
Intelligence System — Binalonan, Pangasinan), pre-loaded with the
`binalonan_crop_data1` research dataset.

Everything here has been tested end-to-end against a live PostgreSQL 16
instance (schema apply → security hardening → ETL load → idempotent
re-run → privilege/RLS checks) before being handed to you.

## Files

| File               | Purpose                                                              |
|--------------------|-----------------------------------------------------------------------|
| `01_schema.sql`    | All 16 tables from the ERD (15 entities + an audit log), constraints, indexes |
| `02_security.sql`  | Roles, least-privilege grants, Row-Level Security, TLS notes         |
| `etl_load.py`      | Loads the Excel workbook into the reference/historical tables       |
| `requirements.txt` | Python deps for the ETL script                                      |
| `.env.example`     | Template for DB connection environment variables                    |

## What gets populated vs. what stays empty

The workbook (`Central Data` sheet, 874 rows, matching the ERD's stated
record count) is a **municipal research dataset**, not per-farmer app
data. The ETL therefore only loads:

- `crop_type` (Corn, Palay)
- `barangay` (21 barangays + soil/terrain/elevation/water body/land size)
- `season` (25 Dry/Wet season periods, parsed from e.g. `"DS 2020-2021"`)
- `climate_record` (46 unique season/year/month climate snapshots, incl.
  lat/long from the `Climate Data` sheet)
- `planting_technique` (99 rows total — see breakdown below)
- `production_record` (all 874 planting/harvest rows, `farm_id = NULL`
  since they're aggregate municipal data, not tied to one farmer)
- `crop_features` (458 rows — see below)

## crop_features — engineered features for model training

The `Crop Features` sheet (present in `binalonan_crop_data2.xlsx` and
later) is a denormalized ML feature matrix: one row per
barangay+crop+season, combining the Planting-phase inputs, that
season's climate, and the eventual yield outcome, plus a handful of
engineered ratios (irrigated/rainfed ratio, water availability,
temperature range, heat stress index, humidity×temperature,
solar×temperature).

Rather than duplicate columns that already live in `barangay`,
`planting_technique`, and `climate_record`, the `crop_features` table
only stores the keys (`barangay_id`, `crop_type_id`, `season_id`,
`climate_id`, and a traceable `production_id` pointing back to the
source Planting-phase row) plus the actual engineered numeric columns.
Join back to those tables for soil type, technique text, etc.

This is meant to be the training input for `predictive_model` /
`yield_prediction` — `yieldshield_etl` can write to it (same as the
other historical tables), `yieldshield_app` and `yieldshield_analyst`
can read it.

Tables like `user_account`, `farm_profile`, `farm_input_log`,
`crop_recommendation`, `yield_prediction`, `predictive_model`, `report`,
`sus_response`, and `support_request` are created with full constraints
but left **empty** — they're meant to be filled by the running
application (sign-ups, farm submissions, model predictions, survey
responses), and no such data exists in the source spreadsheet. Seeding
them with fabricated rows would misrepresent real usage.

## Setup order

```bash
# 1. Create a dedicated database + owner role (run as a Postgres superuser)
createdb yieldshield
psql -d yieldshield -c "CREATE ROLE yieldshield_owner LOGIN PASSWORD '...' CREATEDB;"
psql -d yieldshield -c "ALTER DATABASE yieldshield OWNER TO yieldshield_owner;"

# 2. Build the schema
psql "dbname=yieldshield sslmode=require" -U yieldshield_owner -f 01_schema.sql

# 3. Harden security — MUST run as a superuser (creates login roles)
psql "dbname=yieldshield sslmode=require" -f 02_security.sql
#    -> before running, edit the CHANGE_ME_* passwords in 02_security.sql
#       or better, create the roles without a password there and set
#       real credentials afterwards via `\password yieldshield_app` etc.

# 4. Load the dataset
pip install -r requirements.txt
cp .env.example .env   # fill in real values, never commit this file
export $(grep -v '^#' .env | xargs)
python3 etl_load.py --xlsx /path/to/binalonan_crop_data1.xlsx
```

Re-running `etl_load.py` is safe — every load is an `ON CONFLICT` upsert
keyed on natural business keys (barangay name, season code, crop name,
etc.), so it will not create duplicate rows.

## Security model

- **Least privilege, four roles:**
  - `yieldshield_owner` — schema owner, used only for migrations.
  - `yieldshield_etl` — can only read/write the 6 reference/historical
    tables above; has zero access to accounts, farm data, predictions.
  - `yieldshield_app` — full CRUD on the operational tables the running
    app needs, but **read-only** on the historical dataset (the app
    displays it, it doesn't get to silently rewrite the research data).
  - `yieldshield_analyst` — read-only everywhere, and explicitly cannot
    read the `password_hash` column or the `audit_log` table.
- **Row-Level Security** on `user_account`, `farm_profile`,
  `farm_input_log`, `sus_response`, and `support_request`: a logged-in
  farmer only ever sees/edits their own rows; `Admin` /
  `Agricultural Technician` roles see everything. The app sets this per
  request with:
  ```sql
  SET LOCAL app.current_user_id = '42';
  SET LOCAL app.role = 'Farmer';   -- or 'Admin', 'Agricultural Technician', 'Analyst'
  ```
  (Use `app.role`, not `app.current_role` — the latter collides with the
  reserved SQL keyword `CURRENT_ROLE` and fails to parse.)
- **Passwords never touch the database in plaintext.** `user_account.password_hash`
  is documented to only ever hold a bcrypt/argon2id hash computed by the
  application; the DB has no plaintext password logic at all.
- **Audit trail** on `user_account`, `farm_profile`, and
  `production_record` — every insert/update/delete is logged to
  `audit_log` with old/new JSON snapshots via a `SECURITY DEFINER`
  trigger, so even a compromised app role can't erase its own tracks
  (it has no direct grant on `audit_log`).
- **Encrypted connections are enforced at two layers**, both required
  (SQL alone can't force this — it's server/client config):
  - Server (`postgresql.conf` + `pg_hba.conf`): `ssl = on`,
    `password_encryption = scram-sha-256`, and `hostssl`-only rules per
    role (see the bottom of `02_security.sql` for exact lines).
  - Client: every connection string should use
    `sslmode=verify-full sslrootcert=/path/to/ca.crt` — `verify-full`
    also checks the server's hostname against its certificate, which
    plain `require` does not.

## Planting technique detail — two layers per barangay+crop

`planting_technique` now has a `season_type` column (`'DS'`, `'WS'`, or
`NULL`) so a barangay+crop can carry more than one technique row:

- **`season_type = NULL`** — the general/season-independent summary,
  derived from the three technique columns in the `Central Data` sheet
  (42 rows: 21 barangays × 2 crops). Coarse but always present.
- **`season_type = 'DS'` / `'WS'`** — the detailed, soil-type-and-season
  -specific technique parsed from the `Planting Techniques` sheet
  (Sections 2 & 3): seed depth, seed rate, row spacing, water
  management, land preparation, and key notes, exploded out to every
  barangay listed in that section's "Applicable Barangays" column.
  Rice gets up to two rows (DS irrigated vs. WS rainfed); corn gets one
  (it's only grown in the DS window in this dataset). Sta. Catalina and
  Sumabnit's rice techniques apply to both seasons, so those get folded
  into the `NULL`-season row instead of a separate DS/WS one.
- Ranges in the source text (e.g. `"4–5 cm"`, `"15–18 kg/ha"`) are
  averaged into the numeric columns; the full original wording is kept
  in `row_spacing`, `land_prep_method`, and `special_consideration`
  (all `TEXT`), so nothing is lost.
- The same sheet's barangay quick-reference table (Section 4) also
  fills in `barangay.irrigation_priority`, which the earlier load left
  empty.

Net result: 42 general + 38 rice detail + 21 corn detail rows, minus 2
that merge into the general row for Sta. Catalina/Sumabnit rice = **99
rows** in `planting_technique`.

## Notes / things you'll want to adjust for production

- Replace every `CHANGE_ME_*` password in `02_security.sql` before
  running it, or create the roles with no password and set real ones
  out-of-band (secrets manager, `\password`, etc.).
