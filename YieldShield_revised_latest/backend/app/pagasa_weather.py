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


def rainfall_category(mm_per_day: float) -> tuple[str, str]:
    """Returns (label, advice) -- advice is "" for light/moderate rain."""
    if mm_per_day < 5:
        return "Light rain", ""
    if mm_per_day < 15:
        return "Moderate rain", ""
    if mm_per_day < 30:
        return "Heavy rain", "Watch for localized flooding and slippery field conditions."
    return "Intense to torrential rain", "High risk of flooding -- secure equipment and delay fieldwork."
