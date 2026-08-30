-- =====================================================================
-- YieldShield — Registration ID document storage
-- Run AFTER 15_user_avatar.sql, as yieldshield_owner.
--
-- Previously only the applicant's ID filename (id_file_name) was ever
-- captured at sign-up — the actual file was never uploaded or stored
-- anywhere, so a verification admin had no way to view the ID itself,
-- only its name. This adds the real file content (as a base64 data
-- URL, same approach as 15_user_avatar.sql's avatar_url) so staff can
-- view/download the attached document during review.
--
-- The 3MB cap below is generous for a scanned ID photo/PDF but still
-- bounds the column against something unreasonably large.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.registration_request
    ADD COLUMN IF NOT EXISTS id_file_data TEXT;

ALTER TABLE yieldshield.registration_request
    ADD CONSTRAINT registration_request_id_file_data_length
    CHECK (id_file_data IS NULL OR length(id_file_data) <= 3000000);

COMMENT ON COLUMN yieldshield.registration_request.id_file_data IS
  'The applicant''s uploaded ID as a base64 data URL (e.g. "data:image/jpeg;base64,..."). NULL for older rows submitted before this column existed.';

-- registration_submit() gains a 9th parameter (the file data). The old
-- 8-arg overload is dropped so the API only ever calls the current
-- signature.
DROP FUNCTION IF EXISTS yieldshield.registration_submit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT);

CREATE OR REPLACE FUNCTION yieldshield.registration_submit(
    p_first_name TEXT, p_middle_name TEXT, p_last_name TEXT, p_email TEXT,
    p_phone TEXT, p_address TEXT, p_barangay_id INTEGER, p_id_file_name TEXT,
    p_id_file_data TEXT DEFAULT NULL
) RETURNS INTEGER
SECURITY DEFINER SET search_path = yieldshield, pg_catalog LANGUAGE plpgsql AS $$
DECLARE
    v_id INTEGER;
BEGIN
    INSERT INTO yieldshield.registration_request
        (first_name, middle_name, last_name, email, phone, address, barangay_id, id_file_name, id_file_data)
    VALUES (p_first_name, p_middle_name, p_last_name, p_email, p_phone, p_address, p_barangay_id, p_id_file_name, p_id_file_data)
    RETURNING registration_id INTO v_id;
    RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION yieldshield.registration_submit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION yieldshield.registration_submit(TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,INTEGER,TEXT,TEXT) TO yieldshield_app;

COMMIT;
