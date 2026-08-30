// PAGASA-style rainfall categories, applied to the daily rainfall total
// our weather source (Open-Meteo, via backend/app/weather.py) actually
// provides. PAGASA's official Heavy Rainfall Warning System classifies
// by hourly rate (Light <2.5mm/hr, Moderate 2.5–7.5, Heavy 7.5–15,
// Intense 15–30, Torrential >30) from automated rain gauges — we only
// have a daily total, not an hourly rate, so this is a same-naming,
// daily-total approximation rather than the literal official threshold.
// Kept in sync with backend/app/pagasa_weather.py.
export type RainfallCategory = { label: string; advice: string };

export function pagasaRainfallCategory(mmPerDay: number): RainfallCategory {
  if (mmPerDay < 5) return { label: "Light rain", advice: "" };
  if (mmPerDay < 15) return { label: "Moderate rain", advice: "" };
  if (mmPerDay < 30) return { label: "Heavy rain", advice: "Watch for localized flooding and slippery field conditions." };
  return { label: "Intense to torrential rain", advice: "High risk of flooding — secure equipment and delay fieldwork." };
}
