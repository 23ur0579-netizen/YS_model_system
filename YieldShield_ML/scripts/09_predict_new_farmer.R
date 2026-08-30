# ============================================================
# 09_predict_new_farmer.R
# Score new farmer submission(s) using the saved best model +
# preprocessing artifacts (predict_new_data(), defined in utils.R).
# This is the script the YieldShield backend's prediction endpoint
# mirrors (or calls into, via Rscript / plumber) when a farmer
# submits a new FarmInputRequest.
#
# Run from the project root:  source("scripts/09_predict_new_farmer.R")
# ============================================================

source("config.R")
source("utils.R")

cat("[09] Scoring new farmer submission(s)...\n")

# --- Option A: a hand-built example row -------------------------------------
# IMPORTANT SCALE NOTE: this model is trained on barangay + crop + season
# aggregates (land_size_ha / total_area_planted_ha run into the hundreds of
# hectares - the whole barangay's planted area for that crop/season, not one
# farmer's plot). A "new farmer submission" is really "a new barangay +
# crop + season scenario". If YieldShield needs true per-farmer-plot
# predictions, the training data would need to be collected at that grain
# instead - flag this to the team before wiring up a farmer-facing endpoint.
#
# Replace these values with a real request payload from the YieldShield
# backend (crop_type, barangay, soil_type, season_type + the weather/land
# numeric fields below - see CATEGORICAL_COLS / NUMERIC_COLS in config.R
# for the authoritative field list).
example_farmer <- data.frame(
  crop_type              = "Palay",
  barangay                = "San Pablo",
  soil_type                = "Silty Clay Loam",
  season_type                = "WS",
  rainfall                    = 12.5,
  avg_temp                     = 26.8,
  min_temp                      = 21.3,
  max_temp                       = 32.6,
  humidity                        = 82.5,
  surface_pressure                 = 98.4,
  solar_rad                         = 17.6,
  land_size_ha                       = 250,
  total_area_planted_ha               = 55,
  irrigated_area_ha                    = 35,
  rainfed_area_ha                       = 20,
  irrigated_ratio                        = 35 / 55,
  rainfed_ratio                           = 20 / 55,
  temperature_range                        = 32.6 - 21.3,
  heat_stress_index                         = 26.8 * 82.5 / 100,
  humidity_temp                              = 82.5 * 26.8,
  solar_temp                                  = 17.6 * 26.8,
  water_availability                            = 12.5 * (1 - 20 / 55) + (35 / 55) * 100,
  stringsAsFactors = FALSE
)

# --- Option B: score a CSV of new submissions instead ------------------------
# Drop a file at data/new_farmer_submissions.csv with the same columns as
# `example_farmer` above and this script will use it automatically.
NEW_FARMER_CSV <- file.path(DATA_DIR, "new_farmer_submissions.csv")
if (file.exists(NEW_FARMER_CSV)) {
  cat("[09] Found", NEW_FARMER_CSV, "- scoring that file instead of the example row.\n")
  new_data <- read.csv(NEW_FARMER_CSV, stringsAsFactors = FALSE)
} else {
  new_data <- example_farmer
}

predicted_yield <- predict_new_data(new_data)

prediction_output <- cbind(new_data, predicted_yield_mt_ha = round(predicted_yield, 3))

write.csv(prediction_output, file.path(OUTPUTS_DIR, "Prediction_Output.csv"), row.names = FALSE)

cat("[09] Predicted yield (MT/ha):\n")
print(round(predicted_yield, 3))
cat("[09] Saved outputs/Prediction_Output.csv\n")
