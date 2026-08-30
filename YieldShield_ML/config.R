# ============================================================
# config.R
# Central configuration for the YieldShield yield-prediction
# pipeline. Every script in scripts/ sources this file first,
# so this is the ONE place to change paths, column roles, or
# training settings.
# ============================================================

# --- Project root ---------------------------------------------------------
# All paths below are relative to the YieldShield_ML/ project root.
# Run scripts with the working directory set to the project root, e.g.:
#   setwd("path/to/YieldShield_ML")
#   source("run_pipeline.R")
# or, per-script, from a terminal already `cd`'d into the project root:
#   Rscript scripts/01_data_audit.R
PROJECT_ROOT <- getwd()

# --- Directories -----------------------------------------------------------
DATA_DIR    <- file.path(PROJECT_ROOT, "data")
MODELS_DIR  <- file.path(PROJECT_ROOT, "models")
REPORTS_DIR <- file.path(PROJECT_ROOT, "reports")
OUTPUTS_DIR <- file.path(PROJECT_ROOT, "outputs")

dir.create(DATA_DIR,    showWarnings = FALSE, recursive = TRUE)
dir.create(MODELS_DIR,  showWarnings = FALSE, recursive = TRUE)
dir.create(REPORTS_DIR, showWarnings = FALSE, recursive = TRUE)
dir.create(OUTPUTS_DIR, showWarnings = FALSE, recursive = TRUE)

# --- Source data -------------------------------------------------------------
RAW_XLSX_PATH  <- file.path(DATA_DIR, "binalonan_crop_data.xlsx")
RAW_SHEET_NAME <- "Crop Features"

# --- Intermediate hand-off files (pipeline state passed between scripts) ----
# Keeping these on disk (instead of only in memory) means any single
# script in scripts/ can be re-run on its own during development,
# without re-running everything upstream of it.
AUDITED_RDS  <- file.path(DATA_DIR, "01_audited.rds")
PREPARED_RDS <- file.path(DATA_DIR, "02_prepared.rds")
FEATURES_RDS <- file.path(DATA_DIR, "03_features.rds")
SELECTED_RDS <- file.path(DATA_DIR, "05_model_ready.rds")

# --- Reproducibility ----------------------------------------------------------
SEED <- 42

# --- Train / test split --------------------------------------------------------
TRAIN_FRACTION <- 0.8

# --- Cross-validation control ---------------------------------------------------
CV_METHOD  <- "repeatedcv"
CV_FOLDS   <- 5
CV_REPEATS <- 3

# --- Column roles ------------------------------------------------------------
TARGET_COL <- "yield_mt_ha"

# NOTE: matched to the "Crop Features" sheet of binalonan_crop_data4.xlsx
# AND constrained to what yieldshield.crop_features / climate_record
# actually persist in the live system (see backend/migrations/01_schema.sql).
# planting_month / terrain_type / elevation aren't populated columns in
# this sheet. rain_temp / pressure_temp / water_deficit ARE real headers
# in the sheet but the DB schema has no columns for them and
# INTEGRATION_NOTES.md confirms they're "simply not read" anywhere in the
# live system - so they're excluded here too, rather than training the
# model on three features the backend can never actually supply at
# prediction time.
CATEGORICAL_COLS <- c(
  "crop_type", "barangay", "soil_type", "season_type"
)

# humidity_temp / solar_temp are named to match yieldshield.crop_features'
# humidity_temp_interaction / solar_temp_interaction columns (renamed on
# the Python-serving side, not here - see EXCLUDED_COLS note below and
# scripts/10_export_serving_artifacts.R).
NUMERIC_COLS <- c(
  "rainfall", "avg_temp", "min_temp", "max_temp", "humidity",
  "surface_pressure", "solar_rad", "land_size_ha",
  "irrigated_area_ha", "rainfed_area_ha", "total_area_planted_ha",
  "irrigated_ratio", "rainfed_ratio", "water_availability",
  "temperature_range", "heat_stress_index",
  "humidity_temp", "solar_temp"
)

# Columns intentionally excluded from modeling, and why (kept here so the
# reasoning travels with the code, not just in a comment on someone's laptop):
#  - record_id                     -> row identifier, not a predictor (and is
#                                      entirely blank in this extract anyway)
#  - soil_ph / organic_matter / soil_texture / soil_drainage /
#    seedlings_planted / fertilizer_applied / pesticide_applied /
#    herbicide_applied / planting_month_number / planting_quarter /
#    planting_semester / crop_duration_months
#                                  -> present as column headers but 100% empty
#                                     in this extract (placeholders for future
#                                     data collection); re-add once populated
#  - tillage_method / water_management / primary_planting_technique
#                                  -> free-text, near-deterministic functions
#                                     of crop_type + barangay + soil_type;
#                                     dropping them keeps the dummy-variable
#                                     count sane for a ~460-row dataset
#  - rain_temp / pressure_temp / water_deficit
#                                  -> real headers in the sheet, but not
#                                     persisted anywhere in yieldshield's
#                                     schema (crop_features has no columns
#                                     for them) and not derivable from any
#                                     validated formula - training on them
#                                     would make the model depend on inputs
#                                     the live backend can never supply
EXCLUDED_COLS <- c(
  "record_id", "soil_ph", "organic_matter", "soil_texture", "soil_drainage",
  "seedlings_planted", "fertilizer_applied", "pesticide_applied",
  "herbicide_applied", "planting_month_number", "planting_quarter",
  "planting_semester", "crop_duration_months",
  "tillage_method", "water_management", "primary_planting_technique",
  "rain_temp", "pressure_temp", "water_deficit"
)

# --- Model artifact paths -----------------------------------------------------
RF_MODEL_PATH    <- file.path(MODELS_DIR, "random_forest_model.rds")
XGB_MODEL_PATH   <- file.path(MODELS_DIR, "xgboost_model.rds")
BEST_MODEL_PATH  <- file.path(MODELS_DIR, "best_model.rds")
PREPROCESS_PATH  <- file.path(MODELS_DIR, "preProcess.rds")
