"""
Master-admin privileged-action trail — backs AuditLog.tsx. Read-only
from the API's point of view; entries are written by the routers that
perform the privileged action itself (announcements, registrations,
users) via app.audit_utils.write_audit(), not through a POST here.
"""
from fastapi import APIRouter, Depends

from ..db import get_conn
from ..deps import CurrentUser, require_admin_role
from ..schemas import AuditEntryOut

router = APIRouter(prefix="/audit", tags=["audit"])

_SELECT_SQL = """
    SELECT app_audit_id, actor_id, actor_name, actor_role, category, action, target, at
      FROM yieldshield.app_audit_log
"""


def _to_out(row) -> AuditEntryOut:
    return AuditEntryOut(
        id=str(row["app_audit_id"]),
        at=int(row["at"].timestamp() * 1000),
        actorId=str(row["actor_id"]) if row["actor_id"] is not None else "unknown",
        actorName=row["actor_name"],
        actorRole=row["actor_role"],
        category=row["category"],
        action=row["action"],
        target=row["target"],
    )


# Visible to every admin tier (verification/corn/palay included) —
# only the frontend nav restricts the Audit Log link to master admins;
# RLS (p_app_audit_read) already limits this to Admin/Agricultural
# Technician generally, matching the ManageUsers/Farms endpoints.
@router.get("", response_model=list[AuditEntryOut])
def list_audit_log(user: CurrentUser = Depends(require_admin_role("master", "verification", "corn", "palay"))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " ORDER BY at DESC LIMIT 500")
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]
