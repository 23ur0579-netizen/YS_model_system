-- =====================================================================
-- YieldShield — deleting a field should delete its croppings with it
-- Run AFTER 30_analyst_admin_role.sql, as yieldshield_owner.
--
-- farm_profile.field_id was defined with ON DELETE SET NULL (see
-- 07_v2_features.sql). That means DELETE /fields/{id} (fields.py)
-- never actually removed the croppings that lived on that field — it
-- just nulled their field link, so they silently became orphaned
-- farm_profile rows (and everything cascading from them: farm_input_log,
-- yield_prediction, crop_recommendation, crop_task) that still counted
-- toward barangay yield stats and admin totals, even though the field
-- "containing" them was long gone.
--
-- This is exactly the same class of bug already fixed once for
-- crop_task in migration 17 (input_log_id SET NULL -> CASCADE) — same
-- fix, one level up the chain. It also matches what the UI already
-- promises: MyFarm.tsx's delete-field confirmation literally asks
-- "Delete <field> and its N cropping period(s)?" and optimistically
-- removes those croppings from view immediately, which until now was
-- a lie the backend didn't actually keep — they were still sitting in
-- the database and would reappear (fieldless) on the next reload.
--
-- This changes the FK to ON DELETE CASCADE so deleting a field from
-- now on correctly removes its croppings (and their predictions/tasks)
-- with it.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

-- Pre-flight cleanup: some existing farm_profile rows point at a
-- field_id that no longer exists in yieldshield.field at all (not
-- NULL — an actual dangling reference, e.g. field_id 7 below). That
-- shouldn't be possible under the old SET NULL constraint, so this
-- data most likely predates it, or was written by something that
-- bypassed FK checks (a direct SQL delete, a bulk import/seed run
-- with triggers disabled, etc.). ADD CONSTRAINT validates every
-- existing row, so these would otherwise block this migration outright
-- (as they just did). Null them out first — exactly what the OLD
-- constraint should have already done to them — rather than silently
-- deleting whatever cropping data they belong to.
UPDATE yieldshield.farm_profile
   SET field_id = NULL
 WHERE field_id IS NOT NULL
   AND field_id NOT IN (SELECT field_id FROM yieldshield.field);

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
       AND rel.relname = 'farm_profile'
       AND con.contype = 'f'
       AND con.conkey = (
             SELECT array_agg(attnum ORDER BY attnum)
               FROM pg_attribute
              WHERE attrelid = rel.oid AND attname = 'field_id'
           );

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE yieldshield.farm_profile DROP CONSTRAINT %I', v_constraint_name);
    END IF;
END $$;

ALTER TABLE yieldshield.farm_profile
    ADD CONSTRAINT farm_profile_field_id_fkey
    FOREIGN KEY (field_id) REFERENCES yieldshield.field(field_id)
    ON UPDATE CASCADE ON DELETE CASCADE;

COMMIT;

-- ---------------------------------------------------------------------
-- Pre-existing NULL field_id rows are NOT touched here on purpose:
-- field_id is legitimately optional at creation time too (a cropping
-- can be logged without linking it to a physical field — see
-- FarmInputRequest.field_id in schemas.py), so a NULL there today
-- could mean either "never had a field" or "orphaned by a field
-- deletion before this fix". There's no reliable way to tell those
-- apart after the fact, so nothing is auto-deleted — review manually
-- with something like:
--
-- SELECT farm_id, user_id, plot_code, plot_name
--   FROM yieldshield.farm_profile
--  WHERE field_id IS NULL;
-- ---------------------------------------------------------------------