# ============================================================
# 06_train_random_forest.R
# Train a Random Forest regressor with repeated CV + mtry tuning.
# Saves models/random_forest_model.rds, outputs/Feature_Importance_RF.csv,
# and reports/RandomForest_Report.xlsx.
#
# Run from the project root:  source("scripts/06_train_random_forest.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages({
  library(caret)
  library(randomForest)
  library(dplyr)
})

set.seed(SEED)

cat("[06] Loading model-ready data...\n")
sel <- readRDS(SELECTED_RDS)

ctrl <- trainControl(method = CV_METHOD, number = CV_FOLDS, repeats = CV_REPEATS)

# Random Forest works directly on the (unscaled) encoded matrix - trees
# don't need centering/scaling.
mtry_grid <- sort(unique(pmax(1, round(c(4, 8, 12, ncol(sel$X_train))))))

cat("[06] Training Random Forest (this can take a while)...\n")
m_rf <- train(
  x = sel$X_train, y = sel$y_train,
  method = "rf", trControl = ctrl,
  tuneGrid = expand.grid(mtry = mtry_grid),
  ntree = 500, importance = TRUE
)

test_pred    <- predict(m_rf, newdata = sel$X_test)
test_metrics <- evaluate_regression(sel$y_test, test_pred)

cv_results <- m_rf$results

importance_raw <- caret::varImp(m_rf)$importance
importance_df <- data.frame(
  feature    = rownames(importance_raw),
  importance = importance_raw$Overall
) |> arrange(desc(importance))

write.csv(importance_df, file.path(OUTPUTS_DIR, "Feature_Importance_RF.csv"), row.names = FALSE)

write_xlsx_report(
  list(
    CV_Results          = cv_results,
    Best_Tune           = as.data.frame(m_rf$bestTune),
    Test_Metrics        = test_metrics,
    Feature_Importance  = importance_df
  ),
  file.path(REPORTS_DIR, "RandomForest_Report.xlsx")
)

saveRDS(list(fit = m_rf, use_scaled = FALSE, algorithm = "Random Forest"), RF_MODEL_PATH)

cat("[06] Saved", RF_MODEL_PATH, ", outputs/Feature_Importance_RF.csv,",
    "and reports/RandomForest_Report.xlsx\n")
cat("[06] Test metrics:\n")
print(test_metrics, digits = 4)
