from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .security import decode_session_token

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    user_id: int
    role: str
    username: str
    admin_role: str | None = None


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    if credentials is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    try:
        payload = decode_session_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired, please sign in again")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session token")
    return CurrentUser(
        user_id=int(payload["sub"]),
        role=payload["role"],
        username=payload["username"],
        admin_role=payload.get("admin_role"),
    )


def require_admin_role(*allowed_admin_roles: str):
    """Gate on admin privilege tier (master/verification/corn/palay), on
    top of the ordinary Admin/Agricultural Technician role check. A
    'master' admin is always allowed through, matching ADMIN_ROLE_META
    in the frontend store (master has full control)."""

    def _dep(user: CurrentUser = Depends(require_role("Admin", "Agricultural Technician"))) -> CurrentUser:
        if user.admin_role == "master":
            return user
        if user.admin_role not in allowed_admin_roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your admin privilege tier cannot access this resource.")
        return user

    return _dep


def require_role(*allowed_roles: str):
    def _dep(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user.role not in allowed_roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have access to this resource")
        return user

    return _dep
