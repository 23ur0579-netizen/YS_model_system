"""
PAGASA-style rainfall categorization, applied to the daily rainfall
total weather.py actually provides. PAGASA's official Heavy Rainfall
Warning System classifies by hourly rate (Light <2.5mm/hr, Moderate
2.5-7.5, Heavy 7.5-15, Intense 15-30, Torrential >30) from automated
rain gauges -- we only have a daily total, not an hourly rate, so this
is a same-naming, daily-total approximation rather than the literal
official threshold. Kept in sync with
YieldShield_ui/src/app/lib/pagasaWeather.ts.
"""


def rainfall_category(mm_per_day: float) -> tuple[str, str, str]:
    """Returns (level, label_en, advice_en). level is a stable code —
    "light"/"moderate"/"heavy"/"torrential" — for callers doing
    key-based i18n (see notifications.py's _weather_advisory);
    label_en/advice_en are an English fallback for callers that
    haven't been converted yet (farm_calendar.py's activity notes).
    advice_en is "" for light/moderate rain."""
    if mm_per_day < 5:
        return "light", "Light rain", ""
    if mm_per_day < 15:
        return "moderate", "Moderate rain", ""
    if mm_per_day < 30:
        return "heavy", "Heavy rain", "Watch for localized flooding and slippery field conditions."
    return "torrential", "Intense to torrential rain", "High risk of flooding -- secure equipment and delay fieldwork."
