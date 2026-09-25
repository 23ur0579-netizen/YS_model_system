"""
Admin-facing "Manage Users" endpoints — backs the ManageUsers.tsx
screen, which previously rendered a hard-coded in-memory list. Every
route here is scoped to Admin / Agricultural Technician the same way
the sign-in "Admin" tab is (see ROLE_TAB_TO_DB_ROLES in auth.py):
RLS's p_user_account_self policy already lets those two roles see and
edit every row, so these handlers just run plain SQL under the
caller's own get_conn(user_id, role) — no SECURITY DEFINER needed.
"""
import logging
import secrets
import string

from fastapi import APIRouter, Depends, HTTPException, status

from .. import email_utils, security
from ..audit_utils import write_audit
from ..barangay_utils import barangay_id_from_name
from ..db import get_conn
from ..deps import CurrentUser, get_current_user, require_role
from ..schemas import (
    AdminCreateUserRequest,
    AdminCreateUserResponse,
    AdminResetPasswordRequest,
    AdminResetPasswordResponse,
    AdminUpdateUserRequest,
    AdminUserOut,
)

logger = logging.getLogger("yieldshield.users")

router = APIRouter(prefix="/users", tags=["users"])

STAFF_ROLES = ("Admin", "Agricultural Technician")

_SELECT_USER_SQL = """
    SELECT ua.user_id, ua.full_name, ua.email, ua.contact_info, ua.role,
           ua.admin_role, ua.is_active, ua.date_registered, ua.username, ua.avatar_url, b.barangay_name
      FROM yieldshield.user_account ua
      LEFT JOIN yieldshield.barangay b ON b.barangay_id = ua.barangay_id
"""


def _to_out(row) -> AdminUserOut:
    return AdminUserOut(
        id=str(row["user_id"]),
        name=row["full_name"],
        email=row["email"],
        phone=row["contact_info"] or "",
        role=row["role"] if row["role"] in ("Farmer", "Admin") else "Admin",
        adminRole=row["admin_role"],
        barangay=row["barangay_name"],
        status="Active" if row["is_active"] else "Inactive",
        joinedAt=row["date_registered"].date().isoformat(),
        avatarUrl=row["avatar_url"],
    )


_ADMIN_ROLE_LABEL = {
    "master": "Master Administrator",
    "verification": "Verification Officer",
    "corn": "Corn Program Officer",
    "palay": "Palay Program Officer",
    "analyst": "Data Analyst",
}


def _generate_temp_password() -> str:
    letters = string.ascii_letters
    digits = string.digits
    specials = "!@#$%"
    pool = letters + digits
    body = "".join(secrets.choice(pool) for _ in range(9))
    return body + secrets.choice(specials)


def _derive_username(cur, email: str, full_name: str) -> str:
    base = (email.split("@")[0] or full_name.lower().replace(" ", ".")).strip() or "user"
    candidate, i = base, 2
    while True:
        cur.execute(
            "SELECT 1 FROM yieldshield.auth_find_user_by_identifier(%s)",
            (candidate,),
        )
        if not cur.fetchone():
            return candidate
        candidate = f"{base}.{i}"
        i += 1


@router.get("", response_model=list[AdminUserOut])
def list_users(user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_USER_SQL + " ORDER BY ua.date_registered DESC")
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]


@router.get("/me", response_model=AdminUserOut)
def get_my_profile(user: CurrentUser = Depends(get_current_user)):
    # Unlike list_users(), this is open to any signed-in role (Farmer
    # included) — it's how Settings.tsx loads the current user's own
    # email/phone/barangay, since /users itself is staff-only.
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (user.user_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
    return _to_out(row)


@router.patch("/me", response_model=AdminUserOut)
def update_my_profile(body: AdminUpdateUserRequest, user: CurrentUser = Depends(get_current_user)):
    # Self-service counterpart to update_user() below — any signed-in
    # role can hit this for their own row, but (unlike the staff-only
    # PATCH /{id}) it never touches role, since that's a privilege
    # change that only staff should be able to make.
    fields, values = [], []
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            if body.name is not None:
                fields.append("full_name = %s")
                values.append(body.name)
            if body.email is not None:
                fields.append("email = %s")
                values.append(body.email)
            if body.phone is not None:
                fields.append("contact_info = %s")
                values.append(body.phone)
            if body.barangay is not None:
                fields.append("barangay_id = %s")
                values.append(barangay_id_from_name(cur, body.barangay))
            if body.avatarUrl is not None:
                fields.append("avatar_url = %s")
                values.append(body.avatarUrl or None)  # "" means "clear the picture"

            if fields:
                values.append(user.user_id)
                cur.execute(
                    f"UPDATE yieldshield.user_account SET {', '.join(fields)} WHERE user_id = %s",
                    values,
                )

            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (user.user_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    return _to_out(row)


@router.post("", response_model=AdminCreateUserResponse, status_code=status.HTTP_201_CREATED)
def create_user(body: AdminCreateUserRequest, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    temp_password = _generate_temp_password()
    password_hash = security.hash_password(temp_password)

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM yieldshield.auth_find_user_by_identifier(%s)",
                (body.email,),
            )
            if cur.fetchone():
                raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")

            barangay_id = barangay_id_from_name(cur, body.barangay)
            username = _derive_username(cur, body.email, body.name)
            admin_role = body.adminRole if body.role == "Admin" else None

            cur.execute(
                """
                INSERT INTO yieldshield.user_account
                    (full_name, role, username, email, password_hash, contact_info, barangay_id, admin_role)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING user_id
                """,
                (body.name, body.role, username, body.email, password_hash, body.phone, barangay_id, admin_role),
            )
            new_id = cur.fetchone()["user_id"]

            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (new_id,))
            row = cur.fetchone()

            is_admin = body.role == "Admin"
            write_audit(
                cur,
                user,
                "privilege" if is_admin else "account",
                f"Created admin account ({_ADMIN_ROLE_LABEL.get(admin_role, 'Master Administrator')})"
                if is_admin
                else "Created farmer account",
                body.name,
            )

    try:
        email_utils.send_credentials_email(body.email, body.name, username, temp_password, is_new_account=True)
    except Exception:
        logger.exception("Failed to send new-account credentials email to user_id=%s", new_id)

    return AdminCreateUserResponse(user=_to_out(row), temporary_password=temp_password)


@router.patch("/{target_user_id}", response_model=AdminUserOut)
def update_user(
    target_user_id: int,
    body: AdminUpdateUserRequest,
    user: CurrentUser = Depends(require_role(*STAFF_ROLES)),
):
    fields, values = [], []
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (target_user_id,))
            before = cur.fetchone()
            if before is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

            if body.name is not None:
                fields.append("full_name = %s")
                values.append(body.name)
            if body.email is not None:
                fields.append("email = %s")
                values.append(body.email)
            if body.phone is not None:
                fields.append("contact_info = %s")
                values.append(body.phone)
            if body.role is not None:
                fields.append("role = %s")
                values.append(body.role)
            if body.adminRole is not None:
                fields.append("admin_role = %s")
                values.append(body.adminRole)
            elif body.role == "Farmer":
                fields.append("admin_role = NULL")
            if body.barangay is not None:
                fields.append("barangay_id = %s")
                values.append(barangay_id_from_name(cur, body.barangay))

            if fields:
                values.append(target_user_id)
                cur.execute(
                    f"UPDATE yieldshield.user_account SET {', '.join(fields)} WHERE user_id = %s",
                    values,
                )

            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (target_user_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

            if body.adminRole is not None and body.adminRole != before["admin_role"]:
                write_audit(
                    cur, user, "privilege", f"Assigned {_ADMIN_ROLE_LABEL[body.adminRole]} role", row["full_name"]
                )
            else:
                write_audit(cur, user, "account", "Updated account details", row["full_name"])

    return _to_out(row)


@router.patch("/{target_user_id}/status", response_model=AdminUserOut)
def toggle_user_status(target_user_id: int, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.user_account
                   SET is_active = NOT is_active
                 WHERE user_id = %s
                RETURNING user_id
                """,
                (target_user_id,),
            )
            if cur.fetchone() is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (target_user_id,))
            row = cur.fetchone()
            write_audit(
                cur,
                user,
                "account",
                "Deactivated account" if not row["is_active"] else "Reactivated account",
                row["full_name"],
            )

    return _to_out(row)


@router.delete("/{target_user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(target_user_id: int, user: CurrentUser = Depends(require_role(*STAFF_ROLES))):
    if target_user_id == user.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot remove your own account.")

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_USER_SQL + " WHERE ua.user_id = %s", (target_user_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")
            # farm_profile references user_account ON DELETE CASCADE, so
            # removing an account also removes their plot records — the
            # UI's confirmation copy reflects this.
            cur.execute("DELETE FROM yieldshield.user_account WHERE user_id = %s", (target_user_id,))
            write_audit(cur, user, "account", "Deleted account", row["full_name"])


@router.patch("/{target_user_id}/reset-password", response_model=AdminResetPasswordResponse)
def reset_user_password(
    target_user_id: int,
    body: AdminResetPasswordRequest,
    user: CurrentUser = Depends(require_role(*STAFF_ROLES)),
):
    new_password = body.new_password if body.mode == "manual" else _generate_temp_password()
    if body.mode == "manual" and not new_password:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "new_password is required for manual mode.")

    password_hash = security.hash_password(new_password)

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.user_account
                   SET password_hash = %s
                 WHERE user_id = %s
                RETURNING full_name, email, username
                """,
                (password_hash, target_user_id),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found.")

    if body.notify:
        try:
            email_utils.send_credentials_email(
                row["email"], row["full_name"], row["username"], new_password, is_new_account=False
            )
        except Exception:
            logger.exception("Failed to send password-reset email to user_id=%s", target_user_id)

    return AdminResetPasswordResponse(new_password=new_password)
