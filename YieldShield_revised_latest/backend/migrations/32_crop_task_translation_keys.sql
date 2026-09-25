-- =====================================================================
-- YieldShield — translation keys for auto-generated calendar activities
-- Run AFTER 31_field_delete_cascade.sql, as yieldshield_owner.
--
-- crop_task.text (and its "-- {weather note}" suffix) was always
-- generated as a finished English sentence — fine for one language,
-- but the app itself supports en/tl/ilo (see YieldShield_ui's
-- i18n.tsx). This adds the columns needed to render an
-- auto-generated task's text in whatever language the viewer has
-- selected, instead of always English:
--   text_key         — matches an i18n.tsx key (e.g.
--                       "activity.fert1Basal") naming this activity;
--                       NULL for a farmer-typed custom task, which is
--                       free text with no translation to look up.
--   note_key         — the live weather-note variant attached at
--                       generation/refresh time (e.g.
--                       "task.note.fertilizerHeavy"), or NULL if this
--                       task has no weather note right now.
--   note_rainfall_mm — the one dynamic number that note's translated
--                       sentence needs (see i18n.tsx's {rainfall}
--                       placeholder) — not JSONB, since every note
--                       variant needs at most this one value.
-- text stays exactly as it was — the plain-English fallback for any
-- client that hasn't been updated to read the key columns yet, and
-- the only field a farmer-typed custom task ever uses.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.crop_task
    ADD COLUMN IF NOT EXISTS text_key VARCHAR(100),
    ADD COLUMN IF NOT EXISTS note_key VARCHAR(100),
    ADD COLUMN IF NOT EXISTS note_rainfall_mm NUMERIC(6,1);

COMMIT;
