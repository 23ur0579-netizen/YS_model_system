import { useState } from "react";
import {
  YieldUnit, AreaUnit, SeedRateUnit,
  YIELD_UNITS, AREA_UNITS, SEED_RATE_UNITS,
  formatYieldValue, formatAreaValue, formatSeedRateValue,
} from "../lib/units";

// Small inline "<value> <unit ▾>" widgets. Each keeps its own local unit
// selection (a dropdown right next to the number it labels) — switching
// it only changes how that one figure is displayed; the canonical value
// passed in (and everything in the store/backend) never changes.
//
// `className` sizes/colors the number itself (e.g. "text-2xl"); the unit
// dropdown next to it always stays compact so it doesn't blow up layouts.

function UnitSelect<U extends string>({
  value, options, onChange, tone,
}: { value: U; options: U[]; onChange: (u: U) => void; tone?: "light" }) {
  // appearance-none strips the native dropdown arrow with nothing to
  // replace it, so these looked like plain text — nothing suggested a
  // farmer could click "t/ha" to switch units at all. The ⏷ here is a
  // second, always-visible element next to the (still fully functional,
  // just visually blended-in) <select> itself, specifically so every
  // unit-conversion control in the app reads the same way at a glance.
  return (
    <span className="inline-flex items-center gap-0.5">
      <select
        value={value}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => { e.stopPropagation(); onChange(e.target.value as U); }}
        className={`text-xs bg-transparent border-none outline-none cursor-pointer appearance-none pr-0 ${
          tone === "light" ? "text-emerald-100/80" : "text-slate-400"
        } hover:opacity-80`}
      >
        {options.map((o) => (
          <option key={o} value={o} className="text-slate-800">{o}</option>
        ))}
      </select>
      <span className={`text-[10px] leading-none select-none ${tone === "light" ? "text-emerald-100/80" : "text-slate-400"}`} aria-hidden="true">⏷</span>
    </span>
  );
}

export function YieldValue({
  valueTHa, tone, className = "", initialUnit = "t/ha",
}: { valueTHa: number; tone?: "light"; className?: string; initialUnit?: YieldUnit }) {
  const [unit, setUnit] = useState<YieldUnit>(initialUnit);
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={className}>{formatYieldValue(valueTHa, unit)}</span>
      <UnitSelect value={unit} options={YIELD_UNITS} onChange={setUnit} tone={tone} />
    </span>
  );
}

export function AreaValue({
  valueHa, tone, className = "", initialUnit = "ha",
}: { valueHa: number; tone?: "light"; className?: string; initialUnit?: AreaUnit }) {
  const [unit, setUnit] = useState<AreaUnit>(initialUnit);
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={className}>{formatAreaValue(valueHa, unit)}</span>
      <UnitSelect value={unit} options={AREA_UNITS} onChange={setUnit} tone={tone} />
    </span>
  );
}

export function SeedRateValue({
  valueKgHa, tone, className = "", initialUnit = "kg/ha",
}: { valueKgHa: number; tone?: "light"; className?: string; initialUnit?: SeedRateUnit }) {
  const [unit, setUnit] = useState<SeedRateUnit>(initialUnit);
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className={className}>{formatSeedRateValue(valueKgHa, unit)}</span>
      <UnitSelect value={unit} options={SEED_RATE_UNITS} onChange={setUnit} tone={tone} />
    </span>
  );
}
