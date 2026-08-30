-- =====================================================================
-- YieldShield — User barangay + admin-managed accounts
-- Run AFTER 05_harvest_record.sql, as yieldshield_owner.
-- Adds a barangay_id to user_account so the Manage Users admin screen
-- (previously an in-memory mock list) can display/filter real accounts
-- by barangay, and extends auth_register_farmer so self-registration
-- persists the barangay the farmer picked on the sign-up form instead
-- of silently discarding it.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.user_account
    ADD COLUMN IF NOT EXISTS barangay_id INTEGER
        REFERENCES yieldshield.barangay(barangay_id)
        ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_account_barangay
    ON yieldshield.user_account (barangay_id);

-- Extend the pre-auth registration function with an optional barangay.
-- Postgres treats a different parameter list as an overload rather
-- than a replacement, so the old 5-arg signature is dropped first —
-- otherwise a 5-arg call would keep resolving to the old function
-- (exact arity wins over a default-filled match) and silently never
-- store the barangay.
DROP FUNCTION IF EXISTS yieldshield.auth_register_farmer(TEXT,TEXT,TEXT,TEXT,TEXT);

CREATE OR REPLACE FUNCTION yieldshield.auth_register_farmer(
    p_full_name TEXT, p_username TEXT, p_email TEXT,
    p_password_hash TEXT, p_contact_info TEXT, p_barangay_id INTEGER DEFAULT NULL
) RETURNS INTEGER
SECURITY DEFINER
SET search_path = yieldshield, pg_catalog
LANGUAGE plpgsql AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO yieldshield.user_account
        (full_name, role, username, email, password_hash, contact_info, barangay_id)
    VALUES (p_full_name, 'Farmer', p_username, p_email, p_password_hash, p_contact_info, p_barangay_id)
    RETURNING user_id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_register_farmer(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_register_farmer(TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER) TO yieldshield_app;

COMMIT;
