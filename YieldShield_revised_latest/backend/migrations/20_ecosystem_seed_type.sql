-- =====================================================================
-- YieldShield — ecosystem + seed-type classification for official reports
-- Run AFTER 19_plot_code_scope.sql, as yieldshield_owner.
--
-- The municipal "Planting Status" and "Area Harvested" reports DA/the
-- Municipal Agriculture Office already produce (see the uploaded
-- PLANTING_D_S__2022-2023.xlsx / HARVEST_D_S__2022-2023.xlsx) break
-- every barangay's figures down by:
--   - ecosystem: Irrigated vs. Rainfed
--   - seed type: Hybrid (ALPAS), RS-CS, Tagged CS (RCEF/DA-subsidized),
--     or Tagged CS (Commercial)
-- Neither distinction existed anywhere in the data model before this —
-- both are set once, at DataInput.tsx/CroppingModal submission time,
-- same as variety/technique. Existing rows are simply NULL ("not yet
-- classified") and are still counted in each barangay's totals in the
-- reports — just not in any specific seed-type/ecosystem sub-column.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.farm_input_log
    ADD COLUMN IF NOT EXISTS ecosystem VARCHAR(20)
        CHECK (ecosystem IS NULL OR ecosystem IN ('Irrigated', 'Rainfed')),
    ADD COLUMN IF NOT EXISTS seed_type VARCHAR(30)
        CHECK (seed_type IS NULL OR seed_type IN ('Hybrid', 'RS-CS', 'Tagged CS (RCEF)', 'Tagged CS (Commercial)'));

COMMENT ON COLUMN yieldshield.farm_input_log.ecosystem IS
  'Irrigated or Rainfed — drives the Area Harvested/Planting Status reports'' section split. NULL for rows logged before this column existed.';
COMMENT ON COLUMN yieldshield.farm_input_log.seed_type IS
  'DA seed-subsidy category (Hybrid/RS-CS/Tagged CS RCEF/Tagged CS Commercial) — drives the reports'' column split within each ecosystem. NULL for rows logged before this column existed, or where the farmer didn''t specify.';

COMMIT;
