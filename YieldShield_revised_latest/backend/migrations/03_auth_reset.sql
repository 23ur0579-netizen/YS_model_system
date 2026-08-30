-- =====================================================================
-- YieldShield — Auth additions: email + password reset
-- Run AFTER 01_schema.sql and 02_security.sql, as yieldshield_owner.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

-- ---------------------------------------------------------------------
-- 1. EMAIL on user_account
-- ---------------------------------------------------------------------
-- Login already used "email or username" in the UI and forgot-password
-- needs a real address to send to, so this is a required, unique column.
ALTER TABLE yieldshield.user_account
    ADD COLUMN IF NOT EXISTS email VARCHAR(120);

-- Backfill from contact_info for any existing rows that look like an
-- email address, so the NOT NULL/UNIQUE constraints below don't fail
-- on data that predates this column.
UPDATE yieldshield.user_account
   SET email = contact_info
 WHERE email IS NULL
   AND contact_info ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

ALTER TABLE yieldshield.user_account
    ALTER COLUMN email SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'user_account_email_key'
    ) THEN
        ALTER TABLE yieldshield.user_account
            ADD CONSTRAINT user_account_email_key UNIQUE (email);
    END IF;
END $$;

ALTER TABLE yieldshield.user_account
    ADD CONSTRAINT user_account_email_format
    CHECK (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

CREATE INDEX IF NOT EXISTS idx_user_account_email
    ON yieldshield.user_account (lower(email));

-- Track failed logins / lockout, useful once real auth is wired up.
ALTER TABLE yieldshield.user_account
    ADD COLUMN IF NOT EXISTS failed_login_count SMALLINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS locked_until        TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS last_login_at        TIMESTAMPTZ;

-- ---------------------------------------------------------------------
-- 2. PASSWORD_RESET_TOKEN
-- ---------------------------------------------------------------------
-- Only a SHA-256 hash of the token is stored — never the raw token —
-- the same way user_account never stores a plaintext password. The
-- raw token only ever exists in the emailed link.
CREATE TABLE IF NOT EXISTS yieldshield.password_reset_token (
    token_id     INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES yieldshield.user_account(user_id)
                   ON UPDATE CASCADE ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    expires_at   TIMESTAMPTZ NOT NULL,
    used_at      TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    requested_ip VARCHAR(45)
);
CREATE INDEX IF NOT EXISTS idx_reset_token_user ON yieldshield.password_reset_token(user_id);
CREATE INDEX IF NOT EXISTS idx_reset_token_expiry ON yieldshield.password_reset_token(expires_at);

ALTER TABLE yieldshield.password_reset_token ENABLE ROW LEVEL SECURITY;

-- Only Admin/Agricultural Technician (i.e. the app's staff-facing
-- tooling) or the owning user can see reset-token rows. In practice
-- the app role sets app.current_user_id right after validating the
-- raw token server-side, so a farmer never queries this directly.
CREATE POLICY p_password_reset_token_owner ON yieldshield.password_reset_token
    FOR ALL
    USING (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() IN ('Admin','Agricultural Technician')
        OR user_id = yieldshield.current_app_user_id()
    );

GRANT SELECT, INSERT, UPDATE ON yieldshield.password_reset_token TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.password_reset_token_token_id_seq TO yieldshield_app;

-- ---------------------------------------------------------------------
-- 3. Pre-auth SECURITY DEFINER functions
-- ---------------------------------------------------------------------
-- p_user_account_self (see 02_security.sql) only lets a caller see
-- their OWN row or a staff role's rows — correct once logged in, but
-- it means a not-yet-authenticated login/register/forgot-password
-- request (no app.current_user_id / app.role set yet) sees zero rows,
-- by design. These narrow, single-purpose functions are the standard
-- Postgres pattern for that: each does exactly one pre-auth job, runs
-- as the table owner (bypassing RLS internally), and is granted to
-- yieldshield_app only — the app can never use them to dump the table.

-- Look up exactly one user by username OR email for a login attempt.
CREATE OR REPLACE FUNCTION yieldshield.auth_find_user_by_identifier(p_identifier TEXT)
RETURNS TABLE (
    user_id INTEGER, full_name VARCHAR, role VARCHAR, username VARCHAR,
    email VARCHAR, password_hash TEXT, is_active BOOLEAN,
    failed_login_count SMALLINT, locked_until TIMESTAMPTZ
)
SECURITY DEFINER
SET search_path = yieldshield, pg_catalog
LANGUAGE sql STABLE AS $$
    SELECT user_id, full_name, role, username, email, password_hash,
           is_active, failed_login_count, locked_until
      FROM yieldshield.user_account
     WHERE lower(username) = lower(p_identifier)
        OR lower(email)    = lower(p_identifier)
     LIMIT 1;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_find_user_by_identifier(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_find_user_by_identifier(TEXT) TO yieldshield_app;

-- Register a new Farmer account. Role is intentionally hard-coded —
-- this function must never be usable to self-register as Admin.
CREATE OR REPLACE FUNCTION yieldshield.auth_register_farmer(
    p_full_name TEXT, p_username TEXT, p_email TEXT,
    p_password_hash TEXT, p_contact_info TEXT
) RETURNS INTEGER
SECURITY DEFINER
SET search_path = yieldshield, pg_catalog
LANGUAGE plpgsql AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO yieldshield.user_account
        (full_name, role, username, email, password_hash, contact_info)
    VALUES (p_full_name, 'Farmer', p_username, p_email, p_password_hash, p_contact_info)
    RETURNING user_id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_register_farmer(TEXT,TEXT,TEXT,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_register_farmer(TEXT,TEXT,TEXT,TEXT,TEXT) TO yieldshield_app;

-- Login outcome bookkeeping (lockout after repeated failures).
CREATE OR REPLACE FUNCTION yieldshield.auth_record_login_success(p_user_id INTEGER)
RETURNS VOID SECURITY DEFINER SET search_path = yieldshield, pg_catalog LANGUAGE sql AS $$
    UPDATE yieldshield.user_account
       SET failed_login_count = 0, locked_until = NULL, last_login_at = now()
     WHERE user_id = p_user_id;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_record_login_success(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_record_login_success(INTEGER) TO yieldshield_app;

CREATE OR REPLACE FUNCTION yieldshield.auth_record_login_failure(p_user_id INTEGER)
RETURNS VOID SECURITY DEFINER SET search_path = yieldshield, pg_catalog LANGUAGE plpgsql AS $$
BEGIN
    UPDATE yieldshield.user_account
       SET failed_login_count = failed_login_count + 1,
           locked_until = CASE WHEN failed_login_count + 1 >= 5
                                THEN now() + interval '15 minutes'
                                ELSE locked_until END
     WHERE user_id = p_user_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_record_login_failure(INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_record_login_failure(INTEGER) TO yieldshield_app;

-- Password reset: issue + consume a token, and apply a new hash.
-- Only the SHA-256 hash of the token is ever stored (see table comment).
CREATE OR REPLACE FUNCTION yieldshield.auth_create_reset_token(
    p_user_id INTEGER, p_token_hash TEXT, p_expires_at TIMESTAMPTZ, p_ip TEXT
) RETURNS INTEGER
SECURITY DEFINER
SET search_path = yieldshield, pg_catalog
LANGUAGE sql AS $$
    INSERT INTO yieldshield.password_reset_token (user_id, token_hash, expires_at, requested_ip)
    VALUES (p_user_id, p_token_hash, p_expires_at, p_ip)
    RETURNING token_id;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_create_reset_token(INTEGER,TEXT,TIMESTAMPTZ,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_create_reset_token(INTEGER,TEXT,TIMESTAMPTZ,TEXT) TO yieldshield_app;

-- Validates the token (unused, unexpired), marks it used, and returns
-- the associated user_id — or NULL if invalid/expired, so the app can
-- give a generic "link invalid or expired" error either way (avoids
-- leaking token-guessing feedback).
CREATE OR REPLACE FUNCTION yieldshield.auth_consume_reset_token(p_token_hash TEXT)
RETURNS INTEGER
SECURITY DEFINER
SET search_path = yieldshield, pg_catalog
LANGUAGE plpgsql AS $$
DECLARE
    v_user_id INTEGER;
BEGIN
    UPDATE yieldshield.password_reset_token
       SET used_at = now()
     WHERE token_hash = p_token_hash
       AND used_at IS NULL
       AND expires_at > now()
     RETURNING user_id INTO v_user_id;
    RETURN v_user_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_consume_reset_token(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_consume_reset_token(TEXT) TO yieldshield_app;

CREATE OR REPLACE FUNCTION yieldshield.auth_set_password(p_user_id INTEGER, p_password_hash TEXT)
RETURNS VOID SECURITY DEFINER SET search_path = yieldshield, pg_catalog LANGUAGE sql AS $$
    UPDATE yieldshield.user_account
       SET password_hash = p_password_hash
     WHERE user_id = p_user_id;
$$;
REVOKE ALL ON FUNCTION yieldshield.auth_set_password(INTEGER,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.auth_set_password(INTEGER,TEXT) TO yieldshield_app;

COMMIT;
