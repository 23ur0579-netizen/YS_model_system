-- =====================================================================
-- YieldShield — Profile picture storage
-- Run AFTER 14_task_notification_category.sql, as yieldshield_owner.
--
-- Adds avatar_url to user_account so a farmer's (or admin's) profile
-- picture is stored in the database instead of only in the browser's
-- localStorage. The frontend already downsizes any uploaded photo to a
-- small 256x256 JPEG before sending it (see lib/image.ts), so this is
-- typically a ~15-40KB base64 data URL — small enough for a plain TEXT
-- column, no object storage needed. The 300000-char cap below is a
-- generous safety ceiling against a client sending something much
-- larger than expected, not a realistic size for what's actually sent.
--
-- No new GRANTs or RLS policies needed: yieldshield_app already has
-- SELECT/INSERT/UPDATE/DELETE on user_account (02_security.sql) and
-- p_user_account_self already lets a user update their own row, which
-- is a row-level policy — it covers every column on that row,
-- avatar_url included, with no extra setup.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.user_account
    ADD COLUMN IF NOT EXISTS avatar_url TEXT;

ALTER TABLE yieldshield.user_account
    ADD CONSTRAINT user_account_avatar_url_length
    CHECK (avatar_url IS NULL OR length(avatar_url) <= 300000);

COMMENT ON COLUMN yieldshield.user_account.avatar_url IS
  'Profile picture as a base64 data URL (small JPEG, resized client-side before upload). NULL = no picture set, falls back to initials in the UI.';

COMMIT;
