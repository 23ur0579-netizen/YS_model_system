"""
Downloads for the two official Municipal Agriculture Office reports —
see reports.py for how each workbook is actually built. Admin/
Agricultural Technician only, same as every other municipality-wide
(not "my own farm") view in this app.
"""
import datetime as dt
import io

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse

from ..db import get_conn
from ..deps import CurrentUser, require_role
from ..reports import build_area_harvested_workbook, build_area_planted_workbook
from ..schemas import ReportDateRangeOut

router = APIRouter(prefix="/reports", tags=["reports"])
STAFF_ROLES = ("Admin", "Agricultural Technician")

_XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
_ECOSYSTEM_SLUG = {"Irrigated": "irrigated", "Rainfed": "rainfed", "All": "all-ecosystems"}


def _crop_type_id(cur, crop_label: str) -> int:
    crop_name = "Palay" if crop_label == "Palay (Rice)" else "Corn"
    cur.execute("SELECT crop_type_id FROM yieldshield.crop_type WHERE crop_name = %s ORDER BY crop_type_id LIMIT 1", (crop_name,))
    row = cur.fetchone()
    if row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown crop: {crop_label}")
    return row["crop_type_id"]


def _stream(buf: io.BytesIO, filename: str) -> StreamingResponse:
    return StreamingResponse(
        buf,
        media_type=_XLSX_MEDIA_TYPE,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/date-range", response_model=ReportDateRangeOut)
def report_date_range(
    crop: str = Query(..., description='"Palay (Rice)" or "Corn"'),
    kind: str = Query(..., pattern="^(planted|harvested)$", description='"planted" = every cropping\'s planting date; "harvested" = only croppings with a recorded actual yield'),
    user: CurrentUser = Depends(require_role(*STAFF_ROLES)),
):
    """Backs AdminFarms.tsx's Reports panel: switching between the
    Area Planted / Area Harvested tabs calls this to auto-fill a date
    window that actually has data in it, instead of defaulting to a
    blind "6 months back" guess that may not overlap anything —
    especially easy to get wrong for "harvested" specifically, since a
    window full of still-growing crops is a *correct*, empty report,
    not a bug, but looks identical to one from the outside."""
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            crop_type_id = _crop_type_id(cur, crop)
            yield_filter = "AND fil.actual_yield_mt_ha IS NOT NULL" if kind == "harvested" else ""
            cur.execute(
                f"""
                SELECT MIN(fil.planting_date) AS min_date, MAX(fil.planting_date) AS max_date
                  FROM yieldshield.farm_input_log fil
                  JOIN yieldshield.farm_profile fp ON fp.farm_id = fil.farm_id
                 WHERE fp.crop_type_id = %s
                   {yield_filter}
                """,
                (crop_type_id,),
            )
            row = cur.fetchone()
    return ReportDateRangeOut(
        minDate=row["min_date"].isoformat() if row and row["min_date"] else None,
        maxDate=row["max_date"].isoformat() if row and row["max_date"] else None,
    )


@router.get("/area-planted")
def area_planted_report(
    crop: str = Query(..., description='"Palay (Rice)" or "Corn"'),
    ecosystem: str = Query("Irrigated", pattern="^(Irrigated|Rainfed|All)$", description='Which ecosystem to report — "All" combines Irrigated + Rainfed into one sheet'),
    date_from: dt.date = Query(..., description="First day of the planting window this report covers"),
    date_to: dt.date = Query(..., description="Last day of the planting window this report covers"),
    season_label: str = Query(..., max_length=40, description='e.g. "DS 2025-2026"'),
    as_of_label: str = Query(..., max_length=60, description='e.g. "August 28, 2026" — shown as "As of ..." on the report'),
    prepared_by: str = Query(..., max_length=120),
    prepared_title: str = Query("Agricultural Technologist", max_length=120),
    noted_by: str = Query("", max_length=120),
    noted_title: str = Query("Municipal Agriculturist", max_length=120),
    user: CurrentUser = Depends(require_role(*STAFF_ROLES)),
):
    if date_to < date_from:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "date_to can't be before date_from.")
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            crop_type_id = _crop_type_id(cur, crop)
            buf = build_area_planted_workbook(
                cur, crop_type_id, crop, date_from, date_to, season_label, as_of_label,
                "Binalonan", "Pangasinan", ecosystem, prepared_by, prepared_title, noted_by, noted_title,
            )
    crop_slug = "palay" if crop == "Palay (Rice)" else "corn"
    return _stream(buf, f"area-planted-{crop_slug}-{_ECOSYSTEM_SLUG[ecosystem]}-{season_label.replace(' ', '_')}.xlsx")


@router.get("/area-harvested")
def area_harvested_report(
    crop: str = Query(..., description='"Palay (Rice)" or "Corn"'),
    ecosystem: str = Query("Irrigated", pattern="^(Irrigated|Rainfed|All)$", description='Which ecosystem to report — "All" combines Irrigated + Rainfed into one sheet'),
    date_from: dt.date = Query(..., description="First day of the planting window this report covers"),
    date_to: dt.date = Query(..., description="Last day of the planting window this report covers"),
    season_label: str = Query(..., max_length=40, description='e.g. "DS 2025-2026"'),
    as_of_label: str = Query(..., max_length=60, description='e.g. "August 28, 2026" — shown as "As of ..." on the report'),
    prepared_by: str = Query(..., max_length=120),
    prepared_title: str = Query("Agricultural Technologist", max_length=120),
    noted_by: str = Query("", max_length=120),
    noted_title: str = Query("Municipal Agriculturist", max_length=120),
    user: CurrentUser = Depends(require_role(*STAFF_ROLES)),
):
    if date_to < date_from:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "date_to can't be before date_from.")
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            crop_type_id = _crop_type_id(cur, crop)
            buf = build_area_harvested_workbook(
                cur, crop_type_id, crop, date_from, date_to, season_label, as_of_label,
                "Binalonan", "Pangasinan", ecosystem, prepared_by, prepared_title, noted_by, noted_title,
            )
    crop_slug = "palay" if crop == "Palay (Rice)" else "corn"
    return _stream(buf, f"area-harvested-{crop_slug}-{_ECOSYSTEM_SLUG[ecosystem]}-{season_label.replace(' ', '_')}.xlsx")
