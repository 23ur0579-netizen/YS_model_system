#!/usr/bin/env bash
# =====================================================================
# YieldShield — native (no Docker) Postgres setup
# Run this from backend/
#
# Requires: a local PostgreSQL 16 server already running, and `psql`
# on your PATH (createdb comes with the standard Postgres install).
#
# Usage:
#   ./scripts/01_setup_db_native.sh
#
# You'll be prompted for the yieldshield_owner password. Superuser
# steps (creating the role, running 02_security.sql) will use your
# current OS user's Postgres admin access — adjust -U flags below if
# your local Postgres superuser has a different name (often
# "postgres").
# =====================================================================
set -euo pipefail

SUPERUSER="${PGSUPERUSER:-postgres}"
DB_NAME="yieldshield"

echo "== 1. Create database =="
createdb -U "$SUPERUSER" "$DB_NAME" 2>/dev/null || echo "   (database '$DB_NAME' already exists, continuing)"

echo "== 2. Create yieldshield_owner role =="
read -r -s -p "   Enter a password for yieldshield_owner: " OWNER_PW
echo
psql -U "$SUPERUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yieldshield_owner') THEN
        CREATE ROLE yieldshield_owner LOGIN PASSWORD '$OWNER_PW' CREATEDB;
    END IF;
END
\$\$;
ALTER DATABASE $DB_NAME OWNER TO yieldshield_owner;
SQL

echo "== 3. Apply schema (01_schema.sql) as yieldshield_owner =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/01_schema.sql

echo "== 4. Harden security (02_security.sql) — must run as superuser =="
echo "   NOTE: edit the CHANGE_ME_* passwords inside migrations/02_security.sql"
echo "   before continuing, or accept the placeholders for local dev only."
read -r -p "   Press Enter once you've reviewed migrations/02_security.sql..."
psql -U "$SUPERUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -f migrations/02_security.sql

echo "== 5. Auth + reset-token additions (03_auth_reset.sql) =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/03_auth_reset.sql

echo "== 6. Farm input extra fields (04_farm_input_extra.sql) =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/04_farm_input_extra.sql

echo "== 7. Harvest record fields (05_harvest_record.sql) =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/05_harvest_record.sql

echo "== 8. User barangay linkage (06_user_barangay.sql) =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/06_user_barangay.sql

echo "== 9. v2 features — fields, tasks, announcements, registrations, audit log (07_v2_features.sql) =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/07_v2_features.sql

echo "== 10. Crop variety reference catalog (08_crop_varieties.sql) =="
PGPASSWORD="$OWNER_PW" psql "dbname=$DB_NAME" -U yieldshield_owner -h localhost -v ON_ERROR_STOP=1 -f migrations/08_crop_varieties.sql

echo
echo "Done. Database '$DB_NAME' is ready."
echo "Next: set yieldshield_app / yieldshield_etl / yieldshield_analyst"
echo "passwords for real (they were created with CHANGE_ME_* placeholders"
echo "in 02_security.sql) — e.g.:"
echo "    psql -U $SUPERUSER -d $DB_NAME -c \"ALTER ROLE yieldshield_app PASSWORD 'your-real-password';\""
echo "Then update .env with that password before running the ETL load or the backend."
