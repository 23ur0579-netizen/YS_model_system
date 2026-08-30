import logging

from fastapi import APIRouter, HTTPException, Request, status

from .. import email_utils, security
from ..barangay_utils import barangay_id_from_name
from ..config import settings
from ..db import get_conn
from ..schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    RegisterRequest,
    ResetPasswordRequest,
)

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger("yieldshield.auth")

# UI's "Sign in as Farmer / Administrator" tabs map to these DB roles.
ROLE_TAB_TO_DB_ROLES = {
    "Farmer": {"Farmer"},
    "Admin": {"Admin", "Agricultural Technician"},
}


def _initials(name: str) -> str:
    parts = [p for p in name.split() if p]
    return "".join(p[0] for p in parts[:2]).upper() or "?"


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM yieldshield.auth_find_user_by_identifier(%s)",
                (body.identifier,),
            )
            row = cur.fetchone()

            # Same generic error whether the account doesn't exist or the
            # password is wrong — don't help an attacker enumerate accounts.
            generic_error = HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect username/email or password.")

            if row is None:
                raise generic_error

            if row["locked_until"] is not None:
                cur.execute("SELECT now() < %s AS still_locked", (row["locked_until"],))
                if cur.fetchone()["still_locked"]:
                    raise HTTPException(
                        status.HTTP_423_LOCKED,
                        "Too many failed attempts. Try again in a few minutes.",
                    )

            if not security.verify_password(body.password, row["password_hash"]):
                cur.execute("SELECT yieldshield.auth_record_login_failure(%s)", (row["user_id"],))
                # `with conn:` rolls back on any exception leaving the
                # block, and raising `generic_error` next is exactly
                # that — commit explicitly first so the failed-attempt
                # counter isn't silently undone by the rollback.
                conn.commit()
                raise generic_error

            if not row["is_active"]:
                raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated.")

            # --- Role check: only enforced if the caller sent a tab choice.
            # The sign-in form now has a single field, so `role` is usually
            # omitted and any account role is accepted here — this stays
            # for API callers that still want the old tab behavior.
            if body.role is not None:
                allowed_db_roles = ROLE_TAB_TO_DB_ROLES.get(body.role, set())
                if row["role"] not in allowed_db_roles:
                    raise HTTPException(
                        status.HTTP_403_FORBIDDEN,
                        f"This account is registered as {row['role']}. "
                        f"Please sign in from the correct tab.",
                    )

            cur.execute("SELECT yieldshield.auth_record_login_success(%s)", (row["user_id"],))

        token = security.create_session_token(row["user_id"], row["role"], row["username"], row["admin_role"])
        return LoginResponse(
            token=token,
            user_id=row["user_id"],
            name=row["full_name"],
            role=row["role"],
            initials=_initials(row["full_name"]),
            admin_role=row["admin_role"],
        )


@router.post("/register", response_model=LoginResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest):
    username = body.email.split("@")[0]
    password_hash = security.hash_password(body.password)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM yieldshield.auth_find_user_by_identifier(%s)",
                (body.email,),
            )
            if cur.fetchone():
                raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists.")

            barangay_id = barangay_id_from_name(cur, body.barangay)

            # De-duplicate the derived username the same way the old
            # in-memory mock did (name.2, name.3, ...).
            base_username, candidate, i = username, username, 2
            while True:
                cur.execute(
                    "SELECT 1 FROM yieldshield.auth_find_user_by_identifier(%s)",
                    (candidate,),
                )
                if not cur.fetchone():
                    break
                candidate = f"{base_username}.{i}"
                i += 1

            cur.execute(
                "SELECT yieldshield.auth_register_farmer(%s, %s, %s, %s, %s, %s) AS user_id",
                (body.full_name, candidate, body.email, password_hash, body.phone, barangay_id),
            )
            user_id = cur.fetchone()["user_id"]

    token = security.create_session_token(user_id, "Farmer", candidate)
    return LoginResponse(token=token, user_id=user_id, name=body.full_name, role="Farmer", initials=_initials(body.full_name))


@router.post("/forgot-password", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: ForgotPasswordRequest, request: Request):
    # Always return the same generic response, whether or not the email
    # exists — otherwise this endpoint becomes an account-enumeration
    # oracle. The actual email is only sent when the account is real.
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM yieldshield.auth_find_user_by_identifier(%s)",
                (body.email,),
            )
            row = cur.fetchone()
            if row is not None:
                raw_token, token_hash = security.generate_reset_token()
                expires_at_sql = f"now() + interval '{settings.RESET_TOKEN_EXPIRE_MINUTES} minutes'"
                cur.execute(
                    f"SELECT yieldshield.auth_create_reset_token(%s, %s, {expires_at_sql}, %s)",
                    (row["user_id"], token_hash, request.client.host if request.client else None),
                )
                try:
                    email_utils.send_password_reset_email(row["email"], raw_token)
                except Exception:
                    logger.exception("Failed to send password reset email to user_id=%s", row["user_id"])
                    # Don't leak delivery failures to the caller either —
                    # log it for ops, still return the generic response.

    return {"message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password", status_code=status.HTTP_200_OK)
def reset_password(body: ResetPasswordRequest):
    token_hash = security.hash_reset_token(body.token)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT yieldshield.auth_consume_reset_token(%s) AS user_id", (token_hash,))
            user_id = cur.fetchone()["user_id"]
            if user_id is None:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "This reset link is invalid or has expired.")

            new_hash = security.hash_password(body.new_password)
            cur.execute("SELECT yieldshield.auth_set_password(%s, %s)", (user_id, new_hash))

    return {"message": "Password updated. You can now sign in with your new password."}
