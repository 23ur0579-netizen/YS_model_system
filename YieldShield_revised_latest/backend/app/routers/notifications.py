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
from ..personalized_tips import harvest_recording_reminder
from ..price_advisory import price_advisory_text
from ..schemas import NotificationOut
from ..season_advisory import season_advisory_text
from ..variety_advisory import best_variety_for_barangay, farmer_primary_barangay
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
    level, label, advice = rainfall_category(worst.rainfall_mm)
    if worst.rainfall_mm < 15:  # below PAGASA's "Heavy rain" floor — no advisory needed
        return None

    # A calendar date instead of the word "today"/"tomorrow" — sidesteps
    # needing yet another translated word, and is just as clear in any
    # language.
    when_date = today if worst is forecasts[0] else today + dt.timedelta(days=1)
    params = {
        "rainfall": round(worst.rainfall_mm),
        "temperature": round(worst.temperature_c, 1),
        # Built manually, not strftime("%-d") — that "no leading zero"
        # flag is a Linux/macOS-only glibc extension and raises
        # ValueError on Windows Python (this project's backend has run
        # on both).
        "date": f"{when_date.strftime('%b')} {when_date.day}",
    }
    return NotificationOut(
        id=f"weather-{today.isoformat()}",
        title=f"{label} advisory",
        body=(
            f"Binalonan is expecting {label.lower()} (~{worst.rainfall_mm:.0f}mm) on {params['date']} "
            f"({worst.temperature_c:.1f}\u00b0C). {advice}"
        ),
        titleKey=f"notif.weather.{level}Title",
        bodyKey=f"notif.weather.{level}Body",
        params=params,
        time=dt.datetime.now(dt.timezone.utc).isoformat(),
        read=False,
        category="weather",
        plotId=None,
        barangay=None,
    )


def _season_advisory(today: dt.date) -> NotificationOut | None:
    a = season_advisory_text(today)
    if a is None:
        return None
    return NotificationOut(
        # Stable per (year, month) rather than per-day like the weather
        # advisory — the planting-season picture doesn't change day to
        # day the way rainfall does, so a fresh id every single day
        # would make "dismiss" feel like it never actually sticks.
        id=f"season-{today.year}-{today.month}",
        title=a.title_en,
        body=a.body_en,
        titleKey=a.title_key,
        bodyKey=a.body_key,
        params=a.params,
        time=dt.datetime.now(dt.timezone.utc).isoformat(),
        read=False,
        category="advisory",
        plotId=None,
        barangay=None,
    )


def _price_advisory(today: dt.date) -> NotificationOut | None:
    a = price_advisory_text()
    if a is None:
        return None  # Feed not configured yet, or the PSA request failed.
    return NotificationOut(
        # Stable per (year, month): current_prices() is itself cached
        # for 12h (see price_advisory.py), and PSA only republishes
        # this monthly anyway, so a daily id would just make "dismiss"
        # feel broken the same way it would for the season advisory.
        id=f"price-{today.year}-{today.month}",
        title=a.title_en,
        body=a.body_en,
        titleKey=a.title_key,
        bodyKey=a.body_key,
        params=a.params,
        time=dt.datetime.now(dt.timezone.utc).isoformat(),
        read=False,
        category="advisory",
        plotId=None,
        barangay=None,
    )


def _harvest_reminder(cur, user: CurrentUser, today: dt.date) -> NotificationOut | None:
    # cur is the farmer's own RLS-scoped cursor — this only ever reads
    # their own farm_input_log/farm_profile rows (see
    # personalized_tips.py's own docstring on why that's enough here,
    # unlike _variety_advisory below).
    result = harvest_recording_reminder(cur, user.user_id, today)
    if result is None:
        return None
    a, input_log_id = result
    return NotificationOut(
        # Stable per cropping, not per day — this should keep showing
        # up every time they check notifications for as long as it's
        # genuinely still true (no yield logged yet), and disappear on
        # its own the moment they actually record one, rather than
        # being "dismissable" once and then silently going stale while
        # the harvest is still sitting unlogged.
        id=f"harvest-reminder-{input_log_id}",
        title=a.title_en,
        body=a.body_en,
        titleKey=a.title_key,
        bodyKey=a.body_key,
        params=a.params,
        time=dt.datetime.now(dt.timezone.utc).isoformat(),
        read=False,
        category="task",
        plotId=str(input_log_id),
        barangay=None,
    )


def _variety_advisory(cur, user: CurrentUser, today: dt.date) -> NotificationOut | None:
    # cur is the farmer's own RLS-scoped cursor — this only ever reads
    # THEIR OWN farm_profile rows, so no elevated access is needed here.
    located = farmer_primary_barangay(cur, user.user_id)
    if located is None:
        return None  # No croppings on file yet — nothing to base a barangay on.
    barangay_id, barangay_name = located

    # The aggregate-across-every-farmer query genuinely needs a
    # different connection: a farmer's own RLS-scoped connection can't
    # see other farmers' individual rows (by design), but the result
    # here is a statistic (crop + variety + average + a sample count),
    # never an individual farmer's record, so reading it via a
    # role="Admin" connection for this one query doesn't leak anything
    # a farmer couldn't already see about their own barangay in
    # aggregate — see variety_advisory.py's module docstring.
    with get_conn(role="Admin") as admin_conn, admin_conn.cursor() as admin_cur:
        a = best_variety_for_barangay(admin_cur, barangay_id)
    if a is None:
        return None
    return NotificationOut(
        # Stable per (barangay, year, month) — best_variety_for_barangay
        # is itself cached for 6h, and which variety is "best" doesn't
        # meaningfully change day to day, so a daily id would make
        # "dismiss" feel like it never actually sticks (same reasoning
        # as the season/price advisories).
        id=f"variety-{barangay_id}-{today.year}-{today.month}",
        title=a.title_en,
        body=f"{barangay_name}: {a.body_en}",
        titleKey=a.title_key,
        bodyKey=a.body_key,
        params={**a.params, "barangayName": barangay_name},
        time=dt.datetime.now(dt.timezone.utc).isoformat(),
        read=False,
        category="advisory",
        plotId=None,
        barangay=barangay_name,
    )


@router.get("", response_model=list[NotificationOut])
def list_notifications(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " WHERE user_id = %s ORDER BY created_at DESC", (user.user_id,))
            rows = cur.fetchall()
            # Reuses this same farmer-scoped cursor — see _variety_advisory's
            # own docstring for why the cross-farmer aggregate it also
            # needs opens a second, separate connection instead.
            is_farmer = user.role in ("Farmer", "Agricultural Technician")
            harvest_reminder = _harvest_reminder(cur, user, dt.date.today()) if is_farmer else None
            variety = _variety_advisory(cur, user, dt.date.today()) if is_farmer else None

    out = [_to_out(r) for r in rows]
    advisory = _weather_advisory(dt.date.today())
    if advisory is not None:
        out.insert(0, advisory)
    # Only for farmers/technicians actually deciding what to plant —
    # an admin reviewing the whole municipality doesn't need a personal
    # "what should I plant" nudge in their own notification list.
    if is_farmer:
        for item in (_price_advisory(dt.date.today()), _season_advisory(dt.date.today()), variety, harvest_reminder):
            if item is not None:
                out.insert(0 if advisory is None else 1, item)
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
