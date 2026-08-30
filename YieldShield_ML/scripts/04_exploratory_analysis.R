# ============================================================
# 04_exploratory_analysis.R
# Summary statistics, correlation of numeric predictors with the
# target, and yield breakdowns by crop/barangay. Purely descriptive
# - does not feed data back into the pipeline, only into
# reports/EDA_Report.xlsx.
#
# Run from the project root:  source("scripts/04_exploratory_analysis.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages({
  library(dplyr)
  library(tidyr)
})

cat("[04] Loading engineered features...\n")
features <- readRDS(FEATURES_RDS)

numeric_present <- intersect(NUMERIC_COLS, names(features))

summary_stats <- features |>
  select(all_of(c(numeric_present, TARGET_COL))) |>
  summarise(across(everything(), list(
    mean = ~mean(.x, na.rm = TRUE),
    sd   = ~sd(.x, na.rm = TRUE),
    min  = ~min(.x, na.rm = TRUE),
    max  = ~max(.x, na.rm = TRUE)
  ), .names = "{.col}__{.fn}")) |>
  pivot_longer(everything(), names_to = "metric", values_to = "value") |>
  separate(metric, into = c("column", "stat"), sep = "__") |>
  pivot_wider(names_from = stat, values_from = value)

correlations <- data.frame(
  column = numeric_present,
  correlation_with_yield = sapply(numeric_present, function(col) {
    suppressWarnings(cor(features[[col]], features[[TARGET_COL]], use = "complete.obs"))
  })
) |> arrange(desc(abs(correlation_with_yield)))

yield_by_crop <- features |>
  group_by(crop_type) |>
  summarise(mean_yield = mean(.data[[TARGET_COL]], na.rm = TRUE),
            n = n(), .groups = "drop") |>
  arrange(desc(mean_yield))

yield_by_barangay <- features |>
  group_by(barangay) |>
  summarise(mean_yield = mean(.data[[TARGET_COL]], na.rm = TRUE),
            n = n(), .groups = "drop") |>
  arrange(desc(mean_yield))

write_xlsx_report(
  list(
    Summary_Stats     = summary_stats,
    Correlations      = correlations,
    Yield_By_Crop     = yield_by_crop,
    Yield_By_Barangay = yield_by_barangay
  ),
  file.path(REPORTS_DIR, "EDA_Report.xlsx")
)

cat("[04] Saved reports/EDA_Report.xlsx\n")
