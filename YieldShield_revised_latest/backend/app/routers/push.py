"""
Web Push subscribe/unsubscribe + the public key the frontend needs to
create a subscription. See app/push.py for actually sending a push,
and scripts/04_generate_vapid_keys.py for one-time setup.
"""
from fastapi import APIRouter, Depends

from ..config import settings
from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..schemas import PushSubscribeRequest, PushUnsubscribeRequest

router = APIRouter(prefix="/push", tags=["push"])


@router.get("/vapid-public-key")
def vapid_public_key():
    return {"key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", status_code=201)
def subscribe(body: PushSubscribeRequest, user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO yieldshield.push_subscription (user_id, endpoint, p256dh, auth)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (endpoint) DO UPDATE
                    SET user_id = EXCLUDED.user_id,
                        p256dh = EXCLUDED.p256dh,
                        auth = EXCLUDED.auth
                """,
                (user.user_id, body.endpoint, body.keys.p256dh, body.keys.auth),
            )
    return {"ok": True}


@router.post("/unsubscribe")
def unsubscribe(body: PushUnsubscribeRequest, user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM yieldshield.push_subscription WHERE endpoint = %s AND user_id = %s",
                (body.endpoint, user.user_id),
            )
    return {"ok": True}
