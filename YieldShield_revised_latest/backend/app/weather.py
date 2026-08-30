"""
Real weather via Open-Meteo (https://open-meteo.com) — free, no API key.

Binalonan's 24 barangays are close enough together (a few km apart, all
within the same municipality) that Open-Meteo's forecast/archive grid
resolution (~9-11 km) can't meaningfully distinguish between them, so
every request uses one fixed municipal coordinate. Soil type/pH/moisture
stay separate, static reference data — see BARANGAY_DATA in the frontend
and the note in FarmInputRequest — since there's no free, keyless API for
real-time, plot-level soil conditions the way there is for weather.
"""
import datetime as dt
import logging

import httpx

logger = logging.getLogger("yieldshield.weather")

# Binalonan, Pangasinan municipal center (see PhilAtlas / OpenStreetMap).
BINALONAN_LAT = 16.05
BINALONAN_LON = 120.59

_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"

# Open-Meteo's forecast endpoint also serves recent past days (reanalysis-
# backed) and the near-term forecast; well outside that window there's
# nothing to fetch, so we fall back to a historical climatological average.
_FORECAST_PAST_DAYS_LIMIT = 90
_FORECAST_FUTURE_DAYS_LIMIT = 15


class WeatherResult:
    def __init__(self, temperature_c: float, rainfall_mm: float, source: str):
        self.temperature_c = temperature_c
        self.rainfall_mm = rainfall_mm
        self.source = source  # "forecast" | "historical" | "climatology_average"


def _fetch_daily(url: str, date_str: str) -> dict | None:
    params = {
        "latitude": BINALONAN_LAT,
        "longitude": BINALONAN_LON,
        "start_date": date_str,
        "end_date": date_str,
        "daily": "temperature_2m_mean,precipitation_sum",
        "timezone": "Asia/Manila",
    }
    try:
        resp = httpx.get(url, params=params, timeout=8.0)
        resp.raise_for_status()
        data = resp.json()
        daily = data.get("daily", {})
        temps = daily.get("temperature_2m_mean") or []
        rains = daily.get("precipitation_sum") or []
        if not temps or temps[0] is None:
            return None
        return {"temperature_c": temps[0], "rainfall_mm": rains[0] if rains else 0.0}
    except (httpx.HTTPError, ValueError, KeyError, IndexError) as exc:
        logger.warning("Open-Meteo request to %s failed: %s", url, exc)
        return None


def get_weather_for_date(target_date: dt.date) -> WeatherResult:
    today = dt.date.today()
    days_from_today = (target_date - today).days

    if -_FORECAST_PAST_DAYS_LIMIT <= days_from_today <= _FORECAST_FUTURE_DAYS_LIMIT:
        result = _fetch_daily(_FORECAST_URL, target_date.isoformat())
        if result is not None:
            return WeatherResult(result["temperature_c"], result["rainfall_mm"], "forecast")

    if days_from_today < -_FORECAST_PAST_DAYS_LIMIT:
        result = _fetch_daily(_ARCHIVE_URL, target_date.isoformat())
        if result is not None:
            return WeatherResult(result["temperature_c"], result["rainfall_mm"], "historical")

    # Far-future planting date, or the live APIs above failed/are
    # unreachable: average the same calendar day over the last 3 years
    # of the historical archive as an honest climatological estimate —
    # no service can forecast actual weather months ahead.
    temps, rains = [], []
    for years_back in (1, 2, 3):
        try:
            sample_date = target_date.replace(year=target_date.year - years_back)
        except ValueError:
            # Feb 29 in a year without one — shift a day.
            sample_date = target_date.replace(month=2, day=28, year=target_date.year - years_back)
        result = _fetch_daily(_ARCHIVE_URL, sample_date.isoformat())
        if result is not None:
            temps.append(result["temperature_c"])
            rains.append(result["rainfall_mm"])

    if temps:
        return WeatherResult(sum(temps) / len(temps), sum(rains) / len(rains), "climatology_average")

    # Open-Meteo unreachable entirely (e.g. no outbound network) — this
    # is the only case with no real data behind it.
    raise RuntimeError("Open-Meteo is unreachable and no historical fallback data was available.")
