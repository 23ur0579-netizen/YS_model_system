-- =====================================================================
-- YieldShield — add "analyst" to the admin_role tier check
-- Run AFTER 29_model_retrain_audit.sql, as yieldshield_owner.
--
-- New AdminRole tier (see store.tsx's ADMIN_ROLE_META) that can trigger
-- and monitor model retraining (POST/GET /admin/model/... — see
-- app/routers/model_admin.py) without needing full "master" privilege.
-- Migration 07 created this CHECK inline with the column, so it got
-- Postgres's default auto-generated name; DROP IF EXISTS guards against
-- a differently-named constraint on a DB where it was hand-edited.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.user_account DROP CONSTRAINT IF EXISTS user_account_admin_role_check;
ALTER TABLE yieldshield.user_account ADD CONSTRAINT user_account_admin_role_check
    CHECK (admin_role IS NULL OR admin_role IN ('master', 'verification', 'corn', 'palay', 'analyst'));

COMMIT;
