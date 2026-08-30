"""
Lists submitted plots (farm_profile + farm_input_log, with the latest
yield_prediction attached if one exists) — backs AdminFarms.tsx and
MyFarm.tsx, which previously read from a hard-coded seed array.

No manual role branching is needed here: this query runs under
get_conn(user.user_id, user.role), and the same RLS policies that
scope farm_profile/farm_input_log to "my own rows" for a Farmer (and
to "every row" for Admin/Agricultural Technician) already do the
filtering — see p_farm_profile_owner / p_farm_input_log_owner in
02_security.sql.
"""
from fastapi import APIRouter, Depends

from ..db import get_conn
from ..deps import CurrentUser, get_current_user
from ..schemas import FarmOut

router = APIRouter(prefix="/farms", tags=["farms"])

_LIST_FARMS_SQL = """
    SELECT
        fil.input_log_id,
        fp.farm_id,
        fp.field_id,
        fp.user_id,
        fp.filed_by_user_id,
        ua.full_name           AS farmer_name,
        fp.plot_code,
        b.barangay_name,
        ct.crop_name,
        fp.land_area_ha,
        fil.ph,
        fil.soil_moisture_pct,
        fil.temperature_input,
        fil.rainfall_input,
        fil.notes,
        fil.planting_date,
        fil.quantity,
        fil.quantity_unit,
        fil.variety,
        fil.technique_name,
        fil.spacing_cm,
        fil.seed_rate,
        fil.ecosystem,
        fil.seed_type,
        fil.date_logged,
        fil.actual_yield_mt_ha,
        fil.harvest_date,
        fil.harvest_notes,
        yp.predicted_yield_mt_ha,
        yp.confidence_pct,
        pm.model_name
      FROM yieldshield.farm_input_log fil
      JOIN yieldshield.farm_profile fp ON fp.farm_id = fil.farm_id
      JOIN yieldshield.user_account ua ON ua.user_id = fp.user_id
      JOIN yieldshield.barangay b      ON b.barangay_id = fp.barangay_id
      JOIN yieldshield.crop_type ct    ON ct.crop_type_id = fp.crop_type_id
 LEFT JOIN LATERAL (
        SELECT yp2.model_id, yp2.predicted_yield_mt_ha, yp2.confidence_pct
          FROM yieldshield.yield_prediction yp2
         WHERE yp2.input_log_id = fil.input_log_id
         ORDER BY yp2.date_generated DESC
         LIMIT 1
      ) yp ON true
 LEFT JOIN yieldshield.predictive_model pm ON pm.model_id = yp.model_id
     ORDER BY fil.date_logged DESC
"""


def _crop_label(crop_name: str) -> str:
    return "Palay (Rice)" if crop_name == "Palay" else "Corn"


def _row_to_farm(row) -> FarmOut:
    confidence = int(row["confidence_pct"]) if row["confidence_pct"] is not None else None
    return FarmOut(
        id=str(row["input_log_id"]),
        ownerId=str(row["user_id"]),
        farmer=row["farmer_name"],
        plotId=row["plot_code"] or f"FARM-{row['farm_id']}",
        fieldId=str(row["field_id"]) if row["field_id"] is not None else None,
        barangay=row["barangay_name"],
        crop=_crop_label(row["crop_name"]),
        area=float(row["land_area_ha"]) if row["land_area_ha"] is not None else 0.0,
        ph=float(row["ph"]) if row["ph"] is not None else None,
        moisture=float(row["soil_moisture_pct"]) if row["soil_moisture_pct"] is not None else None,
        temperature=float(row["temperature_input"]) if row["temperature_input"] is not None else None,
        rainfall=float(row["rainfall_input"]) if row["rainfall_input"] is not None else None,
        notes=row["notes"] or "",
        plantingDate=row["planting_date"].isoformat() if row["planting_date"] else None,
        quantity=float(row["quantity"]) if row["quantity"] is not None else None,
        quantityUnit=row["quantity_unit"],
        variety=row["variety"],
        technique=row["technique_name"],
        spacing=float(row["spacing_cm"]) if row["spacing_cm"] is not None else None,
        seedRate=float(row["seed_rate"]) if row["seed_rate"] is not None else None,
        ecosystem=row["ecosystem"],
        seedType=row["seed_type"],
        predictedYield=float(row["predicted_yield_mt_ha"]) if row["predicted_yield_mt_ha"] is not None else None,
        confidence=confidence,
        createdAt=int(row["date_logged"].timestamp() * 1000),
        actualYield=float(row["actual_yield_mt_ha"]) if row["actual_yield_mt_ha"] is not None else None,
        harvestDate=row["harvest_date"].isoformat() if row["harvest_date"] else None,
        harvestNotes=row["harvest_notes"],
        filedByStaff=row["filed_by_user_id"] is not None and row["filed_by_user_id"] != row["user_id"],
    )


@router.get("", response_model=list[FarmOut])
def list_farms(user: CurrentUser = Depends(get_current_user)):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_LIST_FARMS_SQL)
            rows = cur.fetchall()
    return [_row_to_farm(r) for r in rows]
