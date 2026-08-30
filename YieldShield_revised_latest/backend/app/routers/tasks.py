"""
Crop-care to-dos (watering/fertilizer reminders) — backs Calendar.tsx
and the WeekPlan.tsx dashboard card. Always scoped to the signed-in
user (RLS p_crop_task_owner, migration 07) — there's no "on behalf of"
mode here since these are personal reminders, not field records.

Most rows here were auto-generated at submission time (see
farm_calendar.py, called from farm_input.py) rather than typed in by
hand — a farmer can still add/edit/delete their own on top of that.
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status

from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..farm_calendar import weather_refresh_note
from ..schemas import CropTaskCreateRequest, CropTaskOut

router = APIRouter(prefix="/tasks", tags=["tasks"])

_SELECT_SQL = """
    SELECT task_id, user_id, input_log_id, task_type, text, due_date, done
      FROM yieldshield.crop_task
"""


def _to_out(row) -> CropTaskOut:
    return CropTaskOut(
        id=str(row["task_id"]),
        ownerId=str(row["user_id"]),
        type=row["task_type"],
        text=row["text"],
        date=row["due_date"].isoformat(),
        done=row["done"],
        predictionId=str(row["input_log_id"]) if row["input_log_id"] is not None else None,
    )


@router.post("/refresh-weather", response_model=list[CropTaskOut])
def refresh_weather_sensitive(user: CurrentUser = Depends(get_current_user)):
    """Re-checks live weather for the caller's own upcoming, not-yet-done
    water/fertilizer/pre_planting tasks and updates their note if the
    forecast has changed — this is the "changes depending on weather"
    half of the auto-generated calendar (farm_calendar.py handles the
    initial plot). Returns only the tasks that actually changed."""
    horizon = dt.date.today() + dt.timedelta(days=15)  # matches weather.py's forecast horizon
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                _SELECT_SQL + """
                 WHERE user_id = %s AND done = FALSE AND task_type IN ('water', 'fertilizer', 'pre_planting')
                   AND due_date BETWEEN CURRENT_DATE AND %s
                """,
                (user.user_id, horizon),
            )
            candidates = cur.fetchall()

            updated = []
            for row in candidates:
                new_text = weather_refresh_note(row["task_type"], row["text"], row["due_date"])
                if new_text is None:
                    continue
                cur.execute(
                    "UPDATE yieldshield.crop_task SET text = %s WHERE task_id = %s",
                    (new_text, row["task_id"]),
                )
                row["text"] = new_text
                updated.append(row)
    return [_to_out(r) for r in updated]


@router.get("", response_model=list[CropTaskOut])
def list_tasks(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " WHERE user_id = %s ORDER BY due_date", (user.user_id,))
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]


@router.post("", response_model=CropTaskOut, status_code=status.HTTP_201_CREATED)
def create_task(body: CropTaskCreateRequest, user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            input_log_id = int(body.predictionId) if body.predictionId else None
            cur.execute(
                """
                INSERT INTO yieldshield.crop_task (user_id, input_log_id, task_type, text, due_date)
                VALUES (%s, %s, %s, %s, %s)
                RETURNING task_id
                """,
                (user.user_id, input_log_id, body.type, body.text, body.date),
            )
            new_id = cur.fetchone()["task_id"]
            cur.execute(_SELECT_SQL + " WHERE task_id = %s", (new_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.patch("/{task_id}/toggle", response_model=CropTaskOut)
def toggle_task(task_id: int, user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE yieldshield.crop_task SET done = NOT done
                 WHERE task_id = %s
                RETURNING task_id
                """,
                (task_id,),
            )
            if cur.fetchone() is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
            cur.execute(_SELECT_SQL + " WHERE task_id = %s", (task_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_task(task_id: int, user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM yieldshield.crop_task WHERE task_id = %s", (task_id,))
            if cur.rowcount == 0:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found.")
