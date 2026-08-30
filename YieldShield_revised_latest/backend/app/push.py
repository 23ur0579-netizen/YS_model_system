"""
Sends real Web Push notifications to a user's subscribed
browsers/devices — the free, browser-native mechanism (no paid
service, no third-party API key). See scripts/04_generate_vapid_keys.py
for the one-time setup and routers/push.py for the subscribe/
unsubscribe endpoints this reads from.

Deliberately isolated from the request's main DB transaction: sending
a push is a network call to an external push service (Google's,
Mozilla's, etc.), and a slow or failing one shouldn't hold open —
or roll back — whatever the caller was actually trying to save.
Call send_push() *after* the caller's own `with get_conn(...)` block
has already committed.
"""
import json
import logging

from pywebpush import WebPushException, webpush

from .config import settings
from .db import get_conn

logger = logging.getLogger("yieldshield.push")


def send_push(user_id: int, title: str, body: str, url: str | None = None) -> None:
    """Best-effort — logs and returns on any failure rather than
    raising, so a push problem never surfaces as an error to whatever
    real action (a prediction, a harvest) triggered the notification."""
    if not settings.VAPID_PUBLIC_KEY or not settings.VAPID_PRIVATE_KEY_FILE:
        return  # Web Push not configured for this deployment — silently skip.

    try:
        with get_conn(user_id=user_id, role=None) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT subscription_id, endpoint, p256dh, auth FROM yieldshield.push_subscription WHERE user_id = %s",
                    (user_id,),
                )
                subs = cur.fetchall()
    except Exception:
        logger.exception("Failed to load push subscriptions for user_id=%s", user_id)
        return

    if not subs:
        return

    payload = json.dumps({"title": title, "body": body, "url": url or "/"})
    stale_ids: list[int] = []

    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY_FILE,
                vapid_claims={"sub": settings.VAPID_CLAIM_EMAIL},
            )
        except WebPushException as e:
            status = e.response.status_code if e.response is not None else None
            if status in (404, 410):
                # Browser unsubscribed / the subscription expired on
                # the push service's end — stop trying it.
                stale_ids.append(sub["subscription_id"])
            else:
                logger.warning("Push failed for subscription_id=%s: %s", sub["subscription_id"], e)
        except Exception:
            logger.exception("Unexpected error sending push for subscription_id=%s", sub["subscription_id"])

    if stale_ids:
        try:
            with get_conn(user_id=user_id, role=None) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "DELETE FROM yieldshield.push_subscription WHERE subscription_id = ANY(%s)",
                        (stale_ids,),
                    )
        except Exception:
            logger.exception("Failed to clean up stale push subscriptions for user_id=%s", user_id)
