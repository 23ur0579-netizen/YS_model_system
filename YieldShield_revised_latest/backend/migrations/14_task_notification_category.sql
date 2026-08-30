-- =====================================================================
-- YieldShield — add "task" as a notification category
-- Run AFTER 13_pre_planting_task_type.sql, as yieldshield_owner.
--
-- The auto-generated crop-care schedule (farm_calendar.py) previously
-- only surfaced in the Calendar/WeekPlan — a farmer wasn't told about
-- it anywhere else. This lets farm_input.py raise a real notification
-- (and push, same as the existing prediction/low-moisture ones) when a
-- new cropping's schedule is generated, so the upcoming pre-planting
-- step doesn't go unnoticed.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.notification
    DROP CONSTRAINT IF EXISTS notification_category_check;

ALTER TABLE yieldshield.notification
    ADD CONSTRAINT notification_category_check
        CHECK (category IN ('alert', 'weather', 'prediction', 'harvest', 'task', 'system'));

COMMENT ON COLUMN yieldshield.notification.category IS
    'alert | weather | prediction | harvest | task (crop-care schedule reminder) | system';

COMMIT;
