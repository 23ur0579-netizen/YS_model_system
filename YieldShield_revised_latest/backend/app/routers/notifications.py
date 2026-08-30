"""
Per-user notifications — backs Notifications.tsx and the Dashboard
announcements card.

Two sources feed the list this returns:
  1. Persisted rows in yieldshield.notification (migration 09) — real
     events already happening elsewhere in the app: a prediction
     becoming ready, a low soil-moisture reading on submission, a
     harvest being recorded. Those get INSERTed from farm_input.py at
     the point the event actually occurs (see _notify() there).
  2. A live weather advisory, computed here on every read from the same
     Open-Meteo-backed service weather.py already uses — NOT persisted,
     so it's never stale and never needs cleaning up. It only appears
     in the response when today's or tomorrow's real forecast actually
     crosses a heavy-rain threshold; there's no fabricated "in case
     nothing else is going on" filler entry.
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status

from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..pagasa_weather import rainfall_category
from ..schemas import NotificationOut
from ..weather import get_weather_for_date

router = APIRouter(prefix="/notifications", tags=["notifications"])

_SELECT_SQL = """
    SELECT notification_id, category, title, body, barangay, plot_id, read, created_at
      FROM yieldshield.notification
"""


def _to_out(row) -> NotificationOut:
    return NotificationOut(
        id=str(row["notification_id"]),
        title=row["title"],
        body=row["body"],
        time=row["created_at"].isoformat(),
        read=row["read"],
        category=row["category"],
        plotId=row["plot_id"],
        barangay=row["barangay"],
    )


def _weather_advisory(today: dt.date) -> NotificationOut | None:
    try:
        forecasts = [get_weather_for_date(today), get_weather_for_date(today + dt.timedelta(days=1))]
    except RuntimeError:
        # Weather service unreachable — skip the advisory rather than
        # failing the whole notifications list over it.
        return None

    worst = max(forecasts, key=lambda w: w.rainfall_mm)
    label, advice = rainfall_category(worst.rainfall_mm)
    if worst.rainfall_mm < 15:  # below PAGASA's "Heavy rain" floor — no advisory needed
        return None

    when = "today" if worst is forecasts[0] else "tomorrow"
    return NotificationOut(
        id=f"weather-{today.isoformat()}",
        title=f"{label} advisory",
        body=(
            f"Binalonan is expecting {label.lower()} (~{worst.rainfall_mm:.0f}mm) {when} "
            f"({worst.temperature_c:.1f}\u00b0C). {advice}"
        ),
        time=dt.datetime.now(dt.timezone.utc).isoformat(),
        read=False,
        category="weather",
        plotId=None,
        barangay=None,
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " WHERE user_id = %s ORDER BY created_at DESC", (user.user_id,))
            rows = cur.fetchall()

    out = [_to_out(r) for r in rows]
    advisory = _weather_advisory(dt.date.today())
    if advisory is not None:
        out.insert(0, advisory)
    return out


@router.patch("/{notification_id}/read", response_model=NotificationOut | None)
def mark_read(notification_id: str, user: CurrentUser = Depends(get_current_user)):
    # Synthetic weather-advisory ids aren't real rows — nothing to
    # persist, and the client already reflects the read state locally.
    if not notification_id.isdigit():
        return None

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.notification SET read = TRUE
                 WHERE notification_id = %s
                RETURNING notification_id, category, title, body, barangay, plot_id, read, created_at
                """,
                (int(notification_id),),
            )
            row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found.")
    return _to_out(row)


@router.patch("/read-all")
def mark_all_read(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute("UPDATE yieldshield.notification SET read = TRUE WHERE user_id = %s", (user.user_id,))
    return {"ok": True}


@router.delete("/{notification_id}", status_code=status.HTTP_204_NO_CONTENT)
def dismiss(notification_id: str, user: CurrentUser = Depends(get_current_user)):
    if not notification_id.isdigit():
        return
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM yieldshield.notification WHERE notification_id = %s", (int(notification_id),))
