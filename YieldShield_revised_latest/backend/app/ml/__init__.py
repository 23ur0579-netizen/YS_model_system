"""
Server-side yield prediction. See model.py (the trained XGBoost model +
encoding logic) and features.py (assembling raw inputs from the DB).

Typical usage from a router:

    from ..ml import predict_for_submission, model as ml_model

    try:
        result = predict_for_submission(cur, barangay_id, crop_type_id,
                                          body.barangay, body.crop, body.planting_date)
    except ml_model.ModelNotAvailable:
        result = None   # no exported model yet - fall back to "pending"
    except features.FeatureLookupError as exc:
        result = None   # DB doesn't have enough history/climate data yet
"""
import datetime as dt

from . import features, model as _model

ModelNotAvailable = _model.ModelNotAvailable
FeatureLookupError = features.FeatureLookupError
get_model_info = _model.get_model_info

# FarmInputRequest.crop is "Palay (Rice)" / "Corn" (UI label); the model
# was trained on the DB's crop_type.crop_name values ("Palay" / "Corn").
# Mirrors the exact mapping farm_input.py already uses for
# _resolve_barangay_and_crop, kept in one place so the two can't drift.
_CROP_LABEL_TO_MODEL_NAME = {
    "Palay (Rice)": "Palay",
    "Corn": "Corn",
}


def predict_for_submission(
    cur,
    barangay_id: int,
    crop_type_id: int,
    barangay_name: str,
    crop_label: str,
    planting_date: dt.date,
) -> dict:
    """The one call a router needs: DB lookups + feature engineering +
    model inference, bundled. Raises ModelNotAvailable or
    FeatureLookupError on failure - callers decide how to degrade."""
    climate = features.get_climate_features(cur, planting_date)
    barangay_ref = features.get_barangay_reference(cur, barangay_id)
    area_ctx = features.get_area_context(cur, barangay_id, crop_type_id)

    result = _model.predict_yield(
        crop_type=_CROP_LABEL_TO_MODEL_NAME.get(crop_label, crop_label),
        barangay=barangay_name,
        soil_type=barangay_ref["soil_type"],
        season_type=climate["season_type"],
        rainfall=climate["rainfall"],
        avg_temp=climate["avg_temp"],
        min_temp=climate["min_temp"],
        max_temp=climate["max_temp"],
        humidity=climate["humidity"],
        surface_pressure=climate["surface_pressure"],
        solar_rad=climate["solar_rad"],
        land_size_ha=barangay_ref["land_size_ha"],
        total_area_planted_ha=area_ctx["total_area_planted_ha"],
        irrigated_area_ha=area_ctx["irrigated_area_ha"],
        rainfed_area_ha=area_ctx["rainfed_area_ha"],
    )
    result["climate_source"] = climate["source"]
    return result
