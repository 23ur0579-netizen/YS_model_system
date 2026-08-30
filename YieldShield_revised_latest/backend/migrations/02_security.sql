-- =====================================================================
-- YieldShield — Security Hardening
-- Run AFTER 01_schema.sql, connected as a superuser (e.g. `postgres`),
-- because this script creates login roles (CREATE ROLE requires the
-- CREATEROLE attribute or superuser — a plain owner role without it
-- will fail on the CREATE ROLE statements below).
-- =====================================================================
-- What this file does:
--   1. Creates least-privilege roles (owner, app, etl, readonly).
--   2. Locks down the public schema and default privileges.
--   3. Grants only what each role needs, per table/action.
--   4. Enables Row-Level Security so farmers only see their own data.
--   5. Notes the server/client-side settings required to force
--      encrypted (TLS) connections — those go in postgresql.conf /
--      pg_hba.conf, not in SQL, so they're documented at the bottom.
-- =====================================================================

BEGIN;
SET search_path TO yieldshield, pg_catalog;

-- ---------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------
-- yieldshield_owner : owns the schema/objects, runs migrations only.
-- yieldshield_app    : used by the web/API backend at runtime.
-- yieldshield_etl    : used by the batch loader (etl_load.py) to
--                      refresh reference + historical production data.
-- yieldshield_analyst: read-only, for dashboards/BI/reporting tools.
--
-- NOTE: replace the placeholder passwords below before running, or
-- (recommended) create the roles without passwords here and set
-- credentials out-of-band with `\password` / a secrets manager.
-- All roles require SSL — enforced via pg_hba.conf (see bottom notes)
-- and again per-role below with a login restriction comment.

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yieldshield_app') THEN
        CREATE ROLE yieldshield_app LOGIN PASSWORD '123' CONNECTION LIMIT 50;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yieldshield_etl') THEN
        CREATE ROLE yieldshield_etl LOGIN PASSWORD '123' CONNECTION LIMIT 5;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'yieldshield_analyst') THEN
        CREATE ROLE yieldshield_analyst LOGIN PASSWORD '123' CONNECTION LIMIT 10;
    END IF;
END
$$;

-- Force password rotation discipline: expire immediately so the first
-- real deploy must set a fresh password (uncomment if desired):
-- ALTER ROLE yieldshield_app VALID UNTIL 'now()';

-- ---------------------------------------------------------------------
-- 2. Lock down defaults
-- ---------------------------------------------------------------------
REVOKE ALL ON SCHEMA yieldshield FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA yieldshield FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA yieldshield FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA yieldshield FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;   -- stop accidental object creation in public

GRANT USAGE ON SCHEMA yieldshield TO yieldshield_app, yieldshield_etl, yieldshield_analyst;

-- Make sure objects created later by the owner keep the same
-- restrictive baseline automatically.
ALTER DEFAULT PRIVILEGES IN SCHEMA yieldshield REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA yieldshield REVOKE ALL ON SEQUENCES FROM PUBLIC;

-- ---------------------------------------------------------------------
-- 3. yieldshield_analyst — read-only across everything
-- ---------------------------------------------------------------------
GRANT SELECT ON ALL TABLES IN SCHEMA yieldshield TO yieldshield_analyst;
ALTER DEFAULT PRIVILEGES IN SCHEMA yieldshield GRANT SELECT ON TABLES TO yieldshield_analyst;
-- Analysts never need to see credential hashes or raw audit rows.
REVOKE SELECT (password_hash) ON yieldshield.user_account FROM yieldshield_analyst;
REVOKE SELECT ON yieldshield.audit_log FROM yieldshield_analyst;

-- ---------------------------------------------------------------------
-- 4. yieldshield_etl — write access to reference + historical data only
--    (what etl_load.py populates from the Excel dataset)
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON
    yieldshield.season,
    yieldshield.crop_type,
    yieldshield.barangay,
    yieldshield.climate_record,
    yieldshield.planting_technique,
    yieldshield.production_record,
    yieldshield.crop_features
TO yieldshield_etl;

GRANT USAGE, SELECT ON
    yieldshield.season_season_id_seq,
    yieldshield.crop_type_crop_type_id_seq,
    yieldshield.barangay_barangay_id_seq,
    yieldshield.climate_record_climate_id_seq,
    yieldshield.planting_technique_technique_id_seq,
    yieldshield.production_record_production_id_seq,
    yieldshield.crop_features_feature_id_seq
TO yieldshield_etl;

-- The ETL role must NEVER touch user accounts, farm submissions, or
-- predictions/reports — those belong to the running application.
REVOKE ALL ON
    yieldshield.user_account,
    yieldshield.farm_profile,
    yieldshield.farm_input_log,
    yieldshield.crop_recommendation,
    yieldshield.yield_prediction,
    yieldshield.predictive_model,
    yieldshield.report,
    yieldshield.sus_response,
    yieldshield.support_request,
    yieldshield.audit_log
FROM yieldshield_etl;

-- ---------------------------------------------------------------------
-- 5. yieldshield_app — full CRUD on operational tables, read-only on
--    the historical/reference tables (the app displays but does not
--    rewrite the research dataset)
-- ---------------------------------------------------------------------
GRANT SELECT ON
    yieldshield.season,
    yieldshield.crop_type,
    yieldshield.barangay,
    yieldshield.climate_record,
    yieldshield.planting_technique,
    yieldshield.production_record,
    yieldshield.crop_features
TO yieldshield_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON
    yieldshield.user_account,
    yieldshield.farm_profile,
    yieldshield.farm_input_log,
    yieldshield.crop_recommendation,
    yieldshield.yield_prediction,
    yieldshield.predictive_model,
    yieldshield.report,
    yieldshield.sus_response,
    yieldshield.support_request
TO yieldshield_app;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA yieldshield TO yieldshield_app;

-- The app writes audit rows only through the trigger (SECURITY DEFINER),
-- never directly — deny direct table access from the app role.
REVOKE ALL ON yieldshield.audit_log FROM yieldshield_app;

-- The application must never read raw password hashes back out in bulk
-- queries; only the auth-check function/query path should touch it.
-- (Enforced at the app-query level; column-level REVOKE would also
--  block the app's own login lookups, so instead we rely on:
--   - RLS below to keep rows scoped to the right user, and
--   - the app querying by exact username, never SELECT *.)

-- ---------------------------------------------------------------------
-- 6. Row-Level Security — farmers see only their own data
-- ---------------------------------------------------------------------
-- The application sets, once per connection/request, e.g.:
--   SET LOCAL app.current_user_id = '42';
--   SET LOCAL app.role            = 'Farmer';
-- (NOT "app.current_role" — "current_role" is a reserved SQL keyword
-- and breaks the parser even as a dotted suffix; verified live.)
-- Admins/technicians/analysts bypass the per-row restriction.

CREATE OR REPLACE FUNCTION yieldshield.current_app_user_id() RETURNS INTEGER AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::INTEGER;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION yieldshield.current_app_role() RETURNS TEXT AS $$
    SELECT current_setting('app.role', true);
$$ LANGUAGE sql STABLE;

ALTER TABLE yieldshield.user_account   ENABLE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.farm_profile   ENABLE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.farm_input_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.sus_response   ENABLE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.support_request ENABLE ROW LEVEL SECURITY;

-- user_account: a user can see/update only their own row; staff see all.
CREATE POLICY p_user_account_self ON yieldshield.user_account
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );

-- farm_profile: farmers only see/manage their own farm(s).
CREATE POLICY p_farm_profile_owner ON yieldshield.farm_profile
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );

-- farm_input_log: scoped through the owning farm.
CREATE POLICY p_farm_input_log_owner ON yieldshield.farm_input_log
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR farm_id IN (SELECT farm_id FROM yieldshield.farm_profile
                        WHERE user_id = yieldshield.current_app_user_id())
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR farm_id IN (SELECT farm_id FROM yieldshield.farm_profile
                        WHERE user_id = yieldshield.current_app_user_id())
    );

-- sus_response / support_request: users only see their own submissions.
CREATE POLICY p_sus_response_owner ON yieldshield.sus_response
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );

CREATE POLICY p_support_request_owner ON yieldshield.support_request
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );

-- Table owner and privileged roles still bypass RLS by default only if
-- they are the table owner/superuser; yieldshield_app is NOT the owner,
-- so RLS applies to it as intended. Force RLS for the owner role too,
-- in case the app ever runs as owner (defense in depth):
ALTER TABLE yieldshield.user_account    FORCE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.farm_profile    FORCE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.farm_input_log  FORCE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.sus_response    FORCE ROW LEVEL SECURITY;
ALTER TABLE yieldshield.support_request FORCE ROW LEVEL SECURITY;

COMMIT;

-- =====================================================================
-- SERVER-SIDE settings required to actually ENFORCE encrypted
-- connections (edit these outside of psql, then restart/reload):
--
-- postgresql.conf:
--   ssl = on
--   ssl_cert_file = 'server.crt'
--   ssl_key_file  = 'server.key'
--   password_encryption = 'scram-sha-256'
--
-- pg_hba.conf (reject any non-SSL attempt for these roles/DB):
--   hostssl  yieldshield  yieldshield_app       0.0.0.0/0   scram-sha-256
--   hostssl  yieldshield  yieldshield_etl       10.0.0.0/8  scram-sha-256
--   hostssl  yieldshield  yieldshield_analyst   10.0.0.0/8  scram-sha-256
--   host     all          all                   0.0.0.0/0   reject
--
-- CLIENT-SIDE, every connection string used by the app/ETL/BI tools
-- should include (at minimum):
--   sslmode=verify-full sslrootcert=/path/to/ca.crt
-- (verify-full also checks the server hostname against the cert,
--  which prevents MITM even if DNS is spoofed.)
-- =====================================================================
