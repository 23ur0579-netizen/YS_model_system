-- =====================================================================
-- YieldShield — add "pre_planting" as a distinct crop_task type
-- Run AFTER 12_field_coordinates.sql, as yieldshield_owner.
--
-- Land-prep tasks (plowing, harrowing, seedbed/nursery prep) were
-- previously auto-generated under the generic 'other' bucket alongside
-- pest checks and harvest reminders, so they didn't stand out in the
-- calendar. This gives them their own task_type so the frontend
-- (Calendar.tsx) can show them as a distinct "Pre-Planting" category.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.crop_task
    DROP CONSTRAINT IF EXISTS crop_task_task_type_check;

ALTER TABLE yieldshield.crop_task
    ADD CONSTRAINT crop_task_task_type_check
        CHECK (task_type IN ('water', 'fertilizer', 'pre_planting', 'other'));

COMMENT ON COLUMN yieldshield.crop_task.task_type IS
    'water | fertilizer | pre_planting (land prep, seedbed/nursery, before planting date) | other';

COMMIT;
