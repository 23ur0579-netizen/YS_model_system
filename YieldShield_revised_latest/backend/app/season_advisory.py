"""
Computes a "which crop, and when, is in season right now" advisory —
mirrors YieldShield_ui/src/app/data/binalonan.ts's CROPPING_CALENDAR
(same real Palay/Corn planting windows for Binalonan), just in Python
since this runs server-side.

Synthetic, not persisted — same pattern as notifications.py's
_weather_advisory(): computed fresh on every GET /notifications call,
never written to the database, so it can never go stale and never
needs a cleanup job. Its id is stable for a given (year, crop, season)
triple, so the frontend can track "dismissed" locally without a DB row
to match, exactly like the weather advisory already does.

Returns an AdvisoryText (see advisory_types.py) rather than a rendered
English sentence, so the frontend can show it in whatever language is
selected. There are 4 message variants (active/upcoming x wet/dry) —
separate keys per variant rather than one template with a "season"
param, since the flat {placeholder} substitution i18n.tsx uses can't
itself translate a sub-value like "Wet Season" into the target
language.
"""
import datetime as dt

from .advisory_types import AdvisoryText

# (crop label, season label, start month, end month) — inclusive,
# 1-indexed. Matches CROPPING_CALENDAR's "plant" ranges exactly.
_PLANTING_WINDOWS: list[tuple[str, str, int, int]] = [
    ("Palay (Rice)", "Wet Season", 6, 7),
    ("Palay (Rice)", "Dry Season", 11, 12),
    ("Corn", "Wet Season", 5, 6),
    ("Corn", "Dry Season", 11, 12),
]


def _months_until(today_month: int, start_month: int) -> int:
    """How many months from today_month until start_month, wrapping
    around the new year (0 if today_month == start_month)."""
    return (start_month - today_month) % 12


def season_advisory_text(today: dt.date) -> AdvisoryText | None:
    """For the crop(s) whose planting window is open right now, or
    opening soonest — or None if, somehow, every window is equally far
    off (never actually happens with the table above, but keeps this
    honest rather than assuming)."""
    month = today.month

    active = [w for w in _PLANTING_WINDOWS if w[2] <= month <= w[3]]
    if active:
        crops = ", ".join(sorted({w[0] for w in active}))
        season = active[0][1]  # "Wet Season" or "Dry Season"
        variant = "activeWet" if season == "Wet Season" else "activeDry"
        return AdvisoryText(
            title_key=f"notif.season.{variant}Title",
            body_key=f"notif.season.{variant}Body",
            title_en=f"Planting season is open — {crops}",
            body_en=(
                f"It's {season.lower()} in Binalonan, and the planting window for {crops} is open right now. "
                "Head to Simulate cropping to see an expected yield before you plant."
            ),
            params={"crops": crops},
        )

    ranked = sorted(_PLANTING_WINDOWS, key=lambda w: _months_until(month, w[2]))
    if not ranked:
        return None
    soonest_gap = _months_until(month, ranked[0][2])
    upcoming = [w for w in ranked if _months_until(month, w[2]) == soonest_gap]
    crops = ", ".join(sorted({w[0] for w in upcoming}))
    season = upcoming[0][1]
    variant = "upcomingWet" if season == "Wet Season" else "upcomingDry"
    when_en = "next month" if soonest_gap == 1 else f"in {soonest_gap} months"
    return AdvisoryText(
        title_key=f"notif.season.{variant}Title",
        body_key=f"notif.season.{variant}Body",
        title_en=f"Upcoming planting season: {crops}",
        body_en=(
            f"The {season.lower()} planting window for {crops} opens {when_en}. "
            "Check Crop Recommendation to see which fits your field's soil best."
        ),
        params={"crops": crops, "months": soonest_gap},
    )
