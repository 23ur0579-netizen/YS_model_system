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

Every activity text and weather note is a translation key (matching an
entry in YieldShield_ui's i18n.tsx), not a finished English sentence —
see migration 32's crop_task.text_key/note_key/note_rainfall_mm and
Calendar.tsx's rendering. "text" below stays as a plain-English
fallback for anything that hasn't been updated to read the key
columns.
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

# (day offset, days the activity window spans beyond that day, task_type,
# translation key, English fallback text), anchored to the planting
# date. Every entry gets a real multi-day window, not a single exact
# date — a field isn't plowed in one sitting, fertilizer isn't applied
# on one precise day, and even a routine check can slip a day or two
# for weather or whatever else comes up, so pinning any of this to one
# calendar date overpromises a precision nobody actually has. The
# calendar shows each as a continuous range (see Calendar.tsx's
# range-bar rendering). Land prep / seedbed steps use "pre_planting" so
# they surface as a distinct category rather than the generic "other".
#
# Several keys repeat across the tables below on purpose (e.g.
# "activity.plow1" for both palay tables) — the same real-world
# activity gets the same translation regardless of which schedule it's
# scheduled from.
_PALAY_PLANTING_ANCHORED: list[tuple[int, int, str, str, str]] = [
    (-24, 2, "pre_planting", "activity.palaySeedbed", "Prepare seedbed/nursery and sow pre-germinated seeds"),
    (-14, 3, "pre_planting", "activity.plow1", "1st plowing"),
    (-7, 2, "pre_planting", "activity.plow2Puddle", "2nd plowing and harrowing (puddling for wet tillage)"),
    (-3, 2, "pre_planting", "activity.finalHarrowTransplant", "Final harrowing and leveling before transplanting"),
    (7, 3, "other", "activity.checkSeedlingEstablishment", "Check seedling establishment; spot-replant any gaps"),
    (10, 4, "other", "activity.weeding1", "1st hand weeding / spot weeding"),
    (14, 3, "fertilizer", "activity.fert1Basal", "Apply 1st fertilizer dose (basal nitrogen)"),
    (25, 4, "other", "activity.weeding2", "2nd hand weeding"),
    (30, 3, "fertilizer", "activity.fert2Tillering", "Apply 2nd fertilizer dose (top-dress, tillering stage)"),
    (35, 6, "other", "activity.palayMonitorPests", "Monitor for pests (stem borer, leafhoppers) and disease"),
    (40, 5, "water", "activity.awd", "Maintain intermittent irrigation (AWD — alternate wetting and drying)"),
    (45, 3, "water", "activity.checkWaterMidseason", "Check water level and drainage (mid-season)"),
    (60, 3, "fertilizer", "activity.fert3Panicle", "Apply 3rd fertilizer dose if needed (panicle initiation)"),
    (75, 5, "other", "activity.palayMonitorDisease", "Monitor for disease (blast, bacterial blight) at booting stage"),
]
# Same as above but for direct-seeded palay — no nursery/transplanting step.
_PALAY_PLANTING_ANCHORED_DIRECT_SEED: list[tuple[int, int, str, str, str]] = [
    (-14, 3, "pre_planting", "activity.plow1", "1st plowing"),
    (-7, 2, "pre_planting", "activity.plow2", "2nd plowing and harrowing"),
    (-3, 2, "pre_planting", "activity.finalHarrowSowing", "Final harrowing and leveling before sowing"),
    (7, 3, "other", "activity.checkGerminationReplant", "Check germination; spot-replant any gaps"),
    (10, 4, "other", "activity.weeding1", "1st hand weeding / spot weeding"),
    (14, 3, "fertilizer", "activity.fert1Basal", "Apply 1st fertilizer dose (basal nitrogen)"),
    (25, 4, "other", "activity.weeding2", "2nd hand weeding"),
    (30, 3, "fertilizer", "activity.fert2Tillering", "Apply 2nd fertilizer dose (top-dress, tillering stage)"),
    (35, 6, "other", "activity.palayMonitorPests", "Monitor for pests (stem borer, leafhoppers) and disease"),
    (40, 5, "water", "activity.awd", "Maintain intermittent irrigation (AWD — alternate wetting and drying)"),
    (45, 3, "water", "activity.checkWaterMidseason", "Check water level and drainage (mid-season)"),
    (60, 3, "fertilizer", "activity.fert3Panicle", "Apply 3rd fertilizer dose if needed (panicle initiation)"),
    (75, 5, "other", "activity.palayMonitorDisease", "Monitor for disease (blast, bacterial blight) at booting stage"),
]
# (day offset from maturity, window span, task_type, translation key,
# English fallback) — negative = before harvest.
_PALAY_MATURITY_ANCHORED: list[tuple[int, int, str, str, str]] = [
    (-14, 3, "water", "activity.drainForHarvest", "Drain the field ahead of harvest"),
    (-5, 4, "other", "activity.finalFieldCheck", "Final field check and maturity assessment before harvest"),
    (0, 4, "other", "activity.harvestWindow", "Harvest — window around physiological maturity"),
    (3, 4, "other", "activity.dryStoreGrain", "Dry and store harvested grain"),
]

_CORN_PLANTING_ANCHORED: list[tuple[int, int, str, str, str]] = [
    (-10, 3, "pre_planting", "activity.plowPrepareField", "Plow and prepare the field"),
    (-3, 2, "pre_planting", "activity.finalHarrowFurrow", "Final harrowing and furrow-making"),
    (7, 3, "other", "activity.cornCheckGerminationThin", "Check germination; thin or replant gaps"),
    (18, 4, "other", "activity.weeding1HillingUp", "1st weeding / hilling-up"),
    (14, 3, "fertilizer", "activity.fert1BasalCorn", "Apply 1st fertilizer dose (basal)"),
    (25, 5, "other", "activity.cornMonitorArmyworm", "Monitor for fall armyworm and other pests"),
    (30, 3, "fertilizer", "activity.fert2SideDress", "Apply 2nd fertilizer dose (side-dress)"),
    (40, 4, "other", "activity.weeding2IfNeeded", "2nd weeding if needed"),
    (45, 4, "water", "activity.irrigateTasseling", "Irrigate if rainfall has been low (tasseling stage)"),
]
_CORN_MATURITY_ANCHORED: list[tuple[int, int, str, str, str]] = [
    (-10, 3, "other", "activity.checkEarMaturity", "Check ear/kernel maturity"),
    (0, 3, "other", "activity.harvestWindow", "Harvest — window around physiological maturity"),
    (3, 4, "other", "activity.dryStoreCorn", "Dry and store harvested corn"),
]


def _weather_note(target_date: dt.date, task_type: str) -> tuple[str, float | None] | None:
    """Best-effort — returns None (no note) if the forecast isn't
    available yet or the lookup fails; never raises. Returns
    (note_key, rainfall_mm) — note_key matches an i18n.tsx key,
    rainfall_mm is the one dynamic value that key's translated
    sentence needs (its {rainfall} placeholder), or None for the one
    note variant that doesn't mention a number."""
    try:
        w = get_weather_for_date(target_date)
    except Exception:
        return None
    if w.source != "forecast":
        return None  # Outside the real forecast horizon — nothing live to say yet.

    heavy = w.rainfall_mm >= 15  # PAGASA's "Heavy rain" floor — see pagasa_weather.py

    if task_type == "water":
        if heavy:
            return "task.note.waterHeavy", w.rainfall_mm
        return "task.note.waterLow", None
    if task_type == "fertilizer" and heavy:
        return "task.note.fertilizerHeavy", w.rainfall_mm
    if task_type == "pre_planting" and heavy:
        return "task.note.prePlantingHeavy", w.rainfall_mm
    return None


def note_text_en(note_key: str, rainfall_mm: float | None) -> str:
    """English fallback for a note_key — only used to build the plain-
    English "text" fallback column; the live app renders note_key via
    i18n.tsx instead."""
    label = rainfall_category(rainfall_mm)[1] if rainfall_mm is not None else ""
    return {
        "task.note.waterHeavy": f"{label} expected (~{rainfall_mm:.0f}mm) — irrigation likely not needed.",
        "task.note.waterLow": "Little rain expected — plan to irrigate.",
        "task.note.fertilizerHeavy": f"{label} expected (~{rainfall_mm:.0f}mm) — consider shifting by a few days to avoid runoff.",
        "task.note.prePlantingHeavy": f"{label} expected (~{rainfall_mm:.0f}mm) — field may be too wet to work; consider shifting by a few days.",
    }[note_key]


def weather_refresh_note(task_type: str, due_date: dt.date) -> tuple[str | None, float | None] | None:
    """Recomputes the live weather note for an already-existing task as
    its due date comes into (or moves through) the forecast horizon.
    Returns (note_key, rainfall_mm) — note_key is None if the task no
    longer has a note (out of forecast range) — or None if nothing
    should change at all. Unlike the old text-splicing version, the
    caller (routers/tasks.py) just overwrites note_key/note_rainfall_mm
    outright; there's no old note text to strip since it's stored
    separately from the base activity text now."""
    return _weather_note(due_date, task_type)


def generate_activities(
    crop: str, planting_date: dt.date, maturity_days: int, technique: str | None = None,
    with_weather: bool = True,
) -> list[dict]:
    """Returns a list of {task_type, text, text_key, note_key,
    note_rainfall_mm, due_date, end_date} dicts — the standard schedule
    for this crop, anchored to its actual planting date and maturity,
    with a live weather note on whichever tasks fall within the
    current forecast horizon. end_date is None for a single specific
    day, or due_date + the activity's realistic application/work
    window otherwise (see the _*_ANCHORED tables above) — matches
    migration 28's crop_task.end_date and Calendar.tsx's range-bar
    rendering. text is a plain-English fallback (activity + note,
    exactly as this used to render); text_key/note_key/note_rainfall_mm
    are what the live app actually renders via i18n.tsx — see migration
    32.

    For palay, ``technique`` (e.g. "Transplanting (Pindot)") decides
    whether a nursery/seedbed pre-planting step is included — direct
    seeding skips it since there's no separate seedbed stage.

    with_weather=False skips the live weather lookups entirely (each
    one is a real HTTP call — see weather.py) — used by
    scripts/05_seed_test_data.py so seeding hundreds of croppings stays
    fast and deterministic; every real call site should leave this at
    the default so farmers still get the live note."""
    if crop == "Palay (Rice)":
        is_transplanted = bool(technique) and "transplant" in technique.lower()
        planting_anchored = (
            _PALAY_PLANTING_ANCHORED if is_transplanted else _PALAY_PLANTING_ANCHORED_DIRECT_SEED
        )
        maturity_anchored = _PALAY_MATURITY_ANCHORED
    else:
        planting_anchored, maturity_anchored = _CORN_PLANTING_ANCHORED, _CORN_MATURITY_ANCHORED

    out: list[dict] = []
    for offset, span, task_type, text_key, text_en in planting_anchored:
        due = planting_date + dt.timedelta(days=offset)
        note = _weather_note(due, task_type) if with_weather else None
        note_key, note_rainfall = note if note else (None, None)
        out.append({
            "task_type": task_type,
            "text": f"{text_en} — {note_text_en(note_key, note_rainfall)}" if note_key else text_en,
            "text_key": text_key,
            "note_key": note_key,
            "note_rainfall_mm": note_rainfall,
            "due_date": due,
            "end_date": due + dt.timedelta(days=span) if span > 0 else None,
        })
    for offset, span, task_type, text_key, text_en in maturity_anchored:
        due = planting_date + dt.timedelta(days=maturity_days + offset)
        note = _weather_note(due, task_type) if with_weather else None
        note_key, note_rainfall = note if note else (None, None)
        out.append({
            "task_type": task_type,
            "text": f"{text_en} — {note_text_en(note_key, note_rainfall)}" if note_key else text_en,
            "text_key": text_key,
            "note_key": note_key,
            "note_rainfall_mm": note_rainfall,
            "due_date": due,
            "end_date": due + dt.timedelta(days=span) if span > 0 else None,
        })
    return out
