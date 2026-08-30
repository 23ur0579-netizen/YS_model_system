-- =====================================================================
-- YieldShield — stop orphaned crop-care tasks from outliving their cropping
-- Run AFTER 16_registration_id_document.sql, as yieldshield_owner.
--
-- crop_task.input_log_id was defined with ON DELETE SET NULL (see
-- 07_v2_features.sql). That means deleting a cropping (a
-- farm_input_log row) never removed its watering/fertilizer tasks —
-- it just nulled their crop link, so they silently turned into
-- permanent "no crop" reminders that keep showing up forever on the
-- Calendar and the Dashboard's "What to do this week", even though
-- the cropping itself is long gone.
--
-- This changes the FK to ON DELETE CASCADE so deleting a cropping
-- from now on correctly removes its tasks with it.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

-- Drop whatever the FK happens to be named (it was declared inline, so
-- Postgres auto-named it) and recreate it with CASCADE instead of SET NULL.
DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT con.conname INTO v_constraint_name
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'yieldshield'
       AND rel.relname = 'crop_task'
       AND con.contype = 'f'
       AND con.conkey = (
             SELECT array_agg(attnum ORDER BY attnum)
               FROM pg_attribute
              WHERE attrelid = rel.oid AND attname = 'input_log_id'
           );

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE yieldshield.crop_task DROP CONSTRAINT %I', v_constraint_name);
    END IF;
END $$;

ALTER TABLE yieldshield.crop_task
    ADD CONSTRAINT crop_task_input_log_id_fkey
    FOREIGN KEY (input_log_id) REFERENCES yieldshield.farm_input_log(input_log_id)
    ON UPDATE CASCADE ON DELETE CASCADE;

COMMIT;

-- ---------------------------------------------------------------------
-- Cleaning up tasks already orphaned by a PAST cropping deletion:
-- ---------------------------------------------------------------------
-- The fix above only prevents *new* orphans. Tasks orphaned before this
-- migration already have input_log_id = NULL, and at this point there's
-- no way to tell those apart from a task a farmer deliberately created
-- with "No crop" selected — so nothing is auto-deleted here.
--
-- A reasonable way to tell them apart: the app only ever auto-creates
-- 'water' and 'fertilizer' tasks *with* a cropping attached (see
-- backend/app/farm_calendar.py) — a farmer picking "No crop" themselves
-- is far more likely to be logging a generic ('other') reminder. Review
-- the SELECT below yourself first; only run the DELETE once you're sure
-- these rows are genuinely leftover from deleted croppings, not
-- something a farmer intentionally logged as a general reminder:
--
-- SELECT task_id, user_id, task_type, text, due_date
--   FROM yieldshield.crop_task
--  WHERE input_log_id IS NULL AND task_type IN ('water', 'fertilizer');
--
-- DELETE FROM yieldshield.crop_task
--  WHERE input_log_id IS NULL AND task_type IN ('water', 'fertilizer');
