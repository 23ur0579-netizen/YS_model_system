"""
Loads whichever model YieldShield_ML's scripts/10_export_serving_artifacts.R
exported (XGBoost's native JSON, or - if Random Forest won the comparison -
a raw tree dump this module walks itself), and reproduces, in Python, the
exact feature-engineering + one-hot-encoding pipeline that R's
caret::dummyVars(fullRank=TRUE) applied at training time - so a raw request
here produces the same feature vector the model was trained on.

Artifacts expected at ./artifacts/ (see artifacts/README.md):
  - feature_manifest.json           (feature order, dummy-encoding levels,
                                      which model file to load, metrics)
  - xgb_model.json  OR  rf_trees.json  (whichever manifest["model_file"] names)
"""
import json
import os
from functools import lru_cache

import numpy as np
import xgboost as xgb

_ARTIFACT_DIR = os.path.join(os.path.dirname(__file__), "artifacts")
_MANIFEST_PATH = os.path.join(_ARTIFACT_DIR, "feature_manifest.json")


class ModelNotAvailable(RuntimeError):
    """Raised when the exported model artifacts haven't been dropped into
    artifacts/ yet. Callers should treat this as "prediction unavailable",
    not a 500 - the rest of the app has to keep working without a model."""


@lru_cache(maxsize=1)
def _load():
    if not os.path.exists(_MANIFEST_PATH):
        raise ModelNotAvailable(
            f"feature_manifest.json not found at {_ARTIFACT_DIR}. Run "
            "scripts/10_export_serving_artifacts.R in YieldShield_ML and copy "
            "its output into backend/app/ml/artifacts/."
        )
    with open(_MANIFEST_PATH) as f:
        manifest = json.load(f)

    algorithm = manifest.get("algorithm", "XGBoost")
    model_file = manifest.get("model_file", "xgb_model.json")
    model_path = os.path.join(_ARTIFACT_DIR, model_file)
    if not os.path.exists(model_path):
        raise ModelNotAvailable(
            f"Model file '{model_file}' referenced by feature_manifest.json "
            f"not found at {model_path}."
        )

    if algorithm == "XGBoost":
        booster = xgb.Booster()
        booster.load_model(model_path)
        model_obj = {"type": "xgboost", "booster": booster}
    elif algorithm == "Random Forest":
        with open(model_path) as f:
            model_obj = {"type": "random_forest", "trees": json.load(f)["trees"]}
    else:
        raise ModelNotAvailable(f"Unsupported algorithm in manifest: {algorithm!r}")

    return model_obj, manifest


def reload():
    """Drop the cached model/manifest so a freshly-copied-in export gets
    picked up without restarting the process (call from an admin endpoint
    or just restart the service - either works)."""
    _load.cache_clear()


def _walk_rf_tree(nodes: list, row: dict) -> float:
    """One randomForest tree, exported by getTree() in R (1-indexed node
    IDs, 0 = no child). `nodes` is that same list, 0-indexed in Python, so
    R's 1-indexed left/right daughter values are converted with `- 1`."""
    i = 0  # root is always node 1 in R -> index 0 here
    while True:
        node = nodes[i]
        if node["is_leaf"]:
            return node["prediction"]
        value = row.get(node["feature"], 0.0)
        # randomForest convention: <= threshold goes left, else right.
        nxt = node["left"] if value <= node["threshold"] else node["right"]
        i = nxt - 1


def _predict_random_forest(trees: list, row: dict) -> float:
    predictions = [_walk_rf_tree(tree, row) for tree in trees]
    return sum(predictions) / len(predictions)


def _encode_categorical(manifest: dict, col: str, value: str) -> tuple[dict, bool]:
    """One categorical predictor -> {dummy_column_name: 0.0/1.0}, matching
    caret::dummyVars(fullRank=TRUE): the reference level gets no dummy
    column of its own (all of that column's dummies are simply 0). An
    unrecognized value (e.g. a barangay/soil_type the model never trained
    on) falls back to the reference level rather than erroring - the
    caller is told via the returned `unseen` flag so it can lower the
    reported confidence instead of silently pretending certainty."""
    spec = manifest["categorical_levels"][col]
    sep = manifest["dummy_sep"]
    known = set(spec["dummy_levels"]) | {spec["reference"]}
    unseen = value not in known
    effective_value = spec["reference"] if unseen else value
    dummies = {
        f"{col}{sep}{level}": (1.0 if effective_value == level else 0.0)
        for level in spec["dummy_levels"]
    }
    return dummies, unseen


def predict_yield(
    *,
    crop_type: str,
    barangay: str,
    soil_type: str,
    season_type: str,
    rainfall: float,
    avg_temp: float,
    min_temp: float,
    max_temp: float,
    humidity: float,
    surface_pressure: float,
    solar_rad: float,
    land_size_ha: float,
    total_area_planted_ha: float,
    irrigated_area_ha: float,
    rainfed_area_ha: float,
) -> dict:
    """Raw inputs in, {predicted_yield_mt_ha, confidence, algorithm,
    unseen_category} out. Derived features are computed here with the
    exact same formulas as YieldShield_ML/scripts/03_feature_engineering.R
    - keep the two in sync if either changes."""
    model_obj, manifest = _load()

    total_area = total_area_planted_ha or 0.0
    irrigated_ratio = (irrigated_area_ha / total_area) if total_area > 0 else 0.0
    rainfed_ratio = (rainfed_area_ha / total_area) if total_area > 0 else 0.0
    temperature_range = max_temp - min_temp
    heat_stress_index = avg_temp * humidity / 100.0
    humidity_temp = humidity * avg_temp
    solar_temp = solar_rad * avg_temp
    water_availability = rainfall * (1 - rainfed_ratio) + irrigated_ratio * 100.0

    numeric_values = {
        "rainfall": rainfall,
        "avg_temp": avg_temp,
        "min_temp": min_temp,
        "max_temp": max_temp,
        "humidity": humidity,
        "surface_pressure": surface_pressure,
        "solar_rad": solar_rad,
        "land_size_ha": land_size_ha,
        "irrigated_area_ha": irrigated_area_ha,
        "rainfed_area_ha": rainfed_area_ha,
        "total_area_planted_ha": total_area_planted_ha,
        "irrigated_ratio": irrigated_ratio,
        "rainfed_ratio": rainfed_ratio,
        "water_availability": water_availability,
        "temperature_range": temperature_range,
        "heat_stress_index": heat_stress_index,
        "humidity_temp": humidity_temp,
        "solar_temp": solar_temp,
    }

    row: dict[str, float] = {}
    any_unseen = False
    for col, value in (
        ("crop_type", crop_type),
        ("barangay", barangay),
        ("soil_type", soil_type),
        ("season_type", season_type),
    ):
        dummies, unseen = _encode_categorical(manifest, col, value)
        row.update(dummies)
        any_unseen = any_unseen or unseen

    for col in manifest["numeric_cols"]:
        row[col] = numeric_values.get(col, 0.0)

    if model_obj["type"] == "xgboost":
        ordered = [row.get(name, 0.0) for name in manifest["feature_names"]]
        dmatrix = xgb.DMatrix(np.array([ordered], dtype=float), feature_names=manifest["feature_names"])
        predicted_yield = float(model_obj["booster"].predict(dmatrix)[0])
    elif model_obj["type"] == "random_forest":
        predicted_yield = _predict_random_forest(model_obj["trees"], row)
    else:
        raise ModelNotAvailable(f"Loaded model has unknown type: {model_obj['type']!r}")

    confidence = None
    r2 = (manifest.get("metrics") or {}).get("r_squared")
    if r2 is not None:
        confidence = max(0, min(100, round(r2 * 100)))
        if any_unseen:
            # Penalize, don't hide: the model is extrapolating past a
            # category it never saw in training.
            confidence = max(0, confidence - 20)

    return {
        "predicted_yield_mt_ha": round(predicted_yield, 3),
        "confidence": confidence,
        "algorithm": manifest.get("algorithm", "XGBoost"),
        "unseen_category": any_unseen,
    }


_MODEL_NAME = "YieldShield Yield Predictor v1"


def get_model_info() -> dict:
    """Enough to upsert a yieldshield.predictive_model row - matches the
    columns YieldShield_ML/scripts/08_model_evaluation.R's
    predictive_model_insert.sql already writes for the same model."""
    _, manifest = _load()
    metrics = manifest.get("metrics") or {}
    return {
        "model_name": _MODEL_NAME,
        "algorithm": manifest.get("algorithm", "XGBoost"),
        "mae": metrics.get("mae"),
        "mse": metrics.get("mse"),
        "r_squared": metrics.get("r_squared"),
    }
