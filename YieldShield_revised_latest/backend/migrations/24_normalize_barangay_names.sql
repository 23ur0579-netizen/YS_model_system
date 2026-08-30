-- =====================================================================
-- YieldShield — normalize barangay_name to a consistent Unicode form
-- Run AFTER 23_add_missing_barangays.sql, as yieldshield_owner.
--
-- "Santo Niño" (and any other accented name) can be represented two
-- different ways at the byte level: "ñ" as one composed codepoint, or
-- as "n" + a separate combining-tilde mark — visually identical,
-- byte-for-byte different. A migration file, a text editor resaving
-- it, or a terminal/psql client's own encoding handling can silently
-- convert between the two, and a plain `=` comparison (what every
-- barangay_name lookup in this app used until now) treats them as
-- unequal. That's exactly what caused "Santo Niño" to keep showing as
-- "not found in the barangay table" even after 23_add_missing_
-- barangays.sql supposedly added it — the row was there, just not
-- byte-identical to what the application was comparing against.
--
-- This forces every existing barangay_name to Unicode's standard
-- "composed" form (NFC), and the application layer (routers/
-- farm_input.py, routers/seed_distribution.py, store.tsx's
-- keyToLabel/labelToKey, and the seed script's load_barangays) now
-- normalizes to NFC before comparing too, so this can't quietly
-- reappear regardless of which form a future migration, editor, or
-- terminal happens to write. Safe to run repeatedly — already-NFC
-- values are left untouched.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

UPDATE yieldshield.barangay
   SET barangay_name = normalize(barangay_name, NFC)
 WHERE barangay_name IS DISTINCT FROM normalize(barangay_name, NFC);

COMMIT;
