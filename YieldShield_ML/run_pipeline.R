# ============================================================
# run_pipeline.R
# Runs the full YieldShield ML pipeline end-to-end, in order.
#
# Usage (from the project root):
#   Rscript run_pipeline.R
# or, inside an R session already `setwd()`'d to the project root:
#   source("run_pipeline.R")
# ============================================================

scripts <- c(
  "scripts/01_data_audit.R",
  "scripts/02_data_preparation.R",
  "scripts/03_feature_engineering.R",
  "scripts/04_exploratory_analysis.R",
  "scripts/05_feature_selection.R",
  "scripts/06_train_random_forest.R",
  "scripts/07_train_xgboost.R",
  "scripts/08_model_evaluation.R",
  "scripts/09_predict_new_farmer.R",
  "scripts/10_export_serving_artifacts.R"
)

for (s in scripts) {
  cat("\n============================================================\n")
  cat("Running", s, "\n")
  cat("============================================================\n")
  source(s)
}

cat("\nPipeline complete. Check reports/, outputs/, and models/ for results.\n")
