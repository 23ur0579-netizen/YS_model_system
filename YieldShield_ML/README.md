# YieldShield_ML

Modularized version of the original single-file `train_yield_model.R`. Same
underlying logic, split into a numbered pipeline so each stage can be
audited, re-run, or improved independently.

## Structure

```
YieldShield_ML/
├── config.R              # all paths, column roles, CV/seed settings
├── utils.R                # shared helper functions
├── run_pipeline.R          # runs scripts/01 .. 09 in order
│
├── data/
│   └── binalonan_crop_data.xlsx   # <- put your source workbook here
│                                     (sheet name: "Crop Features")
│
├── models/                # .rds artifacts, produced by the pipeline
├── reports/                # .xlsx audit/QA reports, produced by the pipeline
├── outputs/                 # .csv / .sql outputs, produced by the pipeline
│
└── scripts/
    ├── 01_data_audit.R
    ├── 02_data_preparation.R
    ├── 03_feature_engineering.R
    ├── 04_exploratory_analysis.R
    ├── 05_feature_selection.R
    ├── 06_train_random_forest.R
    ├── 07_train_xgboost.R
    ├── 08_model_evaluation.R
    ├── 09_predict_new_farmer.R
    └── 11_extract_farm_level_data.R   # separate, optional - see its own section below
```

## How it fits together

Each script reads the hand-off file the previous script wrote (in `data/`),
does one job, and writes its own hand-off file plus a report/output. This
mirrors the original script's flow exactly, just split apart:

| Script | Reads | Does | Writes |
|---|---|---|---|
| 01 data audit | raw xlsx | structure/missingness/duplicate checks | `data/01_audited.rds`, `reports/Data_Audit_Report.xlsx` |
| 02 data preparation | 01_audited | dedupe, impute | `data/02_prepared.rds`, `reports/Data_Preparation_Report.xlsx` |
| 03 feature engineering | 02_prepared | derive `season_type` + fallback interaction features | `data/03_features.rds`, `reports/Feature_Engineering_Report.xlsx` |
| 04 EDA | 03_features | summary stats, correlations, yield breakdowns | `reports/EDA_Report.xlsx` |
| 05 feature selection | 03_features | one-hot encode, drop near-zero-variance dummies, train/test split, center/scale | `data/05_model_ready.rds`, `models/preProcess.rds`, `reports/Feature_Selection_Report.xlsx` |
| 06 train RF | 05_model_ready | Random Forest, 5-fold x3 repeated CV, mtry tuning | `models/random_forest_model.rds`, `outputs/Feature_Importance_RF.csv`, `reports/RandomForest_Report.xlsx` |
| 07 train XGBoost | 05_model_ready | XGBoost, 200 rounds | `models/xgboost_model.rds`, `outputs/Feature_Importance_XGB.csv`, `reports/XGBoost_Report.xlsx` |
| 08 model evaluation | RF + XGB models | compare on held-out test set, pick winner | `models/best_model.rds`, `outputs/Model_Comparison.csv`, `outputs/predictive_model_insert.sql`, `reports/Model_Evaluation_Report.xlsx` |
| 09 predict new farmer | `models/best_model.rds`, `models/preProcess.rds` | score a new submission | `outputs/Prediction_Output.csv` |

**Note on the two candidate algorithms:** the original script also tried
Linear Regression, Elastic Net, and SVR. This modular version narrows
training to Random Forest and XGBoost (the two strongest, most
production-friendly performers) to match the requested `models/` layout,
which only has slots for `random_forest_model.rds` / `xgboost_model.rds` /
`best_model.rds`. If you want the other algorithms back, duplicate
`06_train_random_forest.R` as a new numbered script following the same
pattern (load `data/05_model_ready.rds`, train, save an `.rds`, evaluate
in `08_model_evaluation.R`).

## Running it

1. Put your source workbook at `data/binalonan_crop_data.xlsx` (or edit
   `RAW_XLSX_PATH` in `config.R` to point elsewhere).
2. Open R / RStudio with the working directory set to `YieldShield_ML/`
   (an RStudio Project rooted here works well), or `cd` there in a terminal.
3. Run the whole thing:
   ```r
   source("run_pipeline.R")
   ```
   or from a terminal:
   ```
   Rscript run_pipeline.R
   ```
4. To iterate on just one stage (e.g. retune the Random Forest), re-run only
   that script - it reads its inputs from the `data/*.rds` hand-off files
   left by the earlier stages, so you don't need to re-run everything.

## Scoring new farmers from the backend

Call `predict_new_data(new_data)` (defined in `utils.R`, demonstrated in
`scripts/09_predict_new_farmer.R`) with a 1-row data.frame containing the
same fields as `CATEGORICAL_COLS` + `NUMERIC_COLS` in `config.R`. It loads
`models/best_model.rds` and `models/preProcess.rds` and returns the
predicted yield in MT/ha.

**Scale caveat:** this is trained on barangay + crop + season aggregates
(one row = a whole barangay's planted area for one crop in one season -
`land_size_ha` runs into the hundreds), not individual farmer plots. A
"new farmer submission" here really means "a new barangay + crop + season
scenario." If YieldShield needs true per-plot predictions, the training
data needs to be collected at that grain.

## Getting real per-farmer data for a future retrain (script 11)

The scale caveat above is a real limitation, checked directly rather than
assumed: the historical dataset behind this whole pipeline has never had a
column for ecosystem, seed source, variety, or planting technique at the
individual-farmer level - not because whoever built it overlooked it, but
because the source records (the Municipal Agriculture Office's own
historical reports) simply don't carry that detail below the barangay
level. No amount of re-processing the existing workbook recovers
information that was never collected in the first place.

The one place that detail *does* exist is the live YieldShield application
itself - every cropping a farmer submits records their ecosystem, seed
source, variety, technique, and (once harvested) an actual yield, all tied
to one specific plot. `scripts/11_extract_farm_level_data.R` pulls exactly
that, directly from the application's database, as a new, separate dataset
- it never reads or writes anything this pipeline's own `01_audited.rds`
through `05_model_ready.rds` files touch, and the original Excel workbook
is untouched either way.

It's deliberately not part of `run_pipeline.R` or the numbered 01-09
sequence: it needs live database credentials the rest of this pipeline has
no reason to have, and - this is the important part - **running it today
would mostly just extract seeded test data, not real farmer outcomes**.
There's no way to tell a genuine harvest from a synthetic one once it's in
the database, so the script's row count and category-coverage summary is
there to help you judge for yourself whether what comes back is worth
training on, rather than assuming more rows automatically means better.
Give it real farmers, across real seasons, first.

See the script's own header comment for exact setup steps (it needs the
`yieldshield_analyst` database role specifically, and the `DBI` /
`RPostgres` R packages this pipeline doesn't otherwise use).

## Dataset-specific notes (binalonan_crop_data4.xlsx, "Crop Features" sheet)

`config.R` / `utils.R` / `scripts/03_feature_engineering.R` are tailored to
this workbook's actual columns:

- **Not used** - `planting_month`, `terrain_type`, and `elevation` don't
  exist as populated columns in this sheet (they're referenced elsewhere in
  the workbook, e.g. the Data Dictionary, but aren't joined into Crop
  Features here). Also excluded: a dozen headers that exist but are 100%
  empty in this extract (`Soil pH`, `Organic Matter`, `Soil Texture`,
  `Soil Drainage`, `Seedlings Planted`, `Fertilizer/Pesticide/Herbicide
  Applied`, `Planting Month Number/Quarter/Semester`,
  `Crop_Duration_Months`), and the free-text `Tillage Method` / `Water
  Management` / `Primary Planting Technique` columns (near-deterministic
  given crop_type + barangay + soil_type; would blow up the dummy-variable
  count for ~460 rows).
- **Computed, not just imputed** - `Temperature_Range`, `Heat_Stress_Index`,
  `Humidity_Temp`, `Solar_Temp`, `Rain_Temp`, `Pressure_Temp`,
  `Irrigated_Ratio`, `Rainfed_Ratio`, `Water_Availability`, and
  `Water_Deficit` exist as column headers in this sheet but are 100% empty,
  so `03_feature_engineering.R` is where they actually get computed (not a
  rare-gap fallback). **`Heat_Stress_Index` and `Water_Deficit` use
  heuristic formulas I made up in the absence of a supplied definition** -
  swap them for a validated agronomic formula if your team has one.
- **Irrigated/rainfed split** is only reported for Palay - all 105 Corn
  rows have both fields blank, which `02_data_preparation.R` imputes to 0
  (meaning "not tracked," not "no water").
- 21 barangays, 2 crop types (Palay/Corn), 5 soil types, DS/WS seasons,
  458 rows total, 21 of them with a reported yield of 0 (crop failures) -
  worth a look in `reports/Data_Audit_Report.xlsx` before trusting the
  model blindly.

## R package dependencies

```r
install.packages(c(
  "readxl", "dplyr", "tidyr", "caret", "randomForest",
  "xgboost", "Metrics", "openxlsx"
))
```

`scripts/11_extract_farm_level_data.R` additionally needs `DBI` and
`RPostgres` (only that script uses a live database connection - nothing
else in this pipeline does):

```r
install.packages(c("DBI", "RPostgres"))
```
