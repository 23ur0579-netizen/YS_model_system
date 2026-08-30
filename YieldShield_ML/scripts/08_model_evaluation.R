# ============================================================
# 08_model_evaluation.R
# Compare Random Forest vs XGBoost on the held-out test set, pick
# the winner (lowest RMSE, ties broken by higher R^2), and save it
# as models/best_model.rds - the single artifact the rest of the
# YieldShield backend should load for scoring. Also emits a SQL
# INSERT for the yieldshield.predictive_model table.
#
# Run from the project root:  source("scripts/08_model_evaluation.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages(library(dplyr))

cat("[08] Loading trained models and test data...\n")
sel     <- readRDS(SELECTED_RDS)
rf      <- readRDS(RF_MODEL_PATH)
xgb_art <- readRDS(XGB_MODEL_PATH)

rf_pred  <- predict(rf$fit, newdata = sel$X_test)
xgb_pred <- predict(xgb_art$fit, as.matrix(sel$X_test))

results <- bind_rows(
  cbind(algorithm = "Random Forest", evaluate_regression(sel$y_test, rf_pred)),
  cbind(algorithm = "XGBoost",       evaluate_regression(sel$y_test, xgb_pred))
) |> arrange(rmse)

cat("\n=== Held-out test set performance (lower MAE/MSE/RMSE, higher R^2 is better) ===\n")
print(results, digits = 4)

write.csv(results, file.path(OUTPUTS_DIR, "Model_Comparison.csv"), row.names = FALSE)

best_name  <- results$algorithm[1]
best_row   <- results[1, ]
best_entry <- if (best_name == "Random Forest") rf else xgb_art

cat("\n>>> Best model:", best_name, "\n")
cat(sprintf("    MAE=%.4f  MSE=%.4f  RMSE=%.4f  R^2=%.4f\n",
            best_row$mae, best_row$mse, best_row$rmse, best_row$r_squared))

saveRDS(
  list(
    model            = best_entry$fit,
    algorithm        = best_name,
    use_scaled       = best_entry$use_scaled,
    metrics          = best_row,
    feature_names    = sel$feature_names,
    categorical_cols = CATEGORICAL_COLS,
    numeric_cols     = NUMERIC_COLS
  ),
  BEST_MODEL_PATH
)

sql <- sprintf(
"INSERT INTO yieldshield.predictive_model (model_name, algorithm, mae, mse, r_squared, trained_date, is_active)
VALUES ('YieldShield Yield Predictor v1', '%s', %.4f, %.4f, %.4f, now(), TRUE);
",
  best_name, best_row$mae, best_row$mse, best_row$r_squared
)
writeLines(sql, file.path(OUTPUTS_DIR, "predictive_model_insert.sql"))

write_xlsx_report(
  list(
    Model_Comparison = results,
    Best_Model       = best_row
  ),
  file.path(REPORTS_DIR, "Model_Evaluation_Report.xlsx")
)

cat("[08] Saved", BEST_MODEL_PATH, ", outputs/Model_Comparison.csv,",
    "outputs/predictive_model_insert.sql, and reports/Model_Evaluation_Report.xlsx\n")
