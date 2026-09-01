-- =====================================================================
-- YieldShield — crop variety reference catalog
-- Run AFTER 07_v2_features.sql, as yieldshield_owner.
--
-- Source: binalonan_crop_data4.xlsx added a "Crop Varieties" sheet — a
-- 71-row NSIC/PhilRice variety catalog (Palay + Corn) with maturity
-- days, yield potential, and tolerance ratings. Nothing else in that
-- workbook revision needs schema changes:
--   - "Crop Features" was restructured (new column order/names) but
--     every genuinely new column it added (soil pH, organic matter,
--     texture, drainage, seedlings/fertilizer/pesticide/herbicide,
--     and every "_Ratio"/"_Interaction"/"Quarter"/"Semester" derived
--     stat) is 100% empty in this revision — reserved for a future
--     data pass, not data to model today. etl_load.py was updated to
--     read the new column positions for the fields that ARE populated
--     (crop/barangay/season/areas/climate/soil type/technique/yield)
--     and leaves the still-empty engineered ratios NULL, same as the
--     schema already allowed.
--   - Every other sheet (Central Data, Planting Data, Harvest Data,
--     Corn Data, Planting Techniques, Climate Data) is byte-for-byte
--     the same layout as the prior workbook.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

CREATE TABLE IF NOT EXISTS yieldshield.crop_variety (
    variety_id             INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    crop_type_id           INTEGER NOT NULL REFERENCES yieldshield.crop_type(crop_type_id)
                              ON UPDATE CASCADE ON DELETE CASCADE,
    source_variety_code    VARCHAR(20) NOT NULL,   -- the sheet's own "variety_id", e.g. "R001"
    nsic_code              VARCHAR(40),             -- e.g. "NSIC Rc160"
    variety_name           VARCHAR(80) NOT NULL,    -- e.g. "Rc160" — shown in the UI's variety picker
    category                VARCHAR(30),             -- Inbred / Hybrid / GM Hybrid / OPV
    average_yield_t_ha      NUMERIC(6,2),
    maximum_yield_t_ha      NUMERIC(6,2),
    maturity_days           SMALLINT,
    recommended_ecosystem   VARCHAR(80),             -- e.g. "Irrigated Lowland"
    grain_type              VARCHAR(30),
    drought_tolerance       VARCHAR(20),
    flood_tolerance         VARCHAR(20),
    disease_resistance      VARCHAR(30),
    source                  VARCHAR(80),             -- e.g. "PhilRice/NSIC"
    UNIQUE (crop_type_id, variety_name)
);
CREATE INDEX IF NOT EXISTS idx_crop_variety_crop ON yieldshield.crop_variety(crop_type_id);
COMMENT ON TABLE yieldshield.crop_variety IS
  'NSIC/PhilRice-style variety reference catalog (maturity, yield potential, tolerances). Read-only reference data, loaded by etl_load.py — the app''s DataInput/Simulation "variety" field is currently free text and doesn''t enforce a match against this table.';

-- Read-only reference data for the app, same access pattern as
-- crop_type/barangay/season/planting_technique. yieldshield_analyst
-- was missed here originally — every other table relies on migration
-- 02's blanket "future tables" default grant, but this table's own
-- explicit grant list (needed for the app/etl split above) meant it
-- never fell under that default. Confirmed missing the hard way: a
-- read-only analyst-role query joining this table failed with
-- "permission denied for table crop_variety" even though the role's
-- whole purpose is read-only access across the schema. This is a
-- plain reference catalog (variety names, no sensitive data — the
-- same category as crop_type/barangay, which analyst already reads
-- fine), so there's no reason it should've been narrower than those.
GRANT SELECT ON yieldshield.crop_variety TO yieldshield_app, yieldshield_analyst;
GRANT SELECT, INSERT, UPDATE ON yieldshield.crop_variety TO yieldshield_etl;
GRANT USAGE, SELECT ON yieldshield.crop_variety_variety_id_seq TO yieldshield_etl;

COMMIT;