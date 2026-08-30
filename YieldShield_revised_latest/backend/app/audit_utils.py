"""
Shared helper for writing to yieldshield.app_audit_log (the curated,
human-readable trail behind AuditLog.tsx) — see migration 07 for why
this is separate from the low-level trigger-based yieldshield.audit_log.
Used by every router whose actions the frontend previously recorded
via store.tsx's pushAudit() (announcements, account/privilege changes,
registration verification).
"""
from .deps import CurrentUser


def write_audit(cur, actor: CurrentUser, category: str, action: str, target: str | None):
    cur.execute("SELECT full_name FROM yieldshield.user_account WHERE user_id = %s", (actor.user_id,))
    row = cur.fetchone()
    actor_name = row["full_name"] if row else actor.username
    cur.execute(
        """
        INSERT INTO yieldshield.app_audit_log (actor_id, actor_name, actor_role, category, action, target)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (actor.user_id, actor_name, actor.admin_role, category, action, target),
    )
