"""
Personalized, per-farmer tips — grounded in that ONE farmer's own
croppings (unlike season_advisory.py/price_advisory.py, which are the
same for everyone, or variety_advisory.py, which is barangay-wide).
Runs entirely on the farmer's own RLS-scoped connection — every query
here only ever touches their own farm_profile/farm_input_log rows, so
none of the elevated-access handling variety_advisory.py needs applies
here.

Currently just one tip (harvest_recording_reminder); written as its
own function per tip, each returning None when it doesn't apply, so
more can be added the same way without changing how they're wired into
notifications.py's list_notifications().
"""
import datetime as dt

from .advisory_types import AdvisoryText
from .routers.farm_input import variety_maturity_days


def harvest_recording_reminder(cur, user_id: int, today: dt.date) -> tuple[AdvisoryText, int] | None:
    """Returns (AdvisoryText, input_log_id) for the farmer's own most
    overdue cropping that's past its estimated maturity date but has
    no actual_yield_mt_ha logged yet — or None if they don't have one.
    The input_log_id is returned too so the caller can build a stable
    per-cropping notification id: this should keep reappearing every
    time they check notifications until they actually log the yield
    (or the cropping is deleted/edited away from being overdue), not
    just once and then be dismissed while still genuinely outstanding.
    """
    cur.execute(
        """
        SELECT fil.input_log_id, fil.planting_date, fil.variety,
               fp.plot_code, fp.plot_name, fp.crop_type_id, ct.crop_name
          FROM yieldshield.farm_input_log fil
          JOIN yieldshield.farm_profile fp ON fp.farm_id = fil.farm_id
          JOIN yieldshield.crop_type ct ON ct.crop_type_id = fp.crop_type_id
         WHERE fp.user_id = %s
           AND fil.actual_yield_mt_ha IS NULL
           AND fil.planting_date IS NOT NULL
         ORDER BY fil.planting_date ASC
        """,
        (user_id,),
    )
    rows = cur.fetchall()
    if not rows:
        return None

    overdue = []
    for row in rows:
        maturity = variety_maturity_days(cur, row["crop_type_id"], row["variety"], row["crop_name"])
        est_harvest = row["planting_date"] + dt.timedelta(days=maturity)
        if est_harvest <= today:
            overdue.append((row, est_harvest))
    if not overdue:
        return None

    # Oldest estimated-harvest-date first — that's the one that's been
    # waiting longest and is most likely to actually be sitting
    # harvested already, just not logged yet.
    row, est_harvest = min(overdue, key=lambda pair: pair[1])
    days_overdue = (today - est_harvest).days
    label = row["plot_name"] or row["plot_code"]
    extra_count = len(overdue) - 1
    # Two body variants (with/without an "and N others" clause) rather
    # than one template with an optional clause — the flat
    # {placeholder} substitution i18n.tsx uses can't itself omit part
    # of a sentence.
    variant = "multiple" if extra_count > 0 else "single"
    params = {"label": label, "cropName": row["crop_name"], "daysOverdue": days_overdue, "extraCount": extra_count}

    extra_en = f" and {extra_count} other cropping(s)" if extra_count > 0 else ""
    advisory = AdvisoryText(
        title_key="notif.harvest.title",
        body_key=f"notif.harvest.{variant}Body",
        title_en="Record your harvest",
        body_en=(
            f"{label} ({row['crop_name']}) reached its estimated maturity date "
            f"{days_overdue} day{'s' if days_overdue != 1 else ''} ago{extra_en}. "
            "Logging the actual yield keeps your own records complete and helps improve future predictions for your barangay."
        ),
        params=params,
    )
    return (advisory, row["input_log_id"])
