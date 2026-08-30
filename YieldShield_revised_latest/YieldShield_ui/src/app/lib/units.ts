// Unit helpers.
//
// The backend (and every stored value in the store — predictedYield/
// actualYield, Field.area, Prediction.seedRate) always uses one fixed
// canonical unit per measurement. This module exists so the UI can
// display — and accept typed input in — a different unit without ever
// changing what's actually persisted:
//   - Yield:      canonical t/ha   (tonnes per hectare)
//   - Area:       canonical ha     (hectares)
//   - Seed rate:  canonical kg/ha  (kilograms per hectare)

// ── Yield ──────────────────────────────────────────────────────────

export type YieldUnit = "t/ha" | "kg/ha";

const KG_PER_TONNE = 1000;

/** Convert a value that's already in t/ha into the given display unit. */
function yieldFromTHa(value: number, unit: YieldUnit): number {
  return unit === "kg/ha" ? value * KG_PER_TONNE : value;
}

/** Convert a value typed/displayed in the given unit back into t/ha. */
export function toTonnesPerHa(value: number, unit: YieldUnit): number {
  return unit === "kg/ha" ? value / KG_PER_TONNE : value;
}

/**
 * Format a t/ha value for display in the given unit, trimming trailing
 * zeros (e.g. 4.50 -> "4.5", 4.00 -> "4").
 */
export function formatYieldValue(value: number, unit: YieldUnit): string {
  if (!Number.isFinite(value)) return "0";
  const converted = yieldFromTHa(value, unit);
  const decimals = unit === "kg/ha" ? 0 : 2;
  return trimZeros(converted, decimals);
}

export const YIELD_UNITS: YieldUnit[] = ["t/ha", "kg/ha"];

// ── Area ───────────────────────────────────────────────────────────

export type AreaUnit = "ha" | "ac";

const ACRES_PER_HECTARE = 2.47105;

/** Convert a value that's already in hectares into the given display unit. */
function areaFromHa(value: number, unit: AreaUnit): number {
  return unit === "ac" ? value * ACRES_PER_HECTARE : value;
}

/** Convert a value typed/displayed in the given unit back into hectares. */
export function toHectares(value: number, unit: AreaUnit): number {
  return unit === "ac" ? value / ACRES_PER_HECTARE : value;
}

/** Format a hectare value for display in the given unit. */
export function formatAreaValue(value: number, unit: AreaUnit): string {
  if (!Number.isFinite(value)) return "0";
  const converted = areaFromHa(value, unit);
  return trimZeros(converted, 2);
}

export const AREA_UNITS: AreaUnit[] = ["ha", "ac"];

// ── Seed rate ──────────────────────────────────────────────────────

export type SeedRateUnit = "kg/ha" | "lb/ac";

// 1 kg/ha = 2.20462 lb / 2.47105 ac
const LB_PER_ACRE_PER_KG_PER_HA = 2.20462 / ACRES_PER_HECTARE;

/** Convert a value that's already in kg/ha into the given display unit. */
function seedRateFromKgHa(value: number, unit: SeedRateUnit): number {
  return unit === "lb/ac" ? value * LB_PER_ACRE_PER_KG_PER_HA : value;
}

/** Convert a value typed/displayed in the given unit back into kg/ha. */
export function toKgPerHa(value: number, unit: SeedRateUnit): number {
  return unit === "lb/ac" ? value / LB_PER_ACRE_PER_KG_PER_HA : value;
}

/** Format a kg/ha value for display in the given unit. */
export function formatSeedRateValue(value: number, unit: SeedRateUnit): string {
  if (!Number.isFinite(value)) return "0";
  const converted = seedRateFromKgHa(value, unit);
  return trimZeros(converted, unit === "lb/ac" ? 1 : 0);
}

export const SEED_RATE_UNITS: SeedRateUnit[] = ["kg/ha", "lb/ac"];

// ── shared ─────────────────────────────────────────────────────────

function trimZeros(value: number, decimals: number): string {
  return value
    .toFixed(decimals)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}
