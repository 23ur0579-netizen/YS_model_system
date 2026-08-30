# ============================================================
# 10_export_serving_artifacts.R
# Export what the Python/FastAPI backend actually needs to serve
# predictions, without needing R at request time - whichever model
# actually won in 08_model_evaluation.R.
#
# WHY THIS EXISTS: models/best_model.rds and models/preProcess.rds are
# R objects (caret::train / xgb.Booster / caret::dummyVars) that only R
# can load. YieldShield's backend is Python (FastAPI).
#   - XGBoost has a native cross-language JSON format (xgb.save()),
#     directly loadable via Python's xgboost.Booster().load_model().
#   - randomForest has no such format, so if Random Forest won, this
#     script dumps every tree's raw split structure (feature, threshold,
#     children, leaf value) to JSON via randomForest::getTree(), and the
#     Python side (app/ml/model.py) walks those trees itself and
#     averages leaf predictions - a manual but fully portable
#     re-implementation of what randomForest::predict() does internally.
#
# Produces (under models/serving/):
#   - xgb_model.json  OR  rf_trees.json   (whichever algorithm won)
#   - feature_manifest.json - everything needed to turn raw inputs into
#                             the exact feature vector the model expects
#                             (dummy-encoding levels, feature order,
#                             which model file to load, reported metrics)
#
# Copy the exported model file + feature_manifest.json into:
#   backend/app/ml/artifacts/
#
# Run from the project root:  source("scripts/10_export_serving_artifacts.R")
# ============================================================

source("config.R")
source("utils.R")

suppressPackageStartupMessages({
  library(xgboost)
  library(randomForest)
})

if (!requireNamespace("jsonlite", quietly = TRUE)) {
  stop("Package 'jsonlite' is required for this script. ",
       "Install it with install.packages('jsonlite').")
}

SERVING_DIR <- file.path(MODELS_DIR, "serving")
dir.create(SERVING_DIR, showWarnings = FALSE, recursive = TRUE)

cat("[10] Loading trained artifacts...\n")
best <- readRDS(BEST_MODEL_PATH)
prep <- readRDS(PREPROCESS_PATH)

cat("[10] Best model:", best$algorithm, "- exporting it for serving.\n")
print(best$metrics, digits = 4)

# ---------------------------------------------------------------------
# Dump every tree in a randomForest fit to a portable JSON structure.
# One entry per tree, one entry per node (1-indexed to match R's
# getTree() node numbering - Python re-indexes to 0-based on load).
# ---------------------------------------------------------------------
export_random_forest_trees <- function(rf_model, feature_names, path) {
  ntree <- rf_model$ntree
  trees <- vector("list", ntree)
  for (i in seq_len(ntree)) {
    tree_df <- randomForest::getTree(rf_model, k = i, labelVar = TRUE)
    nodes <- vector("list", nrow(tree_df))
    for (r in seq_len(nrow(tree_df))) {
      is_leaf <- tree_df[r, "status"] == -1
      nodes[[r]] <- list(
        left       = as.integer(tree_df[r, "left daughter"]),
        right      = as.integer(tree_df[r, "right daughter"]),
        is_leaf    = is_leaf,
        feature    = if (is_leaf) NULL else as.character(tree_df[r, "split var"]),
        threshold  = if (is_leaf) NULL else as.numeric(tree_df[r, "split point"]),
        prediction = if (is_leaf) as.numeric(tree_df[r, "prediction"]) else NULL
      )
    }
    trees[[i]] <- nodes
  }
  jsonlite::write_json(
    list(ntree = ntree, feature_names = feature_names, trees = trees),
    path, auto_unbox = TRUE, pretty = FALSE, na = "null", null = "null"
  )
  cat(sprintf("[10] Exported %d trees (%d total nodes) to %s\n",
              ntree, sum(sapply(trees, length)), path))
}

# --- 1. Export the raw model in a Python-loadable format -------------------
if (best$algorithm == "XGBoost") {
  model_file <- "xgb_model.json"
  model_path <- file.path(SERVING_DIR, model_file)
  # xgb.save()'s output format is determined by the file extension: ".json"
  # (or ".ubj") triggers xgboost's portable JSON/UBJ serializer, which is
  # exactly what Python's xgboost.Booster().load_model() expects.
  xgboost::xgb.save(best$model, model_path)
} else if (best$algorithm == "Random Forest") {
  model_file <- "rf_trees.json"
  model_path <- file.path(SERVING_DIR, model_file)
  # best$model is the caret::train() wrapper (see 06_train_random_forest.R) -
  # the actual randomForest fit getTree() needs is at $finalModel.
  rf_model <- best$model$finalModel
  if (is.null(rf_model) || !inherits(rf_model, "randomForest")) {
    stop("[10] Expected best$model$finalModel to be a randomForest object - check 06_train_random_forest.R's saved structure.")
  }
  export_random_forest_trees(rf_model, prep$feature_names, model_path)
} else {
  stop(sprintf("[10] No export path implemented for algorithm '%s'.", best$algorithm))
}

# --- 2. Recover the categorical encoding used by dummyVars -----------------
# dummies$lvls[[col]] is the exact level order caret used for that factor;
# fullRank = TRUE drops the FIRST level as the reference/baseline and gives
# every other level its own dummy column, named "<col><sep><level>".
dummy_sep <- "."  # caret::dummyVars default; 05_feature_selection.R didn't override it
categorical_levels <- list()
for (col in CATEGORICAL_COLS) {
  lvls <- prep$dummies$lvls[[col]]
  if (is.null(lvls)) stop(sprintf("[10] No factor levels recorded for '%s' - check dummies$lvls.", col))
  reference <- lvls[1]
  dummy_levels <- lvls[-1]
  expected_names <- paste0(col, dummy_sep, dummy_levels)
  actually_present <- expected_names[expected_names %in% prep$feature_names]
  if (length(actually_present) != length(expected_names)) {
    stop(sprintf(
      "[10] Mismatch reconstructing dummy names for '%s'. Expected: %s | Found in feature_names: %s\n%s",
      col, paste(expected_names, collapse = ", "), paste(actually_present, collapse = ", "),
      "This usually means dummy_sep is wrong, or a level was entirely absent from the training split (possible for a rare level in an unlucky 80/20 split)."
    ))
  }
  categorical_levels[[col]] <- list(reference = reference, dummy_levels = dummy_levels)
}

# --- 3. Numeric feature order -----------------------------------------------
numeric_present <- intersect(NUMERIC_COLS, prep$feature_names)

# --- 4. Center/scale params (unused by either algorithm - both are trained
#        with use_scaled = FALSE in this pipeline - exported for completeness
#        in case a future algorithm needs them; app/ml/model.py does NOT
#        currently apply them) -----------------------------------------------
center_scale <- NULL
if (!is.null(prep$pre_proc$mean)) {
  center_scale <- list(
    mean = as.list(prep$pre_proc$mean),
    sd   = as.list(prep$pre_proc$std)
  )
}

manifest <- list(
  target_col          = TARGET_COL,
  algorithm           = best$algorithm,
  model_file          = model_file,
  use_scaled          = FALSE,
  categorical_cols    = CATEGORICAL_COLS,
  numeric_cols        = numeric_present,
  feature_names       = prep$feature_names,
  dummy_sep           = dummy_sep,
  categorical_levels  = categorical_levels,
  center_scale        = center_scale,
  metrics             = as.list(best$metrics),
  exported_at         = as.character(Sys.time())
)

manifest_path <- file.path(SERVING_DIR, "feature_manifest.json")
jsonlite::write_json(manifest, manifest_path, auto_unbox = TRUE, pretty = TRUE, na = "null")

cat("[10] Exported:\n")
cat("     ", model_path, "\n")
cat("     ", manifest_path, "\n")
cat("[10] Copy both into backend/app/ml/artifacts/ in the YieldShield backend.\n")
