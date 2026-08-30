"""
MAO advisories/programs shown on Notifications.tsx and the Dashboard
announcements card. Anyone signed in can read; only staff can write
(RLS p_announcement_* in migration 07). Writes are also recorded to
the master-admin audit log, matching the frontend's previous pushAudit
calls in store.tsx.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from ..audit_utils import write_audit
from ..db import get_conn
from ..deps import CurrentUser, get_current_user, require_role
from ..schemas import AnnouncementCreateRequest, AnnouncementOut, AnnouncementUpdateRequest

router = APIRouter(prefix="/announcements", tags=["announcements"])

STAFF_ROLES = ("Admin", "Agricultural Technician")

_SELECT_SQL = """
    SELECT a.announcement_id, a.title, a.body, a.announce_date, a.tag,
           a.author_label, a.pinned
      FROM yieldshield.announcement a
"""


def _to_out(row) -> AnnouncementOut:
    return AnnouncementOut(
        id=str(row["announcement_id"]),
        title=row["title"],
        body=row["body"],
        date=row["announce_date"].isoformat(),
        tag=row["tag"],
        author=row["author_label"],
        pinned=row["pinned"],
    )


@router.get("", response_model=list[AnnouncementOut])
def list_announcements(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " ORDER BY a.pinned DESC, a.announce_date DESC")
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]


@router.post("", response_model=AnnouncementOut, status_code=status.HTTP_201_CREATED)
def create_announcement(body: AnnouncementCreateRequest, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT full_name FROM yieldshield.user_account WHERE user_id = %s", (user.user_id,))
            author_label = cur.fetchone()["full_name"]
            cur.execute(
                """
                INSERT INTO yieldshield.announcement (title, body, announce_date, tag, author_id, author_label)
                VALUES (%s, %s, %s, %s, %s, %s)
                RETURNING announcement_id
                """,
                (body.title, body.body, body.date, body.tag, user.user_id, author_label),
            )
            new_id = cur.fetchone()["announcement_id"]
            write_audit(cur, user, "announcement", "Posted announcement", body.title)
            cur.execute(_SELECT_SQL + " WHERE a.announcement_id = %s", (new_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.patch("/{announcement_id}", response_model=AnnouncementOut)
def update_announcement(
    announcement_id: int, body: AnnouncementUpdateRequest, user: CurrentUser = Depends(require_role(*STAFF_ROLES))
):
    fields, values = [], []
    if body.title is not None:
        fields.append("title = %s")
        values.append(body.title)
    if body.body is not None:
        fields.append("body = %s")
        values.append(body.body)
    if body.date is not None:
        fields.append("announce_date = %s")
        values.append(body.date)
    if body.tag is not None:
        fields.append("tag = %s")
        values.append(body.tag)

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            if fields:
                values.append(announcement_id)
                cur.execute(
                    f"UPDATE yieldshield.announcement SET {', '.join(fields)} WHERE announcement_id = %s", values
                )
                if cur.rowcount == 0:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found.")
            cur.execute(_SELECT_SQL + " WHERE a.announcement_id = %s", (announcement_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found.")
            write_audit(cur, user, "announcement", "Edited announcement", body.title or row["title"])
    return _to_out(row)


@router.patch("/{announcement_id}/pin", response_model=AnnouncementOut)
def toggle_pin(announcement_id: int, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.announcement SET pinned = NOT pinned
                 WHERE announcement_id = %s
                RETURNING announcement_id
                """,
                (announcement_id,),
            )
            if cur.fetchone() is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found.")
            cur.execute(_SELECT_SQL + " WHERE a.announcement_id = %s", (announcement_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.delete("/{announcement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_announcement(announcement_id: int, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " WHERE a.announcement_id = %s", (announcement_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Announcement not found.")
            cur.execute("DELETE FROM yieldshield.announcement WHERE announcement_id = %s", (announcement_id,))
            write_audit(cur, user, "announcement", "Deleted announcement", row["title"])
