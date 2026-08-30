"""
Farmer sign-up approval workflow — backs Login.tsx (submit + continue
registration) and the ManageUsers.tsx "Account Verification" tab.

Flow: an applicant submits (public, no auth) -> a verification/master
admin approves or rejects it -> approval emails a link containing a
short token -> the applicant returns and sets their password, which
creates the real yieldshield.user_account row (public, no auth, but
gated on the emailed token).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, status

from .. import email_utils, security
from ..barangay_utils import barangay_id_from_name
from ..db import get_conn
from ..deps import CurrentUser, get_current_user, require_role
from ..schemas import (
    RegistrationApproveResponse,
    RegistrationCompleteRequest,
    RegistrationOut,
    RegistrationSubmitRequest,
)

logger = logging.getLogger("yieldshield.registrations")

router = APIRouter(prefix="/registrations", tags=["registrations"])

STAFF_ROLES = ("Admin", "Agricultural Technician")

_SELECT_SQL = """
    SELECT rr.registration_id, rr.first_name, rr.middle_name, rr.last_name,
           rr.email, rr.phone, rr.address, rr.id_file_name, rr.id_file_data, rr.status,
           rr.submitted_at, rr.token_hash, rr.completed_at, b.barangay_name
      FROM yieldshield.registration_request rr
      LEFT JOIN yieldshield.barangay b ON b.barangay_id = rr.barangay_id
"""


def _to_out(row, raw_token: str | None = None, include_id_file: bool = False) -> RegistrationOut:
    return RegistrationOut(
        id=str(row["registration_id"]),
        firstName=row["first_name"],
        middleName=row["middle_name"] or "",
        lastName=row["last_name"],
        email=row["email"],
        phone=row["phone"] or "",
        address=row["address"] or "",
        barangay=row["barangay_name"] or "",
        idFileName=row["id_file_name"] or "",
        # Only staff-facing reads (list/approve/reject) include the actual
        # attached document — the applicant's own POST response doesn't
        # need to echo their own upload back to them.
        idFileUrl=row["id_file_data"] if include_id_file else None,
        status=row["status"],
        submittedAt=row["submitted_at"].date().isoformat(),
        # The raw token is only ever available right after approve() —
        # it's never stored, only its hash is (see migration 07). This
        # lets the UI show the "link code issued" chip immediately.
        token=raw_token,
        completed=row["completed_at"] is not None,
    )


@router.post("", response_model=RegistrationOut, status_code=status.HTTP_201_CREATED)
def submit_registration(body: RegistrationSubmitRequest):
    with get_conn() as conn:
        with conn.cursor() as cur:
            barangay_id = barangay_id_from_name(cur, body.barangay)
            cur.execute(
                "SELECT yieldshield.registration_submit(%s, %s, %s, %s, %s, %s, %s, %s, %s) AS registration_id",
                (
                    body.firstName,
                    body.middleName or None,
                    body.lastName,
                    body.email,
                    body.phone or None,
                    body.address,
                    barangay_id,
                    body.idFileName,
                    body.idFileData,
                ),
            )
            new_id = cur.fetchone()["registration_id"]
            cur.execute(_SELECT_SQL + " WHERE rr.registration_id = %s", (new_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.get("", response_model=list[RegistrationOut])
def list_registrations(user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " ORDER BY rr.submitted_at DESC")
            rows = cur.fetchall()
    return [_to_out(r, include_id_file=True) for r in rows]


@router.patch("/{registration_id}/approve", response_model=RegistrationApproveResponse)
def approve_registration(registration_id: int, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    raw_token, token_hash = security.generate_reset_token()
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.registration_request
                   SET status = 'approved', token_hash = %s,
                       token_expires_at = now() + interval '14 days',
                       reviewed_by = %s
                 WHERE registration_id = %s AND status = 'pending'
                RETURNING registration_id
                """,
                (token_hash, user.user_id, registration_id),
            )
            if cur.fetchone() is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending registration not found.")

            cur.execute(_SELECT_SQL + " WHERE rr.registration_id = %s", (registration_id,))
            row = cur.fetchone()

    try:
        full_name = " ".join(p for p in [row["first_name"], row["middle_name"], row["last_name"]] if p)
        email_utils.send_registration_approved_email(row["email"], full_name, raw_token)
    except Exception:
        logger.exception("Failed to send registration approval email to registration_id=%s", registration_id)

    return RegistrationApproveResponse(registration=_to_out(row, raw_token=raw_token, include_id_file=True), token=raw_token)


@router.patch("/{registration_id}/reject", response_model=RegistrationOut)
def reject_registration(registration_id: int, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.registration_request
                   SET status = 'rejected', reviewed_by = %s
                 WHERE registration_id = %s AND status = 'pending'
                RETURNING registration_id
                """,
                (user.user_id, registration_id),
            )
            if cur.fetchone() is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Pending registration not found.")
            cur.execute(_SELECT_SQL + " WHERE rr.registration_id = %s", (registration_id,))
            row = cur.fetchone()
    return _to_out(row, include_id_file=True)


@router.post("/complete", status_code=status.HTTP_200_OK)
def complete_registration(body: RegistrationCompleteRequest):
    token_hash = security.hash_reset_token(body.token)
    password_hash = security.hash_password(body.password)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT yieldshield.registration_complete(%s, %s, %s) AS user_id",
                (body.email, token_hash, password_hash),
            )
            user_id = cur.fetchone()["user_id"]
            if user_id is None:
                raise HTTPException(
                    status.HTTP_400_BAD_REQUEST,
                    "That email/code combination is invalid, expired, or already used.",
                )
    return {"message": "Account activated. You can now sign in with your new password."}
