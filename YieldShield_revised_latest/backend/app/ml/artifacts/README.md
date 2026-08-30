# Model artifacts

This folder is empty in version control on purpose - drop in whatever
`scripts/10_export_serving_artifacts.R` produced in `YieldShield_ML`:

- `feature_manifest.json` (always)
- **one** of:
  - `xgb_model.json`  (if XGBoost won the model comparison)
  - `rf_trees.json`   (if Random Forest won instead)

`feature_manifest.json`'s `"model_file"` field tells `app/ml/model.py`
which one to load - you don't need to configure anything, just copy
whatever the R script produced.

Without these files, `app/ml/model.py` raises `ModelNotAvailable` on
every prediction request - `farm_input.py` catches that and falls back to
`prediction_status: "pending"`, so the rest of the app keeps working, it
just can't score submissions yet.
