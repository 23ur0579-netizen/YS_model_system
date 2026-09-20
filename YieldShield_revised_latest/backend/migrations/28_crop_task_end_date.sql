-- =====================================================================
-- YieldShield — optional date range for crop_task activities
-- Run AFTER 27_plot_name.sql, as yieldshield_owner.
--
-- Every activity (watering, fertilizing, pre-planting, etc.) previously
-- had only a single due_date, so multi-day activities (e.g. "land
-- preparation, Jan 5-10") had no way to be represented as one item —
-- see Calendar.tsx. end_date is optional and nullable: NULL means the
-- task is still a single-day item exactly as before (every existing
-- row keeps working unchanged); a non-NULL end_date >= due_date marks
-- the task as spanning that whole range, which Calendar.tsx shades
-- continuously across the days in between.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.crop_task
    ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE yieldshield.crop_task
    ADD CONSTRAINT crop_task_end_date_after_due_date
    CHECK (end_date IS NULL OR end_date >= due_date);

COMMIT;
