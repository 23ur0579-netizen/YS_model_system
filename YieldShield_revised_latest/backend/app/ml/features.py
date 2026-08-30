"""
Assembles the raw inputs the yield model needs for a NEW prediction, by
querying tables the existing ETL (etl_load.py) already populates -
yieldshield.climate_record, yieldshield.barangay, yieldshield.crop_features.
No new data source or API call is required; everything here is a read
against data already loaded from binalonan_crop_data4.xlsx.

Why this exists: FarmInputRequest only collects a handful of fields
per-plot (pH, soil moisture %, a single temperature/rainfall reading,
free-text soil_type). The trained model needs the full monthly climate
profile (avg/min/max temp, humidity, surface pressure, solar radiation)
and barangay/crop-level land-use context (irrigated/rainfed split, typical
planted area) that the training data was built from - none of which a
farmer types into a form. This module resolves those from the DB instead.
"""
import datetime as dt


class FeatureLookupError(LookupError):
    """Raised when the DB doesn't have what's needed to build a feature
    row (e.g. a barangay with zero crop_features history). Callers should
    treat this as "prediction unavailable right now", not a 500."""


# Philippine Climate Type I cropping calendar (PAGASA), per the workbook's
# own References sheet: pronounced dry season Nov-Apr, wet season May-Oct.
# Only used as a fallback when climatology averaging can't recover a
# season_type from an actual DB row (see get_climate_features below) -
# the normal path reads season_type straight from yieldshield.season via
# the matched climate_record, so it's never guessing when real data exists.
_DRY_SEASON_MONTHS = {11, 12, 1, 2, 3, 4}


def _season_type_for_month(month_no: int) -> str:
    return "DS" if month_no in _DRY_SEASON_MONTHS else "WS"


def get_climate_features(cur, planting_date: dt.date) -> dict:
    """Exact (year, month) climate_record row if one exists; otherwise the
    climatological average for that calendar month across all years on
    record (same "no service can forecast months ahead" reasoning as
    weather.py's Open-Meteo climatology fallback)."""
    year, month_no = planting_date.year, planting_date.month

    cur.execute(
        """
        SELECT cr.rainfall_mm_day, cr.avg_temp_c, cr.min_temp_c, cr.max_temp_c,
               cr.humidity_pct, cr.surface_pressure_kpa, cr.solar_rad_mj_m2,
               s.season_type
          FROM yieldshield.climate_record cr
          JOIN yieldshield.season s ON s.season_id = cr.season_id
         WHERE cr.year = %s AND cr.month_no = %s
         LIMIT 1
        """,
        (year, month_no),
    )
    row = cur.fetchone()
    if row is not None and row["avg_temp_c"] is not None:
        return {
            "rainfall": float(row["rainfall_mm_day"]),
            "avg_temp": float(row["avg_temp_c"]),
            "min_temp": float(row["min_temp_c"]),
            "max_temp": float(row["max_temp_c"]),
            "humidity": float(row["humidity_pct"]),
            "surface_pressure": float(row["surface_pressure_kpa"]),
            "solar_rad": float(row["solar_rad_mj_m2"]),
            "season_type": row["season_type"],
            "source": "historical_month",
        }

    cur.execute(
        """
        SELECT AVG(rainfall_mm_day) AS rainfall_mm_day, AVG(avg_temp_c) AS avg_temp_c,
               AVG(min_temp_c) AS min_temp_c, AVG(max_temp_c) AS max_temp_c,
               AVG(humidity_pct) AS humidity_pct,
               AVG(surface_pressure_kpa) AS surface_pressure_kpa,
               AVG(solar_rad_mj_m2) AS solar_rad_mj_m2
          FROM yieldshield.climate_record
         WHERE month_no = %s
        """,
        (month_no,),
    )
    row = cur.fetchone()
    if row is None or row["avg_temp_c"] is None:
        raise FeatureLookupError(
            f"No climate_record data available for month {month_no} "
            "(neither an exact year match nor any historical average)."
        )
    return {
        "rainfall": float(row["rainfall_mm_day"]),
        "avg_temp": float(row["avg_temp_c"]),
        "min_temp": float(row["min_temp_c"]),
        "max_temp": float(row["max_temp_c"]),
        "humidity": float(row["humidity_pct"]),
        "surface_pressure": float(row["surface_pressure_kpa"]),
        "solar_rad": float(row["solar_rad_mj_m2"]),
        "season_type": _season_type_for_month(month_no),
        "source": "climatology_average",
    }


def get_barangay_reference(cur, barangay_id: int) -> dict:
    """soil_type + land_size_ha are static per-barangay reference data
    (yieldshield.barangay), not something a farmer should have to type."""
    cur.execute(
        "SELECT soil_type, land_size_ha FROM yieldshield.barangay WHERE barangay_id = %s",
        (barangay_id,),
    )
    row = cur.fetchone()
    if row is None:
        raise FeatureLookupError(f"No barangay row for barangay_id={barangay_id}.")
    return {
        "soil_type": row["soil_type"] or "",
        "land_size_ha": float(row["land_size_ha"]) if row["land_size_ha"] is not None else 0.0,
    }


def get_area_context(cur, barangay_id: int, crop_type_id: int) -> dict:
    """The model was trained on barangay-wide totals (total_area_planted_ha
    etc. in the hundreds of hectares), not one farmer's plot - see
    YieldShield_ML/README.md's "Scale caveat". Using a farmer's own
    area_ha here would put the request wildly outside the training
    distribution. Instead this returns the historical barangay+crop
    average land-use context from yieldshield.crop_features, falling back
    to a crop-wide average if this specific barangay+crop has no history
    yet (e.g. a barangay that has only ever grown the other crop)."""
    cols = """
        AVG(total_area_planted_ha) AS total_area_planted_ha,
        AVG(irrigated_area_ha)     AS irrigated_area_ha,
        AVG(rainfed_area_ha)       AS rainfed_area_ha
    """
    cur.execute(
        f"SELECT {cols} FROM yieldshield.crop_features WHERE barangay_id = %s AND crop_type_id = %s",
        (barangay_id, crop_type_id),
    )
    row = cur.fetchone()
    if row is None or row["total_area_planted_ha"] is None:
        cur.execute(f"SELECT {cols} FROM yieldshield.crop_features WHERE crop_type_id = %s", (crop_type_id,))
        row = cur.fetchone()
    if row is None or row["total_area_planted_ha"] is None:
        raise FeatureLookupError(
            "No crop_features history available to estimate typical land-use context "
            "for this barangay/crop combination."
        )
    return {
        "total_area_planted_ha": float(row["total_area_planted_ha"] or 0.0),
        "irrigated_area_ha": float(row["irrigated_area_ha"] or 0.0),
        "rainfed_area_ha": float(row["rainfed_area_ha"] or 0.0),
    }
