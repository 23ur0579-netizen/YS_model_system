#!/usr/bin/env python3
"""
YieldShield ETL — loads binalonan_crop_data.xlsx into PostgreSQL.

Populates only the reference / historical tables that the source
workbook actually contains data for:
    crop_type, barangay, season, climate_record,
    planting_technique, production_record, crop_features,
    crop_variety (from the "Crop Varieties" sheet, added in the
    binalonan_crop_data4.xlsx revision — see migrations/08_crop_varieties.sql)

It deliberately does NOT touch user_account, farm_profile,
predictive_model, farm_input_log, crop_recommendation,
yield_prediction, report, sus_response, support_request —
those are populated by the running application, not by this
research dataset.

Connection security
--------------------
- No credentials are hard-coded. Everything comes from environment
  variables (see .env.example), ideally injected by a secrets
  manager / CI variable store rather than a committed .env file.
- The connection enforces TLS via sslmode=verify-full by default.
  Point PGSSLROOTCERT at your CA bundle.
- Connects as the low-privilege `yieldshield_etl` role, which can
  only write to the six tables above (see 02_security.sql).

Usage
-----
    python3 etl_load.py --xlsx /path/to/binalonan_crop_data1.xlsx
"""
import argparse
import os
import re
import sys
from datetime import datetime

import openpyxl
import psycopg2
import psycopg2.extras


MONTH_TO_NUM = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
}


def get_conn():
    """Open a TLS-secured connection using environment variables only."""
    required = ["PGHOST", "PGDATABASE", "PGUSER", "PGPASSWORD"]
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        sys.exit(f"Missing required environment variables: {', '.join(missing)}")

    conn = psycopg2.connect(
        host=os.environ["PGHOST"],
        port=os.environ.get("PGPORT", "5432"),
        dbname=os.environ["PGDATABASE"],
        user=os.environ["PGUSER"],
        password=os.environ["PGPASSWORD"],
        sslmode=os.environ.get("PGSSLMODE", "verify-full"),
        sslrootcert=os.environ.get("PGSSLROOTCERT") or None,
        connect_timeout=10,
        options="-c search_path=yieldshield,public",
    )
    conn.autocommit = False
    return conn


def parse_season(season_str: str):
    """'DS 2020-2021' -> ('DS 2020-2021','Dry Season 2020-2021','DS',2020,2021)
       'WS 2017'       -> ('WS 2017','Wet Season 2017','WS',2017,2017)"""
    season_str = season_str.strip()
    m = re.match(r"(DS|WS)\s+(\d{4})(?:-(\d{4}))?", season_str)
    if not m:
        raise ValueError(f"Unrecognized season format: {season_str!r}")
    stype, y1, y2 = m.group(1), int(m.group(2)), m.group(3)
    end_year = int(y2) if y2 else y1
    long_name = "Dry Season" if stype == "DS" else "Wet Season"
    label = f"{long_name} {y1}-{end_year}" if y2 else f"{long_name} {y1}"
    return season_str, label, stype, y1, end_year


def load_workbook(xlsx_path):
    print(f"Reading workbook: {xlsx_path}")
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    central = wb["Central Data"]

    rows = []
    for row in central.iter_rows(min_row=4, values_only=True):
        if row[0] is None:
            continue
        rows.append(row)
    print(f"  Central Data: {len(rows)} data rows")

    lat, lon = None, None
    if "Climate Data" in wb.sheetnames:
        cd = wb["Climate Data"]
        for row in cd.iter_rows(min_row=4, max_row=4, values_only=True):
            lat, lon = row[10], row[11]
    return rows, lat, lon, wb


def upsert_crop_types(cur, rows):
    crop_names = sorted({r[0] for r in rows})
    crop_id = {}
    for name in crop_names:
        cur.execute(
            """
            INSERT INTO crop_type (crop_name, variety)
            VALUES (%s, NULL)
            ON CONFLICT (crop_name, variety) DO UPDATE SET crop_name = EXCLUDED.crop_name
            RETURNING crop_type_id
            """,
            (name,),
        )
        crop_id[name] = cur.fetchone()[0]
    print(f"  crop_type: {len(crop_id)} rows")
    return crop_id


def upsert_barangays(cur, rows):
    info = {}
    for r in rows:
        barangay = r[1]
        soil, terrain, elev, water, land = r[15], r[16], r[17], r[18], r[19]
        info[barangay] = (soil, terrain, elev, water, land)

    barangay_id = {}
    for name, (soil, terrain, elev, water, land) in info.items():
        cur.execute(
            """
            INSERT INTO barangay (barangay_name, soil_type, terrain_type,
                                   elevation_m_asl, nearest_water_body, land_size_ha)
            VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (barangay_name) DO UPDATE SET
                soil_type = EXCLUDED.soil_type,
                terrain_type = EXCLUDED.terrain_type,
                elevation_m_asl = EXCLUDED.elevation_m_asl,
                nearest_water_body = EXCLUDED.nearest_water_body,
                land_size_ha = EXCLUDED.land_size_ha
            RETURNING barangay_id
            """,
            (name, soil, terrain, elev, water, land),
        )
        barangay_id[name] = cur.fetchone()[0]
    print(f"  barangay: {len(barangay_id)} rows")
    return barangay_id


def upsert_seasons(cur, rows):
    codes = sorted({r[4] for r in rows})
    season_id = {}
    for code in codes:
        code_val, label, stype, y1, y2 = parse_season(code)
        cur.execute(
            """
            INSERT INTO season (season_code, season_label, season_type, start_year, end_year)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (season_code) DO UPDATE SET
                season_label = EXCLUDED.season_label,
                season_type = EXCLUDED.season_type,
                start_year = EXCLUDED.start_year,
                end_year = EXCLUDED.end_year
            RETURNING season_id
            """,
            (code_val, label, stype, y1, y2),
        )
        season_id[code] = cur.fetchone()[0]
    print(f"  season: {len(season_id)} rows")
    return season_id


def upsert_climate(cur, rows, season_id_map, lat, lon):
    seen = {}
    for r in rows:
        (crop, barangay, month, year, season, phase, rainfall, avgt, mint, maxt,
         hum, pres, solar, ctype, cseason) = r[:15]
        month_no = MONTH_TO_NUM[month.strip().lower()]
        year = int(year)
        key = (season, year, month_no)
        if key not in seen:
            seen[key] = (rainfall, avgt, mint, maxt, hum, pres, solar, ctype, cseason, month)

    climate_id = {}
    for (season, year, month_no), (rainfall, avgt, mint, maxt, hum, pres, solar, ctype, cseason, month) in seen.items():
        cur.execute(
            """
            INSERT INTO climate_record
                (season_id, year, month, month_no, rainfall_mm_day, avg_temp_c,
                 min_temp_c, max_temp_c, humidity_pct, surface_pressure_kpa,
                 solar_rad_mj_m2, climate_type, climate_season, latitude, longitude)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (season_id, year, month_no) DO UPDATE SET
                rainfall_mm_day = EXCLUDED.rainfall_mm_day,
                avg_temp_c = EXCLUDED.avg_temp_c,
                min_temp_c = EXCLUDED.min_temp_c,
                max_temp_c = EXCLUDED.max_temp_c,
                humidity_pct = EXCLUDED.humidity_pct,
                surface_pressure_kpa = EXCLUDED.surface_pressure_kpa,
                solar_rad_mj_m2 = EXCLUDED.solar_rad_mj_m2,
                climate_type = EXCLUDED.climate_type,
                climate_season = EXCLUDED.climate_season,
                latitude = EXCLUDED.latitude,
                longitude = EXCLUDED.longitude
            RETURNING climate_id
            """,
            (season_id_map[season], year, month, month_no, rainfall, avgt, mint, maxt,
             hum, pres, solar, ctype, cseason, lat, lon),
        )
        climate_id[(season, year, month_no)] = cur.fetchone()[0]
    print(f"  climate_record: {len(climate_id)} rows")
    return climate_id


def upsert_planting_techniques(cur, rows, barangay_id_map, crop_id_map):
    """General (season-independent) technique per barangay+crop, derived
    from the Central Data sheet's three technique columns."""
    seen = {}
    for r in rows:
        crop, barangay = r[0], r[1]
        ppt, till, water = r[26], r[27], r[28]
        seen[(barangay, crop)] = (ppt, till, water)

    count = 0
    for (barangay, crop), (ppt, till, water) in seen.items():
        cur.execute(
            """
            INSERT INTO planting_technique
                (barangay_id, crop_type_id, season_type, primary_planting_method, tillage_method, water_management)
            VALUES (%s,%s,NULL,%s,%s,%s)
            ON CONFLICT (barangay_id, crop_type_id, season_type) DO UPDATE SET
                primary_planting_method = EXCLUDED.primary_planting_method,
                tillage_method = EXCLUDED.tillage_method,
                water_management = EXCLUDED.water_management
            """,
            (barangay_id_map[barangay], crop_id_map[crop], ppt, till, water),
        )
        count += 1
    print(f"  planting_technique (general): {count} rows")


def _numeric_avg(text):
    """'4-5 cm' -> 4.5   '15-18 kg/ha' -> 16.5   '2-3 cm' -> 2.5
    Handles en-dash/hyphen ranges; averages every number found so a
    single representative value can be stored in a NUMERIC column,
    while the full original text is preserved elsewhere (row_spacing,
    land_prep_method, special_consideration are TEXT/VARCHAR and keep
    the raw wording)."""
    if not text:
        return None
    nums = re.findall(r"\d+(?:\.\d+)?", text)
    if not nums:
        return None
    nums = [float(n) for n in nums[:2]]  # first one or two numbers = the range
    return sum(nums) / len(nums)


def _split_barangays(cell):
    if not cell:
        return []
    return [p.strip() for p in cell.split(",") if p.strip()]


def _season_type_from_text(text):
    """'DS (Nov-May)\\nIrrigated' -> 'DS'; 'WS (May-Nov)...' -> 'WS';
    'DS & WS ...' -> None (technique applies year-round)."""
    t = text.strip().upper()
    if t.startswith("DS &") or t.startswith("DS&"):
        return None
    if t.startswith("DS"):
        return "DS"
    if t.startswith("WS"):
        return "WS"
    return None


def load_planting_technique_detail_sheet(wb):
    """Parses Section 2 (rice, rows 14-19) and Section 3 (corn, rows 23-27)
    of the 'Planting Techniques' sheet into one record per applicable
    barangay. Also parses Section 4 (rows 31-51) for barangay-level
    irrigation priority."""
    if "Planting Techniques" not in wb.sheetnames:
        return [], [], {}
    ws = wb["Planting Techniques"]

    rice_records = []
    for r in range(14, 20):
        row = [c.value for c in ws[r]]
        if row[0] is None:
            continue
        soil, season_txt, method, land_prep, depth_txt, rate_txt, spacing, water, notes, barangays_txt = row[:10]
        season_type = _season_type_from_text(season_txt)
        for barangay in _split_barangays(barangays_txt):
            rice_records.append({
                "barangay": barangay,
                "season_type": season_type,
                "primary_planting_method": method,
                "tillage_method": None,
                "land_prep_method": land_prep,
                "seed_depth_cm": _numeric_avg(depth_txt),
                "seed_rate_kg_ha": _numeric_avg(rate_txt),
                "row_spacing": spacing,
                "water_management": water,
                "special_consideration": notes,
            })

    corn_records = []
    for r in range(23, 28):
        row = [c.value for c in ws[r]]
        if row[0] is None:
            continue
        soil, season_txt, tillage, depth_txt, spacing, rate_txt, moisture_cond, water, notes, barangays_txt = row[:10]
        season_type = _season_type_from_text(season_txt)
        for barangay in _split_barangays(barangays_txt):
            corn_records.append({
                "barangay": barangay,
                "season_type": season_type,
                "primary_planting_method": tillage,
                "tillage_method": tillage,
                "land_prep_method": moisture_cond,
                "seed_depth_cm": _numeric_avg(depth_txt),
                "seed_rate_kg_ha": _numeric_avg(rate_txt),
                "row_spacing": spacing,
                "water_management": water,
                "special_consideration": notes,
            })

    irrigation_priority = {}
    for r in range(31, 52):
        row = [c.value for c in ws[r]]
        if row[0] is None:
            continue
        barangay, priority = row[0], row[7]
        irrigation_priority[barangay] = priority

    return rice_records, corn_records, irrigation_priority


def upsert_detailed_planting_techniques(cur, records, crop_name, barangay_id_map, crop_id_map):
    count = 0
    for rec in records:
        cur.execute(
            """
            INSERT INTO planting_technique
                (barangay_id, crop_type_id, season_type, primary_planting_method,
                 tillage_method, water_management, seed_depth_cm, row_spacing,
                 seed_rate_kg_ha, land_prep_method, special_consideration)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (barangay_id, crop_type_id, season_type) DO UPDATE SET
                primary_planting_method = EXCLUDED.primary_planting_method,
                tillage_method = COALESCE(EXCLUDED.tillage_method, planting_technique.tillage_method),
                water_management = EXCLUDED.water_management,
                seed_depth_cm = EXCLUDED.seed_depth_cm,
                row_spacing = EXCLUDED.row_spacing,
                seed_rate_kg_ha = EXCLUDED.seed_rate_kg_ha,
                land_prep_method = EXCLUDED.land_prep_method,
                special_consideration = EXCLUDED.special_consideration
            """,
            (barangay_id_map[rec["barangay"]], crop_id_map[crop_name], rec["season_type"],
             rec["primary_planting_method"], rec["tillage_method"], rec["water_management"],
             rec["seed_depth_cm"], rec["row_spacing"], rec["seed_rate_kg_ha"],
             rec["land_prep_method"], rec["special_consideration"]),
        )
        count += 1
    print(f"  planting_technique ({crop_name}, season-specific): {count} rows")


def update_irrigation_priority(cur, irrigation_priority, barangay_id_map):
    count = 0
    for barangay, priority in irrigation_priority.items():
        if barangay not in barangay_id_map or not priority:
            continue
        cur.execute(
            "UPDATE barangay SET irrigation_priority = %s WHERE barangay_id = %s",
            (priority, barangay_id_map[barangay]),
        )
        count += 1
    print(f"  barangay.irrigation_priority: {count} rows updated")


def upsert_production_records(cur, rows, barangay_id_map, crop_id_map, season_id_map, climate_id_map):
    planting_production_id = {}  # (barangay,crop,season) -> production_id, for Planting-phase rows only
    count = 0
    for r in rows:
        (crop, barangay, month, year, season, phase, *_rest) = r
        irrigated, rainfed, total_planted, harvested, production, yield_ = r[20:26]
        month_no = MONTH_TO_NUM[month.strip().lower()]
        c_id = climate_id_map.get((season, int(year), month_no))

        cur.execute(
            """
            INSERT INTO production_record
                (barangay_id, crop_type_id, season_id, climate_id, farm_id,
                 year, month, phase, irrigated_area_ha, rainfed_area_ha,
                 total_area_planted_ha, area_harvested_ha, production_mt, yield_mt_ha)
            VALUES (%s,%s,%s,%s,NULL,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (barangay_id, crop_type_id, season_id, phase)
                WHERE farm_id IS NULL
            DO UPDATE SET
                climate_id = EXCLUDED.climate_id,
                year = EXCLUDED.year,
                month = EXCLUDED.month,
                irrigated_area_ha = EXCLUDED.irrigated_area_ha,
                rainfed_area_ha = EXCLUDED.rainfed_area_ha,
                total_area_planted_ha = EXCLUDED.total_area_planted_ha,
                area_harvested_ha = EXCLUDED.area_harvested_ha,
                production_mt = EXCLUDED.production_mt,
                yield_mt_ha = EXCLUDED.yield_mt_ha
            RETURNING production_id
            """,
            (barangay_id_map[barangay], crop_id_map[crop], season_id_map[season], c_id,
             year, month, phase, irrigated, rainfed, total_planted, harvested, production, yield_),
        )
        pid = cur.fetchone()[0]
        if phase == "Planting":
            planting_production_id[(barangay, crop, season)] = pid
        count += 1
    print(f"  production_record: {count} rows upserted")
    return planting_production_id


def load_crop_features_sheet(wb, central_rows):
    """Reads the "Crop Features" sheet, supporting two workbook layouts:

    - v1 (binalonan_crop_data2.xlsx and earlier): 33 columns, row[0] is
      "Crop Type". Planting month/year and several engineered ratios
      (irrigated/rainfed ratio, water availability, temperature range,
      heat stress index, humidity/solar-temperature interactions) are
      columns on the sheet itself.
    - v2 (binalonan_crop_data4.xlsx and later): 42 columns, row[0] is
      "Record_ID". Restructured with new reserved columns (soil pH,
      organic matter, texture, drainage, seedlings/fertilizer/
      pesticide/herbicide, and every "_Ratio"/"_Interaction"/"Quarter"/
      "Semester" derived stat) — all empty in this revision, so they're
      read as None rather than guessed. It also dropped the explicit
      Planting Month/Year columns entirely (only an empty "Planting
      Month Number" placeholder remains), so those are backfilled here
      from the Planting-phase row of the same (barangay, crop, season)
      in Central Data — every Crop Features row matches one.
    """
    if "Crop Features" not in wb.sheetnames:
        return []
    ws = wb["Crop Features"]
    is_v2 = ws.cell(row=1, column=1).value == "Record_ID"

    planting_my = {}
    if is_v2:
        for r in central_rows:
            crop, barangay, month, year, season, phase = r[0], r[1], r[2], r[3], r[4], r[5]
            if phase == "Planting":
                planting_my[(barangay, crop, season)] = (month, year)

    records = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if is_v2:
            if row[1] is None:
                continue
            crop, barangay, season = row[1], row[2], row[3]
            total_planted, irrigated_area, rainfed_area = row[5], row[6], row[7]
            yield_mt_ha = row[41]
            key = (barangay, crop, season)
            if key not in planting_my:
                print(f"  WARNING: crop_features row for {key} has no matching Central Data "
                      f"Planting entry — skipped (planting_month/year are required).")
                continue
            planting_month, planting_year = planting_my[key]
            yield_imputed = False
            irrigated_ratio = rainfed_ratio = water_avail = None
            temp_range = heat_stress = humidity_temp = solar_temp = None
        else:
            if row[0] is None:
                continue
            (crop, barangay, season, planting_month, planting_year, *_climate_cols) = row[:5]
            (irrigated_area, rainfed_area, total_planted, _ppt, _till, _water,
             yield_mt_ha, yield_imputed_raw, irrigated_ratio, rainfed_ratio, water_avail,
             temp_range, heat_stress, humidity_temp, solar_temp) = row[18:33]
            yield_imputed = str(yield_imputed_raw).strip().lower() == "yes"

        records.append({
            "crop": crop, "barangay": barangay, "season": season,
            "planting_month": planting_month, "planting_year": int(planting_year),
            "total_area_planted_ha": total_planted,
            "irrigated_area_ha": irrigated_area, "rainfed_area_ha": rainfed_area,
            "yield_mt_ha": yield_mt_ha, "yield_imputed": yield_imputed,
            "irrigated_ratio": irrigated_ratio, "rainfed_ratio": rainfed_ratio,
            "water_availability": water_avail, "temperature_range": temp_range,
            "heat_stress_index": heat_stress, "humidity_temp_interaction": humidity_temp,
            "solar_temp_interaction": solar_temp,
        })
    return records


def upsert_crop_features(cur, records, barangay_id_map, crop_id_map, season_id_map, climate_id_map, planting_production_id):
    count = 0
    for rec in records:
        month_no = MONTH_TO_NUM[rec["planting_month"].strip().lower()]
        climate_id = climate_id_map.get((rec["season"], rec["planting_year"], month_no))
        production_id = planting_production_id.get((rec["barangay"], rec["crop"], rec["season"]))
        cur.execute(
            """
            INSERT INTO crop_features
                (barangay_id, crop_type_id, season_id, climate_id, production_id,
                 planting_month, planting_year, total_area_planted_ha, irrigated_area_ha,
                 rainfed_area_ha, yield_mt_ha, yield_imputed, irrigated_ratio, rainfed_ratio,
                 water_availability, temperature_range, heat_stress_index,
                 humidity_temp_interaction, solar_temp_interaction)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (barangay_id, crop_type_id, season_id) DO UPDATE SET
                climate_id = EXCLUDED.climate_id,
                production_id = EXCLUDED.production_id,
                planting_month = EXCLUDED.planting_month,
                planting_year = EXCLUDED.planting_year,
                total_area_planted_ha = EXCLUDED.total_area_planted_ha,
                irrigated_area_ha = EXCLUDED.irrigated_area_ha,
                rainfed_area_ha = EXCLUDED.rainfed_area_ha,
                yield_mt_ha = EXCLUDED.yield_mt_ha,
                yield_imputed = EXCLUDED.yield_imputed,
                irrigated_ratio = EXCLUDED.irrigated_ratio,
                rainfed_ratio = EXCLUDED.rainfed_ratio,
                water_availability = EXCLUDED.water_availability,
                temperature_range = EXCLUDED.temperature_range,
                heat_stress_index = EXCLUDED.heat_stress_index,
                humidity_temp_interaction = EXCLUDED.humidity_temp_interaction,
                solar_temp_interaction = EXCLUDED.solar_temp_interaction
            """,
            (barangay_id_map[rec["barangay"]], crop_id_map[rec["crop"]], season_id_map[rec["season"]],
             climate_id, production_id, rec["planting_month"], rec["planting_year"],
             rec["total_area_planted_ha"], rec["irrigated_area_ha"], rec["rainfed_area_ha"],
             rec["yield_mt_ha"], rec["yield_imputed"], rec["irrigated_ratio"], rec["rainfed_ratio"],
             rec["water_availability"], rec["temperature_range"], rec["heat_stress_index"],
             rec["humidity_temp_interaction"], rec["solar_temp_interaction"]),
        )
        count += 1
    print(f"  crop_features: {count} rows upserted")


def load_crop_varieties_sheet(wb):
    if "Crop Varieties" not in wb.sheetnames:
        return []
    ws = wb["Crop Varieties"]
    records = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        if row[0] is None:
            continue
        (source_code, nsic_code, crop, variety_id_unused, variety_name, category,
         avg_yield, max_yield, maturity_days, ecosystem, grain_type,
         drought_tol, flood_tol, disease_res, source) = row[:15]
        records.append({
            "crop": crop, "source_variety_code": source_code, "nsic_code": nsic_code,
            "variety_name": variety_name, "category": category,
            "average_yield_t_ha": avg_yield, "maximum_yield_t_ha": max_yield,
            "maturity_days": maturity_days, "recommended_ecosystem": ecosystem,
            "grain_type": grain_type, "drought_tolerance": drought_tol,
            "flood_tolerance": flood_tol, "disease_resistance": disease_res,
            "source": source,
        })
    return records


def upsert_crop_varieties(cur, records, crop_id_map):
    count = 0
    for rec in records:
        crop_type_id = crop_id_map.get(rec["crop"])
        if crop_type_id is None:
            print(f"  WARNING: crop variety {rec['variety_name']!r} references unknown crop "
                  f"{rec['crop']!r} — skipped.")
            continue
        cur.execute(
            """
            INSERT INTO crop_variety
                (crop_type_id, source_variety_code, nsic_code, variety_name, category,
                 average_yield_t_ha, maximum_yield_t_ha, maturity_days, recommended_ecosystem,
                 grain_type, drought_tolerance, flood_tolerance, disease_resistance, source)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (crop_type_id, variety_name) DO UPDATE SET
                source_variety_code = EXCLUDED.source_variety_code,
                nsic_code = EXCLUDED.nsic_code,
                category = EXCLUDED.category,
                average_yield_t_ha = EXCLUDED.average_yield_t_ha,
                maximum_yield_t_ha = EXCLUDED.maximum_yield_t_ha,
                maturity_days = EXCLUDED.maturity_days,
                recommended_ecosystem = EXCLUDED.recommended_ecosystem,
                grain_type = EXCLUDED.grain_type,
                drought_tolerance = EXCLUDED.drought_tolerance,
                flood_tolerance = EXCLUDED.flood_tolerance,
                disease_resistance = EXCLUDED.disease_resistance,
                source = EXCLUDED.source
            """,
            (crop_type_id, rec["source_variety_code"], rec["nsic_code"], rec["variety_name"],
             rec["category"], rec["average_yield_t_ha"], rec["maximum_yield_t_ha"],
             rec["maturity_days"], rec["recommended_ecosystem"], rec["grain_type"],
             rec["drought_tolerance"], rec["flood_tolerance"], rec["disease_resistance"],
             rec["source"]),
        )
        count += 1
    print(f"  crop_variety: {count} rows upserted")


def main():
    ap = argparse.ArgumentParser(description="Load Binalonan crop dataset into YieldShield DB")
    ap.add_argument("--xlsx", required=True, help="Path to binalonan_crop_data workbook")
    ap.add_argument("--dry-run", action="store_true", help="Parse and validate only; no DB writes")
    args = ap.parse_args()

    rows, lat, lon, wb = load_workbook(args.xlsx)

    if args.dry_run:
        print("Dry run complete — parsed OK, no database connection made.")
        return

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            print("Loading reference and historical data ...")
            crop_id_map = upsert_crop_types(cur, rows)
            barangay_id_map = upsert_barangays(cur, rows)
            season_id_map = upsert_seasons(cur, rows)
            climate_id_map = upsert_climate(cur, rows, season_id_map, lat, lon)
            upsert_planting_techniques(cur, rows, barangay_id_map, crop_id_map)
            planting_production_id = upsert_production_records(cur, rows, barangay_id_map, crop_id_map, season_id_map, climate_id_map)

            print("Loading detailed season-specific planting techniques ...")
            rice_records, corn_records, irrigation_priority = load_planting_technique_detail_sheet(wb)
            upsert_detailed_planting_techniques(cur, rice_records, "Palay", barangay_id_map, crop_id_map)
            upsert_detailed_planting_techniques(cur, corn_records, "Corn", barangay_id_map, crop_id_map)
            update_irrigation_priority(cur, irrigation_priority, barangay_id_map)

            print("Loading engineered crop features (model training data) ...")
            feature_records = load_crop_features_sheet(wb, rows)
            if feature_records:
                upsert_crop_features(cur, feature_records, barangay_id_map, crop_id_map, season_id_map,
                                      climate_id_map, planting_production_id)
            else:
                print("  crop_features: sheet not present in this workbook, skipped")

            print("Loading crop variety reference catalog ...")
            variety_records = load_crop_varieties_sheet(wb)
            if variety_records:
                upsert_crop_varieties(cur, variety_records, crop_id_map)
            else:
                print("  crop_variety: sheet not present in this workbook, skipped")
        conn.commit()
        print(f"Done at {datetime.now().isoformat(timespec='seconds')} — all changes committed.")
    except Exception:
        conn.rollback()
        print("Error occurred — transaction rolled back.", file=sys.stderr)
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
