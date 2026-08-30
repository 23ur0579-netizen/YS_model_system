# ============================================================
# 02_data_preparation.R
# Clean the audited data: drop exact duplicate rows, impute the
# handful of genuinely-missing fields. Produces
# reports/Data_Preparation_Report.xlsx and hands the prepared
# table to the feature-engineering step.
#
# Run from the project root:  source("scripts/02_data_preparation.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages(library(dplyr))

cat("[02] Loading audited data...\n")
raw <- readRDS(AUDITED_RDS)

before_missing <- sapply(raw, function(x) sum(is.na(x)))
before_rows <- nrow(raw)

prepared <- raw |>
  distinct() |>
  mutate(
    # Missing irrigated/rainfed area = genuinely not applicable -> 0,
    # matching how irrigated_ratio/rainfed_ratio were already computed
    irrigated_area_ha = ifelse(is.na(irrigated_area_ha), 0, irrigated_area_ha),
    rainfed_area_ha    = ifelse(is.na(rainfed_area_ha), 0, rainfed_area_ha),
    # The most recent season (DS 2024-2025) hasn't caught up with a full
    # NASA POWER extract yet, so it has no pressure/solar reading -
    # median-impute rather than drop the row
    surface_pressure = ifelse(is.na(surface_pressure),
                               median(surface_pressure, na.rm = TRUE), surface_pressure),
    solar_rad         = ifelse(is.na(solar_rad),
                               median(solar_rad, na.rm = TRUE), solar_rad)
  )

after_missing <- sapply(prepared, function(x) sum(is.na(x)))
after_rows <- nrow(prepared)

imputation_summary <- data.frame(
  column          = names(before_missing),
  missing_before  = as.integer(before_missing),
  missing_after   = as.integer(after_missing[names(before_missing)])
) |> filter(missing_before > 0)

row_summary <- data.frame(
  rows_before             = before_rows,
  rows_after              = after_rows,
  duplicate_rows_removed  = before_rows - after_rows
)

write_xlsx_report(
  list(
    Row_Summary        = row_summary,
    Imputation_Summary = imputation_summary
  ),
  file.path(REPORTS_DIR, "Data_Preparation_Report.xlsx")
)

saveRDS(prepared, PREPARED_RDS)
cat("[02] Saved reports/Data_Preparation_Report.xlsx and", PREPARED_RDS, "\n")
