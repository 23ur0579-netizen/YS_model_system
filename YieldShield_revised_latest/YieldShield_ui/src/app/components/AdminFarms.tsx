import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Wheat, Leaf, MapPin, ChevronDown, Search, Users, LandPlot, TrendingUp, Sprout as SproutIcon, Download, Plus, X, FileSpreadsheet, Loader2 } from "lucide-react";
import { useStore, Prediction, Field, maturityDays, adminCrop } from "../store";
import { BARANGAY_FACTS, BARANGAY_DATA } from "../data/binalonan";
import { exportPredictionsCSV, exportPredictionsPDF } from "../export";
import { CroppingModal } from "./MyFarm";
import { YieldValue, AreaValue } from "./UnitValue";
import { StatCard } from "./StatCard";
import * as api from "../lib/api";
import { toast } from "sonner";

function labelFor(key: string) {
  return BARANGAY_DATA[key]?.label ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}
function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr); d.setDate(d.getDate() + n); return d;
}
function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}
function avatarInitials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

export function AdminFarms() {
  const { predictions, fields, setCurrent, setView, user } = useStore();
  const [query, setQuery] = useState("");
  const [openBarangays, setOpenBarangays] = useState<Record<string, boolean>>({});
  const [openFields, setOpenFields] = useState<Record<string, boolean>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [predictionField, setPredictionField] = useState<Field | null>(null);
  const [reportsOpen, setReportsOpen] = useState(false);

  // A Corn/Palay-assigned admin only ever sees that crop's fields and
  // croppings here — same privilege already used to lock Simulation.tsx's
  // crop picker and to filter Planning.tsx. Master/verification admins
  // (adminCrop returns "all") see everything, same as before.
  const lockedCrop = adminCrop(user?.adminRole);
  const isCropLocked = lockedCrop === "Corn" || lockedCrop === "Palay (Rice)";

  const q = query.trim().toLowerCase();

  // Group all *registered* farms (fields) by barangay — a field shows up
  // here as soon as it's registered, even before it has any cropping
  // (prediction) filed against it.
  const predictionsByField = useMemo(() => {
    const map: Record<string, Prediction[]> = {};
    for (const p of predictions) {
      if (!p.fieldId) continue;
      if (isCropLocked && p.crop !== lockedCrop) continue;
      (map[p.fieldId] ??= []).push(p);
    }
    return map;
  }, [predictions, isCropLocked, lockedCrop]);

  const groups = useMemo(() => {
    const map: Record<string, Field[]> = {};
    for (const f of fields) {
      if (q && !(f.farmer.toLowerCase().includes(q) || f.name.toLowerCase().includes(q) || labelFor(f.barangay).toLowerCase().includes(q))) continue;
      // A field with croppings but none matching the locked crop is
      // outside this admin's scope entirely. A field with no croppings
      // yet stays visible either way — it could still become their crop.
      const allCrops = predictions.filter((p) => p.fieldId === f.id);
      if (isCropLocked && allCrops.length > 0 && !(predictionsByField[f.id]?.length)) continue;
      (map[f.barangay] ??= []).push(f);
    }
    return Object.entries(map)
      .map(([key, flds]) => {
        const owners = new Set(flds.map((f) => f.ownerId));
        const area = flds.reduce((s, f) => s + f.area, 0);
        return { key, label: labelFor(key), fields: flds, owners: owners.size, area };
      })
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [fields, predictions, predictionsByField, isCropLocked, q]);

  const totals = useMemo(() => {
    const scopedPredictions = isCropLocked ? predictions.filter((p) => p.crop === lockedCrop) : predictions;
    const scopedFields = groups.flatMap((g) => g.fields);
    const totalYield = scopedPredictions.reduce((s, p) => s + (p.actualYield ?? p.predictedYield), 0);
    return {
      farms: scopedFields.length,
      owners: new Set(scopedFields.map((f) => f.ownerId)),
      area: scopedFields.reduce((s, f) => s + f.area, 0),
      croppings: scopedPredictions.length,
      avgYield: scopedPredictions.length ? totalYield / scopedPredictions.length : 0,
    };
  }, [groups, predictions, isCropLocked, lockedCrop]);

  const shownFields = useMemo(() => groups.flatMap((g) => g.fields), [groups]);
  const shownPredictions = useMemo(
    () => shownFields.flatMap((f) => predictionsByField[f.id] ?? []),
    [shownFields, predictionsByField]
  );

  const pq = pickerQuery.trim().toLowerCase();
  const pickerFields = useMemo(() => {
    return fields
      .filter((f) => !pq || f.farmer.toLowerCase().includes(pq) || f.name.toLowerCase().includes(pq) || labelFor(f.barangay).toLowerCase().includes(pq))
      .sort((a, b) => a.farmer.localeCompare(b.farmer));
  }, [fields, pq]);

  function handleExport() {
    if (shownPredictions.length === 0) { toast.error("No cropping records to export."); return; }
    exportPredictionsCSV(shownPredictions, "yieldshield-farms");
    toast.success(`Exported ${shownPredictions.length} farm records to CSV.`);
  }

  function handleExportPDF() {
    if (shownPredictions.length === 0) { toast.error("No cropping records to export."); return; }
    exportPredictionsPDF(shownPredictions, "YieldShield — Farms Report");
    toast.success("PDF report opened in a new tab — use your browser's print dialog to save.");
  }

  function openFarm(p: Prediction) { setCurrent(p); setView("yield"); }
  function toggleBarangay(key: string) { setOpenBarangays((o) => ({ ...o, [key]: !(o[key] ?? true) })); }
  const isBarangayOpen = (key: string) => openBarangays[key] ?? true;
  function toggleField(id: string) { setOpenFields((o) => ({ ...o, [id]: !(o[id] ?? false) })); }
  const isFieldOpen = (id: string) => openFields[id] ?? false;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {isCropLocked && (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-700">
          {lockedCrop === "Corn" ? <Wheat className="h-3.5 w-3.5" /> : <Leaf className="h-3.5 w-3.5" />}
          {lockedCrop} program admin — showing {lockedCrop.replace(" (Rice)", "")}-only farms and croppings
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={LandPlot} tint="bg-emerald-50 text-emerald-600" label="Registered farms" value={totals.farms} sub={<AreaValue valueHa={totals.area} className="text-slate-400" />} />
        <StatCard icon={Users} tint="bg-sky-50 text-sky-600" label="Farm owners" value={totals.owners.size} sub={`across ${groups.length} barangays`} />
        <StatCard icon={SproutIcon} tint="bg-amber-50 text-amber-600" label="Croppings filed" value={totals.croppings} sub="prediction records" />
        <StatCard icon={Wheat} tint="bg-violet-50 text-violet-600" label="Avg. yield" value={<YieldValue valueTHa={totals.avgYield} className="text-slate-900" />} sub="across all croppings" />
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-emerald-600" />
          <span className="text-slate-900">Farms by Barangay</span>
          <span className="text-xs text-slate-400">· {shownFields.length} shown</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search owner, plot, barangay…"
              className="h-9 w-64 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
            />
          </div>
          <button
            onClick={handleExport}
            className="h-9 px-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm flex items-center gap-2"
          >
            <Download className="h-4 w-4 text-emerald-600" /> CSV
          </button>
          <button
            onClick={handleExportPDF}
            className="h-9 px-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm flex items-center gap-2"
          >
            <Download className="h-4 w-4 text-rose-500" /> PDF
          </button>
          <button
            onClick={() => setReportsOpen(true)}
            className="h-9 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 text-sm flex items-center gap-2"
          >
            <FileSpreadsheet className="h-4 w-4" /> Municipal reports
          </button>
          <button
            onClick={() => { setPickerQuery(""); setPickerOpen(true); }}
            className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> New prediction
          </button>
        </div>
      </div>

      {/* Barangay groups */}
      <div className="space-y-4">
        {groups.length === 0 && (
          <div className="bg-white border border-slate-100 rounded-2xl px-6 py-12 text-center text-sm text-slate-500">
            No farms match your search.
          </div>
        )}
        {groups.map((g) => {
          const facts = BARANGAY_FACTS[g.key];
          return (
            <div key={g.key} className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
              {/* Barangay header */}
              <button onClick={() => toggleBarangay(g.key)} className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50/60 transition-colors">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center">
                    <MapPin className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="text-left">
                    <div className="text-slate-900">{g.label}</div>
                    <div className="text-xs text-slate-500">
                      {g.fields.length} farm{g.fields.length === 1 ? "" : "s"} · {g.owners} owner{g.owners === 1 ? "" : "s"} · <AreaValue valueHa={g.area} />
                      {facts && <> · hist. <YieldValue valueTHa={facts.historicalYield} /></>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${isBarangayOpen(g.key) ? "" : "-rotate-90"}`} />
                </div>
              </button>

              {/* Field rows */}
              {isBarangayOpen(g.key) && (
                <div className="border-t border-slate-100 divide-y divide-slate-50">
                  {g.fields
                    .sort((a, b) => a.farmer.localeCompare(b.farmer))
                    .map((f) => {
                      const crops = (predictionsByField[f.id] ?? []).slice().sort((a, b) => new Date(b.plantingDate).getTime() - new Date(a.plantingDate).getTime());

                      if (crops.length === 0) {
                        // Registered farm, no cropping filed yet — nothing to
                        // expand, just the option to start one.
                        return (
                          <button
                            key={f.id}
                            onClick={() => setPredictionField(f)}
                            className="w-full px-6 py-3.5 flex items-center gap-4 text-left hover:bg-emerald-50/30 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs bg-gradient-to-br from-emerald-400 to-emerald-700">
                                {avatarInitials(f.farmer)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm text-slate-800 truncate">{f.farmer} · {f.name}</div>
                                <div className="text-xs text-slate-400 truncate"><AreaValue valueHa={f.area} /> · No cropping filed yet</div>
                              </div>
                            </div>
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border border-emerald-200 text-emerald-700 bg-emerald-50 shrink-0">
                              <Plus className="h-3 w-3" /> Add prediction
                            </span>
                          </button>
                        );
                      }

                      const latest = crops[0];
                      const latestHarvested = latest.actualYield != null || !!latest.harvestDate;
                      const fieldOpen = isFieldOpen(f.id);

                      return (
                        <div key={f.id}>
                          {/* Field header — expand to see every cropping on it */}
                          <button
                            onClick={() => toggleField(f.id)}
                            className="w-full px-6 py-3.5 flex items-center gap-4 text-left hover:bg-slate-50/60 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 min-w-0 flex-1">
                              <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs bg-gradient-to-br from-emerald-400 to-emerald-700">
                                {avatarInitials(f.farmer)}
                              </div>
                              <div className="min-w-0">
                                <div className="text-sm text-slate-800 truncate">{f.farmer} · {f.name}</div>
                                <div className="text-xs text-slate-400 truncate flex items-center gap-1 flex-wrap">
                                  <AreaValue valueHa={f.area} /> · {crops.length} cropping{crops.length === 1 ? "" : "s"}
                                  {!fieldOpen && (
                                    <>
                                      · latest: <YieldValue valueTHa={latestHarvested && latest.actualYield != null ? latest.actualYield : latest.predictedYield} /> ({latestHarvested ? "actual" : "predicted"})
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                            <ChevronDown className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${fieldOpen ? "" : "-rotate-90"}`} />
                          </button>

                          {/* Croppings within this field */}
                          {fieldOpen && (
                            <div className="pl-[52px] pr-4 pb-3 space-y-1 bg-slate-50/50">
                              {crops.map((p) => {
                                const est = addDays(p.plantingDate, maturityDays(p.crop, p.variety));
                                const harvested = p.actualYield != null || !!p.harvestDate;
                                return (
                                  <button
                                    key={p.id}
                                    onClick={() => openFarm(p)}
                                    className="w-full rounded-lg px-3 py-2.5 flex items-center justify-between gap-3 text-left bg-white hover:bg-emerald-50/50 border border-slate-100"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      {p.crop === "Corn" ? <Wheat className="h-3.5 w-3.5 text-amber-600 shrink-0" /> : <Leaf className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
                                      <span className="text-sm text-slate-700">{p.crop === "Corn" ? "Corn" : "Palay"}</span>
                                      <span className="text-xs text-slate-400 truncate">
                                        Planted {fmt(p.plantingDate)}
                                        {harvested && p.harvestDate ? ` · Harvested ${fmt(p.harvestDate)}` : !harvested ? ` · Est. ${fmt(est)}` : ""}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 shrink-0">
                                      <TrendingUp className="h-3 w-3 text-slate-400" />
                                      <span className="text-sm text-slate-800">
                                        <YieldValue valueTHa={harvested && p.actualYield != null ? p.actualYield : p.predictedYield} />
                                      </span>
                                      <span className="text-[11px] text-slate-400">{harvested ? "actual" : "predicted"}</span>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {pickerOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={() => setPickerOpen(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div className="text-slate-900">Select a farm</div>
              <button onClick={() => setPickerOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-3 border-b border-slate-100">
              <div className="relative">
                <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Search owner, field, barangay…"
                  className="h-9 w-full pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
                />
              </div>
            </div>
            <div className="flex-1 overflow-auto divide-y divide-slate-50">
              {pickerFields.length === 0 && (
                <div className="px-5 py-10 text-center text-sm text-slate-500">
                  No fields match — an owner must have a registered field before you can predict for them.
                </div>
              )}
              {pickerFields.map((f) => (
                <button
                  key={f.id}
                  onClick={() => { setPredictionField(f); setPickerOpen(false); }}
                  className="w-full px-5 py-3 flex items-center gap-3 text-left hover:bg-emerald-50/40 transition-colors"
                >
                  <div className="h-8 w-8 rounded-full shrink-0 flex items-center justify-center text-white text-xs bg-gradient-to-br from-emerald-400 to-emerald-700">
                    {avatarInitials(f.farmer)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-slate-800 truncate">{f.farmer} · {f.name}</div>
                    <div className="text-xs text-slate-400 truncate">{labelFor(f.barangay)} · <AreaValue valueHa={f.area} /></div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {predictionField && (
        <CroppingModal
          field={predictionField}
          mode="add"
          onBehalf={{ ownerId: predictionField.ownerId, farmerName: predictionField.farmer }}
          onClose={() => setPredictionField(null)}
        />
      )}

      {reportsOpen && <ReportsModal onClose={() => setReportsOpen(false)} />}
    </div>
  );
}

// Downloads the two official Municipal Agriculture Office reports —
// Planting Status, and Area Harvested by Ecosystem/Seed Type — as real
// .xlsx files matching the office's own existing templates. See
// backend/app/reports.py for how each workbook is actually built.
function ReportsModal({ onClose }: { onClose: () => void }) {
  const { user } = useStore();
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 6, 1).toISOString().slice(0, 10);
  const defaultTo = today.toISOString().slice(0, 10);

  // Which report this panel is currently configuring — the date range
  // below is auto-suggested per tab (see the effect below) since
  // "planted" and "harvested" genuinely cover different windows: a
  // harvested-crops window that only contains still-growing crops is
  // a correct, empty report, not a bug, but it's indistinguishable
  // from one at a glance, and the old fixed "6 months back" default
  // had a real chance of landing there for "harvested" specifically.
  const [reportKind, setReportKind] = useState<"planted" | "harvested">("planted");
  const [rangeNote, setRangeNote] = useState<string | null>(null);

  const [form, setForm] = useState({
    crop: "Palay (Rice)" as "Palay (Rice)" | "Corn",
    ecosystem: "Irrigated" as "Irrigated" | "Rainfed" | "All",
    dateFrom: defaultFrom,
    dateTo: defaultTo,
    seasonLabel: "",
    asOfLabel: today.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" }),
    preparedBy: user?.name ?? "",
    preparedTitle: "Agricultural Technologist",
    notedBy: "",
    notedTitle: "Municipal Agriculturist",
  });
  const [downloading, setDownloading] = useState(false);
  const [loadingRange, setLoadingRange] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  // Auto-fills the date range whenever the report type or crop changes
  // — not on every keystroke, so an admin who manually narrows the
  // window afterward isn't fought with. Leaves whatever's currently
  // typed untouched (rather than silently reverting it) if this crop/
  // kind combination genuinely has no data yet, and says so instead of
  // just doing nothing visibly.
  useEffect(() => {
    let cancelled = false;
    setLoadingRange(true);
    setRangeNote(null);
    api.getReportDateRange(form.crop, reportKind)
      .then((range) => {
        if (cancelled) return;
        if (range.minDate && range.maxDate) {
          setForm((f) => ({ ...f, dateFrom: range.minDate!, dateTo: range.maxDate! }));
        } else {
          setRangeNote(
            reportKind === "harvested"
              ? `No ${form.crop} croppings have a recorded harvest yet — showing the last suggested window; try Area Planted instead, or widen the dates once something's been harvested.`
              : `No ${form.crop} croppings found at all yet.`
          );
        }
      })
      .catch(() => { /* non-critical — the manually-set/previous date range still works fine */ })
      .finally(() => { if (!cancelled) setLoadingRange(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKind, form.crop]);

  function paramsOrError(): api.ReportParams | null {
    if (!form.seasonLabel.trim()) { toast.error('Season label is required, e.g. "DS 2025-2026".'); return null; }
    if (!form.preparedBy.trim()) { toast.error('"Prepared by" name is required.'); return null; }
    if (new Date(form.dateTo) < new Date(form.dateFrom)) { toast.error("The end date can't be before the start date."); return null; }
    return {
      crop: form.crop,
      ecosystem: form.ecosystem,
      date_from: form.dateFrom,
      date_to: form.dateTo,
      season_label: form.seasonLabel.trim(),
      as_of_label: form.asOfLabel.trim(),
      prepared_by: form.preparedBy.trim(),
      prepared_title: form.preparedTitle.trim(),
      noted_by: form.notedBy.trim(),
      noted_title: form.notedTitle.trim(),
    };
  }

  async function download() {
    const params = paramsOrError();
    if (!params) return;
    setDownloading(true);
    try {
      if (reportKind === "planted") await api.downloadAreaPlantedReport(params);
      else await api.downloadAreaHarvestedReport(params);
      toast.success("Report downloaded.");
    } catch (err) {
      toast.error(err instanceof api.ApiError ? err.message : "Couldn't generate the report — please try again.");
    } finally {
      setDownloading(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="text-slate-900">Municipal reports</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1 mx-6 mt-4 bg-slate-100 rounded-lg p-1 shrink-0">
          {([
            { id: "planted", label: "Area Planted" },
            { id: "harvested", label: "Area Harvested" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setReportKind(opt.id)}
              className={`flex-1 h-9 rounded-md text-sm transition-colors ${
                reportKind === opt.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            Generates the office's official {reportKind === "planted" ? "Area Planted" : "Area Harvested"} report
            directly from submitted cropping records, for the crop, ecosystem, and date range below. The date range
            is auto-filled to whatever window actually {reportKind === "planted" ? "has plantings" : "has recorded harvests"} for
            the selected crop — adjust it if you want a narrower one. "Target" is left blank in the file for the
            office to fill in — this app doesn't track season planning targets.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Crop</div>
              <select value={form.crop} onChange={(e) => set("crop", e.target.value)} className={inputCls}>
                <option value="Palay (Rice)">Palay (Rice)</option>
                <option value="Corn">Corn</option>
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Season label</div>
              <input value={form.seasonLabel} onChange={(e) => set("seasonLabel", e.target.value)} placeholder="e.g. DS 2025-2026" className={inputCls} />
            </label>
          </div>

          <div>
            <div className="text-sm text-slate-700 mb-1.5">Ecosystem</div>
            <div className="grid grid-cols-3 gap-2">
              {([
                { id: "Irrigated", label: "Irrigated" },
                { id: "Rainfed", label: "Rainfed" },
                { id: "All", label: "Overall" },
              ] as const).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => set("ecosystem", opt.id)}
                  className={`h-10 rounded-lg border text-sm transition-colors ${
                    form.ecosystem === opt.id ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="text-xs text-slate-400 mt-1.5">
              {form.ecosystem === "All"
                ? "Combines Irrigated and Rainfed figures into one sheet, same as the office's own TOTAL tab."
                : `Only ${form.ecosystem.toLowerCase()} croppings are counted on the generated sheet.`}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5 flex items-center gap-1.5">
                Planting date from
                {loadingRange && <Loader2 className="h-3 w-3 animate-spin text-slate-400" />}
              </div>
              <input type="date" value={form.dateFrom} onChange={(e) => set("dateFrom", e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Planting date to</div>
              <input type="date" value={form.dateTo} onChange={(e) => set("dateTo", e.target.value)} className={inputCls} />
            </label>
          </div>
          {rangeNote && (
            <div className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span>{rangeNote}</span>
            </div>
          )}

          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">"As of" label shown on the report</div>
            <input value={form.asOfLabel} onChange={(e) => set("asOfLabel", e.target.value)} placeholder="e.g. August 28, 2026" className={inputCls} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Prepared by</div>
              <input value={form.preparedBy} onChange={(e) => set("preparedBy", e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Their title</div>
              <input value={form.preparedTitle} onChange={(e) => set("preparedTitle", e.target.value)} className={inputCls} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Noted by</div>
              <input value={form.notedBy} onChange={(e) => set("notedBy", e.target.value)} placeholder="e.g. Municipal Agriculturist's name" className={inputCls} />
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Their title</div>
              <input value={form.notedTitle} onChange={(e) => set("notedTitle", e.target.value)} className={inputCls} />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Close</button>
          <button
            onClick={download}
            disabled={downloading}
            className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-60 flex items-center gap-2"
          >
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            {reportKind === "planted" ? "Download Area Planted" : "Download Area Harvested"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const inputCls = "w-full h-10 px-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none";
