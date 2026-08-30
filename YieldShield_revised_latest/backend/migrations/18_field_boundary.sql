-- =====================================================================
-- YieldShield — plotted field boundary (polygon corners)
-- Run AFTER 17_crop_task_cascade_delete.sql, as yieldshield_owner.
--
-- Add Field previously only captured a single lat/lng pin (migration
-- 12). This adds the actual shape of the plot — the corners the farmer
-- taps out on the map in Add Field — so the field can be drawn as a
-- polygon instead of just a dot, and so its plotted area can be
-- checked against the hectares the farmer typed in.
--
-- Stored as JSONB: a simple array of [lat, lng] pairs in walking order
-- around the plot, e.g. [[16.0503,120.5926],[16.0505,120.5929],...].
-- NULL for fields that only have (or only need) a single pin.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.field
    ADD COLUMN IF NOT EXISTS boundary JSONB;

COMMENT ON COLUMN yieldshield.field.boundary IS
  'Plotted field corners as a JSON array of [lat, lng] pairs, in order around the plot. NULL when the farmer only dropped a single pin (or hasn''t set a location at all).';

COMMIT;
