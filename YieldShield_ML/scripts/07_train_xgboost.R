# ============================================================
# 07_train_xgboost.R
# Train an XGBoost regressor. Saves models/xgboost_model.rds,
# outputs/Feature_Importance_XGB.csv, and reports/XGBoost_Report.xlsx.
#
# Run from the project root:  source("scripts/07_train_xgboost.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages(library(xgboost))

set.seed(SEED)

cat("[07] Loading model-ready data...\n")
sel <- readRDS(SELECTED_RDS)

dtrain <- xgb.DMatrix(data = as.matrix(sel$X_train), label = sel$y_train)
dtest  <- xgb.DMatrix(data = as.matrix(sel$X_test),  label = sel$y_test)

params <- list(
  objective        = "reg:squarederror",
  eval_metric      = "rmse",
  eta              = 0.1,
  max_depth        = 6,
  subsample        = 0.8,
  colsample_bytree = 0.8
)

cat("[07] Training XGBoost...\n")
watchlist <- list(train = dtrain, test = dtest)
m_xgb <- xgb.train(
  params = params, data = dtrain, nrounds = 200,
  watchlist = watchlist, verbose = 0
)

test_pred    <- predict(m_xgb, as.matrix(sel$X_test))
test_metrics <- evaluate_regression(sel$y_test, test_pred)

eval_log <- as.data.frame(m_xgb$evaluation_log)

importance_df <- as.data.frame(xgb.importance(model = m_xgb, feature_names = sel$feature_names))

write.csv(importance_df, file.path(OUTPUTS_DIR, "Feature_Importance_XGB.csv"), row.names = FALSE)

write_xlsx_report(
  list(
    Params              = data.frame(param = names(params), value = unlist(params)),
    Eval_Log            = eval_log,
    Test_Metrics        = test_metrics,
    Feature_Importance  = importance_df
  ),
  file.path(REPORTS_DIR, "XGBoost_Report.xlsx")
)

saveRDS(list(fit = m_xgb, use_scaled = FALSE, algorithm = "XGBoost"), XGB_MODEL_PATH)

cat("[07] Saved", XGB_MODEL_PATH, ", outputs/Feature_Importance_XGB.csv,",
    "and reports/XGBoost_Report.xlsx\n")
cat("[07] Test metrics:\n")
print(test_metrics, digits = 4)
