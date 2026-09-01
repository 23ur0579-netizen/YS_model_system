import { useEffect, useMemo, useState, ReactNode } from "react";
import { Tractor, MapPin, Layers, TrendingUp, Leaf, CheckCircle2, Clock, Plus, FlaskConical, Droplets, ThermometerSun, CloudRain, Wheat, Loader2, BookOpen, Pencil, Sparkles, AlertTriangle, ChevronDown, Download, CalendarClock, X, Ruler, Trash2, LandPlot, Sprout, PlayCircle, Package, Info, Copy } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useStore, Prediction, Field, plantingWindow, predictYield, adminCrop, remainingFieldArea } from "../store";
import { BARANGAY_FACTS, BARANGAY_DATA, getPlantingTechniques, seasonForMonth, techniqueLabel } from "../data/binalonan";
import { toast } from "sonner";
import { useT } from "../i18n";
import * as api from "../lib/api";
import { FieldMapPlotter } from "./FieldMapPlotter";
import { FieldLocationMap } from "./FieldLocationMap";
import { WeekPlan } from "./WeekPlan";
import { formatYieldValue, toTonnesPerHa, YieldUnit, YIELD_UNITS } from "../lib/units";
import { polygonAreaHa } from "../lib/geo";
import { YieldValue, AreaValue, SeedRateValue } from "./UnitValue";
import { StatCard as SummaryCard } from "./StatCard";
import { SearchableSelect, SearchableOption } from "./SearchableSelect";

function harvestDays(crop: Prediction["crop"]) {
  return crop === "Palay (Rice)" ? 120 : 90;
}

function estimatedHarvest(plantingDate: string, crop: Prediction["crop"]): string {
  const d = new Date(plantingDate);
  d.setDate(d.getDate() + harvestDays(crop));
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function ConfidenceArc({ value }: { value: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" className="shrink-0">
      <circle cx="34" cy="34" r={r} fill="none" stroke="#e2e8f0" strokeWidth="5" />
      <circle
        cx="34" cy="34" r={r}
        fill="none"
        stroke={value >= 85 ? "#10b981" : value >= 70 ? "#f59e0b" : "#ef4444"}
        strokeWidth="5"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeDashoffset={circ * 0.25}
        strokeLinecap="round"
      />
      <text x="34" y="37" textAnchor="middle" fontSize="13" fontWeight="700" fill="#1e293b">{value}%</text>
      <text x="34" y="48" textAnchor="middle" fontSize="8" fill="#94a3b8">conf.</text>
    </svg>
  );
}

function Stat({ label, value, highlight }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm ${highlight ? "text-emerald-700 font-medium" : "text-slate-700"}`}>{value}</div>
    </div>
  );
}

function PlotDetail({ p }: { p: Prediction }) {
  const t = useT();
  const harvested = p.actualYield != null || !!p.harvestDate;
  const isPalay = p.crop === "Palay (Rice)";
  const [showPrediction, setShowPrediction] = useState(true);

  // Planting-technique recommendation for this specific plot.
  const soilType = BARANGAY_FACTS[p.barangay]?.soilType ?? "Sandy Loam";
  const season = seasonForMonth(new Date(p.plantingDate).getMonth());
  const techniques = getPlantingTechniques(p.crop, { moisture: p.moisture, rainfall: p.rainfall, soilType }, season);

  return (
    <div className="space-y-5">
      {/* Header strip */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6 flex items-start gap-6">
        <ConfidenceArc value={p.confidence} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2.5 py-0.5 rounded-full text-xs border ${isPalay ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-amber-50 border-amber-200 text-amber-800"}`}>
              {p.crop}
            </span>
            {harvested && (
              <span className="px-2.5 py-0.5 rounded-full text-xs bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3" /> {t("farm.harvested")}
              </span>
            )}
          </div>
          <div className="mt-2 text-slate-900 text-xl tracking-tight">{p.plotId}</div>
          <div className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
            <MapPin className="h-3.5 w-3.5" />
            {p.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")}, Binalonan
          </div>
          {p.notes && <div className="mt-2 text-xs text-slate-500 italic">"{p.notes}"</div>}
        </div>
        <button
          onClick={() => setShowPrediction((s) => !s)}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
        >
          {showPrediction ? t("farm.hidePrediction") : t("farm.viewPrediction")}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showPrediction ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/* Embedded yield prediction */}
      {showPrediction && <EmbeddedPrediction p={p} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Plot metrics */}
        <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
          <div className="text-sm text-slate-700">{t("farm.plotMetrics")}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Stat label="Area" value={<AreaValue valueHa={p.area} />} />
            <Stat label="Predicted yield" value={<YieldValue valueTHa={p.predictedYield} />} />
            <Stat label="Planted" value={new Date(p.plantingDate).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })} />
            {harvested
              ? <Stat label="Actual yield" value={<YieldValue valueTHa={p.actualYield!} className="text-emerald-700 font-medium" />} highlight />
              : <Stat label="Est. harvest" value={estimatedHarvest(p.plantingDate, p.crop)} />}
          </div>

          {/* Agronomic factors captured for this cropping period */}
          {(p.variety || p.technique || p.spacing || p.seedRate) && (
            <div className="pt-1 grid grid-cols-1 sm:grid-cols-2 gap-4 border-t border-slate-100">
              <div className="pt-3"><Stat label="Variety" value={p.variety ?? "—"} /></div>
              <div className="pt-3"><Stat label="Technique" value={techniqueLabel(t, p.technique) || "—"} /></div>
              {p.spacing != null && <Stat label="Crop distance" value={`${p.spacing} cm`} />}
              {p.seedRate != null && <Stat label="Seeding rate" value={<SeedRateValue valueKgHa={p.seedRate} />} />}
            </div>
          )}
        </div>

        {/* Soil & climate */}
        <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm text-slate-700">{t("farm.soilClimate")}</div>
            <div className="text-xs text-slate-400">{new Date(p.plantingDate).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}</div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <EnvCell icon={<FlaskConical className="h-3.5 w-3.5 text-emerald-600" />} label="Soil pH" value={String(p.ph)} />
            <EnvCell icon={<Droplets className="h-3.5 w-3.5 text-sky-600" />} label="Moisture" value={`${p.moisture}%`} />
            <EnvCell icon={<ThermometerSun className="h-3.5 w-3.5 text-amber-600" />} label="Temperature" value={`${p.temperature}°C`} />
            <EnvCell icon={<CloudRain className="h-3.5 w-3.5 text-sky-700" />} label="Rainfall" value={`${p.rainfall} mm`} />
          </div>
          <div className="text-xs text-slate-400">Temperature &amp; rainfall recorded via live Open-Meteo data at time of entry; soil pH/moisture from static municipal reference data.</div>
        </div>
      </div>

      {/* Harvest recording — only once the crop is actually in the ground */}
      {new Date(p.plantingDate).getTime() <= Date.now() && <HarvestPanel p={p} />}

      {/* Planting technique — chosen technique for this cropping, and the
          full set of techniques available for this crop/conditions, side
          by side. Works identically for Palay and Corn since both pull
          from the same getPlantingTechniques(p.crop, ...) call above. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Chosen technique */}
        <div className={`rounded-2xl overflow-hidden border ${p.technique ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-100"}`}>
          <div className={`px-5 py-4 border-b flex items-center gap-2 ${p.technique ? "border-emerald-100" : "border-slate-100"}`}>
            <CheckCircle2 className={`h-4 w-4 ${p.technique ? "text-emerald-600" : "text-slate-300"}`} />
            <span className="text-sm text-slate-700">{t("farm.chosenTechniqueTitle")}</span>
          </div>
          {(() => {
            const chosen = techniques.find((tc) => tc.name === p.technique);
            if (!p.technique || !chosen) {
              return <div className="p-5 text-sm text-slate-400">{t("farm.noTechniqueChosen")}</div>;
            }
            const Icon = chosen.icon;
            return (
              <div className="p-5 space-y-2">
                <div className="flex items-start gap-2.5">
                  <div className="h-9 w-9 rounded-lg bg-emerald-100 border border-emerald-200 flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4 text-emerald-700" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm text-slate-800">{t(chosen.nameKey)}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${chosen.tagColor}`}>{t(chosen.tagKey)}</span>
                      {!chosen.recommended && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{t("technique.tag.notRecommended")}</span>}
                    </div>
                    {chosen.conditionsKey && <div className="text-[11px] text-slate-500 mt-0.5">{t(chosen.conditionsKey, chosen.conditionsParams)}</div>}
                  </div>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{t(chosen.descKey)}</p>
              </div>
            );
          })()}
        </div>

        {/* All techniques for this crop/conditions */}
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-emerald-600" />
            <span className="text-sm text-slate-700">{t("farm.techniques")}</span>
            <span className="ml-auto text-xs text-slate-400">{p.crop === "Palay (Rice)" ? "Palay" : "Corn"} · {season} season · {soilType}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {techniques.map((tech, i) => {
              const Icon = tech.icon;
              const isChosen = !!p.technique && tech.name === p.technique;
              return (
                <div key={i} className={`p-4 space-y-2 ${isChosen ? "bg-emerald-50 ring-1 ring-inset ring-emerald-300" : ""}`}>
                  <div className="flex items-start gap-2.5">
                    <div className={`h-8 w-8 rounded-lg border flex items-center justify-center shrink-0 ${isChosen ? "bg-emerald-100 border-emerald-200" : "bg-emerald-50 border-emerald-100"}`}>
                      <Icon className="h-4 w-4 text-emerald-700" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm text-slate-800">{t(tech.nameKey)}</span>
                        {isChosen && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-600 text-white">{t("farm.chosenTechnique")}</span>}
                        {i === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">{t("farm.bestFit")}</span>}
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tech.tagColor}`}>{t(tech.tagKey)}</span>
                        {!tech.recommended && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{t("technique.tag.notRecommended")}</span>}
                      </div>
                      {tech.conditionsKey && <div className="text-[11px] text-slate-400 mt-0.5">{t(tech.conditionsKey, tech.conditionsParams)}</div>}
                    </div>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{t(tech.descKey)}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmbeddedPrediction({ p }: { p: Prediction }) {
  const { predictions, user } = useStore();
  const total = (p.predictedYield * p.area).toFixed(2);

  // Real cropping history for this specific field — every Prediction
  // sharing the same fieldId, i.e. actual past/planned cropping cycles on
  // this plot — rather than a fabricated multi-year series.
  const fieldHistory = useMemo(() => {
    const cycles = p.fieldId ? predictions.filter((x) => x.fieldId === p.fieldId) : [p];
    return cycles.slice().sort((a, b) => new Date(a.plantingDate).getTime() - new Date(b.plantingDate).getTime());
  }, [predictions, p.fieldId, p.id]);

  const history = fieldHistory.map((x) => ({
    y: new Date(x.plantingDate).toLocaleDateString("en-PH", { month: "short", year: "2-digit" }),
    v: x.actualYield ?? x.predictedYield,
  }));

  const prev = fieldHistory.length >= 2 ? fieldHistory[fieldHistory.length - 2] : null;
  const prevYield = prev ? prev.actualYield ?? prev.predictedYield : null;
  const delta = prevYield ? (((p.predictedYield - prevYield) / prevYield) * 100).toFixed(1) : null;

  const pw = plantingWindow(p.crop, p.plantingDate);
  const plantedMonth = new Date(p.plantingDate).toLocaleDateString("en-PH", { month: "long" });

  const factors = [
    { label: `Planting window (${plantedMonth})`, weight: Math.round(pw.score * 100) },
    { label: `Soil pH (${p.ph})`, weight: Math.max(50, Math.min(98, Math.round(100 - Math.abs(p.ph - 6.4) * 20))) },
    { label: `Moisture (${p.moisture}%)`, weight: Math.max(45, Math.min(95, Math.round(100 - Math.abs(p.moisture - 62)))) },
    { label: `Rainfall (${p.rainfall}mm)`, weight: Math.max(40, Math.min(95, Math.round(100 - Math.abs(p.rainfall - 145) / 3))) },
    { label: `Temperature (${p.temperature}°C)`, weight: Math.max(40, Math.min(95, Math.round(100 - Math.abs(p.temperature - 28) * 5))) },
  ];

  const advisories: string[] = [];
  if (pw.distance >= 1) {
    advisories.push(
      pw.distance === 1
        ? `Planting is slightly off the ideal calendar — the recommended window for this crop is ${pw.nearest}.`
        : `Planting date is well outside the ideal window (${pw.nearest}), which lowers the expected yield. Consider adjusting to the recommended window.`,
    );
  }
  if (p.moisture < 55) advisories.push("Soil moisture is low — irrigation recommended within the week.");
  if (p.rainfall < 100) advisories.push("Rainfall below seasonal norm — consider supplemental watering.");
  if (p.temperature > 32) advisories.push("High temperature stress likely — mulch to retain soil moisture.");
  if (p.ph < 5.5) advisories.push("Soil is acidic — apply agricultural lime before next cycle.");
  advisories.push("Consider split-application of nitrogen at the tillering stage.");
  advisories.push("Monitor for pest pressure as humidity trends rise.");

  function exportReport() {
    const blob = new Blob(
      [`YieldShield Prediction Report\n\nPlot: ${p.plotId}\nBarangay: ${p.barangay}\nFarmer: ${p.farmer}\nCrop: ${p.crop}\nArea: ${p.area} ha\n\nPredicted yield: ${p.predictedYield.toFixed(2)} t/ha\nTotal expected: ${total} tonnes\nConfidence: ${p.confidence}%\n\nGenerated: ${new Date().toLocaleString()}\n`],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.plotId}-prediction.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report exported.");
  }

  return (
    <div className="space-y-5">
      {p.filedByStaff && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-2xl px-4 py-3">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <div className="text-sm text-amber-900">
            {user?.role === "Admin"
              ? "This cropping was filed by staff on behalf of the farmer."
              : "Staff added this cropping on your behalf. Feel free to edit any of the details below — soil readings, planting date, variety, or anything else — to match your actual field."}
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Hero yield card */}
        <div className="col-span-2 bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 rounded-2xl p-7 text-white relative overflow-hidden">
          <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="flex items-center gap-2 text-emerald-200/90 text-sm">
            <Sparkles className="h-4 w-4" /> AI yield prediction · {new Date(p.createdAt).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })}
          </div>
          <div className="mt-4 flex items-end gap-8">
            <div>
              <div className="text-emerald-100/80 text-sm">Estimated Yield</div>
              <div className="mt-1 flex items-baseline gap-2">
                <YieldValue valueTHa={p.predictedYield} className="text-6xl tracking-tight" tone="light" />
              </div>
              {delta != null && (
                <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-100 text-xs">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {+delta >= 0 ? "+" : ""}{delta}% vs. previous cycle
                </div>
              )}
            </div>
            <div className="ml-auto text-right">
              <div className="text-emerald-100/80 text-sm">Model confidence</div>
              <div className="mt-1 text-4xl tracking-tight">{p.confidence}%</div>
            </div>
          </div>
          <div className="mt-5 inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/10 text-xs">
            {pw.inWindow ? (
              <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-200" /> Planted in the ideal window · {pw.nearest}</>
            ) : (
              <><AlertTriangle className="h-3.5 w-3.5 text-amber-200" /> {pw.distance} mo off ideal · best window: {pw.nearest}</>
            )}
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-white/5 px-3 py-2.5">
              <div className="text-emerald-200/80 text-xs">Crop</div>
              <div>{p.crop}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2.5">
              <div className="text-emerald-200/80 text-xs">Plot</div>
              <div>{p.plotId}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2.5">
              <div className="text-emerald-200/80 text-xs">Total expected</div>
              <div>{total} tonnes (<AreaValue valueHa={p.area} tone="light" />)</div>
            </div>
          </div>
          <div className="mt-6">
            <button onClick={exportReport} className="px-4 h-9 rounded-lg bg-white text-emerald-800 text-sm flex items-center gap-2">
              <Download className="h-4 w-4" />Export report
            </button>
          </div>
        </div>

        {/* Contributing factors */}
        <div className="bg-white border border-slate-100 rounded-2xl p-5">
          <div className="text-slate-900 text-sm">Contributing factors</div>
          <div className="text-xs text-slate-500 mt-0.5 mb-4">Feature importance from model</div>
          <div className="space-y-3.5">
            {factors.map((f) => (
              <div key={f.label}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-700">{f.label}</span>
                  <span className="text-slate-500 text-xs">{f.weight}%</span>
                </div>
                <div className="mt-1.5 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={f.weight >= 75 ? "h-full bg-emerald-500" : "h-full bg-amber-500"} style={{ width: `${f.weight}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Cropping history for this field */}
        <div className="col-span-2 bg-white border border-slate-100 rounded-2xl p-5">
          <div className="text-slate-900 text-sm">Cropping history</div>
          <div className="text-xs text-slate-500 mt-0.5 mb-3">Tonnes per hectare for this field, by cropping cycle</div>
          <div className="h-56">
            {history.length < 2 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-slate-400">
                <TrendingUp className="h-8 w-8 text-slate-200" />
                <span className="text-sm">This is the first cropping cycle on record for this field</span>
              </div>
            ) : (
              <ResponsiveContainer>
                <LineChart data={history}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="y" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
                  <Line type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: "#10b981" }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Risk advisories */}
        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" /> Risk advisories
          </div>
          <ul className="mt-4 space-y-3 text-sm text-amber-900/90">
            {advisories.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{a}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function HarvestPanel({ p }: { p: Prediction }) {
  const t = useT();
  const { recordHarvest } = useStore();
  const harvested = p.actualYield != null;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // Unit the farmer is currently typing/reading the actual-yield figure in
  // for this panel — a dropdown right next to the field, not a global
  // setting. Switching it converts what's already typed so nothing is lost.
  const [unit, setUnit] = useState<YieldUnit>("t/ha");
  const [actual, setActual] = useState(harvested ? formatYieldValue(p.actualYield!, unit) : "");
  const [date, setDate] = useState(p.harvestDate ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(p.harvestNotes ?? "");

  function changeUnit(next: YieldUnit) {
    const typed = parseFloat(actual);
    if (typed > 0) setActual(formatYieldValue(toTonnesPerHa(typed, unit), next));
    setUnit(next);
  }

  function save() {
    const typed = parseFloat(actual);
    if (!typed || typed <= 0) { toast.error(`Enter a valid actual yield (${unit}).`); return; }
    const val = toTonnesPerHa(typed, unit); // backend always stores/expects t/ha
    setSaving(true);
    setTimeout(() => {
      recordHarvest(p.id, +val.toFixed(2), date, notes.trim() || undefined);
      setSaving(false);
      setEditing(false);
      toast.success(`Harvest recorded for ${p.plotId}: ${formatYieldValue(val, unit)} ${unit}`);
    }, 500);
  }

  // Recorded summary
  if (harvested && !editing) {
    const accuracy = Math.round(100 - (Math.abs(p.actualYield! - p.predictedYield) / p.predictedYield) * 100);
    const variance = +(p.actualYield! - p.predictedYield).toFixed(2);
    return (
      <div className="bg-white border border-emerald-100 rounded-2xl p-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {t("farm.harvestRecorded")}
          </div>
          <button onClick={() => setEditing(true)} className="text-xs text-emerald-700 hover:underline flex items-center gap-1">
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <HStat label="Predicted" value={<YieldValue valueTHa={p.predictedYield} />} />
          <HStat label="Actual" value={<YieldValue valueTHa={p.actualYield!} className="text-emerald-700" />} highlight />
          <HStat
            label="Variance"
            value={<span>{variance > 0 ? "+" : ""}<YieldValue valueTHa={variance} className={variance >= 0 ? "text-emerald-700" : "text-rose-600"} /></span>}
            tone={variance >= 0 ? "pos" : "neg"}
          />
          <HStat label="Model accuracy" value={`${accuracy}%`} />
        </div>
        <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
          <span>Total output: <span className="text-slate-800">{(p.actualYield! * p.area).toFixed(2).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")} t</span> from <AreaValue valueHa={p.area} /></span>
          {p.harvestDate && <span>· Harvested {new Date(p.harvestDate).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</span>}
        </div>
        {p.harvestNotes && <div className="mt-2 text-xs text-slate-500 italic">"{p.harvestNotes}"</div>}
      </div>
    );
  }

  // Collapsed prompt with the "Done harvest" button
  if (!harvested && !editing) {
    return (
      <div className="bg-white border border-dashed border-emerald-200 rounded-2xl p-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-amber-50 flex items-center justify-center">
              <Wheat className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <div className="text-sm text-slate-800">{t("farm.recordHarvest")}?</div>
              <div className="text-xs text-slate-500">{t("farm.harvestRecorded")} — record the actual yield to compare against the prediction.</div>
            </div>
          </div>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-white bg-emerald-600 hover:bg-emerald-700"
          >
            <CheckCircle2 className="h-4 w-4" /> {t("farm.doneHarvest")}
          </button>
        </div>
      );
    }
    return (
      <div className="bg-white border border-emerald-200 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-sm text-slate-800 mb-4">
          <Wheat className="h-4 w-4 text-amber-600" /> {t("farm.recordHarvest")}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <div className="text-xs text-slate-600 mb-1.5 flex items-center gap-1">
              Actual yield (
              <select
                value={unit}
                onChange={(e) => changeUnit(e.target.value as YieldUnit)}
                className="text-xs bg-transparent border-none outline-none cursor-pointer appearance-none -mx-0.5"
              >
                {YIELD_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
              <span className="text-[10px] leading-none select-none text-slate-400 -ml-1" aria-hidden="true">⏷</span>
              )
            </div>
            <input
              type="number" step="0.1" min={0} value={actual} onChange={(e) => setActual(e.target.value)}
              placeholder={`e.g. ${formatYieldValue(p.predictedYield, unit)}`}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
            />
          </label>
          <label className="block">
            <div className="text-xs text-slate-600 mb-1.5">Harvest date</div>
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
            />
          </label>
          <label className="block">
            <div className="text-xs text-slate-600 mb-1.5">Notes (optional)</div>
            <input
              value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. minor lodging"
              className="w-full h-10 px-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end gap-3">
          {harvested && <button onClick={() => setEditing(false)} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>}
          <button
            onClick={save} disabled={saving}
            className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : t("farm.saveHarvest")}
          </button>
        </div>
      </div>
    );

  return null;
}


function HStat({ label, value, highlight, tone }: { label: string; value: React.ReactNode; highlight?: boolean; tone?: "pos" | "neg" }) {
  const color = tone === "pos" ? "text-emerald-700" : tone === "neg" ? "text-rose-600" : highlight ? "text-emerald-700" : "text-slate-800";
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2.5">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`mt-0.5 text-sm ${color}`}>{value}</div>
    </div>
  );
}

function EnvCell({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5">
      <div className="text-xs text-slate-500 flex items-center gap-1.5">{icon}{label}</div>
      <div className="mt-1 text-slate-800 text-sm">{value}</div>
    </div>
  );
}

const PALAY_VARIETIES = [
  "NSIC Rc 222 (Hybrid Inbred)",
  "NSIC Rc 216 (Tubigan 18)",
  "NSIC Rc 160 (Tubigan 7)",
  "NSIC Rc 9 (Apo)",
  "IR 64",
  "PSB Rc 82 (Chico 7)",
  // Traditional/heirloom lowland varieties — genuinely non-hybrid and
  // farmer-re-saveable (unlike the NSIC/commercial hybrids above),
  // which is exactly what "Farmer's own seed" actually describes.
  // Sinandomeng and Dinorado in particular are still widely traded and
  // grown across Luzon lowland rice areas today, not just historical.
  "Sinandomeng (Traditional)",
  "Wagwag (Traditional)",
  "Dinorado (Traditional)",
  "Milagrosa (Traditional)",
  "Other / Local variety",
];

const CORN_VARIETIES = [
  "IPB Var 6 (Yellow Hybrid)",
  "Pioneer P3482W (White Corn)",
  "Dekalb DK9108 (Yellow Hybrid)",
  "NSIC Cn 12 (Sweet Corn)",
  "Baguio White (Traditional)",
  // Lagkitan (white glutinous/waxy corn) is an open-pollinated,
  // farmer-re-saveable heirloom variety — one of the two most widely
  // grown native corn types in the country, with dedicated breeding
  // programs (e.g. MMSU Glut 1) in the Ilocos Region specifically.
  "Lagkitan (Traditional)",
  "Other / Local variety",
];

// Rice/corn "type" produced by each variety — i.e., what the harvested
// grain is typically sold/consumed as, not the seed variety itself.
// e.g. NSIC Rc 222 is a seed variety, but the milled grain it produces
// is marketed as ordinary well-milled white rice (non-aromatic).
const VARIETY_PRODUCT_TYPE: Record<string, string> = {
  "NSIC Rc 222 (Hybrid Inbred)": "Well-milled White Rice (non-aromatic)",
  "NSIC Rc 216 (Tubigan 18)": "Well-milled White Rice (non-aromatic)",
  "NSIC Rc 160 (Tubigan 7)": "Well-milled White Rice (non-aromatic)",
  "NSIC Rc 9 (Apo)": "Premium White Rice",
  "IR 64": "Well-milled White Rice (non-aromatic)",
  "PSB Rc 82 (Chico 7)": "Well-milled White Rice (non-aromatic)",
  "Sinandomeng (Traditional)": "Well-milled White Rice (ordinary, the most widely grown traditional lowland variety)",
  "Wagwag (Traditional)": "Well-milled White Rice (hardy, low-cost lowland variety)",
  "Dinorado (Traditional)": "Aromatic / Fragrant Rice (premium, pinkish-tinged grain)",
  "Milagrosa (Traditional)": "Aromatic / Fragrant Rice (premium traditional variety)",
  "Other / Local variety": "Varies — specify (e.g. Jasmine, Glutinous/Malagkit, Brown/Red Rice)",
  "IPB Var 6 (Yellow Hybrid)": "Yellow Corn (feed/industrial grade)",
  "Pioneer P3482W (White Corn)": "White Corn (food grade)",
  "Dekalb DK9108 (Yellow Hybrid)": "Yellow Corn (feed/industrial grade)",
  "NSIC Cn 12 (Sweet Corn)": "Sweet Corn (table/fresh consumption)",
  "Baguio White (Traditional)": "White Corn (food grade)",
  "Lagkitan (Traditional)": "Glutinous / Waxy Corn (for boiled corn, binatog, cornick — not feed corn)",
};

const inputCls = "w-full h-10 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";

function blankCropping(field: Field) {
  const bData = BARANGAY_DATA[field.barangay];
  return {
    crop: "Palay (Rice)" as "Palay (Rice)" | "Corn",
    plotId: "",
    area: String(field.area || ""),
    plantingDate: new Date().toISOString().slice(0, 10),
    // Own-seed (the default before any seed source is chosen) offers
    // the curated Binalonan-area list, not the full national NSIC
    // catalog — see varietyOptions below.
    variety: PALAY_VARIETIES[0],
    technique: "",
    spacing: "20",
    seedRate: "40",
    // Off by default — the seed quantity/rate section below stays
    // auto-computed from area × the standard rate for the crop/
    // technique until the farmer explicitly asks to set it themselves.
    seedRateCustom: false,
    ecosystem: "" as "" | "Irrigated" | "Rainfed",
    // Seed source — who the seed came from — feeds the same seed_type
    // column the municipal reports break out (see reports.py):
    // "own" always maps to the "Farmer Saved Seeds" category; "da"
    // requires picking which DA-subsidized category it was.
    seedSource: "" as "" | "own" | "da",
    seedType: "" as "" | "Hybrid" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)",
    ph: String(bData?.ph ?? 6.5),
    moisture: String(bData?.moisture ?? 62),
    temperature: String(bData?.temperature ?? 28),
    rainfall: String(bData?.rainfall ?? 145),
    quantity: "50",
    quantityUnit: "kg",
    notes: "",
  };
}

// A rainfed-area cropping using hybrid seed (or an irrigated-area one
// using a certified/tagged seed) departs from the office's usual
// guideline (hybrid->irrigated, certified->rainfed) — still allowed,
// since farmers sometimes specifically request hybrid for its higher
// yield, but worth surfacing rather than leaving as a silent mismatch.
function seedGuidelineNote(ecosystem: string, seedType: string): string | null {
  if (!ecosystem || !seedType || seedType === "Farmer Saved Seeds") return null;
  const expected = seedType === "Hybrid" ? "Irrigated" : "Rainfed";
  if (ecosystem === expected) return null;
  return seedType === "Hybrid"
    ? "Hybrid seed for a Rainfed plot — off the usual guideline (hybrid is normally for irrigated areas), but allowed since some rainfed farmers request it for its higher yield."
    : "Certified/tagged seed for an Irrigated plot — off the usual guideline (certified seed is normally for rainfed areas), but not a problem.";
}

// ── Add Field modal ──────────────────────────────────────────────────────
export type OnBehalf = { ownerId: string; farmerName: string };

export function AddFieldModal({ onClose, onCreated, onBehalf }: { onClose: () => void; onCreated: (f: Field) => void; onBehalf?: OnBehalf }) {
  const { addField, logAudit } = useStore();
  const t = useT();
  const [form, setForm] = useState({ name: "", barangay: "Poblacion", houseNo: "", streetZone: "", area: "" });
  const [coords, setCoords] = useState<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });
  const [boundary, setBoundary] = useState<{ lat: number; lng: number }[] | null>(null);
  const [saving, setSaving] = useState(false);

  const barangayLabel = BARANGAY_DATA[form.barangay]?.label ?? form.barangay;
  // Full address for display/submission/geocoding — barangay comes
  // straight from the dropdown above (not re-typed), and municipality/
  // province are fixed since this whole app is scoped to Binalonan.
  const composedAddress = useMemo(() => {
    const line1 = [form.houseNo.trim(), form.streetZone.trim()].filter(Boolean).join(" ");
    return [line1, barangayLabel, "Binalonan", "Pangasinan"].filter(Boolean).join(", ");
  }, [form.houseNo, form.streetZone, barangayLabel]);

  function set(k: keyof typeof form, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const area = parseFloat(form.area);
    if (!form.name.trim()) { toast.error(t("farm.errFieldName")); return; }
    if (!area || area <= 0) { toast.error(t("farm.errFieldSize")); return; }
    if (!form.streetZone.trim()) { toast.error(t("farm.errAddress")); return; }
    setSaving(true);
    setTimeout(() => {
      const f = addField({
        name: form.name.trim(),
        barangay: form.barangay,
        location: composedAddress,
        area,
        latitude: coords.lat ?? undefined,
        longitude: coords.lng ?? undefined,
        boundary: boundary ?? undefined,
        // When an admin files on behalf of a farmer, the field belongs to them.
        ...(onBehalf ? { ownerId: onBehalf.ownerId, farmer: onBehalf.farmerName } : {}),
      });
      if (onBehalf) logAudit({ category: "account", action: `Added field on behalf of farmer (${f.name})`, target: onBehalf.farmerName });
      setSaving(false);
      toast.success(`${t("farm.fieldAddedToast")} "${f.name}"${onBehalf ? ` ${t("farm.forFarmer")} ${onBehalf.farmerName}` : ""}.`);
      onCreated(f);
    }, 500);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <LandPlot className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="text-slate-900">{t("farm.addField")}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("farm.fieldName")} <span className="text-rose-500">*</span></div>
            <input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("farm.fieldNamePlaceholder")} className={inputCls} />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("barangay")}</div>
              <select value={form.barangay} onChange={(e) => set("barangay", e.target.value)} className={`${inputCls} appearance-none`}>
                {Object.entries(BARANGAY_DATA).sort((a, b) => a[1].label.localeCompare(b[1].label)).map(([key, v]) => (
                  <option key={key} value={key}>{v.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("farm.fieldSizeHa")} <span className="text-rose-500">*</span></div>
              <input type="number" step="0.1" min="0" value={form.area} onChange={(e) => set("area", e.target.value)} placeholder="e.g. 3.0" className={inputCls} />
            </label>
          </div>

          {/* Address, broken into its actual parts — barangay mirrors the
              dropdown above (so there's no way for it to disagree with
              it), and municipality/province are fixed since every field
              in this app is in Binalonan, Pangasinan. */}
          <div>
            <div className="text-sm text-slate-700 mb-1.5">{t("farm.exactAddress")} <span className="text-rose-500">*</span></div>
            <div className="grid grid-cols-4 gap-3">
              <label className="block col-span-1">
                <div className="text-xs text-slate-500 mb-1">No.</div>
                <input value={form.houseNo} onChange={(e) => set("houseNo", e.target.value)} placeholder="123" className={inputCls} />
              </label>
              <label className="block col-span-3">
                <div className="text-xs text-slate-500 mb-1">Street / Zone</div>
                <input value={form.streetZone} onChange={(e) => set("streetZone", e.target.value)} placeholder="e.g. Purok 3, Sitio Malaya" className={inputCls} />
              </label>
            </div>
            <div className="grid grid-cols-3 gap-3 mt-3">
              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Barangay</div>
                <input value={barangayLabel} disabled className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} />
              </label>
              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Municipality</div>
                <input value="Binalonan" disabled className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} />
              </label>
              <label className="block">
                <div className="text-xs text-slate-500 mb-1">Province</div>
                <input value="Pangasinan" disabled className={`${inputCls} bg-slate-50 text-slate-500 cursor-not-allowed`} />
              </label>
            </div>
          </div>
          <FieldMapPlotter
            houseNo={form.houseNo}
            streetZone={form.streetZone}
            barangay={barangayLabel}
            targetAreaHa={parseFloat(form.area) || null}
            center={coords.lat != null && coords.lng != null ? { lat: coords.lat, lng: coords.lng } : null}
            onCenterChange={(lat, lng) => setCoords({ lat, lng })}
            boundary={boundary}
            onBoundaryChange={setBoundary}
          />
          <div className="flex items-center justify-end gap-3 pt-1 pb-2">
            <button type="button" onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{t("cancel")}</button>
            <button type="submit" disabled={saving} className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t("farm.savingEllipsis") : t("farm.addField")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Standard seeding rates (kg/ha) by technique — Palay figures per PhilRice
// guidance (transplanted vs. direct-seeded differ substantially); the
// "Dry Direct Seeding" figure matches the 25–30 kg/ha already cited in
// that technique's own description in data/binalonan.ts. Corn uses the
// standard DA hybrid-corn hill/row rate. Falls back to a sensible
// technique-agnostic default when no technique is chosen yet.
const PALAY_SEED_RATE_KG_HA: Record<string, number> = {
  "Transplanting (Pindot)": 40,
  "Wet Direct Seeding": 100,
  "Dry Direct Seeding": 27.5,
  "System of Rice Intensification (SRI)": 15,
};
const CORN_SEED_RATE_KG_HA = 20; // consistent across corn's technique options

function standardSeedRateKgHa(crop: "Palay (Rice)" | "Corn", technique: string): number {
  if (crop === "Corn") return CORN_SEED_RATE_KG_HA;
  return PALAY_SEED_RATE_KG_HA[technique] ?? 40;
}

function croppingToForm(p: Prediction): ReturnType<typeof blankCropping> {
  return {
    crop: p.crop,
    plotId: p.plotId,
    area: String(p.area),
    plantingDate: p.plantingDate,
    variety: p.variety ?? (p.crop === "Palay (Rice)" ? PALAY_VARIETIES[0] : CORN_VARIETIES[0]),
    technique: p.technique ?? "",
    spacing: p.spacing != null ? String(p.spacing) : p.crop === "Corn" ? "25" : "20",
    seedRate: p.seedRate != null ? String(p.seedRate) : "40",
    // An existing record's saved rate is treated as "custom" by
    // default — opening it for editing must never silently recompute
    // and overwrite a real saved figure. The farmer can still flip
    // this back to Auto themselves if they'd rather have it recalculated.
    // Exception: a record whose quantity never actually got recorded
    // (an older/imported row, or the store defaulting a NULL to 0 for
    // display — see store.tsx's apiFarmToPrediction) starts in Auto
    // instead, so opening it immediately fills in a sensible computed
    // value rather than showing a bare "0" the farmer would otherwise
    // have to notice and fix by hand.
    seedRateCustom: p.quantity > 0,
    ecosystem: (p.ecosystem ?? "") as "" | "Irrigated" | "Rainfed",
    // "RS-CS" is a legacy category no longer offered in this form —
    // an old row tagged that way just shows as "DA" with no specific
    // type pre-selected, rather than crashing or silently relabeling it.
    seedSource: (p.seedType ? (p.seedType === "Farmer Saved Seeds" ? "own" : "da") : "") as "" | "own" | "da",
    seedType: (p.seedType && p.seedType !== "Farmer Saved Seeds" && p.seedType !== "RS-CS" ? p.seedType : "") as "" | "Hybrid" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)",
    ph: String(p.ph),
    moisture: String(p.moisture),
    temperature: String(p.temperature),
    rainfall: String(p.rainfall),
    quantity: String(p.quantity),
    quantityUnit: p.quantityUnit,
    notes: p.notes ?? "",
  };
}

// ── Add / Simulate / Edit Cropping modal ─────────────────────────────────
export function CroppingModal({ field, mode, existing, onClose, onBehalf }: { field: Field; mode: "add" | "simulate" | "edit"; existing?: Prediction; onClose: () => void; onBehalf?: OnBehalf }) {
  const { user, predictions, addPrediction, updatePrediction, logAudit, cropVarieties } = useStore();
  const t = useT();
  // A Corn/Palay-assigned admin can only file croppings for their own
  // crop — same privilege that scopes what they see in AdminFarms.tsx.
  const lockedCrop = adminCrop(user?.adminRole);
  const isCropLocked = mode === "add" && (lockedCrop === "Corn" || lockedCrop === "Palay (Rice)");
  const [form, setForm] = useState(() => {
    const base = existing ? croppingToForm(existing) : blankCropping(field);
    if (!isCropLocked || base.crop === lockedCrop) return base;
    return {
      ...base,
      crop: lockedCrop,
      variety: lockedCrop === "Palay (Rice)" ? PALAY_VARIETIES[0] : CORN_VARIETIES[0],
      spacing: lockedCrop === "Corn" ? "25" : "20",
    };
  });
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState<Prediction | null>(null);
  const [weatherSource, setWeatherSource] = useState<"forecast" | "historical" | "climatology_average" | null>(null);
  const isSimulate = mode === "simulate";
  const isEdit = mode === "edit";

  // How much of this field isn't already committed to another still-
  // growing cropping. A harvested cropping's land is free again for the
  // next planting, so only croppings with no recorded actual yield yet
  // count as "occupying" space. Editing an existing cropping excludes
  // that cropping's own current area from the total (otherwise it would
  // count against itself and the field would look smaller than it is
  // every time you open Edit). Simulation never actually claims any
  // field area, so it isn't capped by this at all.
  const remainingArea = useMemo(() => {
    if (isSimulate) return field.area;
    return remainingFieldArea(field, predictions, existing?.id);
  }, [predictions, field, existing?.id, isSimulate]);

  // Live weather for the chosen planting date (soil pH/moisture stay the
  // static per-barangay defaults set in blankCropping — see data/binalonan.ts
  // for why there's no equivalent live API for soil).
  useEffect(() => {
    if (isEdit) return; // editing an existing record — don't overwrite its saved readings
    api
      .getWeather(form.plantingDate)
      .then((w) => {
        setForm((f) => ({ ...f, temperature: String(w.temperature), rainfall: String(w.rainfall) }));
        setWeatherSource(w.source);
      })
      .catch((err) => {
        console.error("Failed to fetch live weather from the API", err);
        setWeatherSource(null);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.plantingDate]);

  // Auto-compute seed quantity — area × the standard rate for the chosen
  // crop/technique — instead of the farmer estimating it by hand. Kept in
  // sync as area/crop/technique change; skipped entirely once the farmer
  // switches the toggle below to set their own rate. Note this is keyed
  // on the toggle, not on add-vs-edit: flipping an existing record's
  // toggle back to Auto is a deliberate action and should recompute
  // immediately, same as it would for a brand new cropping.
  useEffect(() => {
    if (form.seedRateCustom) return;
    const rate = standardSeedRateKgHa(form.crop, form.technique);
    const area = parseFloat(form.area) || 0;
    setForm((f) => ({ ...f, quantity: area > 0 ? (rate * area).toFixed(1) : "0", quantityUnit: "kg", seedRate: String(rate) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.crop, form.technique, form.area, form.seedRateCustom]);

  function set(k: keyof ReturnType<typeof blankCropping>, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // Farmer's own (saved) seed is narrowed to the varieties actually
  // common in the Binalonan area (there's no authoritative "grown in
  // Binalonan" field anywhere in the historical dataset to filter a
  // wider catalog by, so this curated list — the same 5-per-crop set
  // this form always defaulted new croppings to — is used directly).
  // DA-distributed seed instead draws on the full national NSIC/PhilRice
  // catalog, narrowed once a specific seed type is picked: the Hybrid
  // program hands out hybrid varieties, RCEF/Tagged Certified-Seed
  // programs hand out non-hybrid (Inbred/OPV) ones. Until a specific
  // seed type is chosen there's no basis to narrow the catalog yet, so
  // all of it stays offered.
  function varietyEligibleForSeedType(category: string | null | undefined, seedType: string): boolean {
    if (!category || !seedType) return true;
    const isHybridCategory = /hybrid/i.test(category);
    if (seedType === "Hybrid") return isHybridCategory;
    if (seedType === "Tagged CS (RCEF)" || seedType === "Tagged CS (Commercial)") return !isHybridCategory;
    return true;
  }

  function daVarietiesFor(crop: "Palay (Rice)" | "Corn", seedType: string) {
    const forCrop = cropVarieties.filter((v) => v.crop === crop);
    return seedType ? forCrop.filter((v) => varietyEligibleForSeedType(v.category, seedType)) : forCrop;
  }

  // Keeps whatever's already picked when it's still valid in the pool
  // the new crop/source/type combination offers; only falls back to
  // that pool's first entry when it genuinely isn't — so switching,
  // say, seed type away and back doesn't needlessly jump the selection
  // around, and opening an existing record never gets silently
  // rewritten on mount (these are only ever called from a click handler).
  function bestVarietyFor(crop: "Palay (Rice)" | "Corn", seedSource: "" | "own" | "da", seedType: string, current: string): string {
    const pool = seedSource === "da" ? daVarietiesFor(crop, seedType).map((v) => v.name) : (crop === "Palay (Rice)" ? PALAY_VARIETIES : CORN_VARIETIES);
    if (pool.includes(current)) return current;
    return pool[0] ?? current;
  }

  function setCrop(c: "Palay (Rice)" | "Corn") {
    setForm((f) => ({
      ...f,
      crop: c,
      variety: bestVarietyFor(c, f.seedSource, f.seedType, f.variety),
      technique: "",
      spacing: c === "Corn" ? "25" : "20",
    }));
  }

  function chooseSeedSource(source: "own" | "da") {
    setForm((f) => {
      const nextSource = f.seedSource === source ? "" : source;
      return { ...f, seedSource: nextSource, seedType: "", variety: bestVarietyFor(f.crop, nextSource, "", f.variety) };
    });
  }

  function chooseSeedType(seedType: string) {
    setForm((f) => ({ ...f, seedType: seedType as typeof f.seedType, variety: bestVarietyFor(f.crop, f.seedSource, seedType, f.variety) }));
  }

  // Options actually offered in the picker below — own-seed (or no
  // source chosen yet) shows the curated Binalonan-common list annotated
  // with its known final-product description; DA shows the (possibly
  // seed-type-narrowed) national catalog annotated with its category/
  // grain type/maturity. Either way, whatever's currently selected stays
  // present even if it isn't actually in that list — an older saved
  // record's free-text variety must never silently vanish from the
  // dropdown just because it doesn't match either source's list.
  const varietyOptions: SearchableOption[] = useMemo(() => {
    let opts: SearchableOption[];
    if (form.seedSource === "da") {
      opts = daVarietiesFor(form.crop, form.seedType).map((v) => ({
        value: v.name,
        label: v.name,
        subtitle: [v.category, v.grainType, v.maturityDays != null ? `~${v.maturityDays}d maturity` : null].filter(Boolean).join(" · "),
      }));
    } else {
      const curated = form.crop === "Palay (Rice)" ? PALAY_VARIETIES : CORN_VARIETIES;
      opts = curated.map((name) => ({ value: name, label: name, subtitle: VARIETY_PRODUCT_TYPE[name] }));
    }
    if (!opts.some((o) => o.value === form.variety)) opts = [{ value: form.variety, label: form.variety }, ...opts];
    return opts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.seedSource, form.seedType, form.crop, form.variety, cropVarieties]);

  const selectedCatalogVariety = form.seedSource === "da" ? cropVarieties.find((v) => v.crop === form.crop && v.name === form.variety) : undefined;
  // Same mismatch check score() applies to the yield number itself (see
  // store.tsx) — surfaced here so a lower-than-expected estimate has a
  // visible reason attached instead of just quietly coming out lower.
  const ecosystemMismatch = useMemo(() => {
    if (!selectedCatalogVariety?.recommendedEcosystem || !form.ecosystem) return false;
    const rec = selectedCatalogVariety.recommendedEcosystem;
    const recommendsIrrigated = /irrigated/i.test(rec);
    const recommendsRainfed = /rainfed/i.test(rec);
    return (
      (form.ecosystem === "Rainfed" && recommendsIrrigated && !recommendsRainfed) ||
      (form.ecosystem === "Irrigated" && recommendsRainfed && !recommendsIrrigated)
    );
  }, [selectedCatalogVariety, form.ecosystem]);
  // Final-product preview: the curated list's hand-written description
  // when picking own-seed, or a plainer category/grain-derived line for
  // a DA catalog pick — the catalog's grain_type is coarse (just "Long"
  // for every palay row, "Yellow/White" for every corn row) so this is
  // necessarily less specific than the curated descriptions, but it's
  // the honest final-product line the DA catalog data can actually support.
  const finalProductPreview = selectedCatalogVariety
    ? [selectedCatalogVariety.category, selectedCatalogVariety.grainType && `${selectedCatalogVariety.grainType} grain`].filter(Boolean).join(", ")
    : VARIETY_PRODUCT_TYPE[form.variety];

  const techniqueOptions = useMemo(() => {
    const bData = BARANGAY_DATA[field.barangay];
    const season = seasonForMonth(new Date(form.plantingDate).getMonth());
    return getPlantingTechniques(form.crop, {
      moisture: parseFloat(form.moisture) || 62,
      rainfall: parseFloat(form.rainfall) || 145,
      soilType: bData?.soilType ?? "Clay loam",
    }, season);
  }, [form.crop, field.barangay, form.plantingDate, form.moisture, form.rainfall]);

  // Live yield preview — recomputed as the farmer adjusts factors.
  const preview = useMemo(() => predictYield({
    crop: form.crop,
    ph: parseFloat(form.ph) || 6.5,
    moisture: parseFloat(form.moisture) || 62,
    temperature: parseFloat(form.temperature) || 28,
    rainfall: parseFloat(form.rainfall) || 145,
    plantingDate: form.plantingDate,
    technique: form.technique || undefined,
    spacing: parseFloat(form.spacing) || undefined,
    varietyAvgYieldTHa: selectedCatalogVariety?.averageYieldTHa ?? undefined,
    ecosystem: form.ecosystem || undefined,
    varietyRecommendedEcosystem: selectedCatalogVariety?.recommendedEcosystem ?? undefined,
  }), [form, selectedCatalogVariety]);

  function buildPayload() {
    const area = parseFloat(form.area);
    return {
      farmer: onBehalf?.farmerName ?? user?.name ?? "Unknown",
      ...(onBehalf ? { ownerId: onBehalf.ownerId } : {}),
      plotId: form.plotId.trim(),
      fieldId: field.id,
      barangay: field.barangay,
      crop: form.crop,
      area,
      ph: parseFloat(form.ph),
      moisture: parseFloat(form.moisture),
      temperature: parseFloat(form.temperature),
      rainfall: parseFloat(form.rainfall),
      // NaN-guarded to a real number, not left as NaN like before — an
      // unparseable quantity used to serialize to JSON `null` here,
      // which the (now-fixed) edit endpoint accepts fine, but the
      // create endpoint's stricter gt=0 requires an actual number, and
      // addPrediction's type requires this field non-optional either way.
      quantity: parseFloat(form.quantity) || 0,
      quantityUnit: form.quantityUnit,
      plantingDate: form.plantingDate,
      variety: form.variety,
      technique: form.technique || undefined,
      spacing: parseFloat(form.spacing) || undefined,
      seedRate: parseFloat(form.seedRate) || undefined,
      ecosystem: form.ecosystem || undefined,
      seedType: (form.seedSource === "own" ? "Farmer Saved Seeds" : form.seedSource === "da" ? (form.seedType || undefined) : undefined) as
        | "Hybrid" | "RS-CS" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)" | "Farmer Saved Seeds" | undefined,
      notes: form.notes.trim(),
    };
  }

  function save() {
    if (!form.plotId.trim()) { toast.error(t("farm.errCroppingId")); return; }
    const area = parseFloat(form.area);
    if (!area || area <= 0) { toast.error(t("farm.errArea")); return; }
    // Checked against remainingArea, not field.area — a field already
    // fully claimed by another still-growing cropping has zero space
    // left for a new one regardless of the field's own total size.
    if (!isSimulate && area > remainingArea) {
      toast.error(
        remainingArea <= 0
          ? `${field.name} has no free area left — it's fully planted with a still-growing cropping.`
          : `Only ${remainingArea.toFixed(1)} ha is still free on ${field.name}.`
      );
      return;
    }
    setSaving(true);
    setTimeout(() => {
      if (isEdit && existing) {
        // Awaited, not fire-and-forget: closing the modal and showing
        // success before the server actually confirmed the save meant
        // a real failure looked identical to success until the next
        // reload silently revealed the edit was never persisted. Now
        // the modal stays open and shows a real, hard-to-miss error
        // instead, with the on-screen values rolled back to match
        // what's actually saved (see store.tsx's updatePrediction).
        updatePrediction(existing.id, buildPayload())
          .then((pred) => {
            setSaving(false);
            toast.success(`${t("farm.croppingUpdatedToast")} ${pred?.plotId ?? form.plotId} — ${pred ? pred.predictedYield.toFixed(2) : ""} t/ha ${t("farm.predictedSuffix")}.`);
            onClose();
          })
          .catch(() => {
            setSaving(false);
            toast.error("Couldn't save your changes — the server didn't confirm the edit. Please check your connection and try again.");
          });
        return;
      }
      const pred = addPrediction(buildPayload());
      if (onBehalf) logAudit({ category: "account", action: `Filed cropping on behalf of farmer (${pred.plotId})`, target: onBehalf.farmerName });
      setSaving(false);
      setDone(pred);
      toast.success(`${t("farm.croppingAddedToast")} ${pred.plotId} — ${pred.predictedYield.toFixed(2)} t/ha ${t("farm.predictedSuffix")}.`);
    }, 700);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!isSimulate) save();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${isSimulate ? "bg-sky-50" : "bg-emerald-50"}`}>
              {isSimulate ? <PlayCircle className="h-4 w-4 text-sky-600" /> : isEdit ? <Pencil className="h-4 w-4 text-emerald-600" /> : <Sprout className="h-4 w-4 text-emerald-600" />}
            </div>
            <div>
              <div className="text-slate-900">{isSimulate ? t("farm.simulateCropping") : isEdit ? t("farm.editCropping") : t("farm.addCropping")}</div>
              <div className="text-xs text-slate-500">{field.name} · {field.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")}</div>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Success state */}
        {done ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 py-12 text-center">
            <div className="h-16 w-16 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
            <div className="text-slate-900 text-lg">{done.plotId} {t("farm.addedSuffix")}</div>
            <p className="text-sm text-slate-500 max-w-xs">
              {t("farm.predictedYieldLabel")}: <YieldValue valueTHa={done.predictedYield} className="text-emerald-700" /> {t("farm.withConfidence")} {done.confidence}% {t("farm.confidenceWord")}.
              {" "}{t("farm.nowTrackedUnder")} {field.name}.
            </p>
            <div className="flex gap-3 mt-2">
              <button onClick={() => { setForm(blankCropping(field)); setDone(null); }} className="px-4 h-10 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">{t("farm.addAnother")}</button>
              <button onClick={onClose} className="px-5 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm">{t("farm.done")}</button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            {/* Live yield preview */}
            <div className={`rounded-xl border p-4 flex items-center gap-4 ${isSimulate ? "bg-sky-50/60 border-sky-100" : "bg-emerald-50/60 border-emerald-100"}`}>
              <div className="flex items-center gap-2 text-slate-500 text-xs">
                <Sparkles className="h-4 w-4 text-emerald-600" /> {t("farm.livePrediction")}
              </div>
              <div className="ml-auto flex items-baseline gap-6">
                <div className="text-right">
                  <div className="text-2xl tracking-tight text-emerald-700"><YieldValue valueTHa={preview.yieldPerHa} className="text-2xl tracking-tight text-emerald-700" /></div>
                  <div className="text-[11px] text-slate-400">{t("farm.estimatedYield")}</div>
                </div>
                <div className="text-right">
                  <div className="text-2xl tracking-tight text-slate-800">{preview.confidence}%</div>
                  <div className="text-[11px] text-slate-400">{t("farm.confidenceWord")}</div>
                </div>
              </div>
            </div>
            {!isSimulate && (
              <div className="text-xs text-slate-400 -mt-3 px-1">
                A quick estimate that updates as you type. The number actually saved comes from the official
                municipal yield model, which scores by barangay, crop, and planting month only — it can come out
                a bit different, and won't move at all for ecosystem, seed source, variety, or technique changes
                (that model doesn't factor those in yet), or for a planting date change that stays within the
                same calendar month as before.
              </div>
            )}
            {isSimulate && (
              <div className="text-xs text-sky-700 bg-sky-50 border border-sky-100 rounded-lg px-3 py-2 flex items-center gap-2">
                <PlayCircle className="h-3.5 w-3.5 shrink-0" /> {t("farm.simulateHint")}
              </div>
            )}

            {/* Planting date — first, since everything else (season,
                techniques, live weather) follows from this */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("sim.plantingDate")}</div>
              <input type="date" value={form.plantingDate} onChange={(e) => set("plantingDate", e.target.value)} className={inputCls} />
            </label>

            {/* Crop selector */}
            <div>
              <div className="text-sm text-slate-700 mb-2">{t("farm.cropType")}</div>
              <div className="grid grid-cols-2 gap-3">
                {(["Palay (Rice)", "Corn"] as const).map((c) => (
                  <button key={c} type="button" disabled={isCropLocked} onClick={() => setCrop(c)}
                    className={`h-11 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors ${form.crop === c ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"} ${isCropLocked ? "opacity-50 cursor-not-allowed" : ""}`}>
                    {c === "Palay (Rice)" ? <Leaf className="h-4 w-4 text-emerald-600" /> : <Wheat className="h-4 w-4 text-amber-600" />}
                    {c === "Palay (Rice)" ? "Palay (Rice)" : "Corn"}
                  </button>
                ))}
              </div>
              {isCropLocked && (
                <div className="text-xs text-slate-400 mt-1.5">{t("farm.lockedToProgram")} {lockedCrop.replace(" (Rice)", "")} {t("farm.program")}.</div>
              )}
            </div>

            {/* Ecosystem + seed source — asked here, before Variety,
                since seed source (and, for DA seed, which specific type)
                decides which varieties are even offered below: DA's
                Hybrid program hands out hybrid varieties, RCEF/Tagged
                Certified-Seed programs hand out non-hybrid (Inbred/OPV)
                ones. Both optional — feed the Municipal Agriculture
                Office's official Area Planted / Area Harvested reports
                (see AdminFarms.tsx's Reports panel) and, for seed
                source, the seed_type column those reports break out by
                (see reports.py) — neither is required for the yield
                prediction itself. */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Ecosystem <span className="text-slate-400">(optional)</span></div>
              <select value={form.ecosystem} onChange={(e) => set("ecosystem", e.target.value)} className={`${inputCls} appearance-none`}>
                <option value="">Not specified</option>
                <option value="Irrigated">Irrigated</option>
                <option value="Rainfed">Rainfed</option>
              </select>
            </label>

            <div>
              <div className="text-sm text-slate-700 mb-2">Seed source <span className="text-slate-400">(optional)</span></div>
              <div className="grid grid-cols-2 gap-3">
                <button type="button" onClick={() => chooseSeedSource("own")}
                  className={`h-11 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors ${form.seedSource === "own" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <Sprout className="h-4 w-4" /> Farmer's own seed
                </button>
                <button type="button" onClick={() => chooseSeedSource("da")}
                  className={`h-11 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors ${form.seedSource === "da" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  <Package className="h-4 w-4" /> From Department of Agriculture
                </button>
              </div>

              {form.seedSource === "own" && (
                <div className="text-xs text-slate-400 mt-1.5">Recorded as "Farmer Saved Seeds" on the municipal reports. Every variety below is available.</div>
              )}

              {form.seedSource === "da" && (
                <label className="block mt-3">
                  <div className="text-sm text-slate-700 mb-1.5">DA seed type</div>
                  <select value={form.seedType} onChange={(e) => chooseSeedType(e.target.value)} className={`${inputCls} appearance-none`}>
                    <option value="">Not specified</option>
                    <option value="Hybrid">Hybrid</option>
                    <option value="Tagged CS (RCEF)">Tagged CS (RCEF)</option>
                    <option value="Tagged CS (Commercial)">Tagged CS (Commercial)</option>
                  </select>
                  {form.seedType && (
                    <div className="text-xs text-slate-400 mt-1.5">Variety below is narrowed to what the {form.seedType} program actually distributes.</div>
                  )}
                </label>
              )}

              {seedGuidelineNote(form.ecosystem, form.seedSource === "da" ? form.seedType : "") && (
                <div className="mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  <span>{seedGuidelineNote(form.ecosystem, form.seedSource === "da" ? form.seedType : "")}</span>
                </div>
              )}
            </div>

            {/* Variety — type-to-search combobox: own-seed narrows to the
                curated Binalonan-common list, DA narrows to the national
                catalog (further narrowed by seed type once picked). */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("farm.cropVariety")}</div>
              <SearchableSelect
                value={form.variety}
                onChange={(v) => set("variety", v)}
                options={varietyOptions}
                placeholder="Type to search a variety…"
              />
              {finalProductPreview && (
                <div className="text-xs text-slate-500 mt-1.5">
                  {t("farm.riceTypeProduced")}: <span className="text-slate-700">{finalProductPreview}</span>
                </div>
              )}
              {selectedCatalogVariety && (
                <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                  {selectedCatalogVariety.maturityDays != null && <span>~{selectedCatalogVariety.maturityDays}d maturity</span>}
                  {selectedCatalogVariety.averageYieldTHa != null && <span>avg {selectedCatalogVariety.averageYieldTHa} t/ha</span>}
                  {selectedCatalogVariety.droughtTolerance && <span>{selectedCatalogVariety.droughtTolerance} drought tolerance</span>}
                </div>
              )}
              {ecosystemMismatch && (
                <div className="text-xs text-amber-700 mt-1.5 flex items-start gap-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {form.variety} is recommended for {selectedCatalogVariety?.recommendedEcosystem}, but this
                    cropping is set to {form.ecosystem} — yield here may run a bit below the {selectedCatalogVariety?.averageYieldTHa} t/ha average.
                  </span>
                </div>
              )}
            </label>

            {/* Planting technique */}
            <div>
              <div className="text-sm text-slate-700 mb-2">{t("sim.plantingTechnique")}</div>
              <div className="space-y-2">
                {techniqueOptions.map((tech, i) => {
                  const Icon = tech.icon;
                  const selected = form.technique === tech.name;
                  return (
                    <button key={i} type="button" onClick={() => set("technique", selected ? "" : tech.name)}
                      className={`w-full text-left rounded-xl border p-3 flex items-start gap-3 transition-colors ${selected ? "border-emerald-400 bg-emerald-50" : "border-slate-200 hover:bg-slate-50"}`}>
                      <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center mt-0.5 ${selected ? "bg-emerald-100" : "bg-slate-100"}`}>
                        <Icon className={`h-4 w-4 ${selected ? "text-emerald-700" : "text-slate-500"}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-sm ${selected ? "text-emerald-900" : "text-slate-700"}`}>{t(tech.nameKey)}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${tech.tagColor}`}>{t(tech.tagKey)}</span>
                          {i === 0 && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">{t("farm.bestFit")}</span>}
                          {!tech.recommended && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">{t("technique.tag.notRecommended")}</span>}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-2">{t(tech.descKey)}</p>
                      </div>
                      <div className={`shrink-0 h-4 w-4 rounded-full border-2 mt-1 ${selected ? "border-emerald-500 bg-emerald-500" : "border-slate-300"}`} />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Cropping ID + Area + Crop distance */}
            <div className="grid grid-cols-3 gap-3">
              <label className="block">
                <div className="text-sm text-slate-700 mb-1.5">{t("farm.croppingId")} <span className="text-rose-500">*</span></div>
                <input value={form.plotId} onChange={(e) => set("plotId", e.target.value)} placeholder="e.g. LOT-2026-201" className={inputCls} />
              </label>
              <label className="block">
                <div className="text-sm text-slate-700 mb-1.5">{t("farm.croppedAreaHa")} <span className="text-rose-500">*</span></div>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max={remainingArea}
                  value={form.area}
                  onChange={(e) => {
                    const v = e.target.value;
                    // Cropped area can never exceed what's actually still
                    // free on this field — other still-growing croppings
                    // already claim the rest of it — clamp rather than
                    // just validate on submit, so the farmer sees the cap
                    // immediately as they type.
                    if (v === "" || parseFloat(v) <= remainingArea) set("area", v);
                    else set("area", String(remainingArea));
                  }}
                  disabled={!isSimulate && remainingArea <= 0}
                  placeholder={`max ${remainingArea} ha`}
                  className={`${inputCls} ${!isSimulate && remainingArea <= 0 ? "bg-slate-50 text-slate-500 cursor-not-allowed" : ""}`}
                />
              </label>
              <label className="block">
                <div className="text-sm text-slate-700 mb-1.5 flex items-center gap-1"><Ruler className="h-3.5 w-3.5 text-slate-400" />{t("farm.distanceCm")}</div>
                <input type="number" step="1" min="0" value={form.spacing} onChange={(e) => set("spacing", e.target.value)} placeholder={form.crop === "Corn" ? "e.g. 25" : "e.g. 20"} className={inputCls} />
              </label>
            </div>
            {!isSimulate && (
              remainingArea <= 0 ? (
                <div className="-mt-1 flex items-start gap-2 text-xs text-rose-700 bg-rose-50 border border-rose-100 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {field.name}'s entire {field.area} ha is already planted with a still-growing cropping — there's
                    no room left for another one here until some of it is harvested.
                  </span>
                </div>
              ) : (
                <div className="-mt-1 text-xs text-slate-400">
                  {remainingArea.toFixed(1)} of {field.area} ha still free on {field.name}
                  {remainingArea < field.area ? " — the rest is already planted with a still-growing cropping." : "."}
                </div>
              )
            )}

            {/* Soil & climate */}
            <div>
              <div className="text-sm text-slate-700 mb-2">{t("farm.soilClimateConditions")}</div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><FlaskConical className="h-3 w-3 text-emerald-600" />{t("sim.soilPH")}</div>
                  <input type="number" step="0.1" min="0" max="14" value={form.ph} onChange={(e) => set("ph", e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Droplets className="h-3 w-3 text-sky-600" />{t("sim.soilMoisture")}</div>
                  <input type="number" step="1" min="0" max="100" value={form.moisture} onChange={(e) => set("moisture", e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><ThermometerSun className="h-3 w-3 text-amber-600" />{t("sim.temperature")}</div>
                  <input type="number" step="0.5" value={form.temperature} onChange={(e) => set("temperature", e.target.value)} className={inputCls} />
                </label>
                <label className="block">
                  <div className="text-xs text-slate-500 mb-1 flex items-center gap-1"><CloudRain className="h-3 w-3 text-sky-700" />{t("sim.rainfall")}</div>
                  <input type="number" step="1" min="0" value={form.rainfall} onChange={(e) => set("rainfall", e.target.value)} className={inputCls} />
                </label>
              </div>
              <div className="text-xs text-slate-400 mt-1.5">
                {t("farm.tempRainfallLive")}
                {weatherSource === "forecast" && ` (${t("farm.forecastWord")})`}
                {weatherSource === "historical" && ` (${t("farm.historicalRecordWord")})`}
                {weatherSource === "climatology_average" && ` (${t("farm.seasonalAverageWord")})`}
                . {t("farm.soilStaticFor")} {field.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")} — {t("farm.adjustIfMeasured")}.
              </div>
            </div>

            {/* Seed quantity + rate — auto-computed from area × the
                standard rate for this crop/technique by default, so it
                can't drift from that formula unless the farmer
                specifically asks to set it themselves. Unit is always
                kg (not user-selectable), so it's shown as an inline
                suffix inside each field rather than a third,
                permanently-disabled box sitting awkwardly between two
                active ones. */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-sm text-slate-700">{t("farm.seedQty")}</div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.seedRateCustom}
                  onClick={() => setForm((f) => ({ ...f, seedRateCustom: !f.seedRateCustom }))}
                  className={`flex items-center gap-2 pl-3 pr-1.5 py-1.5 rounded-full border transition-colors ${
                    form.seedRateCustom ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-slate-50"
                  }`}
                >
                  <span className={`text-xs ${form.seedRateCustom ? "text-emerald-700" : "text-slate-500"}`}>
                    {form.seedRateCustom ? "Custom" : "Auto-calculated"}
                  </span>
                  <span className={`relative inline-block h-5 w-9 rounded-full transition-colors shrink-0 ${form.seedRateCustom ? "bg-emerald-500" : "bg-slate-300"}`}>
                    <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${form.seedRateCustom ? "translate-x-4" : "translate-x-0"}`} />
                  </span>
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <div className="text-xs text-slate-400 mb-1">{t("farm.quantityWord")}</div>
                  <div className={`flex items-center h-10 rounded-lg border overflow-hidden focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100 ${!form.seedRateCustom ? "bg-slate-50 border-slate-200" : "border-slate-200"}`}>
                    <input
                      value={form.quantity}
                      onChange={(e) => set("quantity", e.target.value)}
                      disabled={!form.seedRateCustom}
                      readOnly={!form.seedRateCustom}
                      className={`min-w-0 flex-1 h-full pl-3 pr-1 bg-transparent border-0 outline-none text-sm ${!form.seedRateCustom ? "text-slate-500 cursor-not-allowed" : "text-slate-900"}`}
                    />
                    <span className="pr-3 text-sm text-slate-400 shrink-0">kg</span>
                  </div>
                </label>
                <label className="block">
                  <div className="text-xs text-slate-400 mb-1">{t("farm.ratePerHa")}</div>
                  <div className={`flex items-center h-10 rounded-lg border overflow-hidden focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-100 ${!form.seedRateCustom ? "bg-slate-50 border-slate-200" : "border-slate-200"}`}>
                    <input
                      value={form.seedRate}
                      onChange={(e) => set("seedRate", e.target.value)}
                      disabled={!form.seedRateCustom}
                      readOnly={!form.seedRateCustom}
                      className={`min-w-0 flex-1 h-full pl-3 pr-1 bg-transparent border-0 outline-none text-sm ${!form.seedRateCustom ? "text-slate-500 cursor-not-allowed" : "text-slate-900"}`}
                    />
                    <span className="pr-3 text-sm text-slate-400 shrink-0">kg/ha</span>
                  </div>
                </label>
              </div>
            </div>
            <div className="text-xs text-slate-400 -mt-3">
              {form.seedRateCustom
                ? "Set your own quantity and rate per hectare."
                : <>{t("farm.computedFromArea")} {form.crop === "Corn" ? "Corn" : "Palay"}{form.technique ? ` (${techniqueLabel(t, form.technique)})` : ""}.</>}
            </div>

            {/* Notes */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("farm.notesOptional")}</div>
              <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} placeholder={t("farm.notesPlaceholder")} className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm resize-none" />
            </label>

            {/* Footer actions */}
            <div className="flex items-center justify-end gap-3 pt-1 pb-2">
              <button type="button" onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{isSimulate ? t("farm.close") : t("cancel")}</button>
              <button type="button" onClick={save} disabled={saving}
                className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? t("farm.savingEllipsis") : isSimulate ? t("farm.saveAsCropping") : isEdit ? t("farm.saveChanges") : t("farm.addCropping")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function FieldInfoModal({ field, croppingCount, onClose }: { field: Field; croppingCount: number; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const hasBoundary = !!field.boundary && field.boundary.length >= 3;
  // The area actually enclosed by the plotted boundary, for comparison
  // against the area the farmer typed in when the field was created —
  // these can legitimately differ (a hand-typed estimate vs. corners
  // actually plotted on the map), which is useful to see, not a bug.
  const plottedAreaHa = hasBoundary ? polygonAreaHa(field.boundary!) : null;

  function copyCoords() {
    if (field.latitude == null || field.longitude == null) return;
    navigator.clipboard.writeText(`${field.latitude}, ${field.longitude}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg flex items-center justify-center bg-emerald-50">
              <Info className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-slate-900">Field info</div>
              <div className="text-xs text-slate-500">{field.name}</div>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <FieldLocationMap latitude={field.latitude} longitude={field.longitude} boundary={field.boundary} />

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <div className="text-xs text-slate-400 mb-0.5">Barangay</div>
              <div className="text-slate-800">{field.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")}</div>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <div className="text-xs text-slate-400 mb-0.5">Registered area</div>
              <div className="text-slate-800"><AreaValue valueHa={field.area} /></div>
            </div>
            {hasBoundary && plottedAreaHa != null && (
              <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
                <div className="text-xs text-slate-400 mb-0.5">Plotted boundary area</div>
                <div className="text-slate-800">
                  <AreaValue valueHa={plottedAreaHa} />
                  {Math.abs(plottedAreaHa - field.area) > 0.1 && (
                    <span className="text-amber-600 text-xs ml-1.5">≠ registered</span>
                  )}
                </div>
              </div>
            )}
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5">
              <div className="text-xs text-slate-400 mb-0.5">Cropping periods</div>
              <div className="text-slate-800">{croppingCount}</div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 text-sm">
            <div className="text-xs text-slate-400 mb-0.5">Address</div>
            <div className="text-slate-800">{field.location}</div>
          </div>

          {field.latitude != null && field.longitude != null && (
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 text-sm flex items-center justify-between gap-3">
              <div>
                <div className="text-xs text-slate-400 mb-0.5">Coordinates</div>
                <div className="text-slate-800">{field.latitude.toFixed(6)}, {field.longitude.toFixed(6)}</div>
              </div>
              <button
                onClick={copyCoords}
                className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-slate-200 text-xs text-slate-500 hover:bg-white"
              >
                <Copy className="h-3 w-3" /> {copied ? "Copied" : "Copy"}
              </button>
            </div>
          )}

          {field.notes && (
            <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2.5 text-sm">
              <div className="text-xs text-slate-400 mb-0.5">Notes</div>
              <div className="text-slate-800 italic">"{field.notes}"</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MyFarm() {
  const t = useT();
  const { visibleFields, visiblePredictions, deleteField, deletePrediction, current } = useStore();
  const [addFieldOpen, setAddFieldOpen] = useState(false);
  const [croppingMode, setCroppingMode] = useState<null | "add" | "simulate" | "edit">(null);
  const [fieldInfoOpen, setFieldInfoOpen] = useState(false);

  const fields = useMemo(
    () => [...visibleFields].sort((a, b) => b.createdAt - a.createdAt),
    [visibleFields],
  );

  // Track the selected field; default to the field of the "current" prediction.
  const [activeFieldId, setActiveFieldId] = useState<string | null>(
    current?.fieldId ?? fields[0]?.id ?? null,
  );
  const activeField = fields.find((f) => f.id === activeFieldId) ?? fields[0] ?? null;

  // Cropping periods that belong to the selected field.
  const croppings = useMemo(
    () =>
      visiblePredictions
        .filter((p) => p.fieldId === activeField?.id)
        .sort((a, b) => b.createdAt - a.createdAt),
    [visiblePredictions, activeField],
  );

  // How much of the field isn't already claimed by a still-growing
  // cropping — same rule CroppingModal uses for its own area cap. Kept
  // here too so the "Add Cropping" buttons below can stop the farmer
  // before they even open the form, instead of only after.
  const remainingFieldAreaValue = useMemo(
    () => (activeField ? remainingFieldArea(activeField, visiblePredictions) : 0),
    [visiblePredictions, activeField],
  );
  const fieldIsFull = remainingFieldAreaValue <= 0;

  const [activeCroppingId, setActiveCroppingId] = useState<string | null>(null);
  const activeCropping =
    croppings.find((p) => p.id === activeCroppingId) ?? croppings[0] ?? null;

  const stats = useMemo(() => {
    const totalFields = fields.length;
    const totalArea = +fields.reduce((s, f) => s + f.area, 0).toFixed(1);
    const cps = visiblePredictions.filter((p) => fields.some((f) => f.id === p.fieldId));
    const totalCroppings = cps.length;
    const totalProduction = +cps.reduce((s, p) => s + p.predictedYield * p.area, 0).toFixed(1);
    const harvestRecords = cps.filter((p) => p.actualYield != null).length;
    const avgYield = cps.length ? +(cps.reduce((s, p) => s + p.predictedYield, 0) / cps.length).toFixed(2) : 0;
    return { totalFields, totalArea, totalCroppings, totalProduction, harvestRecords, avgYield };
  }, [fields, visiblePredictions]);

  function handleSelectField(id: string) {
    setActiveFieldId(id);
    setActiveCroppingId(null);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard icon={LandPlot}   tint="bg-emerald-50 text-emerald-600" label={t("farm.fields")}              value={String(stats.totalFields)} sub={<AreaValue valueHa={stats.totalArea} className="text-slate-400" />} />
        <SummaryCard icon={Layers}     tint="bg-violet-50 text-violet-600"   label={t("farm.croppingPeriods")}    value={String(stats.totalCroppings)} sub={`${stats.totalProduction} t predicted`} />
        <SummaryCard icon={TrendingUp} tint="bg-sky-50 text-sky-600"         label={t("farm.avgYield")} value={<YieldValue valueTHa={stats.avgYield} />}   sub="predicted average" />
        <SummaryCard icon={CheckCircle2} tint="bg-amber-50 text-amber-600"   label="Harvest records"              value={String(stats.harvestRecords)} sub={`of ${stats.totalCroppings}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2">
      {fields.length === 0 ? (
        <div className="bg-white border border-dashed border-slate-200 rounded-2xl py-16 flex flex-col items-center gap-3 text-center">
          <div className="h-12 w-12 rounded-full bg-emerald-50 flex items-center justify-center">
            <Tractor className="h-6 w-6 text-emerald-500" />
          </div>
          <div className="text-slate-700">{t("farm.noFieldsYet")}</div>
          <div className="text-sm text-slate-500 max-w-xs">Add your first field — its location and size — then add or simulate cropping periods within it.</div>
          <button
            onClick={() => setAddFieldOpen(true)}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
          >
            <Plus className="h-4 w-4" /> {t("farm.addField")}
          </button>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
          {/* Field tab bar */}
          <div className="flex items-center gap-0 border-b border-slate-100 overflow-x-auto">
            {fields.map((f) => {
              const isActive = f.id === activeField?.id;
              const count = visiblePredictions.filter((p) => p.fieldId === f.id).length;
              return (
                <button
                  key={f.id}
                  onClick={() => handleSelectField(f.id)}
                  className={`shrink-0 flex items-center gap-2.5 px-5 py-3.5 border-b-2 transition-colors text-left ${
                    isActive
                      ? "border-emerald-500 bg-emerald-50/60 text-emerald-900"
                      : "border-transparent text-slate-600 hover:text-slate-800 hover:bg-slate-50"
                  }`}
                >
                  <div className="h-8 w-8 rounded-lg bg-emerald-50 border border-emerald-100 flex items-center justify-center shrink-0">
                    <LandPlot className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div>
                    <div className="text-sm leading-tight">{f.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      {f.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")} · <AreaValue valueHa={f.area} /> · {count} cropping{count === 1 ? "" : "s"}
                    </div>
                  </div>
                </button>
              );
            })}
            <div className="ml-auto px-4 shrink-0">
              <button
                onClick={() => setAddFieldOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
              >
                <Plus className="h-3.5 w-3.5" /> {t("farm.addField")}
              </button>
            </div>
          </div>

          {/* Field content */}
          {activeField && (
            <div className="p-6 space-y-5">
              {/* Field header + actions */}
              <div className="bg-slate-50/70 border border-slate-100 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="text-slate-900 text-lg tracking-tight">{activeField.name}</div>
                    <button
                      onClick={() => setFieldInfoOpen(true)}
                      className="h-6 w-6 rounded-full flex items-center justify-center text-slate-400 hover:text-emerald-700 hover:bg-emerald-50 shrink-0"
                      title="Field info"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="text-sm text-slate-500 flex items-center gap-1 mt-0.5">
                    <MapPin className="h-3.5 w-3.5" /> {activeField.location}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 flex items-center gap-1"><LandPlot className="h-3 w-3 text-emerald-600" /> <AreaValue valueHa={activeField.area} /></span>
                    <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 flex items-center gap-1"><Layers className="h-3 w-3 text-violet-600" /> {croppings.length} cropping period{croppings.length === 1 ? "" : "s"}</span>
                    {activeField.notes && <span className="text-slate-400 italic">"{activeField.notes}"</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setCroppingMode("simulate")}
                    className="flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-sm text-sky-700 border border-sky-200 hover:bg-sky-50"
                  >
                    <PlayCircle className="h-4 w-4" /> {t("farm.simulateCropping")}
                  </button>
                  <button
                    onClick={() => { if (!fieldIsFull) setCroppingMode("add"); }}
                    disabled={fieldIsFull}
                    title={fieldIsFull ? `${activeField.name} is fully planted with a still-growing cropping — nothing harvested yet to free up space.` : undefined}
                    className={`flex items-center gap-1.5 px-3.5 h-9 rounded-lg text-sm text-white ${
                      fieldIsFull ? "bg-slate-300 cursor-not-allowed" : "bg-emerald-600 hover:bg-emerald-700"
                    }`}
                  >
                    <Plus className="h-4 w-4" /> {t("farm.addCropping")}
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${activeField.name}" and its ${croppings.length} cropping period(s)?`)) {
                        deleteField(activeField.id);
                        setActiveFieldId(null);
                        toast.success("Field deleted.");
                      }
                    }}
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200"
                    title="Delete field"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {fieldIsFull && (
                <div className="-mt-2 flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>
                    {activeField.name}'s entire {activeField.area} ha is already planted with a still-growing
                    cropping — Add Cropping is disabled until some of it is harvested.
                  </span>
                </div>
              )}

              {/* Cropping periods */}
              {croppings.length === 0 ? (
                <div className="border border-dashed border-slate-200 rounded-2xl py-12 flex flex-col items-center gap-3 text-center">
                  <div className="h-11 w-11 rounded-full bg-emerald-50 flex items-center justify-center">
                    <Sprout className="h-5 w-5 text-emerald-500" />
                  </div>
                  <div className="text-slate-700">{t("farm.noCroppingsYet")}</div>
                  <div className="text-sm text-slate-500 max-w-xs">Add a cropping period to run a yield prediction for this field, or simulate an assumed cropping first.</div>
                  <div className="flex gap-3 mt-1">
                    <button onClick={() => setCroppingMode("simulate")} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-sky-700 border border-sky-200 hover:bg-sky-50">
                      <PlayCircle className="h-4 w-4" /> {t("farm.simulateCropping")}
                    </button>
                    <button onClick={() => setCroppingMode("add")} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
                      <Plus className="h-4 w-4" /> {t("farm.addCropping")}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Cropping sub-tabs */}
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs uppercase tracking-wide text-slate-400 mr-1">Cropping periods</span>
                    {activeCropping && (
                      <button
                        onClick={() => setCroppingMode("edit")}
                        className="order-last flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-emerald-700 border border-emerald-200 hover:bg-emerald-50"
                      >
                        <Pencil className="h-3.5 w-3.5" /> {t("farm.editCropping")}
                      </button>
                    )}
                    {activeCropping && (
                      <button
                        onClick={() => {
                          if (confirm(`Delete the "${activeCropping.plotId}" cropping? This removes its prediction and any watering/fertilizer reminders too — this can't be undone.`)) {
                            const remaining = croppings.filter((p) => p.id !== activeCropping.id);
                            deletePrediction(activeCropping.id);
                            setActiveCroppingId(remaining[0]?.id ?? null);
                            toast.success("Cropping deleted.");
                          }
                        }}
                        className="order-last ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-slate-500 border border-slate-200 hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200"
                        title="Delete this cropping"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Delete cropping
                      </button>
                    )}
                    {croppings.map((p) => {
                      const isActive = p.id === activeCropping?.id;
                      return (
                        <button
                          key={p.id}
                          onClick={() => setActiveCroppingId(p.id)}
                          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                            isActive
                              ? "border-emerald-400 bg-emerald-50 text-emerald-900"
                              : "border-slate-200 text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {p.plotId}
                          <span className="text-[11px] text-slate-400">{p.crop === "Palay (Rice)" ? "Palay" : "Corn"}</span>
                        </button>
                      );
                    })}
                  </div>

                  {activeCropping && <PlotDetail p={activeCropping} />}
                </>
              )}
            </div>
          )}
        </div>
      )}
        </div>

        {/* Upcoming activities / to-do list for this farmer's own croppings — sized to match the Dashboard's announcement card, sitting beside Fields & Crops */}
        <WeekPlan />
      </div>

      {addFieldOpen && (
        <AddFieldModal
          onClose={() => setAddFieldOpen(false)}
          onCreated={(f) => { setAddFieldOpen(false); handleSelectField(f.id); }}
        />
      )}
      {croppingMode && activeField && (
        <CroppingModal
          field={activeField}
          mode={croppingMode}
          existing={croppingMode === "edit" ? activeCropping ?? undefined : undefined}
          onClose={() => setCroppingMode(null)}
        />
      )}
      {fieldInfoOpen && activeField && (
        <FieldInfoModal field={activeField} croppingCount={croppings.length} onClose={() => setFieldInfoOpen(false)} />
      )}
    </div>
  );
}


