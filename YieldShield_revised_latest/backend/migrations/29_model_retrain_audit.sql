-- =====================================================================
-- YieldShield — audit category for admin-triggered model retraining
-- Run AFTER 28_crop_task_end_date.sql, as yieldshield_owner.
--
-- Same pattern as migration 21's seed_distribution addition: the
-- category check on yieldshield.app_audit_log needs the new value
-- added before any 'model_retrain' row can be inserted (see the new
-- POST /admin/model/retrain endpoint).
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.app_audit_log DROP CONSTRAINT IF EXISTS app_audit_log_category_check;
ALTER TABLE yieldshield.app_audit_log ADD CONSTRAINT app_audit_log_category_check
    CHECK (category IN ('verification', 'announcement', 'account', 'privilege', 'seed_distribution', 'model_retrain'));

COMMIT;
