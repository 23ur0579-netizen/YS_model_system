-- =====================================================================
-- YieldShield — seed distribution tracking + real seed-type categories
-- Run AFTER 20_ecosystem_seed_type.sql, as yieldshield_owner.
--
-- Two changes, both driven by the actual DA/Municipal Agriculture
-- Office practice described by the office and confirmed against the
-- uploaded PLANTING_W_S__2023.xlsx reference (RAINFED / IRRIGATED /
-- TOTAL sheets):
--
-- 1. farm_input_log.seed_type's placeholder 'RS-CS' category is
--    replaced by the category the office actually uses on its own
--    forms: 'Farmer Saved Seeds' (a farmer plants seed they saved
--    from a previous harvest, rather than anything sourced from the
--    Department of Agriculture). 'RS-CS' is left in the CHECK
--    constraint for backward compatibility with any row already
--    classified that way, but the UI no longer offers it.
--
-- 2. A new yieldshield.seed_distribution table tracks the DA's own
--    side of this: which barangay is scheduled to receive which
--    seed type, how much, and whether it's gone out yet. This is
--    intentionally separate from farm_input_log — a farmer's
--    cropping record says what seed *they* planted; this table says
--    what the DA *handed out*, matched up by barangay/crop/ecosystem/
--    season for the office's own tallying, not tied to one specific
--    farmer or cropping record.
--
--    The office's rule of thumb — hybrid seed for irrigated areas,
--    certified seed for rainfed areas — is NOT enforced as a hard
--    constraint here: some rainfed-area farmers specifically request
--    hybrid seed for its higher yield potential, and the office still
--    needs to be able to record that. The app instead flags such rows
--    as an "off-guideline" exception in the UI so it's visible, not
--    rejected.
--
--    Only the corn/palay commodity coordinators and a master admin
--    manage this (see require_admin_role("corn","palay") in
--    routers/seed_distribution.py) — same admin_role tier gate as
--    Planning.tsx, enforced at the API layer; RLS here mirrors the
--    broader Admin/Agricultural Technician staff policy already used
--    for announcement/app_audit_log, same division of labor as
--    elsewhere in this schema.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

ALTER TABLE yieldshield.farm_input_log
    DROP CONSTRAINT IF EXISTS farm_input_log_seed_type_check;
ALTER TABLE yieldshield.farm_input_log
    ADD CONSTRAINT farm_input_log_seed_type_check
        CHECK (seed_type IS NULL OR seed_type IN (
            'Hybrid', 'RS-CS', 'Tagged CS (RCEF)', 'Tagged CS (Commercial)', 'Farmer Saved Seeds'
        ));

COMMENT ON COLUMN yieldshield.farm_input_log.seed_type IS
  'DA seed-subsidy category (Hybrid/Tagged CS RCEF/Tagged CS Commercial) or Farmer Saved Seeds (own/saved seed, not DA-sourced) — drives the reports'' column split within each ecosystem. ''RS-CS'' kept only for rows classified before this migration; no longer offered in the UI. NULL where the farmer didn''t specify.';

-- ---------------------------------------------------------------------
-- SEED_DISTRIBUTION — DA seed hand-outs, scheduled and tallied per
-- barangay. seed_type here is deliberately narrower than
-- farm_input_log's — the DA can't distribute "Farmer Saved Seeds" by
-- definition, so that value is excluded.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS yieldshield.seed_distribution (
    distribution_id   INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    crop_type_id       INTEGER NOT NULL REFERENCES yieldshield.crop_type(crop_type_id)
                          ON UPDATE CASCADE ON DELETE RESTRICT,
    barangay_id        INTEGER NOT NULL REFERENCES yieldshield.barangay(barangay_id)
                          ON UPDATE CASCADE ON DELETE RESTRICT,
    ecosystem          VARCHAR(20) NOT NULL
                          CHECK (ecosystem IN ('Irrigated', 'Rainfed')),
    seed_type          VARCHAR(30) NOT NULL
                          CHECK (seed_type IN ('Hybrid', 'Tagged CS (RCEF)', 'Tagged CS (Commercial)')),
    quantity_kg        NUMERIC(10,2) NOT NULL CHECK (quantity_kg > 0),
    beneficiary_count  INTEGER CHECK (beneficiary_count IS NULL OR beneficiary_count >= 0),
    scheduled_date     DATE NOT NULL,
    distributed_date   DATE,
    status             VARCHAR(20) NOT NULL DEFAULT 'Scheduled'
                          CHECK (status IN ('Scheduled', 'Distributed', 'Cancelled')),
    notes              VARCHAR(2000) NOT NULL DEFAULT '',
    created_by         INTEGER REFERENCES yieldshield.user_account(user_id)
                          ON UPDATE CASCADE ON DELETE SET NULL,
    updated_by         INTEGER REFERENCES yieldshield.user_account(user_id)
                          ON UPDATE CASCADE ON DELETE SET NULL,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT seed_distribution_distributed_date_requires_status
        CHECK (distributed_date IS NULL OR status = 'Distributed')
);
CREATE INDEX IF NOT EXISTS idx_seed_distribution_barangay ON yieldshield.seed_distribution(barangay_id);
CREATE INDEX IF NOT EXISTS idx_seed_distribution_crop ON yieldshield.seed_distribution(crop_type_id);
CREATE INDEX IF NOT EXISTS idx_seed_distribution_scheduled_date ON yieldshield.seed_distribution(scheduled_date);

COMMENT ON TABLE yieldshield.seed_distribution IS
  'DA/MAO seed hand-outs scheduled and tallied per barangay, separate from farm_input_log (which records what a farmer actually planted). Managed by corn/palay coordinators and master admins only.';
COMMENT ON COLUMN yieldshield.seed_distribution.ecosystem IS
  'Which ecosystem this hand-out targets. Office guideline is Hybrid->Irrigated, certified (Tagged CS)->Rainfed; deviations (e.g. Hybrid to a Rainfed barangay on farmer request) are allowed and flagged in the UI, not blocked here.';

CREATE OR REPLACE FUNCTION yieldshield.trg_seed_distribution_touch() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_seed_distribution_updated_at ON yieldshield.seed_distribution;
CREATE TRIGGER trg_seed_distribution_updated_at
    BEFORE UPDATE ON yieldshield.seed_distribution
    FOR EACH ROW EXECUTE FUNCTION yieldshield.trg_seed_distribution_touch();

-- Municipal-wide record, same shape as announcement: every staff role
-- can read (so e.g. a verification-tier admin isn't hard-blocked at
-- the DB layer), only staff can write. The corn/palay/master-only
-- restriction on top of this is an API-layer (require_admin_role)
-- decision, not a DB one, matching how app_audit_log/audit.py already
-- divide that responsibility.
ALTER TABLE yieldshield.seed_distribution ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_seed_distribution_read ON yieldshield.seed_distribution
    FOR SELECT USING (yieldshield.current_app_role() IN ('Admin', 'Agricultural Technician'));
CREATE POLICY p_seed_distribution_write ON yieldshield.seed_distribution
    FOR INSERT WITH CHECK (yieldshield.current_app_role() IN ('Admin', 'Agricultural Technician'));
CREATE POLICY p_seed_distribution_modify ON yieldshield.seed_distribution
    FOR UPDATE USING (yieldshield.current_app_role() IN ('Admin', 'Agricultural Technician'));
CREATE POLICY p_seed_distribution_delete ON yieldshield.seed_distribution
    FOR DELETE USING (yieldshield.current_app_role() IN ('Admin', 'Agricultural Technician'));
ALTER TABLE yieldshield.seed_distribution FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yieldshield.seed_distribution TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.seed_distribution_distribution_id_seq TO yieldshield_app;

-- Let routers/seed_distribution.py log its own create/update/delete
-- actions to the same curated trail AnnouncementLog/AuditLog.tsx
-- already read (write_audit()), instead of overloading the
-- unrelated 'announcement' category for them.
ALTER TABLE yieldshield.app_audit_log DROP CONSTRAINT IF EXISTS app_audit_log_category_check;
ALTER TABLE yieldshield.app_audit_log ADD CONSTRAINT app_audit_log_category_check
    CHECK (category IN ('verification', 'announcement', 'account', 'privilege', 'seed_distribution'));

COMMIT;
