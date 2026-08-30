# ============================================================
# 03_feature_engineering.R
# Derive engineered features: season_type from season_period, plus
# the interaction/index/ratio columns that yieldshield.crop_features
# actually has columns for (Temperature_Range, Heat_Stress_Index,
# Humidity_Temp, Solar_Temp, Irrigated_Ratio, Rainfed_Ratio,
# Water_Availability). These exist as column headers in the source
# workbook but are NOT populated in this extract, so this script is
# the actual place they get computed (the ifelse(is.na(...)) guards
# just mean a future extract that DOES arrive pre-computed won't be
# clobbered).
#
# NOTE: the source sheet also has Rain_Temp / Pressure_Temp /
# Water_Deficit headers, but yieldshield.crop_features has no columns
# for them and INTEGRATION_NOTES.md confirms they're not read anywhere
# in the live system - so they're deliberately NOT computed here. See
# EXCLUDED_COLS in config.R.
#
# IMPORTANT: Heat_Stress_Index has no standard, universally-agreed
# formula and none was supplied with this dataset, so the one below is
# a simple, clearly-labeled heuristic - swap it for a validated
# agronomic formula if your team has one.
#
# Produces reports/Feature_Engineering_Report.xlsx.
#
# Run from the project root:  source("scripts/03_feature_engineering.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages(library(dplyr))

cat("[03] Loading prepared data...\n")
prepared <- readRDS(PREPARED_RDS)

features <- prepared |>
  mutate(
    # DS / WS pulled out of "DS 2020-2021" style season labels
    season_type = substr(season_period, 1, 2),

    temperature_range = ifelse(is.na(temperature_range),
                                max_temp - min_temp, temperature_range),

    # Irrigated/rainfed area is only tracked for Palay (Corn rows have both
    # imputed to 0 in 02_data_preparation.R), so these ratios come out 0/0
    # -> 0 for Corn. That's a real limitation of this extract, not a bug -
    # it means "no irrigation/rainfed split reported" rather than "no water".
    irrigated_ratio = ifelse(is.na(irrigated_ratio),
                              ifelse(total_area_planted_ha > 0,
                                     irrigated_area_ha / total_area_planted_ha, 0),
                              irrigated_ratio),
    rainfed_ratio    = ifelse(is.na(rainfed_ratio),
                              ifelse(total_area_planted_ha > 0,
                                     rainfed_area_ha / total_area_planted_ha, 0),
                              rainfed_ratio),

    # Heuristic heat-stress proxy: temperature scaled up when humidity is
    # high (humid heat feels/stresses more than dry heat of the same temp).
    heat_stress_index = ifelse(is.na(heat_stress_index),
                                avg_temp * humidity / 100, heat_stress_index),

    # Simple pairwise interaction terms with average temperature - named to
    # match yieldshield.crop_features.humidity_temp_interaction /
    # solar_temp_interaction (renamed on export, see script 10).
    humidity_temp = ifelse(is.na(humidity_temp), humidity * avg_temp, humidity_temp),
    solar_temp     = ifelse(is.na(solar_temp), solar_rad * avg_temp, solar_temp),

    # Heuristic combined water-supply score: rainfall discounted by the
    # rainfed share (less reliable than irrigation) plus a flat bonus for
    # irrigated share.
    water_availability = ifelse(is.na(water_availability),
                                rainfall * (1 - rainfed_ratio) + irrigated_ratio * 100,
                                water_availability)
  )

engineered_cols <- c(
  "season_type", "temperature_range", "irrigated_ratio", "rainfed_ratio",
  "heat_stress_index", "humidity_temp", "solar_temp", "water_availability"
)

feature_definitions <- data.frame(
  feature = engineered_cols,
  definition = c(
    "First 2 characters of season_period (e.g. 'DS' / 'WS')",
    "max_temp - min_temp",
    "irrigated_area_ha / total_area_planted_ha  [0 for Corn rows - not tracked]",
    "rainfed_area_ha / total_area_planted_ha  [0 for Corn rows - not tracked]",
    "avg_temp * humidity / 100  [heuristic - not a validated heat index]",
    "humidity * avg_temp",
    "solar_rad * avg_temp",
    "rainfall * (1 - rainfed_ratio) + irrigated_ratio * 100  [heuristic]"
  )
)

season_type_counts <- features |> count(season_type, name = "n_rows")

write_xlsx_report(
  list(
    Feature_Definitions = feature_definitions,
    Season_Type_Counts  = season_type_counts
  ),
  file.path(REPORTS_DIR, "Feature_Engineering_Report.xlsx")
)

saveRDS(features, FEATURES_RDS)
cat("[03] Saved reports/Feature_Engineering_Report.xlsx and", FEATURES_RDS, "\n")
