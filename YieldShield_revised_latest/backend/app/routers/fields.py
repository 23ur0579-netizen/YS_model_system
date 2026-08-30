"""
Physical fields (yieldshield.field) — a field can host many cropping
periods (farm_profile rows, linked via farm_profile.field_id). Backs
MyFarm.tsx's field list/add/delete and the field picker in
DataInput.tsx / Simulation.tsx.

RLS (p_field_owner, migration 07) already scopes rows to "my own" for
a Farmer and "every row" for Admin/Agricultural Technician, same
pattern as farm_profile — see farms.py for the precedent.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from psycopg2.extras import Json

from ..barangay_utils import barangay_id_from_name
from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..schemas import FieldCreateRequest, FieldOut

router = APIRouter(prefix="/fields", tags=["fields"])

_SELECT_SQL = """
    SELECT f.field_id, f.user_id, ua.full_name AS farmer_name, f.name,
           b.barangay_name, f.location, f.area_ha, f.notes,
           f.latitude, f.longitude, f.boundary, f.created_at
      FROM yieldshield.field f
      JOIN yieldshield.user_account ua ON ua.user_id = f.user_id
      JOIN yieldshield.barangay b ON b.barangay_id = f.barangay_id
"""


def _to_out(row) -> FieldOut:
    return FieldOut(
        id=str(row["field_id"]),
        ownerId=str(row["user_id"]),
        farmer=row["farmer_name"],
        name=row["name"],
        barangay=row["barangay_name"],
        location=row["location"] or "",
        area=float(row["area_ha"]) if row["area_ha"] is not None else 0.0,
        notes=row["notes"] or "",
        latitude=float(row["latitude"]) if row["latitude"] is not None else None,
        longitude=float(row["longitude"]) if row["longitude"] is not None else None,
        boundary=row["boundary"],  # psycopg2 hands JSONB back as a plain list already
        createdAt=int(row["created_at"].timestamp() * 1000),
    )


@router.get("", response_model=list[FieldOut])
def list_fields(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " ORDER BY f.created_at DESC")
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]


@router.post("", response_model=FieldOut, status_code=status.HTTP_201_CREATED)
def create_field(body: FieldCreateRequest, user: CurrentUser = Depends(get_current_user)):
    # Admins may create a field on behalf of a farmer (explicit ownerId);
    # farmers may only ever create their own.
    owner_id = user.user_id
    if body.ownerId is not None:
        if user.role not in ("Admin", "Agricultural Technician"):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Only staff can create a field on behalf of a farmer.")
        owner_id = int(body.ownerId)

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            barangay_id = barangay_id_from_name(cur, body.barangay)
            cur.execute(
                """
                INSERT INTO yieldshield.field (user_id, barangay_id, name, location, area_ha, latitude, longitude, boundary)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING field_id
                """,
                (
                    owner_id, barangay_id, body.name, body.location, body.area, body.latitude, body.longitude,
                    Json(body.boundary) if body.boundary else None,
                ),
            )
            new_id = cur.fetchone()["field_id"]
            cur.execute(_SELECT_SQL + " WHERE f.field_id = %s", (new_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.delete("/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field(field_id: int, user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            # RLS scopes this to the caller's own fields (or all fields
            # for staff) — a farmer targeting someone else's field_id
            # just deletes zero rows, same as a 404.
            cur.execute("DELETE FROM yieldshield.field WHERE field_id = %s", (field_id,))
            if cur.rowcount == 0:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Field not found.")
