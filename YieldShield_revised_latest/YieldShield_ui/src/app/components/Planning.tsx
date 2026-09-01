import { useMemo, useState } from "react";
import { AlertTriangle, ClipboardList, MapPin, Sprout, TrendingDown, Users, CheckCircle2, Tractor, BarChart3, Droplets, FlaskConical, Package, Wheat, Download } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend } from "recharts";
import { useStore, adminCrop } from "../store";
import { BARANGAY_FACTS, BARANGAY_DATA } from "../data/binalonan";
import { exportPredictionsCSV, exportPredictionsPDF } from "../export";
import { YieldValue, AreaValue } from "./UnitValue";
import { StatCard as SummaryCard } from "./StatCard";
import { toast } from "sonner";

type Priority = "Critical" | "High" | "Watch" | "Healthy" | "Unmonitored";
type PlanView = "barangay" | "field" | "resources";

const COLOR: Record<Priority, { bg: string; text: string; bar: string }> = {
  Critical: { bg: "bg-rose-50 border-rose-200", text: "text-rose-700", bar: "bg-rose-500" },
  High:     { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", bar: "bg-amber-500" },
  Watch:    { bg: "bg-sky-50 border-sky-200", text: "text-sky-700", bar: "bg-sky-500" },
  Healthy:  { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", bar: "bg-emerald-500" },
  // Not a real urgency reading — historical/reference data is used to
  // train the yield model, never to stand in for a score on this
  // screen. A barangay with no live cropping records yet gets no
  // urgency bar or number at all, just this neutral "not yet monitored"
  // state, until real submissions come in.
  Unmonitored: { bg: "bg-slate-50 border-slate-200", text: "text-slate-500", bar: "bg-slate-300" },
};

function classify(score: number): Priority {
  if (score >= 75) return "Critical";
  if (score >= 55) return "High";
  if (score >= 35) return "Watch";
  return "Healthy";
}

function interventions(
  hasData: boolean,
  env: { ph: number; moisture: number; rainfall: number },
  facts: { irrigatedArea: number; landSize: number; historicalYield: number } | undefined,
): string[] {
  // No live cropping data for this barangay yet — the only honest
  // recommendation is to go get some; anything more specific would be
  // presenting the historical baseline as if it were a live assessment.
  if (!hasData) return ["Dispatch field officer to begin live monitoring"];

  const list: string[] = [];
  const irrRatio = facts ? facts.irrigatedArea / facts.landSize : 1;
  if (facts && facts.historicalYield > 0 && facts.historicalYield < 3.6)
    list.push("Enroll in yield-recovery program (certified seed + soil rehab)");
  if (irrRatio < 0.15) list.push("Prioritize communal irrigation / small water impounding");
  else if (irrRatio < 0.25) list.push("Expand irrigation coverage to rainfed parcels");
  if (env.moisture < 60) list.push("Deploy supplemental irrigation support");
  if (env.rainfall < 130) list.push("Schedule water trucking for vulnerable plots");
  if (env.ph < 6.2) list.push("Distribute agricultural lime for soil amendment");
  if (env.ph > 6.6) list.push("Apply sulfur amendment to lower pH");
  if (list.length === 0) list.push("Continue monitoring — no intervention needed");
  return list;
}

export function Planning() {
  const { predictions, user } = useStore();
  const [view, setView] = useState<PlanView>("barangay");

  // Corn/palay officers only plan for their own crop; master sees all.
  const cropScope = adminCrop(user?.adminRole);
  const scoped = useMemo(
    () => (cropScope === "all" || cropScope === "none" ? predictions : predictions.filter((p) => p.crop === cropScope)),
    [predictions, cropScope],
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {cropScope !== "all" && cropScope !== "none" && (
          <span className="px-3 py-1 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
            <Wheat className="h-3.5 w-3.5" /> {cropScope} program scope
          </span>
        )}
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 ml-auto">
          {([
            { id: "barangay", label: "Per Barangay", icon: MapPin },
            { id: "field", label: "Per Farm / Field", icon: Tractor },
            { id: "resources", label: "Resource Analytics", icon: BarChart3 },
          ] as const).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setView(t.id)}
                className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-1.5 transition-colors ${
                  view === t.id ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {t.label}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => {
            if (scoped.length === 0) { toast.error("No plots to export."); return; }
            exportPredictionsCSV(scoped, "yieldshield-planning");
            toast.success(`Exported ${scoped.length} plot records to CSV.`);
          }}
          className="h-9 px-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm flex items-center gap-2"
        >
          <Download className="h-4 w-4 text-emerald-600" /> CSV
        </button>
        <button
          onClick={() => {
            if (scoped.length === 0) { toast.error("No plots to export."); return; }
            exportPredictionsPDF(scoped, "YieldShield — Intervention Planning Report");
            toast.success("PDF report opened in a new tab — use your browser's print dialog to save.");
          }}
          className="h-9 px-3 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm flex items-center gap-2"
        >
          <Download className="h-4 w-4 text-rose-500" /> PDF
        </button>
      </div>

      {view === "barangay" && <BarangayPlan predictions={scoped} />}
      {view === "field" && <FieldPlan predictions={scoped} />}
      {view === "resources" && <ResourcePlan predictions={scoped} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-barangay view                                                   */
/* ------------------------------------------------------------------ */
function BarangayPlan({ predictions }: { predictions: any[] }) {
  const [filter, setFilter] = useState<Priority | "All">("All");

  const rows = useMemo(() => {
    return Object.entries(BARANGAY_DATA).map(([key, env]) => {
      const here = predictions.filter((p) => p.barangay === key);
      const facts = BARANGAY_FACTS[key];
      const hasLiveData = here.length > 0;
      const avgConf = hasLiveData ? here.reduce((s, p) => s + p.confidence, 0) / here.length : 0;
      const totalArea = here.reduce((s, p) => s + p.area, 0);
      const avgYield = hasLiveData ? here.reduce((s, p) => s + p.predictedYield, 0) / here.length : 0;

      // Urgency is only ever computed from real submitted data. The
      // historical baseline (histYield below) feeds the yield *model*
      // elsewhere in the app — it never substitutes for a live score
      // here. No live data means no score and no priority ranking at
      // all, just "Unmonitored", until real croppings come in.
      let score: number | null = null;
      let priority: Priority = "Unmonitored";
      if (hasLiveData) {
        let s = 0;
        if (avgYield < 3.6) s += 44;
        else if (avgYield < 4.4) s += 30;
        else if (avgYield < 5.0) s += 16;
        if (facts && facts.irrigatedArea / facts.landSize < 0.12) s += 16;
        else if (facts && facts.irrigatedArea / facts.landSize < 0.22) s += 8;
        if (env.moisture < 60) s += 8;
        if (env.rainfall < 130) s += 8;
        if (env.ph < 6.2 || env.ph > 6.6) s += 6;
        if (avgConf && avgConf < 80) s += 6;
        score = Math.min(100, s);
        priority = classify(score);
      }

      return {
        key,
        label: env.label,
        env,
        avgYield: +avgYield.toFixed(2),
        hasLiveData,
        avgConf: Math.round(avgConf),
        plots: here.length,
        farmers: new Set(here.map((p) => p.ownerId)).size,
        totalArea: +totalArea.toFixed(1),
        score,
        priority,
        actions: interventions(hasLiveData, env, facts),
        histYield: facts?.historicalYield ?? 0,
        irrRatio: facts ? Math.round((facts.irrigatedArea / facts.landSize) * 100) : null,
      };
    }).sort((a, b) => {
      // Monitored barangays first (ranked by real urgency); unmonitored
      // ones after, alphabetically — never interleaved by a score that
      // doesn't actually exist for them.
      if (a.hasLiveData !== b.hasLiveData) return a.hasLiveData ? -1 : 1;
      if (a.hasLiveData) return (b.score ?? 0) - (a.score ?? 0);
      return a.label.localeCompare(b.label);
    });
  }, [predictions]);

  const counts = rows.reduce((acc, r) => { acc[r.priority] = (acc[r.priority] ?? 0) + 1; return acc; }, {} as Record<Priority, number>);
  const filtered = filter === "All" ? rows : rows.filter((r) => r.priority === filter);
  const totals = {
    farmers: rows.reduce((s, r) => s + r.farmers, 0),
    plots: rows.reduce((s, r) => s + r.plots, 0),
    area: +rows.reduce((s, r) => s + r.totalArea, 0).toFixed(1),
    needsAttention: rows.filter((r) => r.priority === "Critical" || r.priority === "High").length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard icon={AlertTriangle} tint="bg-rose-50 text-rose-600" label="Barangays needing attention" value={String(totals.needsAttention)} sub={`${counts.Critical ?? 0} critical · ${counts.High ?? 0} high`} />
        <SummaryCard icon={Sprout} tint="bg-emerald-50 text-emerald-600" label="Healthy barangays" value={String(counts.Healthy ?? 0)} sub={`${counts.Watch ?? 0} on watch · ${counts.Unmonitored ?? 0} unmonitored`} />
        <SummaryCard icon={Users} tint="bg-amber-50 text-amber-600" label="Active farmers" value={String(totals.farmers)} sub={`${totals.plots} plots tracked`} />
        <SummaryCard icon={MapPin} tint="bg-sky-50 text-sky-600" label="Total monitored area" value={<AreaValue valueHa={totals.area} />} sub="across Binalonan" />
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-slate-900 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-emerald-600" /> Intervention Planning
            </div>
            <div className="text-xs text-slate-500 mt-0.5">Barangays ranked by urgency · {filtered.length} of {rows.length} shown</div>
          </div>
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
            {(["All", "Critical", "High", "Watch", "Healthy", "Unmonitored"] as const).map((p) => (
              <button key={p} onClick={() => setFilter(p)}
                className={`px-3 py-1.5 rounded-md text-xs transition-colors ${filter === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
                {p}
                {p !== "All" && counts[p] !== undefined && <span className="ml-1.5 text-slate-400">{counts[p]}</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-slate-100">
          {filtered.map((r) => {
            const c = COLOR[r.priority];
            return (
              <div key={r.key} className="px-6 py-4 hover:bg-slate-50/60 transition-colors">
                <div className="grid grid-cols-12 gap-4 items-start">
                  <div className="col-span-12 sm:col-span-3">
                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${c.bg} ${c.text}`}>{r.priority}</span>
                    </div>
                    <div className="mt-2 text-slate-900 flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-emerald-600" />{r.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{r.farmers} farmer{r.farmers === 1 ? "" : "s"} · <AreaValue valueHa={r.totalArea} /></div>
                  </div>
                  <div className="col-span-12 sm:col-span-3">
                    <div className="text-xs text-slate-500">Yield · Confidence</div>
                    <div className="mt-1 flex items-baseline gap-1.5">
                      <span className="text-slate-900">
                        {r.hasLiveData ? <YieldValue valueTHa={r.avgYield} className="text-slate-900" /> : <span className="text-slate-400 text-sm">No live data</span>}
                      </span>
                      {r.hasLiveData && r.avgConf > 0 && <span className="text-xs text-slate-500">· {r.avgConf}%</span>}
                    </div>
                    {r.hasLiveData ? (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="h-1.5 w-32 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full ${c.bar}`} style={{ width: `${r.score}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">Urgency {r.score}</span>
                      </div>
                    ) : (
                      <div className="mt-2 text-xs text-slate-400">Urgency will show once cropping data is submitted</div>
                    )}
                  </div>
                  <div className="col-span-12 sm:col-span-3 text-xs text-slate-600">
                    <div className="text-slate-500 mb-1">Conditions</div>
                    <div className="flex flex-wrap gap-1.5">
                      {r.histYield > 0 && <Chip warn={r.histYield < 4.0}><YieldValue valueTHa={r.histYield} /> hist.</Chip>}
                      {r.irrRatio !== null && <Chip warn={r.irrRatio < 15}>{r.irrRatio}% irrig.</Chip>}
                      <Chip warn={r.env.rainfall < 130}>{r.env.rainfall}mm rain</Chip>
                      <Chip>{r.env.soilType}</Chip>
                    </div>
                  </div>
                  <div className="col-span-12 sm:col-span-3">
                    <div className="text-xs text-slate-500">Recommended actions</div>
                    <ul className="mt-1 space-y-1 text-xs text-slate-700">
                      {r.actions.slice(0, 2).map((a, i) => (
                        <li key={i} className="flex gap-1.5">
                          {r.priority === "Healthy" ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /> : <TrendingDown className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />}
                          <span>{a}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="px-6 py-10 text-center text-sm text-slate-500">No barangays match this filter.</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Per-farm / field view                                               */
/* ------------------------------------------------------------------ */
function FieldPlan({ predictions }: { predictions: any[] }) {
  const { fields } = useStore();
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const list = fields.map((f: any) => {
      const here = predictions.filter((p) => p.fieldId === f.id || (!p.fieldId && p.barangay === f.barangay && p.ownerId === f.ownerId));
      const env = BARANGAY_DATA[f.barangay];
      const avgYield = here.length ? here.reduce((s, p) => s + p.predictedYield, 0) / here.length : 0;
      const avgConf = here.length ? here.reduce((s, p) => s + p.confidence, 0) / here.length : 0;
      const latest = [...here].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

      let score = 0;
      if (avgYield && avgYield < 3.6) score += 40;
      else if (avgYield && avgYield < 4.4) score += 26;
      else if (avgYield && avgYield < 5.0) score += 14;
      if (env && env.moisture < 60) score += 12;
      if (env && env.rainfall < 130) score += 10;
      if (env && (env.ph < 6.2 || env.ph > 6.6)) score += 8;
      if (here.length === 0) score += 20;
      if (avgConf && avgConf < 80) score += 8;
      score = Math.min(100, score);

      const actions: string[] = [];
      if (here.length === 0) actions.push("No active cropping — schedule field assessment");
      if (env && env.moisture < 60) actions.push("Irrigation support recommended");
      if (env && (env.ph < 6.2)) actions.push("Apply lime — soil too acidic");
      else if (env && env.ph > 6.6) actions.push("Apply sulfur — soil too alkaline");
      if (avgYield && avgYield < 4.0) actions.push("Certified seed + fertilizer top-up");
      if (actions.length === 0) actions.push("On track — routine monitoring");

      return {
        id: f.id, name: f.name, farmer: f.farmer, barangay: f.barangay,
        label: env?.label ?? f.barangay, location: f.location, area: f.area,
        crops: [...new Set(here.map((p) => p.crop))],
        activeCount: here.filter((p) => !p.actualYield).length,
        avgYield: +avgYield.toFixed(2), avgConf: Math.round(avgConf),
        latest, score, priority: classify(score), actions,
      };
    }).sort((a, b) => b.score - a.score);
    if (!q.trim()) return list;
    // Same fix as AuditLog.tsx's search: trim the actual term used for
    // matching, not just the "is this empty" check — otherwise a
    // leading/trailing space in the query needs that exact same space
    // in the same spot in the target text to match at all.
    const t = q.trim().toLowerCase();
    return list.filter((r) => r.name.toLowerCase().includes(t) || r.farmer.toLowerCase().includes(t) || r.label.toLowerCase().includes(t));
  }, [fields, predictions, q]);

  const totals = {
    fields: fields.length,
    area: +fields.reduce((s: number, f: any) => s + f.area, 0).toFixed(1),
    active: rows.reduce((s, r) => s + r.activeCount, 0),
    attention: rows.filter((r) => r.priority === "Critical" || r.priority === "High").length,
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard icon={Tractor} tint="bg-emerald-50 text-emerald-600" label="Registered fields" value={String(totals.fields)} sub={<AreaValue valueHa={totals.area} className="text-slate-400" />} />
        <SummaryCard icon={Sprout} tint="bg-amber-50 text-amber-600" label="Active croppings" value={String(totals.active)} sub="in-season across fields" />
        <SummaryCard icon={AlertTriangle} tint="bg-rose-50 text-rose-600" label="Fields needing attention" value={String(totals.attention)} sub="critical or high priority" />
        <SummaryCard icon={MapPin} tint="bg-sky-50 text-sky-600" label="Coverage" value={String(new Set(fields.map((f: any) => f.barangay)).size)} sub="barangays with fields" />
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-slate-900 flex items-center gap-2"><Tractor className="h-4 w-4 text-emerald-600" /> Field-level Planning</div>
            <div className="text-xs text-slate-500 mt-0.5">{rows.length} field{rows.length === 1 ? "" : "s"} ranked by urgency</div>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search field, farmer, barangay…"
            className="h-9 px-3 rounded-lg border border-slate-200 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
        </div>

        <div className="divide-y divide-slate-100">
          {rows.map((r) => {
            const c = COLOR[r.priority];
            return (
              <div key={r.id} className="px-6 py-4 hover:bg-slate-50/60 transition-colors grid grid-cols-12 gap-4 items-start">
                <div className="col-span-12 sm:col-span-4">
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs border ${c.bg} ${c.text}`}>{r.priority}</span>
                    {r.activeCount === 0 && <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 border border-slate-200">Idle</span>}
                  </div>
                  <div className="mt-2 text-slate-900">{r.name}</div>
                  <div className="text-xs text-slate-500 mt-0.5">{r.farmer} · {r.label} · <AreaValue valueHa={r.area} /></div>
                  {r.location && <div className="text-xs text-slate-400 mt-0.5">{r.location}</div>}
                </div>
                <div className="col-span-6 sm:col-span-3">
                  <div className="text-xs text-slate-500">Crops · Yield</div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {r.crops.length ? r.crops.map((cr) => <Chip key={cr}>{cr}</Chip>) : <span className="text-xs text-slate-400">none</span>}
                  </div>
                  <div className="mt-1.5 text-sm text-slate-900">{r.avgYield > 0 ? <YieldValue valueTHa={r.avgYield} className="text-slate-900" /> : "—"}{r.avgConf > 0 && <span className="text-xs text-slate-500"> · {r.avgConf}%</span>}</div>
                </div>
                <div className="col-span-6 sm:col-span-2">
                  <div className="text-xs text-slate-500">Urgency</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden"><div className={`h-full ${c.bar}`} style={{ width: `${r.score}%` }} /></div>
                    <span className="text-xs text-slate-500">{r.score}</span>
                  </div>
                </div>
                <div className="col-span-12 sm:col-span-3">
                  <div className="text-xs text-slate-500">Recommended actions</div>
                  <ul className="mt-1 space-y-1 text-xs text-slate-700">
                    {r.actions.slice(0, 2).map((a, i) => (
                      <li key={i} className="flex gap-1.5">
                        {r.priority === "Healthy" ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mt-0.5 shrink-0" /> : <TrendingDown className="h-3 w-3 text-amber-500 mt-0.5 shrink-0" />}
                        <span>{a}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
          {rows.length === 0 && <div className="px-6 py-10 text-center text-sm text-slate-500">No fields match your search.</div>}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resource analytics view                                             */
/* ------------------------------------------------------------------ */
function ResourcePlan({ predictions }: { predictions: any[] }) {
  const active = useMemo(() => predictions.filter((p) => !p.actualYield), [predictions]);

  // Resource estimation model (per-hectare rules of thumb for MAO planning).
  const totals = useMemo(() => {
    let seed = 0, urea = 0, complete = 0, waterHa = 0;
    active.forEach((p) => {
      const isCorn = p.crop === "Corn";
      seed += p.area * (isCorn ? 20 : 40);        // kg seed / ha
      urea += p.area * (isCorn ? 3 : 4);          // bags urea / ha
      complete += p.area * (isCorn ? 2 : 3);      // bags complete (14-14-14) / ha
      const env = BARANGAY_DATA[p.barangay];
      if (!env || env.moisture < 65 || env.rainfall < 140) waterHa += p.area; // needs irrigation support
    });
    return {
      seed: Math.round(seed), urea: Math.round(urea), complete: Math.round(complete),
      waterHa: +waterHa.toFixed(1),
      area: +active.reduce((s, p) => s + p.area, 0).toFixed(1),
    };
  }, [active]);

  const byBarangay = useMemo(() => {
    const m: Record<string, { label: string; area: number; seed: number; fert: number }> = {};
    active.forEach((p) => {
      const env = BARANGAY_DATA[p.barangay];
      const key = p.barangay;
      if (!m[key]) m[key] = { label: env?.label ?? key, area: 0, seed: 0, fert: 0 };
      const isCorn = p.crop === "Corn";
      m[key].area += p.area;
      m[key].seed += p.area * (isCorn ? 20 : 40);
      m[key].fert += p.area * (isCorn ? 5 : 7);
    });
    return Object.values(m).map((v) => ({ label: v.label, area: +v.area.toFixed(1), seed: Math.round(v.seed), fert: Math.round(v.fert) }))
      .sort((a, b) => b.area - a.area).slice(0, 10);
  }, [active]);

  const cropMix = useMemo(() => {
    const palay = active.filter((p) => p.crop === "Palay (Rice)").reduce((s, p) => s + p.area, 0);
    const corn = active.filter((p) => p.crop === "Corn").reduce((s, p) => s + p.area, 0);
    return [
      { name: "Palay (Rice)", value: +palay.toFixed(1), color: "#10b981" },
      { name: "Corn", value: +corn.toFixed(1), color: "#f59e0b" },
    ].filter((d) => d.value > 0);
  }, [active]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <SummaryCard icon={Package} tint="bg-emerald-50 text-emerald-600" label="Certified seed needed" value={`${totals.seed} kg`} sub={<AreaValue valueHa={totals.area} className="text-slate-400" />} />
        <SummaryCard icon={FlaskConical} tint="bg-violet-50 text-violet-600" label="Urea (46-0-0)" value={`${totals.urea} bags`} sub="50 kg bags, whole season" />
        <SummaryCard icon={FlaskConical} tint="bg-amber-50 text-amber-600" label="Complete (14-14-14)" value={`${totals.complete} bags`} sub="basal application" />
        <SummaryCard icon={Droplets} tint="bg-sky-50 text-sky-600" label="Irrigation support" value={<AreaValue valueHa={totals.waterHa} />} sub="low moisture / rainfed plots" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-100 rounded-2xl p-6">
          <div className="text-slate-900 flex items-center gap-2 mb-4"><BarChart3 className="h-4 w-4 text-emerald-600" /> Resource demand by barangay (top 10)</div>
          {byBarangay.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-slate-500">No active croppings to plan for.</div>
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={byBarangay} margin={{ top: 4, right: 8, left: -12, bottom: 40 }}>
                <XAxis dataKey="label" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 11, fill: "#64748b" }} height={60} />
                <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
                <Tooltip contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="seed" name="Seed (kg)" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="fert" name="Fertilizer (bags)" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-6">
          <div className="text-slate-900 flex items-center gap-2 mb-4"><Wheat className="h-4 w-4 text-emerald-600" /> Cropped area mix</div>
          {cropMix.length === 0 ? (
            <div className="h-64 flex items-center justify-center text-sm text-slate-500">No active croppings.</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={cropMix} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={90} paddingAngle={3}>
                  {cropMix.map((d) => <Cell key={d.name} fill={d.color} />)}
                </Pie>
                <Tooltip formatter={(v: any) => `${v} ha`} contentStyle={{ borderRadius: 12, border: "1px solid #e2e8f0", fontSize: 12 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-6">
        <div className="text-slate-900 flex items-center gap-2 mb-2"><ClipboardList className="h-4 w-4 text-emerald-600" /> Procurement planning notes</div>
        <p className="text-xs text-slate-500 mb-4">Estimates use MAO per-hectare norms (palay: 40 kg seed, 4 bags urea, 3 bags complete; corn: 20 kg seed, 3 bags urea, 2 bags complete). Add ~10% buffer for distribution losses.</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <PlanNote tint="bg-emerald-50 text-emerald-700" label="Seed w/ 10% buffer" value={`${Math.round(totals.seed * 1.1)} kg`} />
          <PlanNote tint="bg-violet-50 text-violet-700" label="Total fertilizer" value={`${totals.urea + totals.complete} bags`} />
          <PlanNote tint="bg-sky-50 text-sky-700" label="Est. water trucking runs" value={`${Math.ceil(totals.waterHa / 5)} runs`} />
        </div>
      </div>
    </div>
  );
}

function PlanNote({ tint, label, value }: { tint: string; label: string; value: string }) {
  return (
    <div className={`rounded-xl p-4 ${tint}`}>
      <div className="text-xs opacity-80">{label}</div>
      <div className="mt-1 text-xl tracking-tight">{value}</div>
    </div>
  );
}



function Chip({ children, warn }: { children: any; warn?: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded-md border ${warn ? "bg-amber-50 border-amber-200 text-amber-800" : "bg-slate-50 border-slate-200 text-slate-700"}`}>
      {children}
    </span>
  );
}
