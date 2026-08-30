-- =====================================================================
-- YieldShield — exact field coordinates (map pin)
-- Run AFTER 11_push_subscriptions.sql, as yieldshield_owner.
--
-- Add Field previously only captured a barangay + free-text "location
-- details" note — no way to see exactly where a plot actually is. This
-- adds real lat/lng so the frontend's map picker (MyFarm.tsx /
-- AddFieldModal) can store an exact pin instead.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.field
    ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6) CHECK (latitude  IS NULL OR latitude  BETWEEN -90 AND 90),
    ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6) CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

COMMENT ON COLUMN yieldshield.field.latitude IS 'Exact plot location pinned on the map in Add Field. NULL for fields created before this existed.';
COMMENT ON COLUMN yieldshield.field.longitude IS 'Exact plot location pinned on the map in Add Field. NULL for fields created before this existed.';

-- "location" already existed as free text — now used specifically for
-- the exact street address instead of an open-ended note.
COMMENT ON COLUMN yieldshield.field.location IS 'Exact address of the plot (was a free-text "location details" note before this revision).';

COMMIT;
