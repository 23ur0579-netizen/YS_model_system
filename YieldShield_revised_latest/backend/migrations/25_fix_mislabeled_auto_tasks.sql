-- =====================================================================
-- YieldShield — fix mislabeled auto-generated tasks and remove the
-- duplicate schedules that gap already produced
-- Run AFTER 24_normalize_barangay_names.sql, as yieldshield_owner.
--
-- Root cause of "the Calendar shows doubled activities after editing a
-- cropping": migration 22 added crop_task.auto_generated and backfilled
-- every row that existed *at that moment* to TRUE. But any cropping
-- schedule created *after* that migration ran, and *before* the
-- corresponding code change (explicitly setting auto_generated = TRUE
-- in submit_farm_input's INSERT) was actually deployed, got the
-- column's default instead: FALSE. Editing one of those croppings
-- later — even on a fully up-to-date deployment — runs
-- update_farm_input's recalculation, which deletes only
-- `auto_generated = TRUE, done = FALSE` rows before inserting the new
-- schedule. Rows stuck on FALSE from that deployment gap never match,
-- so they're never deleted — the new schedule gets added *next to*
-- the old one instead of replacing it, which is exactly what "doubled
-- activities" looks like.
--
-- This is a one-time gap from that specific deployment window, not an
-- ongoing bug — every code path that creates these rows (
-- submit_farm_input, update_farm_input's regeneration, and the seed
-- script) has correctly set auto_generated = TRUE for a while now.
-- What's needed is a one-time correction for whatever rows already
-- exist from before that.
--
-- generate_activities() (farm_calendar.py) produces a fixed, known set
-- of task texts — optionally with a live weather note appended after
-- " — ", never before — so matching on these as *prefixes* correctly
-- identifies its output regardless of the auto_generated flag's
-- historical accuracy, without needing to guess at exact string
-- equality. These phrases are specific agronomic instructions, not
-- something a farmer's own hand-typed task would plausibly duplicate,
-- so this is a safe way to identify them after the fact.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

UPDATE yieldshield.crop_task
   SET auto_generated = TRUE
 WHERE auto_generated = FALSE
   AND (
        text LIKE 'Prepare seedbed/nursery and sow pre-germinated seeds%'
     OR text LIKE 'Plow and prepare the field%'
     OR text LIKE 'Final harrowing and leveling before transplanting%'
     OR text LIKE 'Final harrowing and leveling before sowing%'
     OR text LIKE 'Check seedling establishment; spot-replant any gaps%'
     OR text LIKE 'Check germination; spot-replant any gaps%'
     OR text LIKE 'Check germination; thin or replant gaps%'
     OR text LIKE 'Apply 1st fertilizer dose%'
     OR text LIKE 'Apply 2nd fertilizer dose%'
     OR text LIKE 'Apply 3rd fertilizer dose if needed (panicle initiation)%'
     OR text LIKE 'Monitor for pests (stem borer, leafhoppers) and disease%'
     OR text LIKE 'Monitor for fall armyworm and other pests%'
     OR text LIKE 'Check water level and drainage (mid-season)%'
     OR text LIKE 'Irrigate if rainfall has been low (tasseling stage)%'
     OR text LIKE 'Drain the field ahead of harvest%'
     OR text LIKE 'Final field check before harvest%'
     OR text LIKE 'Harvest and record actual yield%'
     OR text LIKE 'Check ear/kernel maturity%'
   );

-- ---------------------------------------------------------------------
-- Step 2: remove the duplicates that already exist because of the gap
-- above — now that every row from it is correctly flagged TRUE by
-- Step 1, they're visible to this cleanup too.
--
-- Every row a single generate_activities() call inserts shares the
-- exact same created_at: Postgres's now() returns the transaction's
-- start time, not the current statement's, so one edit's whole INSERT
-- loop (all in one transaction) gets one identical timestamp. That
-- makes grouping by (input_log_id, created_at) a reliable way to tell
-- "one generation batch" from another after the fact — keeping only
-- the most recent batch per cropping removes exactly the stale,
-- superseded schedule and nothing else: not a completed task (done
-- rows are excluded entirely), not a hand-added one (auto_generated
-- = FALSE rows are excluded entirely), and not the correct current
-- schedule (its own batch is always the one being kept).
-- ---------------------------------------------------------------------
DELETE FROM yieldshield.crop_task ct
 WHERE ct.auto_generated = TRUE
   AND ct.done = FALSE
   AND ct.input_log_id IS NOT NULL
   AND ct.created_at < (
       SELECT MAX(ct2.created_at)
         FROM yieldshield.crop_task ct2
        WHERE ct2.input_log_id = ct.input_log_id
          AND ct2.auto_generated = TRUE
          AND ct2.done = FALSE
   );

COMMIT;
