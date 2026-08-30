# ============================================================
# 01_data_audit.R
# Load the raw "Crop Features" sheet and audit it: structure,
# missing values, duplicates, column types, and cardinality of
# categorical columns. Produces reports/Data_Audit_Report.xlsx
# and hands the cleaned-but-unmodified raw table to the next step.
#
# Run from the project root:  source("scripts/01_data_audit.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages({
  library(readxl)
  library(dplyr)
})

cat("[01] Loading raw data from", RAW_XLSX_PATH, "...\n")
raw <- load_raw_crop_data()
cat("[01] Rows:", nrow(raw), " Columns:", ncol(raw), "\n")

# --- Structure summary ---------------------------------------------------
structure_summary <- data.frame(
  rows           = nrow(raw),
  columns        = ncol(raw),
  duplicate_rows = sum(duplicated(raw))
)

# --- Column types ----------------------------------------------------------
column_types <- data.frame(
  column = names(raw),
  type   = sapply(raw, function(x) class(x)[1])
)

# --- Missing values ----------------------------------------------------------
missing_values <- data.frame(
  column      = names(raw),
  n_missing   = sapply(raw, function(x) sum(is.na(x))),
  pct_missing = sapply(raw, function(x) round(100 * mean(is.na(x)), 2))
) |> arrange(desc(n_missing))

# --- Cardinality of categorical-looking columns ------------------------------
cat_like <- names(raw)[sapply(raw, function(x) is.character(x) || is.factor(x))]
cardinality <- data.frame(
  column   = cat_like,
  n_unique = sapply(raw[cat_like], function(x) length(unique(x)))
) |> arrange(desc(n_unique))

write_xlsx_report(
  list(
    Summary        = structure_summary,
    Column_Types   = column_types,
    Missing_Values = missing_values,
    Cardinality    = cardinality
  ),
  file.path(REPORTS_DIR, "Data_Audit_Report.xlsx")
)

saveRDS(raw, AUDITED_RDS)
cat("[01] Saved reports/Data_Audit_Report.xlsx and", AUDITED_RDS, "\n")
