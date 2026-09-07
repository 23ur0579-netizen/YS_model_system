import { useMemo, useState } from "react";
import { Sparkles, Download, Share2, AlertTriangle, CheckCircle2, Inbox, Wheat, Pencil, Loader2 } from "lucide-react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from "recharts";
import { useStore, moisturePctToMm } from "../store";
import { toast } from "sonner";
import { useT } from "../i18n";
import { YieldValue, AreaValue } from "./UnitValue";

function ConfidenceRing({ value }: { value: number }) {
  const t = useT();
  const r = 56;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <div className="relative h-40 w-40">
      <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
        <circle cx="70" cy="70" r={r} stroke="rgba(255,255,255,0.12)" strokeWidth="12" fill="none" />
        <circle cx="70" cy="70" r={r} stroke="#a7f3d0" strokeWidth="12" fill="none" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-2xl">{value}%</div>
        <div className="text-xs text-emerald-100/80">{t("yr.confidence")}</div>
      </div>
    </div>
  );
}

function HarvestCard({ p }: { p: any }) {
  const { recordHarvest } = useStore();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState(p.actualYield ?? p.predictedYield);
  const [date, setDate] = useState(p.harvestDate ?? new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(p.harvestNotes ?? "");
  const [saving, setSaving] = useState(false);

  const hasHarvest = typeof p.actualYield === "number";
  const accuracy = hasHarvest
    ? Math.max(0, 100 - Math.abs((p.predictedYield - p.actualYield) / p.predictedYield) * 100)
    : 0;
  const diff = hasHarvest ? +(p.actualYield - p.predictedYield).toFixed(2) : 0;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!actual || actual <= 0) {
      toast.error(t("yr.invalidYieldError"));
      return;
    }
    setSaving(true);
    setTimeout(() => {
      recordHarvest(p.id, +actual, date, notes);
      setSaving(false);
      setOpen(false);
      toast.success(`${t("yr.harvestRecordedToast")} ${actual} t/ha`);
    }, 500);
  }

  if (!hasHarvest && !open) {
    return (
      <div className="bg-white border border-dashed border-emerald-300 rounded-2xl p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <Wheat className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <div className="text-slate-900">{t("yr.harvestComplete")}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t("yr.harvestCompleteDesc")}</div>
          </div>
        </div>
        <button onClick={() => setOpen(true)} className="px-4 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm">
          {t("yr.recordActualYield")}
        </button>
      </div>
    );
  }

  if (open) {
    return (
      <form onSubmit={submit} className="bg-white border border-emerald-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2 text-slate-900">
            <Wheat className="h-4 w-4 text-emerald-600" /> {hasHarvest ? t("yr.updateHarvestRecord") : t("yr.recordActualHarvest")}
          </div>
          <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-400 hover:text-slate-700">{t("yr.cancel")}</button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("yr.actualYield")}</div>
            <input
              type="number" step="0.1" min={0}
              value={actual}
              onChange={(e) => setActual(+e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
            />
            <div className="text-xs text-slate-400 mt-1">{t("yr.predictedWas")} <YieldValue valueTHa={p.predictedYield} /></div>
          </label>
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("yr.harvestDate")}</div>
            <input
              type="date" value={date} onChange={(e) => setDate(e.target.value)}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
            />
          </label>
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("yr.notesOptional")}</div>
            <input
              value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={t("yr.notesPlaceholder")}
              className="w-full h-10 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
            />
          </label>
        </div>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={() => setOpen(false)} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">
            {t("yr.cancel")}
          </button>
          <button type="submit" disabled={saving} className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white flex items-center gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t("yr.saving") : t("yr.saveHarvest")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="bg-white border border-emerald-100 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2 text-slate-900">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> {t("yr.harvestRecordedTitle")}
        </div>
        <button onClick={() => setOpen(true)} className="text-xs text-emerald-700 hover:underline flex items-center gap-1">
          <Pencil className="h-3 w-3" /> {t("yr.edit")}
        </button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-slate-500">{t("yr.predicted")}</div>
          <div className="mt-1 text-slate-900 text-xl tracking-tight"><YieldValue valueTHa={p.predictedYield} /></div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t("yr.actual")}</div>
          <div className="mt-1 text-emerald-700 text-xl tracking-tight"><YieldValue valueTHa={p.actualYield} className="text-emerald-700" /></div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t("yr.variance")}</div>
          <div className={`mt-1 text-xl tracking-tight ${diff >= 0 ? "text-emerald-700" : "text-rose-600"}`}>
            {diff >= 0 ? "+" : ""}<YieldValue valueTHa={diff} className={diff >= 0 ? "text-emerald-700" : "text-rose-600"} />
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">{t("yr.modelAccuracy")}</div>
          <div className="mt-1 text-slate-900 text-xl tracking-tight">{accuracy.toFixed(0)}%</div>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
        <span>{t("yr.harvested")} {new Date(p.harvestDate).toLocaleDateString()}</span>
        {p.harvestNotes && <span>· {p.harvestNotes}</span>}
        <span className="ml-auto">{t("yr.totalOutput")} {(p.actualYield * p.area).toFixed(2)} {t("yr.tonnes")}</span>
      </div>
    </div>
  );
}

export function YieldResult() {
  const { current, visiblePredictions, setCurrent, setView, user } = useStore();
  const t = useT();
  const p = current ?? visiblePredictions[0];
  const isAdmin = user?.role === "Admin";

  if (!p) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="bg-white border border-slate-100 rounded-2xl p-12 text-center">
          <Inbox className="h-10 w-10 mx-auto text-slate-300" />
          <div className="mt-3 text-slate-700">{t("yr.noPredictionsYet")}</div>
          <div className="text-sm text-slate-500 mt-1">{t("yr.noPredictionsDesc")}</div>
          <button onClick={() => setView(isAdmin ? "farms" : "myfarm")} className="mt-5 px-4 h-10 rounded-lg bg-emerald-600 text-white text-sm">
            {t("yr.goToDataInput")}
          </button>
        </div>
      </div>
    );
  }

  const total = (p.predictedYield * p.area).toFixed(2);
  const history = [
    { y: "2022", v: +(p.predictedYield - 1.4).toFixed(2) },
    { y: "2023", v: +(p.predictedYield - 1.1).toFixed(2) },
    { y: "2024", v: +(p.predictedYield - 0.7).toFixed(2) },
    { y: "2025", v: +(p.predictedYield - 0.9).toFixed(2) },
    { y: "2026", v: p.predictedYield },
  ];
  const delta = (((history[4].v - history[3].v) / history[3].v) * 100).toFixed(1);

  const factors = [
    { label: `${t("sim.soilPH")} (${p.ph})`, weight: Math.max(50, Math.min(98, Math.round(100 - Math.abs(p.ph - 6.4) * 20))) },
    { label: `${t("sim.moisture")} (${moisturePctToMm(p.moisture)}mm)`, weight: Math.max(45, Math.min(95, Math.round(100 - Math.abs(p.moisture - 62)))) },
    { label: `${t("yr.rainfallShort")} (${p.rainfall}mm)`, weight: Math.max(40, Math.min(95, Math.round(100 - Math.abs(p.rainfall - 145) / 3))) },
    { label: `${t("yr.temperatureShort")} (${p.temperature}°C)`, weight: Math.max(40, Math.min(95, Math.round(100 - Math.abs(p.temperature - 28) * 5))) },
    { label: t("yr.historicalYield"), weight: 82 },
  ];

  function exportPdf() {
    const blob = new Blob(
      [
        `YieldShield Prediction Report\n\nPlot: ${p.plotId}\nBarangay: ${p.barangay}\nFarmer: ${p.farmer}\nCrop: ${p.crop}\nArea: ${p.area} ha\n\nPredicted yield: ${p.predictedYield} t/ha\nTotal expected: ${total} tonnes\nConfidence: ${p.confidence}%\n\nGenerated: ${new Date().toLocaleString()}\n`,
      ],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.plotId}-prediction.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t("yr.reportExported"));
  }

  // Other cropping cycles on this same field — replaces what used to be
  // the 6 most-recently-added predictions from any field/farmer, which
  // had nothing to do with the one actually being viewed.
  const fieldCroppings = useMemo(() => {
    const cycles = p.fieldId ? visiblePredictions.filter((x) => x.fieldId === p.fieldId) : [p];
    return cycles.slice().sort((a, b) => new Date(b.plantingDate).getTime() - new Date(a.plantingDate).getTime());
  }, [visiblePredictions, p.fieldId, p.id]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {fieldCroppings.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-xs text-slate-500">{t("yr.recent")}</span>
          {fieldCroppings.map((x) => (
            <button
              key={x.id}
              onClick={() => setCurrent(x)}
              className={`text-xs px-3 py-1.5 rounded-full border whitespace-nowrap ${
                x.id === p.id ? "bg-emerald-600 border-emerald-600 text-white" : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50"
              }`}
            >
              {new Date(x.plantingDate).toLocaleDateString("en-PH", { month: "short", year: "2-digit" })} · {x.crop === "Corn" ? "Corn" : "Palay"}
            </button>
          ))}
        </div>
      )}

      <HarvestCard p={p} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="col-span-2 bg-gradient-to-br from-emerald-700 via-emerald-800 to-emerald-900 rounded-2xl p-7 text-white relative overflow-hidden">
          <div className="absolute -top-16 -right-16 h-64 w-64 rounded-full bg-emerald-400/15 blur-3xl" />
          <div className="flex items-center gap-2 text-emerald-200/90 text-sm">
            <Sparkles className="h-4 w-4" /> {t("yr.predictionGenerated")} {new Date(p.createdAt).toLocaleString()}
          </div>
          <div className="mt-4 flex items-end gap-8">
            <div>
              <div className="text-emerald-100/80 text-sm">{t("yr.estimatedYield")}</div>
              <div className="mt-1 flex items-baseline gap-2">
                <YieldValue valueTHa={p.predictedYield} className="text-6xl tracking-tight" tone="light" />
              </div>
              <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-100 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5" /> {+delta >= 0 ? "+" : ""}{delta}% {t("yr.vsPreviousCycle")}
              </div>
            </div>
            <div className="ml-auto">
              <ConfidenceRing value={p.confidence} />
            </div>
          </div>

          <div className="mt-7 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-white/5 px-3 py-2.5">
              <div className="text-emerald-200/80 text-xs">{t("yr.crop")}</div>
              <div>{p.crop === "Corn" ? t("common.crop.corn") : t("common.crop.palay")}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2.5">
              <div className="text-emerald-200/80 text-xs">{t("yr.plot")}</div>
              <div>{p.plotId} · {p.barangay}</div>
            </div>
            <div className="rounded-lg bg-white/5 px-3 py-2.5">
              <div className="text-emerald-200/80 text-xs">{t("yr.totalExpected")}</div>
              <div>{total} {t("yr.tonnes")} (<AreaValue valueHa={p.area} tone="light" />)</div>
            </div>
          </div>

          <div className="mt-6 flex items-center gap-2">
            <button onClick={exportPdf} className="px-4 h-9 rounded-lg bg-white text-emerald-800 text-sm flex items-center gap-2">
              <Download className="h-4 w-4" />{t("yr.exportReport")}
            </button>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(`${p.plotId} · ${p.predictedYield} t/ha (${p.confidence}%)`).catch(() => {});
                toast.success(`${t("yr.sharedToast")} ${p.farmer}.`);
              }}
              className="px-4 h-9 rounded-lg bg-white/10 hover:bg-white/20 text-sm flex items-center gap-2"
            >
              <Share2 className="h-4 w-4" />{t("yr.shareWithFarmer")}
            </button>
            <button
              onClick={() => setView("recommend")}
              className="ml-auto text-sm text-emerald-100/90 hover:text-white"
            >
              {t("yr.seeCropRecommendations")}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5">
          <div className="text-slate-900">{t("yr.contributingFactors")}</div>
          <div className="text-xs text-slate-500 mt-0.5 mb-4">{t("yr.featureImportance")}</div>
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
        <div className="col-span-2 bg-white border border-slate-100 rounded-2xl p-5">
          <div className="text-slate-900">{t("yr.yieldHistory5yr")}</div>
          <div className="text-xs text-slate-500 mt-0.5 mb-3">{t("yr.tonnesPerHa")}</div>
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="y" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
                <Line type="monotone" dataKey="v" stroke="#10b981" strokeWidth={2.5} dot={{ r: 4, fill: "#10b981" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-5">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertTriangle className="h-4 w-4" /> {t("yr.riskAdvisories")}
          </div>
          <ul className="mt-4 space-y-3 text-sm text-amber-900/90">
            {p.moisture < 55 && (
              <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{t("yr.riskLowMoisture")}</li>
            )}
            {p.rainfall < 100 && (
              <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{t("yr.riskLowRainfall")}</li>
            )}
            {p.temperature > 32 && (
              <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{t("yr.riskHighTemp")}</li>
            )}
            {p.ph < 5.5 && (
              <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{t("yr.riskAcidicSoil")}</li>
            )}
            <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{t("yr.riskNitrogenSplit")}</li>
            <li className="flex gap-2"><span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />{t("yr.riskPestMonitor")}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
