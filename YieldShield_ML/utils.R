# ============================================================
# utils.R
# Shared helper functions used across the scripts/ pipeline.
# Source this AFTER config.R (some functions rely on config
# constants like BEST_MODEL_PATH / PREPROCESS_PATH as defaults).
# ============================================================

suppressPackageStartupMessages({
  library(dplyr)
})

# ---------------------------------------------------------------
# clean_col_names(): snake_case, ASCII-safe column names.
# ---------------------------------------------------------------
clean_col_names <- function(df) {
  names(df) <- names(df) |>
    trimws() |>
    gsub("[^A-Za-z0-9]+", "_", x = _) |>
    gsub("_+$", "", x = _) |>
    tolower()
  df
}

# ---------------------------------------------------------------
# load_raw_crop_data(): read the "Crop Features" sheet and apply
# the column clean-up / renaming used throughout the pipeline.
# ---------------------------------------------------------------
load_raw_crop_data <- function(path = RAW_XLSX_PATH, sheet = RAW_SHEET_NAME) {
  raw <- readxl::read_excel(path, sheet = sheet)
  raw <- clean_col_names(raw)

  # Only rename columns whose cleaned name differs from the short,
  # stable handle used by the rest of the pipeline. (Humidity_Temp,
  # Solar_Temp, Rain_Temp, Pressure_Temp, Temperature_Range,
  # Heat_Stress_Index, Irrigated_Ratio, Rainfed_Ratio, Water_Availability,
  # and Water_Deficit all already clean to the exact handle names used
  # downstream, so they don't need an entry here.)
  rename_map <- c(
    rainfall           = "planting_rainfall_mm_day",
    avg_temp            = "planting_avg_temp_c",
    min_temp             = "planting_min_temp_c",
    max_temp              = "planting_max_temp_c",
    humidity               = "planting_humidity",
    surface_pressure        = "planting_surface_pressure_kpa",
    solar_rad                = "planting_solar_rad_mj_m_day"
  )
  rename_map <- rename_map[rename_map %in% names(raw)]
  if (length(rename_map) > 0) {
    raw <- dplyr::rename(raw, !!!rename_map)
  }

  raw
}

# ---------------------------------------------------------------
# write_xlsx_report(): write a named list of data.frames to a
# multi-sheet workbook. Each list name becomes a sheet name.
# ---------------------------------------------------------------
write_xlsx_report <- function(sheet_list, path) {
  if (!requireNamespace("openxlsx", quietly = TRUE)) {
    stop("Package 'openxlsx' is required to write report workbooks. ",
         "Install it with install.packages('openxlsx').")
  }
  wb <- openxlsx::createWorkbook()
  for (nm in names(sheet_list)) {
    sheet_nm <- substr(nm, 1, 31)  # Excel sheet-name length cap
    openxlsx::addWorksheet(wb, sheet_nm)
    openxlsx::writeData(wb, sheet_nm, sheet_list[[nm]])
  }
  openxlsx::saveWorkbook(wb, path, overwrite = TRUE)
  invisible(path)
}

# ---------------------------------------------------------------
# evaluate_regression(): standard regression metrics as a 1-row
# data.frame, so results from different models stack with rbind().
# ---------------------------------------------------------------
evaluate_regression <- function(actual, predicted) {
  data.frame(
    mae       = Metrics::mae(actual, predicted),
    mse       = Metrics::mse(actual, predicted),
    rmse      = Metrics::rmse(actual, predicted),
    r_squared = suppressWarnings(cor(actual, predicted)^2)
  )
}

# ---------------------------------------------------------------
# predict_new_data(): score new farmer submissions with the saved
# best model + preprocessing artifacts. This is the single function
# the rest of the YieldShield backend should call.
#
# new_data: a data.frame (1+ rows) with the same raw columns as the
#           engineered feature table - see CATEGORICAL_COLS /
#           NUMERIC_COLS in config.R for the exact field list.
# ---------------------------------------------------------------
predict_new_data <- function(new_data,
                              model_path = BEST_MODEL_PATH,
                              preprocess_path = PREPROCESS_PATH) {
  art  <- readRDS(model_path)
  prep <- readRDS(preprocess_path)

  for (col in art$categorical_cols) {
    new_data[[col]] <- factor(new_data[[col]])
  }

  # dummyVars was fit on a formula that included the target column, so
  # predict.dummyVars() expects it to exist in newdata too. Its value is
  # irrelevant here - it's discarded before modeling - so a placeholder is fine.
  if (!(TARGET_COL %in% names(new_data))) {
    new_data[[TARGET_COL]] <- NA_real_
  }

  x <- predict(prep$dummies, newdata = new_data) |> as.data.frame()

  # Any dummy column seen in training but absent in this new row
  # (e.g. a crop/barangay level that doesn't appear in the submission)
  # is filled with 0 rather than dropped, so the matrix always lines
  # up with what the model was trained on.
  missing_cols <- setdiff(prep$feature_names, names(x))
  for (col in missing_cols) x[[col]] <- 0
  x <- x[, prep$feature_names, drop = FALSE]

  if (isTRUE(art$use_scaled)) x <- predict(prep$pre_proc, x)

  if (inherits(art$model, "xgb.Booster")) {
    as.numeric(predict(art$model, as.matrix(x)))
  } else {
    as.numeric(predict(art$model, newdata = x))
  }
}
