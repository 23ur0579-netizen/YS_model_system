-- =====================================================================
-- YieldShield — Harvest record additions
-- Run AFTER 04_farm_input_extra.sql, as yieldshield_owner.
-- Adds the "actual yield" fields the MyFarm / YieldResult UI already
-- collects (Record Actual Yield / Done harvest) but that never had a
-- home in the schema — this was previously stored only in frontend
-- in-memory state and lost on refresh.
--
-- No new GRANTs needed: yieldshield_app already has
-- SELECT/INSERT/UPDATE/DELETE on farm_input_log from 02_security.sql,
-- and the existing p_farm_input_log_owner RLS policy (FOR ALL) already
-- covers UPDATE, scoped to the farmer's own farm_profile rows.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.farm_input_log
    ADD COLUMN IF NOT EXISTS actual_yield_mt_ha NUMERIC(8,3) CHECK (actual_yield_mt_ha IS NULL OR actual_yield_mt_ha > 0),
    ADD COLUMN IF NOT EXISTS harvest_date        DATE,
    ADD COLUMN IF NOT EXISTS harvest_notes       TEXT;

COMMENT ON COLUMN yieldshield.farm_input_log.actual_yield_mt_ha IS
  'Farmer-reported actual yield (t/ha) recorded after harvest, entered via the MyFarm/YieldResult "Record Actual Yield" flow. NULL until harvested.';

COMMIT;
