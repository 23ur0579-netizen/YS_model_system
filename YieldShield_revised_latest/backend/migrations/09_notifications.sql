-- =====================================================================
-- YieldShield — real per-user notifications
-- Run AFTER 08_crop_varieties.sql, as yieldshield_owner.
--
-- Notifications.tsx and the Dashboard "announcements" card previously
-- rendered three hardcoded rows baked into the frontend (store.tsx) —
-- there was no backing table at all, so nothing here was ever real,
-- including a fabricated "PAGASA rain advisory". This table gives
-- prediction-ready, low-moisture, and harvest events (all real, all
-- already happening in farm_input.py) somewhere to land as actual
-- per-user notifications. Live weather advisories are NOT stored here —
-- routers/notifications.py synthesizes those on read from the same
-- Open-Meteo-backed weather service the rest of the app already uses,
-- so they're always current rather than a stale row that never expires.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

CREATE TABLE IF NOT EXISTS yieldshield.notification (
    notification_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES yieldshield.user_account(user_id)
                       ON UPDATE CASCADE ON DELETE CASCADE,
    category         VARCHAR(20) NOT NULL DEFAULT 'system'
                       CHECK (category IN ('alert', 'weather', 'prediction', 'harvest', 'system')),
    title            VARCHAR(200) NOT NULL,
    body             TEXT NOT NULL,
    barangay         VARCHAR(60),
    plot_id          VARCHAR(60),
    read             BOOLEAN NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notification_user ON yieldshield.notification(user_id, created_at DESC);

-- Personal, not municipal-wide (unlike announcement): each user reads
-- and manages only their own notifications; Admin can see all of them
-- (mirrors p_crop_task_owner's shape in migration 07).
ALTER TABLE yieldshield.notification ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_notification_owner ON yieldshield.notification
    FOR ALL
    USING (
        yieldshield.current_app_role() = 'Admin'
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() = 'Admin'
        OR user_id = yieldshield.current_app_user_id()
    );
ALTER TABLE yieldshield.notification FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yieldshield.notification TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.notification_notification_id_seq TO yieldshield_app;

COMMIT;
