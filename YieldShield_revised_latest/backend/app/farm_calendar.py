"""
Auto-generates the standard activity schedule (land prep, fertilizer
timing, pest monitoring, irrigation checks, harvest) for a newly
submitted cropping — so a farmer doesn't have to manually plot every
task onto their calendar themselves.

The schedule itself (which activity, how many days after planting) is
real agronomic timing for Palay/Corn in Binalonan — the same
CROP_PRACTICES/CROPPING_CALENDAR data already used on the frontend
(YieldShield_ui/src/app/data/binalonan.ts), just mirrored here since
this runs server-side at submission time.

Near-term tasks (within Open-Meteo's ~15-day forecast horizon — see
weather.py) get a live weather note attached at generation time.
Everything else is refreshed on demand as it comes into range — see
routers/tasks.py's refresh_weather_sensitive().
"""
import datetime as dt
import logging

from .pagasa_weather import rainfall_category
from .weather import get_weather_for_date

logger = logging.getLogger("yieldshield.farm_calendar")

# Human-readable label per task_type — kept in sync with Calendar.tsx's
# TASK_META labels so backend-generated notification text matches what
# the farmer sees in the calendar.
TASK_TYPE_LABEL: dict[str, str] = {
    "water": "Watering",
    "fertilizer": "Fertilizer",
    "pre_planting": "Pre-Planting",
    "other": "Other",
}

# (day offset, task_type, activity text), anchored to the planting date.
# Land prep / seedbed steps use "pre_planting" so they surface as a
# distinct category in the calendar rather than the generic "other".
_PALAY_PLANTING_ANCHORED: list[tuple[int, str, str]] = [
    (-21, "pre_planting", "Prepare seedbed/nursery and sow pre-germinated seeds"),
    (-14, "pre_planting", "Plow and prepare the field (1st plowing)"),
    (-3, "pre_planting", "Final harrowing and leveling before transplanting"),
    (7, "other", "Check seedling establishment; spot-replant any gaps"),
    (14, "fertilizer", "Apply 1st fertilizer dose (basal nitrogen)"),
    (30, "fertilizer", "Apply 2nd fertilizer dose (top-dress, tillering stage)"),
    (35, "other", "Monitor for pests (stem borer, leafhoppers) and disease"),
    (45, "water", "Check water level and drainage (mid-season)"),
    (60, "fertilizer", "Apply 3rd fertilizer dose if needed (panicle initiation)"),
]
# Same as above but for direct-seeded palay — no nursery/transplanting step.
_PALAY_PLANTING_ANCHORED_DIRECT_SEED: list[tuple[int, str, str]] = [
    (-14, "pre_planting", "Plow and prepare the field (1st plowing)"),
    (-3, "pre_planting", "Final harrowing and leveling before sowing"),
    (7, "other", "Check germination; spot-replant any gaps"),
    (14, "fertilizer", "Apply 1st fertilizer dose (basal nitrogen)"),
    (30, "fertilizer", "Apply 2nd fertilizer dose (top-dress, tillering stage)"),
    (35, "other", "Monitor for pests (stem borer, leafhoppers) and disease"),
    (45, "water", "Check water level and drainage (mid-season)"),
    (60, "fertilizer", "Apply 3rd fertilizer dose if needed (panicle initiation)"),
]
# (day offset from maturity, task_type, activity text) — negative = before harvest.
_PALAY_MATURITY_ANCHORED: list[tuple[int, str, str]] = [
    (-14, "water", "Drain the field ahead of harvest"),
    (-3, "other", "Final field check before harvest"),
    (0, "other", "Harvest and record actual yield"),
]

_CORN_PLANTING_ANCHORED: list[tuple[int, str, str]] = [
    (-10, "pre_planting", "Plow and prepare the field"),
    (7, "other", "Check germination; thin or replant gaps"),
    (14, "fertilizer", "Apply 1st fertilizer dose (basal)"),
    (25, "other", "Monitor for fall armyworm and other pests"),
    (30, "fertilizer", "Apply 2nd fertilizer dose (side-dress)"),
    (45, "water", "Irrigate if rainfall has been low (tasseling stage)"),
]
_CORN_MATURITY_ANCHORED: list[tuple[int, str, str]] = [
    (-10, "other", "Check ear/kernel maturity"),
    (0, "other", "Harvest and record actual yield"),
]

def _weather_note(target_date: dt.date, task_type: str) -> str | None:
    """Best-effort — returns None (no note) if the forecast isn't
    available yet or the lookup fails; never raises."""
    try:
        w = get_weather_for_date(target_date)
    except Exception:
        return None
    if w.source != "forecast":
        return None  # Outside the real forecast horizon — nothing live to say yet.

    label, _advice = rainfall_category(w.rainfall_mm)
    heavy = w.rainfall_mm >= 15  # PAGASA's "Heavy rain" floor — see pagasa_weather.py

    if task_type == "water":
        if heavy:
            return f"{label} expected (~{w.rainfall_mm:.0f}mm) — irrigation likely not needed."
        return "Little rain expected — plan to irrigate."
    if task_type == "fertilizer" and heavy:
        return f"{label} expected (~{w.rainfall_mm:.0f}mm) — consider shifting by a few days to avoid runoff."
    if task_type == "pre_planting" and heavy:
        return f"{label} expected (~{w.rainfall_mm:.0f}mm) — field may be too wet to work; consider shifting by a few days."
    return None


def weather_refresh_note(task_type: str, current_text: str, due_date: dt.date) -> str | None:
    """Recomputes the live weather note for an already-existing task as
    its due date comes into (or moves through) the forecast horizon.
    Returns the updated full text, or None if nothing should change
    (out of forecast range, or the note is unchanged). Strips any note
    this function previously appended (delimited by " — ") before
    adding the current one, so repeated calls don't stack notes.
    """
    base_text = current_text.split(" — ", 1)[0]
    note = _weather_note(due_date, task_type)
    new_text = f"{base_text} — {note}" if note else base_text
    return new_text if new_text != current_text else None


def generate_activities(
    crop: str, planting_date: dt.date, maturity_days: int, technique: str | None = None,
) -> list[dict]:
    """Returns a list of {task_type, text, due_date} dicts — the
    standard schedule for this crop, anchored to its actual planting
    date and maturity, with a live weather note on whichever tasks
    fall within the current forecast horizon.

    For palay, ``technique`` (e.g. "Transplanting (Pindot)") decides
    whether a nursery/seedbed pre-planting step is included — direct
    seeding skips it since there's no separate seedbed stage."""
    if crop == "Palay (Rice)":
        is_transplanted = bool(technique) and "transplant" in technique.lower()
        planting_anchored = (
            _PALAY_PLANTING_ANCHORED if is_transplanted else _PALAY_PLANTING_ANCHORED_DIRECT_SEED
        )
        maturity_anchored = _PALAY_MATURITY_ANCHORED
    else:
        planting_anchored, maturity_anchored = _CORN_PLANTING_ANCHORED, _CORN_MATURITY_ANCHORED

    out: list[dict] = []
    for offset, task_type, text in planting_anchored:
        due = planting_date + dt.timedelta(days=offset)
        note = _weather_note(due, task_type)
        out.append({
            "task_type": task_type,
            "text": f"{text} — {note}" if note else text,
            "due_date": due,
        })
    for offset, task_type, text in maturity_anchored:
        due = planting_date + dt.timedelta(days=maturity_days + offset)
        note = _weather_note(due, task_type)
        out.append({
            "task_type": task_type,
            "text": f"{text} — {note}" if note else text,
            "due_date": due,
        })
    return out
