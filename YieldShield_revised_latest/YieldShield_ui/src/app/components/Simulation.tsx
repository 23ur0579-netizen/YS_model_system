import { useMemo, useState } from "react";
import {
  MapPin, CalendarDays, Droplets, ThermometerSun, FlaskConical, CloudRain, LandPlot,
  Ruler, Sprout, Wheat, Leaf, TrendingUp, Gauge, RotateCcw, UserCheck, Info, BookOpen, Plus, X,
} from "lucide-react";
import { useStore, predictYield, plantingWindow, adminCrop, moisturePctToMm } from "../store";
import { BARANGAY_DATA, getPlantingTechniques, seasonForMonth, Season, techniqueLabel } from "../data/binalonan";
import { useT } from "../i18n";
import { AreaUnit, SeedRateUnit, AREA_UNITS, SEED_RATE_UNITS, toHectares, toKgPerHa, formatAreaValue, formatSeedRateValue } from "../lib/units";
import { YieldValue, AreaValue } from "./UnitValue";
import { SearchableSelect, SearchableOption } from "./SearchableSelect";
import { VarietyCompareModal } from "./VarietyCompare";

const inputCls =
  "w-full h-10 px-3 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";

function Field({ label, children, hint }: { label: React.ReactNode; children: React.ReactNode; hint?: string }) {
  return (
    <label className="block">
      <div className="text-sm text-slate-700 mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-slate-400 mt-1">{hint}</div>}
    </label>
  );
}

const PALAY_VARIETIES = [
  "NSIC Rc 222 (Hybrid Inbred)", "NSIC Rc 216", "NSIC Rc 160", "Mestizo 20 (Hybrid)", "PSB Rc 82",
  // Traditional/heirloom lowland varieties — see MyFarm.tsx's
  // CroppingModal for the same list and the research behind it.
  "Sinandomeng (Traditional)", "Wagwag (Traditional)", "Dinorado (Traditional)", "Milagrosa (Traditional)",
];
const CORN_VARIETIES = [
  "IPB Var 6 (Yellow Hybrid)", "Pioneer P3862", "NK 6410", "Macho F1", "USM Var 10 (OPV)",
  "Lagkitan (Traditional)",
];

// Rice/corn "type" produced by each seed variety — what the harvested
// grain is typically marketed/consumed as (e.g. a variety like Mestizo 20
// yields fragrant, Jasmine-type rice; NSIC Rc 222 yields ordinary
// well-milled white rice).
const VARIETY_PRODUCT_TYPE: Record<string, string> = {
  "NSIC Rc 222 (Hybrid Inbred)": "Well-milled White Rice (non-aromatic)",
  "NSIC Rc 216": "Well-milled White Rice (non-aromatic)",
  "NSIC Rc 160": "Well-milled White Rice (non-aromatic)",
  "Mestizo 20 (Hybrid)": "Aromatic / Fragrant Rice (e.g. Jasmine-type)",
  "PSB Rc 82": "Well-milled White Rice (non-aromatic)",
  "Sinandomeng (Traditional)": "Well-milled White Rice (ordinary, the most widely grown traditional lowland variety)",
  "Wagwag (Traditional)": "Well-milled White Rice (hardy, low-cost lowland variety)",
  "Dinorado (Traditional)": "Aromatic / Fragrant Rice (premium, pinkish-tinged grain)",
  "Milagrosa (Traditional)": "Aromatic / Fragrant Rice (premium traditional variety)",
  "IPB Var 6 (Yellow Hybrid)": "Yellow Corn (feed/industrial grade)",
  "Pioneer P3862": "Yellow Corn (feed/industrial grade)",
  "NK 6410": "Yellow Corn (feed/industrial grade)",
  "Macho F1": "Sweet Corn (table/fresh consumption)",
  "USM Var 10 (OPV)": "White Corn (food grade)",
  "Lagkitan (Traditional)": "Glutinous / Waxy Corn (for boiled corn, binatog, cornick — not feed corn)",
};

function SimulationPanel({ onRemove, panelLabel, compact }: { onRemove?: () => void; panelLabel?: string; compact?: boolean }) {
  const { user, cropVarieties } = useStore();
  const tr = useT();
  const only = adminCrop(user?.adminRole); // "Corn" | "Palay (Rice)" | "all" | "none"
  const lockedCrop = only === "Corn" || only === "Palay (Rice)";
  const [compareOpen, setCompareOpen] = useState(false);

  const blank = {
    consultant: user?.name ?? "",
    barangay: "Poblacion",
    crop: (lockedCrop ? only : "Palay (Rice)") as "Palay (Rice)" | "Corn",
    variety: cropVarieties.find((v) => v.crop === (lockedCrop && only === "Corn" ? "Corn" : "Palay (Rice)"))?.name
      ?? (lockedCrop && only === "Corn" ? CORN_VARIETIES[0] : PALAY_VARIETIES[0]),
    area: 1.0,
    plantingDate: new Date().toISOString().slice(0, 10),
    technique: "",
    spacing: 20,
    seedRate: 40,
    ph: BARANGAY_DATA["Poblacion"].ph,
    moisture: BARANGAY_DATA["Poblacion"].moisture,
    temperature: BARANGAY_DATA["Poblacion"].temperature,
    rainfall: BARANGAY_DATA["Poblacion"].rainfall,
  };

  const [form, setForm] = useState(blank);
  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) { setForm((f) => ({ ...f, [k]: v })); }

  // form.area is always stored in hectares and form.seedRate always in
  // kg/ha (that's what predictYield/the backend expect) — these are just
  // the units the two fields are currently being typed/displayed in.
  const [areaUnit, setAreaUnit] = useState<AreaUnit>("ha");
  const [areaText, setAreaText] = useState(formatAreaValue(blank.area, "ha"));
  const [seedRateUnit, setSeedRateUnit] = useState<SeedRateUnit>("kg/ha");
  const [seedRateText, setSeedRateText] = useState(formatSeedRateValue(blank.seedRate, "kg/ha"));

  function onAreaTextChange(text: string) {
    setAreaText(text);
    const n = parseFloat(text);
    if (Number.isFinite(n)) set("area", toHectares(n, areaUnit));
  }
  function onAreaUnitChange(next: AreaUnit) {
    setAreaText(formatAreaValue(form.area, next));
    setAreaUnit(next);
  }
  function onSeedRateTextChange(text: string) {
    setSeedRateText(text);
    const n = parseFloat(text);
    if (Number.isFinite(n)) set("seedRate", toKgPerHa(n, seedRateUnit));
  }
  function onSeedRateUnitChange(next: SeedRateUnit) {
    setSeedRateText(formatSeedRateValue(form.seedRate, next));
    setSeedRateUnit(next);
  }

  // Auto-populate soil/climate features from the selected barangay.
  function loadBarangay(key: string) {
    const b = BARANGAY_DATA[key];
    setForm((f) => ({ ...f, barangay: key, ph: b.ph, moisture: b.moisture, temperature: b.temperature, rainfall: b.rainfall }));
  }

  const season: Season = seasonForMonth(new Date(form.plantingDate).getMonth());
  const soilType = BARANGAY_DATA[form.barangay].soilType;
  // Prefer the real NSIC/PhilRice catalog once loaded; fall back to the
  // old hardcoded list otherwise, same reasoning as MyFarm.tsx's
  // CroppingModal. The currently-selected value is always kept
  // selectable even if it isn't in whichever list wins.
  const catalogVarieties = useMemo(() => cropVarieties.filter((v) => v.crop === form.crop), [cropVarieties, form.crop]);
  const selectedVarietyInfo = catalogVarieties.find((v) => v.name === form.variety);
  // Admin/Simulation deliberately has no seed-source concept — every
  // variety for the crop is always offered, catalog first with the old
  // hardcoded list as a fallback if it hasn't loaded, same as before.
  const varietyOptions: SearchableOption[] = useMemo(() => {
    let opts: SearchableOption[] = catalogVarieties.length > 0
      ? catalogVarieties.map((v) => ({
          value: v.name,
          label: v.name,
          subtitle: [v.category, v.grainType, v.maturityDays != null ? `~${v.maturityDays}d maturity` : null].filter(Boolean).join(" · "),
        }))
      : (form.crop === "Corn" ? CORN_VARIETIES : PALAY_VARIETIES).map((name) => ({ value: name, label: name, subtitle: VARIETY_PRODUCT_TYPE[name] }));
    if (!opts.some((o) => o.value === form.variety)) opts = [{ value: form.variety, label: form.variety }, ...opts];
    return opts;
  }, [catalogVarieties, form.crop, form.variety]);

  const techniques = useMemo(
    () => getPlantingTechniques(form.crop, { moisture: form.moisture, rainfall: form.rainfall, soilType }, season),
    [form.crop, form.moisture, form.rainfall, soilType, season],
  );

  const preview = useMemo(
    () => predictYield({
      crop: form.crop, ph: form.ph, moisture: form.moisture, temperature: form.temperature,
      rainfall: form.rainfall, plantingDate: form.plantingDate, technique: form.technique || undefined, spacing: form.spacing,
      varietyAvgYieldTHa: selectedVarietyInfo?.averageYieldTHa ?? undefined,
    }),
    [form, selectedVarietyInfo],
  );

  const win = plantingWindow(form.crop, form.plantingDate);
  const totalYield = +(preview.yieldPerHa * form.area).toFixed(1);

  return (
    <div className="w-full">
      <div className={`flex ${compact ? "flex-col" : "flex-col lg:flex-row"} gap-6 items-start max-w-7xl`}>
        {/* ── Form ── */}
        <div className="flex-1 min-w-0 bg-white border border-slate-100 rounded-2xl overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
            <div>
              <div className="text-slate-900 flex items-center gap-2">
                {panelLabel && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">{panelLabel}</span>}
                {tr("sim.inputsTitle")}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{tr("sim.inputsHint")}</div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setForm(blank);
                  setAreaText(formatAreaValue(blank.area, areaUnit));
                  setSeedRateText(formatSeedRateValue(blank.seedRate, seedRateUnit));
                }}
                className="text-xs text-slate-600 hover:text-slate-900 flex items-center gap-1.5 h-8 px-3 rounded-lg border border-slate-200 hover:bg-slate-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> {tr("sim.reset")}
              </button>
              {onRemove && (
                <button
                  onClick={onRemove}
                  title="Remove this comparison"
                  className="h-8 w-8 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 text-slate-400 flex items-center justify-center"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-5">
            <div className="col-span-1 sm:col-span-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400">
              <span className="h-px flex-1 bg-slate-100" /> {tr("sim.consultation")} <span className="h-px flex-1 bg-slate-100" />
            </div>

            <Field label={tr("sim.consultant")}>
              <input className={inputCls} value={form.consultant} onChange={(e) => set("consultant", e.target.value)} />
            </Field>
            <Field label={tr("sim.barangayAutoload")}>
              <div className="relative">
                <MapPin className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <select className={`${inputCls} pl-9`} value={form.barangay} onChange={(e) => loadBarangay(e.target.value)}>
                  {Object.entries(BARANGAY_DATA)
                    .sort((a, b) => a[1].label.localeCompare(b[1].label))
                    .map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
                </select>
              </div>
            </Field>

            <Field label={tr("sim.crop")}>
              <select className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`} value={form.crop} disabled={lockedCrop}
                onChange={(e) => { const c = e.target.value as "Palay (Rice)" | "Corn"; const firstVariety = cropVarieties.find((v) => v.crop === c)?.name; setForm((f) => ({ ...f, crop: c, variety: firstVariety ?? (c === "Corn" ? CORN_VARIETIES : PALAY_VARIETIES)[0], spacing: c === "Corn" ? 25 : 20 })); }}>
                <option value="Palay (Rice)">{tr("common.crop.palay")}</option>
                <option value="Corn">{tr("common.crop.corn")}</option>
              </select>
            </Field>
            <Field label={
              <div className="flex items-center justify-between">
                <span>{tr("sim.variety")}</span>
                <button
                  type="button"
                  onClick={() => setCompareOpen(true)}
                  className="text-xs text-emerald-700 hover:text-emerald-800 flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Compare varieties
                </button>
              </div>
            }>
              <SearchableSelect
                value={form.variety}
                onChange={(v) => set("variety", v)}
                options={varietyOptions}
                placeholder="Type to search a variety…"
                allowCustom
                customLabel={(q) => `Add "${q}" as a new variety`}
              />
              {selectedVarietyInfo ? (
                <div className="text-xs text-slate-500 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {selectedVarietyInfo.category && <span>{selectedVarietyInfo.category}</span>}
                  {selectedVarietyInfo.maturityDays != null && <span>~{selectedVarietyInfo.maturityDays}d maturity</span>}
                  {selectedVarietyInfo.averageYieldTHa != null && <span>avg {selectedVarietyInfo.averageYieldTHa} t/ha</span>}
                  {selectedVarietyInfo.droughtTolerance && <span>{selectedVarietyInfo.droughtTolerance} drought tolerance</span>}
                </div>
              ) : VARIETY_PRODUCT_TYPE[form.variety] && (
                <div className="text-xs text-slate-500 mt-1.5">
                  Rice/corn type produced: <span className="text-slate-700">{VARIETY_PRODUCT_TYPE[form.variety]}</span>
                </div>
              )}
            </Field>

            <Field label={tr("sim.fieldSize")} hint={tr("sim.fieldSizeHint")}>
              <div className="relative flex items-center">
                <LandPlot className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="number" step="0.1" min={0} className={`${inputCls} pl-9 pr-14`} value={areaText} onChange={(e) => onAreaTextChange(e.target.value)} />
                <select
                  value={areaUnit}
                  onChange={(e) => onAreaUnitChange(e.target.value as AreaUnit)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs bg-transparent border-none outline-none cursor-pointer text-slate-500"
                >
                  {AREA_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </Field>
            <Field label={tr("sim.plantingDate")}>
              <div className="relative">
                <CalendarDays className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="date" className={`${inputCls} pl-9`} value={form.plantingDate} onChange={(e) => set("plantingDate", e.target.value)} />
              </div>
            </Field>

            <div className="col-span-1 sm:col-span-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400 mt-1">
              <span className="h-px flex-1 bg-slate-100" /> {tr("sim.plantingTechnique")} <span className="h-px flex-1 bg-slate-100" />
            </div>

            <div className="col-span-1 sm:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {techniques.map((tech) => {
                const Icon = tech.icon;
                const active = form.technique === tech.name;
                return (
                  <button key={tech.name} type="button" onClick={() => set("technique", active ? "" : tech.name)}
                    className={`text-left rounded-xl border p-3 flex gap-2.5 transition-colors ${active ? "border-emerald-400 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-slate-800">{tr(tech.nameKey)}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tech.tagColor}`}>{tr(tech.tagKey)}</span>
                        {!tech.recommended && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{tr("technique.tag.notRecommended")}</span>}
                      </div>
                      <div className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">{tr(tech.descKey)}</div>
                    </div>
                  </button>
                );
              })}
            </div>

            <Field label={tr("sim.spacing")}>
              <div className="relative">
                <Ruler className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="number" min={1} className={`${inputCls} pl-9`} value={form.spacing} onChange={(e) => set("spacing", +e.target.value)} />
              </div>
            </Field>
            <Field label={form.crop === "Corn" ? tr("sim.seedingRate") : tr("sim.seedlingRate")}>
              <div className="relative flex items-center">
                <input type="number" min={0} className={`${inputCls} pr-16`} value={seedRateText} onChange={(e) => onSeedRateTextChange(e.target.value)} />
                <select
                  value={seedRateUnit}
                  onChange={(e) => onSeedRateUnitChange(e.target.value as SeedRateUnit)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs bg-transparent border-none outline-none cursor-pointer text-slate-500"
                >
                  {SEED_RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </Field>

            <div className="col-span-1 sm:col-span-2 flex items-center gap-2 text-xs uppercase tracking-wide text-slate-400 mt-1">
              <span className="h-px flex-1 bg-slate-100" /> {tr("sim.soilClimateFrom")} {BARANGAY_DATA[form.barangay].label}) <span className="h-px flex-1 bg-slate-100" />
            </div>

            <Field label={tr("sim.soilPH")}>
              <div className="relative">
                <FlaskConical className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-emerald-600" />
                <input type="number" step="0.1" className={`${inputCls} pl-9`} value={form.ph} onChange={(e) => set("ph", +e.target.value)} />
              </div>
            </Field>
            <Field label={tr("sim.soilMoisture")}>
              <div className="relative">
                <Droplets className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-sky-600" />
                <input type="number" className={`${inputCls} pl-9`} value={form.moisture} onChange={(e) => set("moisture", +e.target.value)} />
              </div>
            </Field>
            <Field label={tr("sim.temperature")}>
              <div className="relative">
                <ThermometerSun className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-amber-600" />
                <input type="number" className={`${inputCls} pl-9`} value={form.temperature} onChange={(e) => set("temperature", +e.target.value)} />
              </div>
            </Field>
            <Field label={tr("sim.rainfall")}>
              <div className="relative">
                <CloudRain className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-sky-700" />
                <input type="number" className={`${inputCls} pl-9`} value={form.rainfall} onChange={(e) => set("rainfall", +e.target.value)} />
              </div>
            </Field>

            <div className="col-span-1 sm:col-span-2 rounded-xl bg-slate-50 border border-slate-100 px-4 py-2.5 flex items-center gap-2 text-xs text-slate-500">
              <Info className="h-3.5 w-3.5 text-slate-400 shrink-0" />
              {tr("sim.soilFamily")} <span className="text-slate-700">{soilType}</span> · {tr("sim.seasonLabel")} <span className="text-slate-700">{season === "Wet" ? tr("cal.wetSeasonShort") : tr("cal.drySeasonShort")}</span>. {tr("sim.simOnlyNotSaved")}
            </div>
          </div>
        </div>

        {/* ── Live result — floats/sticks alongside the form on desktop so
            it stays visible while scrolling through a long simulation
            form; on mobile it just sits inline (a fixed floating card
            there would cover too much of a narrow screen). ── */}
        <div className={compact ? "w-full shrink-0 space-y-3" : "w-full lg:w-80 shrink-0 space-y-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pb-2"}>
          <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white p-5">
            <div className="flex items-center gap-2 text-emerald-100/90 text-sm">
              {form.crop === "Corn" ? <Wheat className="h-4 w-4" /> : <Leaf className="h-4 w-4" />} {tr("sim.simulatedYield")}
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <YieldValue valueTHa={preview.yieldPerHa} className="text-4xl tracking-tight" tone="light" />
            </div>
            <div className="mt-1 text-sm text-emerald-100/80">≈ {totalYield} t {tr("sim.totalOver")} <AreaValue valueHa={form.area} tone="light" /></div>
            <div className="mt-4 flex items-center gap-2">
              <Gauge className="h-4 w-4 text-emerald-100/80" />
              <div className="flex-1 h-1.5 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-white" style={{ width: `${preview.confidence}%` }} />
              </div>
              <span className="text-sm">{preview.confidence}%</span>
            </div>
            <div className="text-[11px] text-emerald-100/70 mt-1">{tr("sim.modelConfidence")}</div>
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-4 space-y-3">
            <div className="text-sm text-slate-700 flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-600" /> {tr("sim.contributingFactors")}</div>
            <FactorRow label={tr("sim.plantingWindow")} value={win.inWindow ? tr("sim.ideal") : `${win.distance} ${tr("sim.moOff")}`} good={win.inWindow} note={win.nearest} />
            <FactorRow label={tr("sim.cropDistance")} value={`${form.spacing} cm`} good={Math.abs(form.spacing - (form.crop === "Corn" ? 25 : 20)) <= 5} />
            <FactorRow label={tr("sim.technique")} value={form.technique ? techniqueLabel(tr, form.technique) : tr("sim.notSet")} good={!!form.technique} />
            <FactorRow label={tr("sim.soilPH")} value={String(form.ph)} good={Math.abs(form.ph - 6.4) <= 0.5} />
            <FactorRow label={tr("sim.moisture")} value={`${moisturePctToMm(form.moisture)}mm`} good={form.moisture >= (form.crop === "Corn" ? 45 : 55)} />
          </div>

          <div className="bg-white border border-slate-100 rounded-2xl p-4">
            <div className="text-sm text-slate-700 flex items-center gap-2 mb-2"><BookOpen className="h-4 w-4 text-emerald-600" /> {tr("sim.recommendedForSeason")} {season === "Wet" ? tr("cal.wetSeasonShort") : tr("cal.drySeasonShort")} {tr("sim.seasonWord")}</div>
            <ul className="space-y-1.5">
              {techniques.filter((tech) => tech.recommended).slice(0, 3).map((tech) => (
                <li key={tech.name} className="flex items-start gap-2 text-xs text-slate-600">
                  <Sprout className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" /> {tr(tech.nameKey)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      {compareOpen && <VarietyCompareModal onClose={() => setCompareOpen(false)} initialCrop={form.crop} />}
    </div>
  );
}

function FactorRow({ label, value, good, note }: { label: string; value: string; good: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}{note ? ` · ${note}` : ""}</span>
      <span className={`text-xs px-2 py-0.5 rounded-full border ${good ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-amber-50 text-amber-700 border-amber-200"}`}>{value}</span>
    </div>
  );
}

// Outer shell: the walk-in banner (shown once, not per comparison
// panel), the compare-simulations trigger, and 1–2 independent
// SimulationPanel instances stacked underneath. Each panel keeps its
// own form/preview state entirely — this shell only tracks how many
// are open, not their contents, so comparing never means reconciling
// two panels' state against each other.
export function Simulation() {
  const tr = useT();
  // This page is admin-only (see Sidebar.tsx's ADMIN_NAV — "simulation"
  // isn't in FARMER_NAV), so the trigger button is always the labeled
  // "Compare simulations" version; there's no separate farmer-facing
  // variant of this page to design for.
  const [comparing, setComparing] = useState(false);

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      {/* Walk-in banner */}
      <div className="max-w-7xl mb-5 flex items-start gap-3 rounded-2xl border border-sky-200 bg-sky-50/70 px-5 py-4">
        <div className="h-10 w-10 rounded-xl bg-sky-100 text-sky-700 flex items-center justify-center shrink-0">
          <UserCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sky-900">{tr("sim.bannerTitle")}</div>
          <div className="text-sm text-sky-700/80 mt-0.5">
            {tr("sim.bannerBody")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setComparing(true)}
          title="Open two simulations side by side to compare"
          className="shrink-0 flex items-center gap-1.5 h-9 px-3.5 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm"
        >
          <Plus className="h-4 w-4" /> Compare simulations
        </button>
      </div>

      <div className="max-w-7xl">
        <SimulationPanel />
      </div>

      {/* Comparison — a true side-by-side modal overlay (two cards,
          one shared backdrop), not a second panel inserted into the
          page below the first — so comparing two setups never means
          scrolling down to see the second one. */}
      {comparing && (
        <div className="fixed inset-0 z-50 flex flex-col lg:flex-row items-center justify-center gap-4 p-4 overflow-auto">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={() => setComparing(false)} />
          <button
            onClick={() => setComparing(false)}
            title="Close comparison"
            className="absolute top-4 right-4 z-10 h-9 w-9 rounded-full bg-white/90 hover:bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-500 hover:text-slate-800"
          >
            <X className="h-4 w-4" />
          </button>
          <div className="relative bg-white rounded-2xl shadow-2xl w-full lg:w-[47vw] max-w-2xl max-h-[90vh] overflow-y-auto p-4">
            <SimulationPanel panelLabel="Simulation 1" compact />
          </div>
          <div className="relative bg-white rounded-2xl shadow-2xl w-full lg:w-[47vw] max-w-2xl max-h-[90vh] overflow-y-auto p-4">
            <SimulationPanel panelLabel="Simulation 2" onRemove={() => setComparing(false)} compact />
          </div>
        </div>
      )}
    </div>
  );
}
