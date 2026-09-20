import datetime as dt
import logging

import psycopg2
import psycopg2.errors
from fastapi import APIRouter, Depends, HTTPException, status

from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..farm_calendar import TASK_TYPE_LABEL, generate_activities
from ..ml import FeatureLookupError, ModelNotAvailable, get_model_info, predict_for_submission
from ..push import send_push
from ..schemas import (
    FarmInputRequest,
    FarmInputResponse,
    HarvestRequest,
    HarvestResponse,
    PredictionUpdateRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/farm-input", tags=["farm-input"])

# Real model, once scripts/10_export_serving_artifacts.R's output has been
# copied into app/ml/artifacts/ (see that folder's README). Until then,
# ModelNotAvailable is raised on every call and submissions fall back to
# the client-submitted heuristic score below, exactly as before this change.
_HEURISTIC_MODEL_NAME = "Agronomic Heuristic v1 (client-side)"


def _get_or_create_heuristic_model_id(cur) -> int:
    cur.execute(
        "SELECT model_id FROM yieldshield.predictive_model WHERE model_name = %s",
        (_HEURISTIC_MODEL_NAME,),
    )
    row = cur.fetchone()
    if row:
        return row["model_id"]
    cur.execute(
        """
        INSERT INTO yieldshield.predictive_model (model_name, algorithm, is_active)
        VALUES (%s, %s, TRUE)
        RETURNING model_id
        """,
        (_HEURISTIC_MODEL_NAME, "Deterministic agronomic scoring (soil, climate, timing)"),
    )
    return cur.fetchone()["model_id"]


def _get_or_create_real_model_id(cur) -> int:
    """Same idea as _get_or_create_heuristic_model_id, but for the actual
    trained model - upserts a yieldshield.predictive_model row from the
    exported model's own reported metrics, so provenance in the data is
    honest (which model, and how good it actually was)."""
    info = get_model_info()
    cur.execute(
        "SELECT model_id FROM yieldshield.predictive_model WHERE model_name = %s",
        (info["model_name"],),
    )
    row = cur.fetchone()
    if row:
        return row["model_id"]
    cur.execute(
        """
        INSERT INTO yieldshield.predictive_model (model_name, algorithm, mae, mse, r_squared, trained_date, is_active)
        VALUES (%s, %s, %s, %s, %s, now(), TRUE)
        RETURNING model_id
        """,
        (info["model_name"], info["algorithm"], info["mae"], info["mse"], info["r_squared"]),
    )
    return cur.fetchone()["model_id"]


def _score_submission(cur, barangay_id: int, crop_type_id: int, barangay: str, crop: str, planting_date) -> dict | None:
    """Tries the real model first; returns None (not an exception) if it's
    unavailable or the DB doesn't have enough history/climate data yet, so
    callers can fall back to the client-submitted heuristic score without
    a try/except at every call site."""
    try:
        return predict_for_submission(cur, barangay_id, crop_type_id, barangay, crop, planting_date)
    except ModelNotAvailable as exc:
        logger.info("Real model not available, falling back to client-submitted score: %s", exc)
        return None
    except FeatureLookupError as exc:
        logger.warning("Feature lookup failed for barangay_id=%s crop_type_id=%s: %s", barangay_id, crop_type_id, exc)
        return None


def _resolve_barangay_and_crop(cur, barangay_label: str, crop_label: str):
    # normalize() on both sides: an accented barangay name (e.g. "Santo
    # Niño") can be stored, or arrive from the frontend, with "ñ" as
    # either one composed codepoint or "n" + a separate combining-tilde
    # mark — visually identical, byte-for-byte different, and a plain
    # `=` comparison treats them as unequal. Same failure mode already
    # hit and fixed in the seed script and store.tsx; fixing it here
    # too means a real farmer's submission can't quietly fail the same
    # way depending on which form Postgres happens to have stored.
    cur.execute(
        "SELECT barangay_id FROM yieldshield.barangay WHERE normalize(barangay_name, NFC) = normalize(%s, NFC)",
        (barangay_label,),
    )
    barangay_row = cur.fetchone()
    if barangay_row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown barangay: {barangay_label}")

    cur.execute(
        "SELECT crop_type_id FROM yieldshield.crop_type WHERE crop_name = %s ORDER BY crop_type_id LIMIT 1",
        ("Palay" if crop_label == "Palay (Rice)" else "Corn",),
    )
    crop_row = cur.fetchone()
    if crop_row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown crop type: {crop_label}")
    return barangay_row["barangay_id"], crop_row["crop_type_id"]


def maturity_days(crop: str) -> int:
    """Flat crop-level fallback — mirrors store.tsx's maturityDays().
    Prefer variety_maturity_days() below when a specific variety is
    known; this is only the last resort when it isn't (no variety
    typed, or it doesn't match anything in yieldshield.crop_variety)."""
    return 120 if crop == "Palay (Rice)" else 90


def variety_maturity_days(cur, crop_type_id: int, variety: str | None, crop_label: str) -> int:
    """Real per-variety maturity (yieldshield.crop_variety, migration 08)
    when the farmer's free-text variety matches the catalog — a 105-day
    variety and a 130-day variety sharing one flat 120-day assumption
    otherwise threw off both the harvest countdown (WeekPlan.tsx) and
    the maturity-anchored tasks generate_activities() plots (fertilizer/
    harvest reminders). Falls back to the flat crop-level default for
    free-text varieties that aren't in the catalog, same as before this
    existed."""
    if variety:
        cur.execute(
            "SELECT maturity_days FROM yieldshield.crop_variety WHERE crop_type_id = %s AND variety_name = %s",
            (crop_type_id, variety),
        )
        row = cur.fetchone()
        if row is not None and row["maturity_days"] is not None:
            return int(row["maturity_days"])
    return maturity_days(crop_label)


def _notify(cur, user_id: int, category: str, title: str, body_text: str, barangay: str | None = None, plot_id: str | None = None) -> None:
    """Inserts a real notification row for an event that just happened —
    see migration 09 / routers/notifications.py for why this replaced
    the frontend's hardcoded demo notifications."""
    cur.execute(
        """
        INSERT INTO yieldshield.notification (user_id, category, title, body, barangay, plot_id)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (user_id, category, title, body_text, barangay, plot_id),
    )


@router.post("", response_model=FarmInputResponse, status_code=status.HTTP_201_CREATED)
def submit_farm_input(body: FarmInputRequest, user: CurrentUser = Depends(get_current_user)):
    if user.role not in ("Farmer", "Admin", "Agricultural Technician"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This role cannot submit field records.")

    # Same on-behalf pattern as routers/fields.py's create_field — without
    # this, every cropping submitted through AdminFarms.tsx's "on behalf
    # of a farmer" flow was silently filed under the *admin's* account
    # instead, since the insert below used to always use user.user_id.
    owner_id = user.user_id
    if body.ownerId is not None:
        if user.role not in ("Admin", "Agricultural Technician"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only staff can submit a cropping on behalf of a farmer.")
        owner_id = int(body.ownerId)

    pending_pushes: list[tuple[int, str, str]] = []

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            if body.ownerId is not None:
                cur.execute("SELECT user_id FROM yieldshield.user_account WHERE user_id = %s", (owner_id,))
                if cur.fetchone() is None:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown ownerId: {body.ownerId}")

            barangay_id, crop_type_id = _resolve_barangay_and_crop(cur, body.barangay, body.crop)

            if body.field_id is not None:
                # RLS on yieldshield.field already confirms this field
                # belongs to the caller (or any field, for staff).
                cur.execute("SELECT field_id, user_id FROM yieldshield.field WHERE field_id = %s", (body.field_id,))
                field_row = cur.fetchone()
                if field_row is None:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown field_id: {body.field_id}")
                if body.ownerId is None:
                    # No explicit on-behalf owner was given, but the
                    # field itself belongs to someone else — that's the
                    # normal Admin/Technician "pick any farmer's field"
                    # path (AdminFarms.tsx), so attribute the cropping to
                    # the field's real owner rather than the caller.
                    owner_id = field_row["user_id"]
                elif field_row["user_id"] != owner_id:
                    raise HTTPException(status.HTTP_400_BAD_REQUEST, "field_id does not belong to ownerId.")

            # Best-effort match to a documented planting technique for
            # this barangay+crop (general, season-independent row) —
            # purely informational, so a miss is not an error.
            cur.execute(
                """
                SELECT technique_id FROM yieldshield.planting_technique
                 WHERE barangay_id = %s AND crop_type_id = %s AND season_type IS NULL
                 LIMIT 1
                """,
                (barangay_id, crop_type_id),
            )
            technique_row = cur.fetchone()
            technique_id = technique_row["technique_id"] if technique_row else None

            # One DataInput submission = one plot = one farm_profile row.
            # RLS's WITH CHECK on farm_profile allows any user_id here
            # when the caller is Admin/Agricultural Technician (same
            # policy fields.py's create_field relies on); for a Farmer,
            # owner_id is always their own so the check is a no-op.
            #
            # plot_code is only unique *per owner* (migration 19) — a
            # collision here means this same farmer already has another
            # cropping using this exact code, which is a normal mistake
            # to make (typo, re-submitting, forgetting they used it
            # already) and should come back as a clear message, not an
            # unhandled 500.
            try:
                cur.execute(
                    """
                    INSERT INTO yieldshield.farm_profile
                        (user_id, barangay_id, crop_type_id, land_area_ha, soil_condition, plot_code, plot_name, field_id, filed_by_user_id)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING farm_id
                    """,
                    (
                        owner_id,
                        barangay_id,
                        crop_type_id,
                        body.area_ha,
                        body.soil_type or None,
                        body.plot_id,
                        body.plot_name or None,
                        body.field_id,
                        user.user_id,
                    ),
                )
            except psycopg2.errors.UniqueViolation:
                conn.rollback()
                raise HTTPException(
                    status.HTTP_409_CONFLICT,
                    f"You already have a cropping using the plot code \"{body.plot_id}\" — please use a different one.",
                )
            farm_id = cur.fetchone()["farm_id"]

            cur.execute(
                """
                INSERT INTO yieldshield.farm_input_log
                    (farm_id, technique_id, land_area_ha, rainfall_input, temperature_input,
                     planting_date, ph, soil_moisture_pct, quantity, quantity_unit, notes,
                     variety, technique_name, spacing_cm, seed_rate, ecosystem, seed_type)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING input_log_id
                """,
                (
                    farm_id,
                    technique_id,
                    body.area_ha,
                    body.rainfall,
                    body.temperature,
                    body.planting_date,
                    body.ph,
                    body.moisture,
                    body.quantity,
                    body.quantity_unit,
                    body.notes,
                    body.variety,
                    body.technique,
                    body.spacing,
                    body.seed_rate,
                    body.ecosystem,
                    body.seed_type,
                ),
            )
            input_log_id = cur.fetchone()["input_log_id"]

            # Auto-plot the standard care schedule for this cropping onto
            # the calendar (see farm_calendar.py) — the farmer doesn't
            # have to add these themselves. Near-term ones already carry
            # a live weather note; the rest get refreshed as they come
            # into forecast range (see routers/tasks.py's
            # refresh_weather_sensitive, called when Calendar.tsx loads).
            schedule = generate_activities(
                body.crop, body.planting_date,
                variety_maturity_days(cur, crop_type_id, body.variety, body.crop), body.technique,
            )
            for activity in schedule:
                cur.execute(
                    """
                    INSERT INTO yieldshield.crop_task
                        (user_id, input_log_id, task_type, text, due_date, end_date, auto_generated, text_key, note_key, note_rainfall_mm)
                    VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s)
                    """,
                    (
                        owner_id, input_log_id, activity["task_type"], activity["text"], activity["due_date"], activity["end_date"],
                        activity["text_key"], activity["note_key"], activity["note_rainfall_mm"],
                    ),
                )

            # Let the farmer know a schedule was plotted for them, headlined
            # by whichever task is due soonest (almost always a pre-planting
            # step — land prep, or seedbed prep for transplanted rice) so
            # it doesn't just sit unnoticed in the Calendar/WeekPlan.
            if schedule:
                first = min(schedule, key=lambda a: a["due_date"])
                days_out = (first["due_date"] - dt.date.today()).days
                when = (
                    "today" if days_out == 0 else
                    "tomorrow" if days_out == 1 else
                    f"in {days_out} days" if days_out > 1 else
                    f"{-days_out} day(s) ago"
                )
                task_body = (
                    f"A care schedule was set up for {body.plot_id} ({body.crop}). "
                    f"First up: \u201c{first['text'].split(' \u2014 ', 1)[0]}\u201d "
                    f"({TASK_TYPE_LABEL.get(first['task_type'], 'Other')}), due {when} "
                    f"({first['due_date'].isoformat()}). See Calendar for the full schedule."
                )
                _notify(
                    cur, owner_id, "task", "Farm schedule ready", task_body,
                    barangay=body.barangay, plot_id=body.plot_id,
                )
                pending_pushes.append((owner_id, "Farm schedule ready", task_body))

            predicted_yield_mt_ha = None
            confidence = None
            algorithm = None
            prediction_status = "pending"

            server_prediction = _score_submission(
                cur, barangay_id, crop_type_id, body.barangay, body.crop, body.planting_date
            )
            if server_prediction is not None:
                model_id = _get_or_create_real_model_id(cur)
                predicted_yield_mt_ha = server_prediction["predicted_yield_mt_ha"]
                confidence = server_prediction["confidence"]
                algorithm = server_prediction["algorithm"]
                prediction_status = "ready"
            elif body.predicted_yield_mt_ha is not None:
                model_id = _get_or_create_heuristic_model_id(cur)
                predicted_yield_mt_ha = body.predicted_yield_mt_ha
                confidence = body.confidence
                algorithm = _HEURISTIC_MODEL_NAME
                prediction_status = "ready"

            if predicted_yield_mt_ha is not None:
                predicted_production_mt = round(predicted_yield_mt_ha * body.area_ha, 2)
                cur.execute(
                    """
                    INSERT INTO yieldshield.yield_prediction
                        (input_log_id, model_id, predicted_yield_mt_ha, predicted_production_mt, confidence_pct)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (input_log_id, model_id, predicted_yield_mt_ha, predicted_production_mt, confidence),
                )
                filed_by_staff = owner_id != user.user_id
                prediction_body = (
                    (
                        f"Staff added a new cropping for {body.plot_id} on your behalf — "
                        f"{body.crop}: {predicted_yield_mt_ha:.2f} t/ha predicted"
                        + (f" ({confidence:.0f}% confidence)" if confidence is not None else "")
                        + ". Review it and edit any details that aren't quite right."
                    )
                    if filed_by_staff else
                    (
                        f"{body.crop} at {body.plot_id}: {predicted_yield_mt_ha:.2f} t/ha predicted"
                        + (f" ({confidence:.0f}% confidence)" if confidence is not None else "") + "."
                    )
                )
                _notify(
                    cur, owner_id, "prediction", "Yield prediction ready", prediction_body,
                    barangay=body.barangay, plot_id=body.plot_id,
                )
                pending_pushes.append((owner_id, "Yield prediction ready", prediction_body))

            # Real low-moisture flag from the farmer's own submitted
            # reading — not a fabricated PAGASA-style advisory.
            if body.moisture is not None and body.moisture < 40:
                moisture_body = (
                    f"{body.plot_id} was logged at {body.moisture:.0f}% soil moisture — below the "
                    "typical 40% threshold for healthy growth. Consider irrigation."
                )
                _notify(
                    cur, owner_id, "alert", "Low soil moisture", moisture_body,
                    barangay=body.barangay, plot_id=body.plot_id,
                )
                pending_pushes.append((owner_id, "Low soil moisture", moisture_body))

    for push_user_id, push_title, push_body in pending_pushes:
        send_push(push_user_id, push_title, push_body)

    return FarmInputResponse(
        input_log_id=input_log_id,
        farm_id=farm_id,
        field_id=body.field_id,
        predicted_yield_mt_ha=predicted_yield_mt_ha,
        predicted_production_mt=(
            round(predicted_yield_mt_ha * body.area_ha, 2) if predicted_yield_mt_ha is not None else None
        ),
        algorithm=algorithm,
        confidence=confidence,
        prediction_status=prediction_status,
    )


@router.patch("/{input_log_id}", response_model=FarmInputResponse)
def update_farm_input(input_log_id: int, body: PredictionUpdateRequest, user: CurrentUser = Depends(get_current_user)):
    """Edits an existing cropping's agronomic inputs and re-scores it —
    backs MyFarm.tsx's 'Edit cropping'. RLS (p_farm_input_log_owner)
    already scopes this to the caller's own records (or all, for staff)."""
    if user.role not in ("Farmer", "Admin", "Agricultural Technician"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This role cannot edit field records.")

    fields, values = [], []
    simple_map = {
        "area_ha": "land_area_ha",
        "planting_date": "planting_date",
        "ph": "ph",
        "moisture": "soil_moisture_pct",
        "temperature": "temperature_input",
        "rainfall": "rainfall_input",
        "quantity": "quantity",
        "quantity_unit": "quantity_unit",
        "notes": "notes",
        "variety": "variety",
        "technique": "technique_name",
        "spacing": "spacing_cm",
        "seed_rate": "seed_rate",
        "ecosystem": "ecosystem",
        "seed_type": "seed_type",
    }
    for attr, column in simple_map.items():
        val = getattr(body, attr)
        if val is not None:
            fields.append(f"{column} = %s")
            values.append(val)

    pending_pushes: list[tuple[int, str, str]] = []

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            # Snapshot the three inputs that drive the auto-generated care
            # schedule (farm_calendar.py's generate_activities, plus
            # variety_maturity_days() above it) before this edit
            # overwrites them, so a real change to any one of them (not
            # just this field being resent unchanged, which MyFarm.tsx's
            # edit form always does) can be detected below.
            cur.execute(
                "SELECT planting_date, technique_name, variety FROM yieldshield.farm_input_log WHERE input_log_id = %s",
                (input_log_id,),
            )
            before = cur.fetchone()
            if before is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Field record not found.")

            if fields:
                values.append(input_log_id)
                cur.execute(
                    f"UPDATE yieldshield.farm_input_log SET {', '.join(fields)} WHERE input_log_id = %s",
                    values,
                )
                if cur.rowcount == 0:
                    raise HTTPException(status.HTTP_404_NOT_FOUND, "Field record not found.")

            cur.execute(
                "SELECT farm_id, land_area_ha, planting_date, technique_name, variety FROM yieldshield.farm_input_log WHERE input_log_id = %s",
                (input_log_id,),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Field record not found.")

            # plot_name lives on farm_profile (see migration 27), not
            # farm_input_log like the rest of simple_map above — a
            # separate statement, keyed by the farm_id just looked up.
            if body.plot_name is not None:
                cur.execute(
                    "UPDATE yieldshield.farm_profile SET plot_name = %s WHERE farm_id = %s",
                    (body.plot_name.strip() or None, row["farm_id"]),
                )
            cur.execute(
                """
                SELECT fp.field_id, fp.barangay_id, fp.crop_type_id, fp.user_id, fp.plot_code,
                       b.barangay_name, ct.crop_name
                  FROM yieldshield.farm_profile fp
                  JOIN yieldshield.barangay b ON b.barangay_id = fp.barangay_id
                  JOIN yieldshield.crop_type ct ON ct.crop_type_id = fp.crop_type_id
                 WHERE fp.farm_id = %s
                """,
                (row["farm_id"],),
            )
            farm_row = cur.fetchone()

            # Recalculate the care schedule if the planting date,
            # technique, or variety actually changed — planting date and
            # technique feed generate_activities()'s offsets/shape
            # directly (technique also decides whether a nursery/seedbed
            # pre-planting step is included), and variety decides how
            # many days out maturity_days() below places the whole
            # maturity-anchored half of the schedule. Any stale
            # combination would otherwise keep showing the wrong due
            # dates on Calendar.tsx/WeekPlan.tsx. Only this cropping's
            # auto_generated, not-yet-done rows are touched — anything
            # the farmer added by hand from the Calendar (migration 22)
            # is left alone regardless of its due date, and completed
            # tasks are kept as a record of what was actually done.
            planting_date_changed = body.planting_date is not None and body.planting_date != before["planting_date"]
            technique_changed = body.technique is not None and body.technique != before["technique_name"]
            variety_changed = body.variety is not None and body.variety != before["variety"]
            if (planting_date_changed or technique_changed or variety_changed) and farm_row is not None and row["planting_date"] is not None:
                crop_label = "Palay (Rice)" if farm_row["crop_name"] == "Palay" else "Corn"
                cur.execute(
                    "DELETE FROM yieldshield.crop_task WHERE input_log_id = %s AND done = FALSE AND auto_generated = TRUE",
                    (input_log_id,),
                )
                schedule = generate_activities(
                    crop_label, row["planting_date"],
                    variety_maturity_days(cur, farm_row["crop_type_id"], row["variety"], crop_label),
                    row["technique_name"],
                )
                for activity in schedule:
                    cur.execute(
                        """
                        INSERT INTO yieldshield.crop_task
                            (user_id, input_log_id, task_type, text, due_date, end_date, auto_generated, text_key, note_key, note_rainfall_mm)
                        VALUES (%s, %s, %s, %s, %s, %s, TRUE, %s, %s, %s)
                        """,
                        (
                            farm_row["user_id"], input_log_id, activity["task_type"], activity["text"], activity["due_date"], activity["end_date"],
                            activity["text_key"], activity["note_key"], activity["note_rainfall_mm"],
                        ),
                    )
                if schedule:
                    reschedule_body = (
                        f"The care schedule for {farm_row['plot_code'] or 'your plot'} was recalculated "
                        "after its planting date/technique changed — check Calendar for the updated dates."
                    )
                    _notify(
                        cur, farm_row["user_id"], "task", "Care schedule updated", reschedule_body,
                        barangay=farm_row["barangay_name"], plot_id=farm_row["plot_code"],
                    )
                    pending_pushes.append((farm_row["user_id"], "Care schedule updated", reschedule_body))

            predicted_yield_mt_ha = None
            confidence = None
            algorithm = None
            prediction_status = "pending"
            area_ha = float(row["land_area_ha"]) if row["land_area_ha"] is not None else 0.0

            server_prediction = None
            if farm_row is not None and row["planting_date"] is not None:
                # body.barangay/body.crop aren't part of PredictionUpdateRequest
                # (barangay/crop don't change on an edit - only agronomic
                # inputs do), so the current farm_profile values are used
                # directly; body.planting_date already landed in `row` above
                # if this edit changed it.
                server_prediction = _score_submission(
                    cur, farm_row["barangay_id"], farm_row["crop_type_id"],
                    farm_row["barangay_name"], farm_row["crop_name"], row["planting_date"],
                )

            if server_prediction is not None:
                model_id = _get_or_create_real_model_id(cur)
                predicted_yield_mt_ha = server_prediction["predicted_yield_mt_ha"]
                confidence = server_prediction["confidence"]
                algorithm = server_prediction["algorithm"]
                prediction_status = "ready"
            elif body.predicted_yield_mt_ha is not None:
                model_id = _get_or_create_heuristic_model_id(cur)
                predicted_yield_mt_ha = body.predicted_yield_mt_ha
                confidence = body.confidence
                algorithm = _HEURISTIC_MODEL_NAME
                prediction_status = "ready"

            if predicted_yield_mt_ha is not None:
                predicted_production_mt = round(predicted_yield_mt_ha * area_ha, 2)
                cur.execute(
                    """
                    INSERT INTO yieldshield.yield_prediction
                        (input_log_id, model_id, predicted_yield_mt_ha, predicted_production_mt, confidence_pct)
                    VALUES (%s, %s, %s, %s, %s)
                    """,
                    (input_log_id, model_id, predicted_yield_mt_ha, predicted_production_mt, confidence),
                )

    for push_user_id, push_title, push_body in pending_pushes:
        send_push(push_user_id, push_title, push_body)

    return FarmInputResponse(
        input_log_id=input_log_id,
        farm_id=row["farm_id"],
        field_id=farm_row["field_id"] if farm_row else None,
        predicted_yield_mt_ha=predicted_yield_mt_ha,
        predicted_production_mt=(
            round(predicted_yield_mt_ha * area_ha, 2) if predicted_yield_mt_ha is not None else None
        ),
        algorithm=algorithm,
        confidence=confidence,
        prediction_status=prediction_status,
    )


@router.patch("/{input_log_id}/harvest", response_model=HarvestResponse)
def record_harvest(input_log_id: int, body: HarvestRequest, user: CurrentUser = Depends(get_current_user)):
    if user.role not in ("Farmer", "Admin", "Agricultural Technician"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This role cannot record harvest results.")

    pending_push: tuple[int, str, str] | None = None

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            # RLS (p_farm_input_log_owner) already scopes this to the
            # caller's own farm_profile rows (or all rows for
            # Admin/Agricultural Technician) — a farmer targeting
            # someone else's input_log_id just updates zero rows here,
            # same as if the record didn't exist.
            cur.execute(
                """
                UPDATE yieldshield.farm_input_log
                   SET actual_yield_mt_ha = %s,
                       harvest_date = %s,
                       harvest_notes = %s
                 WHERE input_log_id = %s
                RETURNING input_log_id, actual_yield_mt_ha, harvest_date, harvest_notes
                """,
                (body.actual_yield_mt_ha, body.harvest_date, body.harvest_notes, input_log_id),
            )
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Field record not found.")

            # The field's actual owner (not necessarily the caller — a
            # staff role can record harvest on a farmer's behalf), plus
            # enough context to write a real comparison message.
            cur.execute(
                """
                SELECT fp.user_id, fp.plot_code, b.barangay_name, ct.crop_name,
                       (SELECT predicted_yield_mt_ha FROM yieldshield.yield_prediction
                         WHERE input_log_id = fil.input_log_id
                         ORDER BY date_generated DESC LIMIT 1) AS predicted_yield_mt_ha
                  FROM yieldshield.farm_input_log fil
                  JOIN yieldshield.farm_profile fp ON fp.farm_id = fil.farm_id
                  JOIN yieldshield.barangay b ON b.barangay_id = fp.barangay_id
                  JOIN yieldshield.crop_type ct ON ct.crop_type_id = fp.crop_type_id
                 WHERE fil.input_log_id = %s
                """,
                (input_log_id,),
            )
            owner_row = cur.fetchone()
            if owner_row is not None:
                predicted = owner_row["predicted_yield_mt_ha"]
                actual = float(body.actual_yield_mt_ha)
                comparison = ""
                if predicted is not None:
                    diff_pct = round((actual - float(predicted)) / float(predicted) * 100, 1)
                    comparison = f" ({'+' if diff_pct >= 0 else ''}{diff_pct}% vs. the {float(predicted):.2f} t/ha prediction)"
                harvest_body = (
                    f"{owner_row['crop_name']} at {owner_row['plot_code'] or 'your plot'}: "
                    f"{actual:.2f} t/ha actual yield{comparison}."
                )
                _notify(
                    cur, owner_row["user_id"], "harvest", "Harvest recorded", harvest_body,
                    barangay=owner_row["barangay_name"], plot_id=owner_row["plot_code"],
                )
                pending_push = (owner_row["user_id"], "Harvest recorded", harvest_body)

    if pending_push is not None:
        send_push(*pending_push)

    return HarvestResponse(**row)


@router.delete("/{input_log_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_farm_input(input_log_id: int, user: CurrentUser = Depends(get_current_user)):
    """Deletes a cropping entirely — backs MyFarm.tsx's "Delete cropping".
    RLS (p_farm_input_log_owner) scopes this to the caller's own records
    (or all, for staff). Everything derived from this cropping — its
    crop_recommendation, yield_prediction, and crop_task rows — cascades
    with it (see 01_schema.sql and migration 17), so no orphaned
    "no crop" reminders are left behind on the Calendar/Dashboard."""
    if user.role not in ("Farmer", "Admin", "Agricultural Technician"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This role cannot delete field records.")

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM yieldshield.farm_input_log WHERE input_log_id = %s", (input_log_id,))
            if cur.rowcount == 0:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Field record not found.")
