-- =====================================================================
-- YieldShield — separate cropping "name" from the plot_code identifier
-- Run AFTER 26_remove_seed_distribution_ecosystem.sql, as yieldshield_owner.
--
-- plot_code (migrations 04, 19) is the plot's identifier — from this
-- revision on, the frontend auto-generates it (see MyFarm.tsx's
-- generatePlotCode) instead of asking the farmer to invent a unique
-- code by hand. plot_name is a new, separate, optional free-text label
-- the farmer can still set/edit for their own reference (e.g. "Back lot
-- near the creek") — no uniqueness constraint, since it's just a label,
-- not an identifier.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.farm_profile
    ADD COLUMN IF NOT EXISTS plot_name VARCHAR(120);

COMMIT;
