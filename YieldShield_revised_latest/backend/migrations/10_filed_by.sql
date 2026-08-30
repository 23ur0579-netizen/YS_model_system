-- =====================================================================
-- YieldShield — track who actually filed a cropping
-- Run AFTER 09_notifications.sql, as yieldshield_owner.
--
-- farm_profile.user_id is the farm's *owner* — but since the admin
-- on-behalf fix, that can now legitimately differ from whoever actually
-- clicked submit (a staff member filing on a farmer's behalf via
-- AdminFarms.tsx). This column records the real submitter so the UI can
-- tell a farmer "staff added this for you, feel free to edit it" rather
-- than presenting a staff-filed record as if the farmer entered it
-- themselves.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.farm_profile
    ADD COLUMN IF NOT EXISTS filed_by_user_id INTEGER
        REFERENCES yieldshield.user_account(user_id)
        ON UPDATE CASCADE ON DELETE SET NULL;

COMMENT ON COLUMN yieldshield.farm_profile.filed_by_user_id IS
  'Who actually submitted this record via POST /farm-input. Differs from '
  'user_id (the owner) only when staff filed it on a farmer''s behalf. '
  'NULL for rows created before this column existed — treated the same '
  'as "filed by the owner" (not staff) by the API.';

COMMIT;
