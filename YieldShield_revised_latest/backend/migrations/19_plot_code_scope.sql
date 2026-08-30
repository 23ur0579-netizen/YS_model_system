-- =====================================================================
-- YieldShield — scope plot_code uniqueness to per-farmer
-- Run AFTER 18_field_boundary.sql, as yieldshield_owner.
--
-- plot_code is a free-text label the farmer types themselves when
-- adding a cropping (e.g. "LOT-2026-201") — see MyFarm.tsx's Add
-- Cropping form. 04_farm_input_extra.sql made it unique *system-wide*,
-- across every farmer's account, which was far too strict: two
-- different farmers picking the same everyday label (very likely,
-- since it's just free text with no coordination between them) crashed
-- the request with an unhandled 500 instead of a sensible error.
--
-- This replaces the global uniqueness rule with a per-farmer one — a
-- farmer still can't reuse the exact same code twice on their own
-- account, but two different farmers no longer collide with each other.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

DROP INDEX IF EXISTS yieldshield.idx_farm_profile_plot_code;

CREATE UNIQUE INDEX IF NOT EXISTS idx_farm_profile_user_plot_code
    ON yieldshield.farm_profile (user_id, plot_code)
    WHERE plot_code IS NOT NULL;

COMMIT;
