"""
Read-only NSIC/PhilRice variety reference catalog (yieldshield.crop_variety,
migration 08) — backs the variety picker in MyFarm.tsx's cropping form and
Simulation.tsx. Loaded by etl_load.py from binalonan_crop_data4.xlsx's
"Crop Varieties" sheet; nothing here writes to it.

Same access pattern as other reference data (crop_type/barangay/season) —
any signed-in user can read it, since it's just catalog data needed to
render a dropdown, not anything scoped per-farmer or per-admin-tier.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..schemas import CropVarietyOut

router = APIRouter(prefix="/crop-varieties", tags=["crop-varieties"])

_SELECT_SQL = """
    SELECT cv.variety_id, ct.crop_name, cv.nsic_code, cv.variety_name, cv.category,
           cv.average_yield_t_ha, cv.maximum_yield_t_ha, cv.maturity_days,
           cv.recommended_ecosystem, cv.grain_type, cv.drought_tolerance,
           cv.flood_tolerance, cv.disease_resistance
      FROM yieldshield.crop_variety cv
      JOIN yieldshield.crop_type ct ON ct.crop_type_id = cv.crop_type_id
"""


def _to_out(row) -> CropVarietyOut:
    return CropVarietyOut(
        id=str(row["variety_id"]),
        crop="Palay (Rice)" if row["crop_name"] == "Palay" else "Corn",
        nsicCode=row["nsic_code"],
        name=row["variety_name"],
        category=row["category"],
        averageYieldTHa=float(row["average_yield_t_ha"]) if row["average_yield_t_ha"] is not None else None,
        maximumYieldTHa=float(row["maximum_yield_t_ha"]) if row["maximum_yield_t_ha"] is not None else None,
        maturityDays=row["maturity_days"],
        recommendedEcosystem=row["recommended_ecosystem"],
        grainType=row["grain_type"],
        droughtTolerance=row["drought_tolerance"],
        floodTolerance=row["flood_tolerance"],
        diseaseResistance=row["disease_resistance"],
    )


@router.get("", response_model=list[CropVarietyOut])
def list_crop_varieties(
    crop: str | None = Query(None, description='"Palay (Rice)" or "Corn" — omit for both'),
    user: CurrentUser = Depends(get_current_user),
):
    sql = _SELECT_SQL
    params: list = []
    if crop is not None:
        if crop not in ("Palay (Rice)", "Corn"):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown crop: {crop}")
        sql += " WHERE ct.crop_name = %s"
        params.append("Palay" if crop == "Palay (Rice)" else "Corn")
    sql += " ORDER BY cv.variety_name"

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]
