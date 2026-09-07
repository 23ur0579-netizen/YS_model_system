-- =====================================================================
-- YieldShield — drop ecosystem tracking from seed_distribution
-- Run AFTER 21_seed_distribution.sql, as yieldshield_owner.
--
-- The office decided ecosystem (Irrigated/Rainfed) isn't something it
-- wants recorded per hand-out on this table — schedules are tracked by
-- barangay/crop/seed-type only from here on. This also retires the
-- "off-guideline" exception flag (routers/seed_distribution.py's
-- _on_guideline / SeedDistributionOut.onGuideline), since that check
-- only ever existed to compare seed_type against ecosystem.
--
-- Note: this is unrelated to farm_input_log.ecosystem (added in
-- 20_ecosystem_seed_type.sql) — that column backs a farmer's own
-- cropping records and AdminFarms.tsx's Reports panel, and is left
-- untouched here.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.seed_distribution
    DROP COLUMN IF EXISTS ecosystem;

COMMIT;
