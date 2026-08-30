-- =====================================================================
-- YieldShield — add the 3 barangays missing from the historical dataset
-- Run AFTER 22_auto_generated_tasks.sql, as yieldshield_owner.
--
-- Binalonan has 24 barangays (confirmed against the official GADM
-- administrative boundary data this app already ships — see
-- src/imports/Binalonan_Pangasinan_Barangays.json), but the Municipal
-- Agriculture Office's own historical planting/harvest archives this
-- whole system was built from — and which etl_load.py populates
-- yieldshield.barangay from — only ever covered 21 of them. The
-- workbook's own References sheet says as much directly: "Dominant
-- soil series across 21 barangays." Poblacion, Santo Niño, and
-- Canarvacanan simply have no rows anywhere in that dataset, in any
-- spelling (checked every sheet, every column, before concluding
-- this) — not a naming mismatch like the 4 fixed in migration/store.tsx
-- work elsewhere, a genuine absence.
--
-- Rather than leave these 3 real, GADM-confirmed barangays permanently
-- unusable (no farmer of theirs could ever register a plot, and the
-- map/reports would always show them blank), this adds them with the
-- best defensible estimate available instead of leaving them out:
--   - land_size_ha is REAL, not estimated — computed directly from
--     each barangay's actual GADM polygon area (shoelace formula on a
--     local equirectangular projection, accurate to well under 1% at
--     this scale).
--   - soil_type/terrain_type/elevation_m_asl match the municipal mode
--     (Sandy Loam / Flat-Lowland / 30m — what 19-20 of the 21 known
--     barangays actually are), since there's no field survey for
--     these 3 to draw a more specific value from.
--   - nearest_water_body is left NULL rather than guessing a specific
--     river name with no basis.
-- Barangay names are spelled to match the frontend's GADM-based keys
-- exactly (BARANGAY_DATA in data/binalonan.ts) — "Santo Niño" round-
-- trips cleanly through store.tsx's keyToLabel/labelToKey generic
-- transform already, so unlike Camanggaan/Mangkasuy/Sta. Catalina/
-- Sta. Maria Norte, these 3 need no exception entry there.
--
-- The live prediction path (backend/app/ml/features.py's
-- get_area_context) already falls back to a crop-wide average when a
-- barangay has no yieldshield.crop_features history, and soil_type
-- above reuses an existing training-data category — so a real farmer
-- registering in one of these 3 barangays gets a working prediction
-- from day one, not just a seedable test account. What *isn't* fixed
-- by this migration: yieldshield.crop_features itself (barangay-level
-- irrigated/rainfed ratios etc. used as model training features) has
-- no rows for these 3 either, and won't until a future ETL run over
-- real submitted data for them — the crop-wide-average fallback is a
-- reasonable stand-in until then, not a substitute for it.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

INSERT INTO yieldshield.barangay
    (barangay_name, soil_type, terrain_type, elevation_m_asl, nearest_water_body, land_size_ha)
VALUES
    ('Poblacion',     'Sandy Loam', 'Flat / Lowland', 30, NULL, 140.89),
    ('Santo Niño',    'Sandy Loam', 'Flat / Lowland', 30, NULL, 105.66),
    ('Canarvacanan',  'Sandy Loam', 'Flat / Lowland', 30, NULL, 185.91)
ON CONFLICT (barangay_name) DO NOTHING;

COMMIT;
