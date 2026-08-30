-- =====================================================================
-- YieldShield — Farm input module additions
-- Run AFTER 03_auth_reset.sql, as yieldshield_owner.
-- Adds the fields the DataInput.tsx UI actually submits per plot that
-- the base ERD tables don't carry (plot identifier, soil pH/moisture
-- snapshot, planted quantity, free-text notes) rather than overloading
-- an existing column with a different meaning.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.farm_profile
    ADD COLUMN IF NOT EXISTS plot_code VARCHAR(50);

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_profile_plot_code
    ON yieldshield.farm_profile (plot_code)
    WHERE plot_code IS NOT NULL;

ALTER TABLE yieldshield.farm_input_log
    ADD COLUMN IF NOT EXISTS ph                NUMERIC(4,2) CHECK (ph IS NULL OR ph BETWEEN 0 AND 14),
    ADD COLUMN IF NOT EXISTS soil_moisture_pct  NUMERIC(5,2) CHECK (soil_moisture_pct IS NULL OR soil_moisture_pct BETWEEN 0 AND 100),
    ADD COLUMN IF NOT EXISTS quantity           NUMERIC(12,2),
    ADD COLUMN IF NOT EXISTS quantity_unit      VARCHAR(30),
    ADD COLUMN IF NOT EXISTS notes              TEXT;

COMMIT;
