-- =====================================================================
-- YieldShield — Web Push subscriptions (device notifications)
-- Run AFTER 10_filed_by.sql, as yieldshield_owner.
--
-- Free, no third-party API: this is the browser-native Web Push
-- standard. Each row is one (browser + device) subscription a user
-- opted into via Settings -> "Enable device notifications". The
-- backend signs pushes itself with a VAPID keypair (see
-- app/push.py / scripts/04_generate_vapid_keys.py) — no paid push
-- service, no per-message cost, no vendor account.
-- =====================================================================
BEGIN;
SET search_path TO yieldshield, pg_catalog;

CREATE TABLE IF NOT EXISTS yieldshield.push_subscription (
    subscription_id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES yieldshield.user_account(user_id)
                      ON UPDATE CASCADE ON DELETE CASCADE,
    endpoint        TEXT NOT NULL UNIQUE,
    p256dh          TEXT NOT NULL,
    auth            TEXT NOT NULL,
    user_agent      VARCHAR(300),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_push_subscription_user ON yieldshield.push_subscription(user_id);

-- endpoint is UNIQUE per browser+device+site regardless of who's
-- signed in, so re-subscribing (e.g. a shared tablet where a
-- different farmer later logs in) reassigns the row rather than
-- erroring — see the ON CONFLICT in routers/push.py.
ALTER TABLE yieldshield.push_subscription ENABLE ROW LEVEL SECURITY;
CREATE POLICY p_push_subscription_owner ON yieldshield.push_subscription
    FOR ALL
    USING (
        yieldshield.current_app_role() = 'Admin'
        OR user_id = yieldshield.current_app_user_id()
    )
    WITH CHECK (
        yieldshield.current_app_role() = 'Admin'
        OR user_id = yieldshield.current_app_user_id()
    );
ALTER TABLE yieldshield.push_subscription FORCE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON yieldshield.push_subscription TO yieldshield_app;
GRANT USAGE, SELECT ON yieldshield.push_subscription_subscription_id_seq TO yieldshield_app;

COMMIT;
