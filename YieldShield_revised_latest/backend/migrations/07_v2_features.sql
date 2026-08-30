-- =====================================================================
-- YieldShield — v2 feature set additions
-- Run AFTER 06_user_barangay.sql, as yieldshield_owner.
--
-- Adds the tables/columns needed for the revised UI's new modules,
-- previously mocked entirely in frontend state:
--   1. Admin privilege tiers (master / verification / corn / palay)
--   2. FIELD — a physical plot that can host many cropping periods
--      (farm_profile rows). Existing farm_profile rows are backfilled
--      into one field per farmer+barangay so nothing is orphaned.
--   3. Extra agronomic columns on farm_input_log (variety, technique,
--      spacing, seed rate) the DataInput/Simulation UI now captures.
--   4. REGISTRATION_REQUEST — farmer sign-up approval workflow
--      (verification admin approves -> continue-registration token).
--   5. CROP_TASK — farmer watering/fertilizer to-dos (WeekPlan card).
--   6. ANNOUNCEMENT — MAO advisories/programs shown on the dashboard.
--   7. APP_AUDIT_LOG — human-readable privileged-action trail for the
--      master-admin Audit Log screen. Deliberately separate from the
--      low-level yieldshield.audit_log trigger-based table added in
--      01_schema.sql: that one records raw row diffs for *any* change
--      to a handful of sensitive tables (forensic/compliance use),
--      while this one records a curated, human-authored summary of
--      privileged actions (verification/announcement/account/
--      privilege) the app writes explicitly, one row per action.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

-- ---------------------------------------------------------------------
-- 1. Admin privilege tier
-- ---------------------------------------------------------------------
ALTER TABLE yieldshield.user_account
    ADD COLUMN IF NOT EXISTS admin_role VARCHAR(20)
        CHECK (admin_role IS NULL OR admin_role IN ('master','verification','corn','palay'));

COMMENT ON COLUMN yieldshield.user_account.admin_role IS
  'Privilege tier for role=''Admin'' accounts only. master assigns privileges/creates admins; verification reviews registrations; corn/palay scope an admin to one commodity. NULL for Farmer accounts.';

-- ---------------------------------------------------------------------
-- 1b. Extend the pre-auth login lookup to also return admin_role, so
--     login() can embed it in the session token/response without a
--     second query. Return type changes -> drop before recreate.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS yieldshield.auth_find_user_by_identifier(TEXT);

CREATE OR REPLACE FUNCTION yieldshield.auth_find_user_by_identifier(p_identifier TEXT)
RETURNS TABLE (
    user_id INTEGER, full_name VARCHAR, role VARCHAR, username VARCHAR,
    email VARCHAR, password_hash TEXT, is_active BOOLEAN,
    failed_login_count SMALLINT, locked_until TIMESTAMPTZ, admin_role VARCHAR
)
SECURITY DEFINER
SET search_path = yieldshield, pg_catalog
LANGUAGE sql STABLE AS $$
    SELECT user_id, full_name, role, username, email, password_hash,
           is_active, failed_login_count, locked_until, admin_role
      FROM yieldshield.user_account
     WHERE lower(username) = lower(p_identifier)
        OR lower(email)    = lower(p_identifier)
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_find_user_by_identifier(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_find_user_by_identifier(TEXT) TO yieldshield_app;

-- ---------------------------------------------------------------------
-- 2. FIELD — physical plot, parent of one-or-more farm_profile
--    (cropping period) rows.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yieldshield.field (
    field_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES yieldshield.user_account(user_id)
                   ON UPDATE CASCADE ON DELETE CASCADE,
    barangay_id  INTEGER NOT NULL REFERENCES yieldshield.barangay(barangay_id)
                   ON UPDATE CASCADE ON DELETE RESTRICT,
    name         VARCHAR(120) NOT NULL,
    location     VARCHAR(200),
    area_ha      NUMERIC(10,2) CHECK (area_ha IS NULL OR area_ha >= 0),
    notes        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_field_user ON yieldshield.field(user_id);
CREATE INDEX IF NOT EXISTS idx_field_barangay ON yieldshield.field(barangay_id);

ALTER TABLE yieldshield.farm_profile
    ADD COLUMN IF NOT EXISTS field_id INTEGER
        REFERENCES yieldshield.field(field_id) ON UPDATE CASCADE ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_farm_profile_field ON yieldshield.farm_profile(field_id);

-- Backfill: one field per (user, barangay) grouping of existing plots,
-- named/located the same way the frontend mock previously derived it.
INSERT INTO yieldshield.field (user_id, barangay_id, name, location, area_ha, created_at)
SELECT fp.user_id, fp.barangay_id,
       b.barangay_name || ' Field',
       b.barangay_name || ', Binalonan, Pangasinan',
       MAX(fp.land_area_ha),
       MIN(fp.date_created)
  FROM yieldshield.farm_profile fp
  JOIN yieldshield.barangay b ON b.barangay_id = fp.barangay_id
 WHERE fp.field_id IS NULL
 GROUP BY fp.user_id, fp.barangay_id, b.barangay_name
ON CONFLICT DO NOTHING;

UPDATE yieldshield.farm_profile fp
   SET field_id = f.field_id
  FROM yieldshield.field f
 WHERE fp.field_id IS NULL
   AND f.user_id = fp.user_id
   AND f.barangay_id = fp.barangay_id;

ALTER TABLE yieldshield.field ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_field_owner ON yieldshield.field
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );
ALTER TABLE yieldshield.field FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yieldshield.field TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.field_field_id_seq TO yieldshield_app;

-- ---------------------------------------------------------------------
-- 3. Extra agronomic columns captured by DataInput.tsx / Simulation.tsx
-- ---------------------------------------------------------------------
ALTER TABLE yieldshield.farm_input_log
    ADD COLUMN IF NOT EXISTS variety            VARCHAR(120),
    ADD COLUMN IF NOT EXISTS technique_name      VARCHAR(120),
    ADD COLUMN IF NOT EXISTS spacing_cm          NUMERIC(6,2),
    ADD COLUMN IF NOT EXISTS seed_rate           NUMERIC(10,2);

COMMENT ON COLUMN yieldshield.farm_input_log.technique_name IS
  'Free-text planting technique chosen in the UI (e.g. "Transplanting (Pindot)"). Distinct from technique_id, which links to the structured yieldshield.planting_technique reference row when one matches.';

-- ---------------------------------------------------------------------
-- 3b. Per-prediction confidence. predictive_model.r_squared (01_schema)
--     is one fixed value per *model*; the client-side heuristic scoring
--     formula (store.tsx score(), reused by Simulation.tsx) produces a
--     different confidence per *submission*, so it needs a home on
--     yield_prediction itself.
-- ---------------------------------------------------------------------
ALTER TABLE yieldshield.yield_prediction
    ADD COLUMN IF NOT EXISTS confidence_pct SMALLINT CHECK (confidence_pct IS NULL OR confidence_pct BETWEEN 0 AND 100);

-- ---------------------------------------------------------------------
-- 4. REGISTRATION_REQUEST — pre-auth farmer sign-up approval workflow
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yieldshield.registration_request (
    registration_id  INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    first_name       VARCHAR(80) NOT NULL,
    middle_name      VARCHAR(80),
    last_name        VARCHAR(80) NOT NULL,
    email            VARCHAR(120) NOT NULL,
    phone            VARCHAR(30),
    address          TEXT,
    barangay_id      INTEGER REFERENCES yieldshield.barangay(barangay_id)
                       ON UPDATE CASCADE ON DELETE SET NULL,
    id_file_name     VARCHAR(255),
    status           VARCHAR(10) NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','approved','rejected')),
    token_hash       TEXT,
    token_expires_at TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    reviewed_by      INTEGER REFERENCES yieldshield.user_account(user_id)
                       ON UPDATE CASCADE ON DELETE SET NULL,
    submitted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_registration_status ON yieldshield.registration_request(status);
CREATE INDEX IF NOT EXISTS idx_registration_email ON yieldshield.registration_request(lower(email));

-- No RLS needed: this table is only ever touched pre-auth (public
-- submission + token completion, via SECURITY DEFINER functions below)
-- or by staff through the ordinary yieldshield_app role, same tier of
-- access as yieldshield.user_account itself.
GRANT SELECT, INSERT, UPDATE ON yieldshield.registration_request TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.registration_request_registration_id_seq TO yieldshield_app;

-- Public sign-up: create a pending registration. No auth required.
CREATE OR REPLACE FUNCTION yieldshield.registration_submit(
    p_first_name TEXT, p_middle_name TEXT, p_last_name TEXT, p_email TEXT,
    p_phone TEXT, p_address TEXT, p_barangay_id INTEGER, p_id_file_name TEXT
) RETURNS INTEGER
SECURITY DEFINER SET search_path = yieldshield, pg_catalog LANGUAGE plpgsql AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO yieldshield.registration_request
        (first_name, middle_name, last_name, email, phone, address, barangay_id, id_file_name)
    VALUES (p_first_name, p_middle_name, p_last_name, p_email, p_phone, p_address, p_barangay_id, p_id_file_name)
    RETURNING registration_id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.registration_submit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.registration_submit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT) TO yieldshield_app;

-- Public completion: validate the emailed token, create the real
-- account, mark the registration completed. Mirrors the pattern of
-- auth_consume_reset_token / auth_register_farmer in 03_auth_reset.sql.
CREATE OR REPLACE FUNCTION yieldshield.registration_complete(
    p_email TEXT, p_token_hash TEXT, p_password_hash TEXT
) RETURNS INTEGER
SECURITY DEFINER SET search_path = yieldshield, pg_catalog LANGUAGE plpgsql AS $$
DECLARE
    v_reg RECORD;
    v_username TEXT;
    v_base TEXT;
    v_i INTEGER := 2;
    v_user_id INTEGER;
BEGIN
    SELECT * INTO v_reg
      FROM yieldshield.registration_request
     WHERE lower(email) = lower(p_email)
       AND status = 'approved'
       AND token_hash = p_token_hash
       AND token_expires_at > now()
       AND completed_at IS NULL
     LIMIT 1;

    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    v_base := split_part(v_reg.email, '@', 1);
    v_username := v_base;
    WHILE EXISTS (SELECT 1 FROM yieldshield.user_account WHERE lower(username) = lower(v_username)) LOOP
        v_username := v_base || '.' || v_i;
        v_i := v_i + 1;
    END LOOP;

    INSERT INTO yieldshield.user_account
        (full_name, role, username, email, password_hash, contact_info, barangay_id)
    VALUES (
        trim(both ' ' from concat_ws(' ', v_reg.first_name, v_reg.middle_name, v_reg.last_name)),
        'Farmer', v_username, v_reg.email, p_password_hash, v_reg.phone, v_reg.barangay_id
    )
    RETURNING user_id INTO v_user_id;

    UPDATE yieldshield.registration_request
       SET completed_at = now()
     WHERE registration_id = v_reg.registration_id;

    RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.registration_complete(TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.registration_complete(TEXT,TEXT,TEXT) TO yieldshield_app;

-- ---------------------------------------------------------------------
-- 5. CROP_TASK — farmer watering/fertilizer to-dos
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yieldshield.crop_task (
    task_id       INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES yieldshield.user_account(user_id)
                    ON UPDATE CASCADE ON DELETE CASCADE,
    input_log_id  INTEGER REFERENCES yieldshield.farm_input_log(input_log_id)
                    ON UPDATE CASCADE ON DELETE SET NULL,
    task_type     VARCHAR(20) NOT NULL DEFAULT 'other'
                    CHECK (task_type IN ('water','fertilizer','other')),
    text          VARCHAR(255) NOT NULL,
    due_date      DATE NOT NULL,
    done          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_crop_task_user ON yieldshield.crop_task(user_id);

ALTER TABLE yieldshield.crop_task ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_crop_task_owner ON yieldshield.crop_task
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );
ALTER TABLE yieldshield.crop_task FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yieldshield.crop_task TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.crop_task_task_id_seq TO yieldshield_app;

-- ---------------------------------------------------------------------
-- 6. ANNOUNCEMENT — MAO advisories/programs
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yieldshield.announcement (
    announcement_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    title           VARCHAR(200) NOT NULL,
    body            TEXT NOT NULL,
    announce_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    tag             VARCHAR(20) NOT NULL DEFAULT 'advisory'
                      CHECK (tag IN ('advisory','program','schedule','policy','reminder')),
    author_id       INTEGER REFERENCES yieldshield.user_account(user_id)
                      ON UPDATE CASCADE ON DELETE SET NULL,
    author_label    VARCHAR(120) NOT NULL,
    pinned          BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcement_date ON yieldshield.announcement(announce_date DESC);

-- Every signed-in role reads announcements; only staff write. RLS with
-- a role-gated WITH CHECK (no owner concept — these are municipal-wide).
ALTER TABLE yieldshield.announcement ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_announcement_read ON yieldshield.announcement
    FOR SELECT USING (true);
CREATE POLICY p_announcement_write ON yieldshield.announcement
    FOR INSERT WITH CHECK (yieldshield.current_app_role() IN ('Admin','Agricultural Technician'));
CREATE POLICY p_announcement_modify ON yieldshield.announcement
    FOR UPDATE USING (yieldshield.current_app_role() IN ('Admin','Agricultural Technician'));
CREATE POLICY p_announcement_delete ON yieldshield.announcement
    FOR DELETE USING (yieldshield.current_app_role() IN ('Admin','Agricultural Technician'));
ALTER TABLE yieldshield.announcement FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yieldshield.announcement TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.announcement_announcement_id_seq TO yieldshield_app;

-- ---------------------------------------------------------------------
-- 7. APP_AUDIT_LOG — curated privileged-action trail (Audit Log screen)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yieldshield.app_audit_log (
    app_audit_id  BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id      INTEGER REFERENCES yieldshield.user_account(user_id)
                    ON UPDATE CASCADE ON DELETE SET NULL,
    actor_name    VARCHAR(120) NOT NULL,
    actor_role    VARCHAR(20),
    category      VARCHAR(20) NOT NULL
                    CHECK (category IN ('verification','announcement','account','privilege')),
    action        VARCHAR(255) NOT NULL,
    target        VARCHAR(255),
    at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_app_audit_at ON yieldshield.app_audit_log(at DESC);

-- Master-admin-only read, same as the Audit Log screen; every staff
-- role may write (the entries they generate themselves via their own
-- privileged actions), never farmers.
ALTER TABLE yieldshield.app_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_app_audit_read ON yieldshield.app_audit_log
    FOR SELECT USING (yieldshield.current_app_role() IN ('Admin','Agricultural Technician'));
CREATE POLICY p_app_audit_write ON yieldshield.app_audit_log
    FOR INSERT WITH CHECK (yieldshield.current_app_role() IN ('Admin','Agricultural Technician'));
ALTER TABLE yieldshield.app_audit_log FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON yieldshield.app_audit_log TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.app_audit_log_app_audit_id_seq TO yieldshield_app;

COMMIT;
