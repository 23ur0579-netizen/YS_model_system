import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, status

from ..deps import get_current_user
from ..schemas import WeatherOut
from ..weather import get_weather_for_date

router = APIRouter(prefix="/weather", tags=["weather"])


@router.get("", response_model=WeatherOut)
def weather_for_date(date: str, user=Depends(get_current_user)):
    """
    Real weather for Binalonan on the given date (YYYY-MM-DD) — recent-past
    and near-future dates use Open-Meteo's forecast API, older dates use its
    historical archive, and far-future planting dates fall back to a
    3-year seasonal average for that calendar day (see weather.py for why).
    Soil type/pH/moisture are NOT part of this endpoint — those remain
    static reference data.
    """
    try:
        target_date = dt.date.fromisoformat(date)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "date must be in YYYY-MM-DD format.")

    try:
        result = get_weather_for_date(target_date)
    except RuntimeError as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))

    return WeatherOut(
        date=date,
        temperature=round(result.temperature_c, 1),
        rainfall=round(result.rainfall_mm, 1),
        source=result.source,
    )
