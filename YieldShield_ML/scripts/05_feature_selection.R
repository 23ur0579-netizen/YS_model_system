# ============================================================
# 05_feature_selection.R
# Build the final predictor set: one-hot encode categoricals, split
# train/test, and center/scale numeric predictors (fit on train only).
# Saves the model-ready data for the training scripts and the
# preprocessing artifacts models/preProcess.rds needed to score new
# farmer submissions later.
#
# Run from the project root:  source("scripts/05_feature_selection.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages({
  library(dplyr)
  library(caret)
})

set.seed(SEED)

cat("[05] Loading engineered features...\n")
features <- readRDS(FEATURES_RDS)

model_df <- features |>
  select(all_of(c(CATEGORICAL_COLS, NUMERIC_COLS, TARGET_COL))) |>
  mutate(across(all_of(CATEGORICAL_COLS), as.factor))

cat("[05] Modeling rows:", nrow(model_df),
    " | raw predictors:", length(CATEGORICAL_COLS) + length(NUMERIC_COLS), "\n")

# --- Train / test split (stratified loosely by crop type) ------------------
train_idx <- createDataPartition(model_df$crop_type, p = TRAIN_FRACTION, list = FALSE)
train_raw <- model_df[train_idx, ]
test_raw  <- model_df[-train_idx, ]

# --- One-hot encode categoricals --------------------------------------------
# Every algorithm downstream (RF, XGBoost) shares the same encoded matrix,
# which keeps the comparison apples-to-apples and simplifies serving.
dummies <- dummyVars(as.formula(paste(TARGET_COL, "~ .")), data = train_raw, fullRank = TRUE)
X_train <- predict(dummies, newdata = train_raw) |> as.data.frame()
X_test  <- predict(dummies, newdata = test_raw) |> as.data.frame()
y_train <- train_raw[[TARGET_COL]]
y_test  <- test_raw[[TARGET_COL]]

encoded_predictor_count <- ncol(X_train)

# --- Near-zero-variance check: informational only, NOT applied ------------
# nearZeroVar()'s default threshold flags any one-hot dummy column whose
# minority class is rarer than ~1-in-20 - which, for a 21-level categorical
# like barangay spread across ~460 rows, flags most levels as "near constant"
# even though each one is a real, meaningful barangay. Dropping them would
# silently make the model unable to distinguish most barangays from the
# reference level. With fullRank=TRUE encoding, a level truly absent from
# training data already gets no column at all - that's the protection that
# actually matters here, so nearZeroVar's dummy-count filtering is reported
# for visibility but not acted on.
nzv <- nearZeroVar(X_train)
flagged_by_nzv <- names(X_train)[nzv]

# --- Center/scale numeric predictors (fit on train only, applied to both) --
pre_proc  <- preProcess(X_train, method = c("center", "scale"))
X_train_s <- predict(pre_proc, X_train)
X_test_s  <- predict(pre_proc, X_test)

feature_names <- names(X_train)

# --- Report: correlation of each encoded predictor with target -------------
feature_correlation <- data.frame(
  feature = feature_names,
  correlation_with_yield = sapply(feature_names, function(f) {
    suppressWarnings(cor(X_train[[f]], y_train, use = "complete.obs"))
  })
) |> arrange(desc(abs(correlation_with_yield)))

selection_summary <- data.frame(
  raw_predictors           = length(CATEGORICAL_COLS) + length(NUMERIC_COLS),
  encoded_predictors        = encoded_predictor_count,
  flagged_by_near_zero_var   = length(flagged_by_nzv),
  final_predictors             = length(feature_names),
  train_rows                     = nrow(X_train),
  test_rows                       = nrow(X_test)
)

flagged_features <- data.frame(feature = flagged_by_nzv)

write_xlsx_report(
  list(
    Selection_Summary    = selection_summary,
    Feature_Correlation  = feature_correlation,
    Flagged_NearZeroVar  = flagged_features
  ),
  file.path(REPORTS_DIR, "Feature_Selection_Report.xlsx")
)

saveRDS(
  list(
    X_train = X_train, X_test = X_test, y_train = y_train, y_test = y_test,
    X_train_s = X_train_s, X_test_s = X_test_s,
    dummies = dummies, pre_proc = pre_proc, feature_names = feature_names
  ),
  SELECTED_RDS
)

saveRDS(
  list(
    dummies = dummies, pre_proc = pre_proc, feature_names = feature_names,
    categorical_cols = CATEGORICAL_COLS, numeric_cols = NUMERIC_COLS
  ),
  PREPROCESS_PATH
)

cat("[05] Saved reports/Feature_Selection_Report.xlsx,", SELECTED_RDS,
    "and", PREPROCESS_PATH, "\n")
