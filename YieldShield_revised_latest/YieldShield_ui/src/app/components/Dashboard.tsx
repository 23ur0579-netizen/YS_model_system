import { TrendingUp, Wheat, Leaf, Droplets, ThermometerSun, MapPin, Plus, Megaphone, Pin, CalendarDays, ShieldAlert, BookOpen, Tag, Clock, X, Loader2 } from "lucide-react";
import { useState, useMemo } from "react";
import {
  ComposedChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Line,
} from "recharts";
import { useStore, AnnouncementTag, adminCrop, moisturePctToMm, municipalityAvgMoistureMm } from "../store";
import { useT } from "../i18n";
import { toast } from "sonner";
import { pagasaRainfallCategory } from "../lib/pagasaWeather";
import { BarangayHeatMap } from "./BarangayHeatMap";
import { WeekPlan } from "./WeekPlan";
import { YieldValue, AreaValue } from "./UnitValue";
import { StatCard as Stat } from "./StatCard";

const TAG_LABELS: { key: AnnouncementTag; labelKey: string }[] = [
  { key: "advisory", labelKey: "tag.advisory" },
  { key: "program",  labelKey: "tag.program"  },
  { key: "schedule", labelKey: "tag.schedule" },
  { key: "policy",   labelKey: "tag.policy"   },
  { key: "reminder", labelKey: "tag.reminder" },
];

const BLANK = { title: "", about: "", description: "", tag: "advisory" as AnnouncementTag };

function PostAnnouncementModal({ onClose }: { onClose: () => void }) {
  const { user, addAnnouncement } = useStore();
  const t = useT();
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  function set(k: keyof typeof BLANK, v: string) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.description.trim()) return;
    setSaving(true);
    setTimeout(() => {
      addAnnouncement({
        title: form.title.trim(),
        body: `${form.about.trim() ? form.about.trim() + " — " : ""}${form.description.trim()}`,
        tag: form.tag,
        date: new Date().toISOString().slice(0, 10),
        author: user?.name ?? "MAO Binalonan",
        pinned: false,
      });
      setSaving(false);
      setDone(true);
    }, 700);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Megaphone className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="text-slate-900">{t("dash.postAnnouncementTitle")}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        {done ? (
          <div className="px-6 py-12 flex flex-col items-center gap-3 text-center">
            <div className="h-14 w-14 rounded-2xl bg-emerald-50 flex items-center justify-center">
              <Megaphone className="h-7 w-7 text-emerald-500" />
            </div>
            <div className="text-slate-900">{t("dash.announcementPosted")}</div>
            <p className="text-sm text-slate-500 max-w-xs">{t("dash.announcementVisible")}</p>
            <button onClick={onClose} className="mt-3 px-5 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm">{t("farm.done")}</button>
          </div>
        ) : (
          <form onSubmit={submit} className="px-6 py-5 space-y-4">
            {/* Tag selector */}
            <div>
              <div className="text-sm text-slate-700 mb-2">{t("dash.category")}</div>
              <div className="flex gap-2 flex-wrap">
                {TAG_LABELS.map(({ key, labelKey }) => (
                  <button key={key} type="button" onClick={() => set("tag", key)}
                    className={`h-8 px-3 rounded-full border text-xs transition-colors ${form.tag === key ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            </div>

            {/* Title */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("dash.announcementTitleLabel")} <span className="text-rose-500">*</span></div>
              <input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Free fertilizer distribution — July 2026"
                className="w-full h-11 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
              />
            </label>

            {/* About */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("dash.about")}</div>
              <input
                value={form.about}
                onChange={(e) => set("about", e.target.value)}
                placeholder="Brief subtitle or context (optional)"
                className="w-full h-11 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
              />
            </label>

            {/* Description */}
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">{t("dash.description")} <span className="text-rose-500">*</span></div>
              <textarea
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                rows={4}
                placeholder="Full details of the announcement…"
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm resize-none"
              />
            </label>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button type="button" onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{t("cancel")}</button>
              <button type="submit" disabled={saving || !form.title.trim() || !form.description.trim()}
                className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-2">
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {saving ? t("dash.posting") : t("dash.postAnnouncement")}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const TAG_META: Record<AnnouncementTag, { icon: any; chip: string }> = {
  advisory: { icon: ShieldAlert,  chip: "bg-rose-50 text-rose-700 border-rose-200"         },
  program:  { icon: BookOpen,     chip: "bg-violet-50 text-violet-700 border-violet-200"   },
  schedule: { icon: CalendarDays, chip: "bg-sky-50 text-sky-700 border-sky-200"            },
  policy:   { icon: Tag,          chip: "bg-amber-50 text-amber-700 border-amber-200"      },
  reminder: { icon: Clock,        chip: "bg-emerald-50 text-emerald-700 border-emerald-200"},
};

export function Dashboard() {
  const { predictions, visiblePredictions, setCurrent, setView, user, announcements, users, weather, weatherError } = useStore();
  const t = useT();
  const isAdmin = user?.role === "Admin";
  // Corn/Palay-assigned admins are locked to their crop — same
  // adminCrop() privilege used to lock Simulation.tsx's crop picker and
  // to filter Planning.tsx. "all"/"none" (master/verification admins,
  // and farmers) can freely switch tabs.
  const lockedCrop = isAdmin ? adminCrop(user?.adminRole) : "all";
  const isCropLocked = lockedCrop === "Corn" || lockedCrop === "Palay (Rice)";
  const [cropTab, setCropTab] = useState<"All" | "Corn" | "Palay (Rice)">(isCropLocked ? lockedCrop : "All");
  const scopedPredictions = useMemo(
    () => (cropTab === "All" ? visiblePredictions : visiblePredictions.filter((p) => p.crop === cropTab)),
    [visiblePredictions, cropTab]
  );
  const [postOpen, setPostOpen] = useState(false);

  const recentAnnouncements = [...announcements]
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    })
    .slice(0, 4);

  const avgYieldTHa = scopedPredictions.length
    ? scopedPredictions.reduce((s, p) => s + p.predictedYield, 0) / scopedPredictions.length
    : 0;

  // Shown as an absolute mm figure (available water in the root zone)
  // rather than a bare percentage, alongside the town-wide average so a
  // farmer can see at a glance whether they're above or below it.
  const avgMoistureMm = scopedPredictions.length
    ? moisturePctToMm(scopedPredictions.reduce((s, p) => s + p.moisture, 0) / scopedPredictions.length)
    : null;
  const townAvgMoistureMm = municipalityAvgMoistureMm(predictions);
  const moistureVsTown =
    avgMoistureMm != null && townAvgMoistureMm != null
      ? avgMoistureMm - townAvgMoistureMm
      : null;

  // "All" means every registered farmer, crop or no crop — but once a
  // specific crop tab is picked, this should mean farmers actually
  // growing that crop, not the town's total farmer count again. Previously
  // this stayed the unscoped total regardless of the tab, so switching to
  // "Palay" still showed the same "Farmers" figure as "Corn" or "All".
  const farmerCount = isAdmin
    ? (cropTab === "All"
        ? users.filter((u) => u.role === "Farmer").length
        : new Set(scopedPredictions.map((p) => p.ownerId)).size)
    : null;

  // Real "actual vs. predicted" trend, grouped by planting month, from
  // whatever plots are currently visible (all of them for admin, the
  // signed-in farmer's own for a farmer) — replaces a previously
  // hardcoded 7-month sample dataset.
  const yieldTrend = useMemo(() => {
    const buckets: Record<string, { predSum: number; predN: number; actSum: number; actN: number }> = {};
    for (const p of scopedPredictions) {
      const d = new Date(p.plantingDate);
      if (Number.isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const b = (buckets[key] ??= { predSum: 0, predN: 0, actSum: 0, actN: 0 });
      b.predSum += p.predictedYield;
      b.predN += 1;
      if (p.actualYield != null) {
        b.actSum += p.actualYield;
        b.actN += 1;
      }
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-7)
      .map(([key, b]) => {
        const [y, m] = key.split("-").map(Number);
        return {
          m: new Date(y, m - 1, 1).toLocaleDateString("en-PH", { month: "short" }),
          predicted: +(b.predSum / b.predN).toFixed(2),
          actual: b.actN ? +(b.actSum / b.actN).toFixed(2) : null,
        };
      });
  }, [scopedPredictions]);

  // Same idea as CropRecommendation.tsx's scoring, driven by today's real
  // weather instead of a hardcoded barangay/percentage claim.
  const conditionsPick = useMemo(() => {
    if (!weather) return null;
    const crops = [
      { name: "Palay", label: "Palay", idealTemp: 28, idealRain: 150 },
      { name: "Corn", label: "Corn", idealTemp: 29, idealRain: 110 },
    ];
    const scored = crops
      .map((c) => {
        const tempScore = 1 - Math.min(1, Math.abs(weather.temperature - c.idealTemp) / 12);
        const rainScore = 1 - Math.min(1, Math.abs(weather.rainfall - c.idealRain) / 120);
        return { ...c, score: tempScore * 0.5 + rainScore * 0.5 };
      })
      .sort((a, b) => b.score - a.score);
    const [top, second] = scored;
    const edge = second.score > 0 ? Math.round(((top.score - second.score) / second.score) * 100) : 0;
    return { top: top.label, edge };
  }, [weather]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {isCropLocked ? (
        <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 border border-emerald-100 text-xs text-emerald-700">
          {lockedCrop === "Corn" ? <Wheat className="h-3.5 w-3.5" /> : <Leaf className="h-3.5 w-3.5" />}
          {lockedCrop} {t("dash.cropLockedBadge")} {lockedCrop.replace(" (Rice)", "")}{t("dash.cropLockedOnlyData")}
        </div>
      ) : (
        <div className="inline-flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {(["All", "Palay (Rice)", "Corn"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCropTab(c)}
              className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                cropTab === c ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {c === "Palay (Rice)" ? t("common.crop.palay") : c === "Corn" ? t("common.crop.corn") : t("dash.tabAll")}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Stat
          label={isAdmin ? t("dash.avgYieldTown") : t("dash.avgYieldMine")}
          value={<YieldValue valueTHa={avgYieldTHa} className="text-slate-900 text-xl tracking-tight" />}
          icon={TrendingUp}
          tint="bg-emerald-50 text-emerald-600"
        />
        <Stat
          label={isAdmin ? t("dash.farmers") : t("dash.myPlots")}
          value={isAdmin ? String(farmerCount ?? 0) : String(scopedPredictions.length)}
          unit={isAdmin ? t("dash.farmersUnit") : t("dash.plotsUnit")}
          icon={Wheat}
          tint="bg-amber-50 text-amber-600"
        />
        <Stat
          label={t("dash.moisture")}
          value={avgMoistureMm != null ? String(avgMoistureMm) : "—"}
          unit={avgMoistureMm != null ? "mm" : ""}
          sub={
            moistureVsTown != null
              ? moistureVsTown === 0
                ? "= town avg"
                : `${moistureVsTown > 0 ? "↑" : "↓"} ${Math.abs(moistureVsTown)}mm vs. town avg`
              : undefined
          }
          icon={Droplets}
          tint="bg-sky-50 text-sky-600"
        />
        <Stat
          label={t("dash.heat")}
          value={weather ? weather.temperature.toFixed(1) : weatherError ? "—" : "…"}
          unit="°C"
          icon={ThermometerSun}
          tint="bg-rose-50 text-rose-600"
        />
      </div>

      {isAdmin && <BarangayHeatMap crop={cropTab} />}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="col-span-2 bg-white border border-slate-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-slate-900">{t("dash.yieldTrend")}</div>
              <div className="text-xs text-slate-500 mt-0.5">{t("dash.yieldTrendSubtitle")}</div>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" /> {t("dash.actual")}</span>
              <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-blue-500" /> {t("dash.predicted")}</span>
            </div>
          </div>
          <div className="h-64">
            {yieldTrend.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center gap-2 text-slate-400">
                <TrendingUp className="h-8 w-8 text-slate-200" />
                <span className="text-sm">{t("dash.noYieldHistory")}</span>
              </div>
            ) : (
              <ResponsiveContainer>
                <ComposedChart data={yieldTrend}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis dataKey="m" stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: 10, border: "1px solid #e2e8f0" }} />
                  <Area type="monotone" dataKey="actual" stroke="#22C55E" strokeWidth={2.5} fill="#22C55E" fillOpacity={0.18} connectNulls={false} />
                  <Line type="monotone" dataKey="predicted" stroke="#3B82F6" strokeWidth={2} strokeDasharray="4 4" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="bg-white border border-slate-100 rounded-2xl p-5 flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="flex items-center gap-2 text-slate-900">
                <Megaphone className="h-4 w-4 text-emerald-600" /> {t("dash.announcements")}
              </div>
              <div className="text-xs text-slate-500 mt-0.5">{t("dash.announcementsSubtitle")}</div>
            </div>
            <div className="flex items-center gap-3">
              {isAdmin && (
                <button onClick={() => setPostOpen(true)} className="h-7 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> {t("dash.post")}
                </button>
              )}
              <button onClick={() => setView("notifications")} className="text-xs text-emerald-700 hover:underline">{t("dash.viewAll")}</button>
            </div>
          </div>
          {recentAnnouncements.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 text-slate-400">
              <Megaphone className="h-8 w-8 text-slate-200" />
              <span className="text-sm">{t("dash.noAnnouncements")}</span>
            </div>
          ) : (
            <div className="space-y-3">
              {recentAnnouncements.map((a) => {
                const meta = TAG_META[a.tag];
                const Icon = meta.icon;
                return (
                  <div key={a.id} className={`rounded-xl border p-3.5 flex gap-3 ${a.pinned ? "border-emerald-100 bg-emerald-50/40" : "border-slate-100"}`}>
                    <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center ${a.pinned ? "bg-emerald-100" : "bg-slate-50"}`}>
                      <Icon className={`h-3.5 w-3.5 ${a.pinned ? "text-emerald-600" : "text-slate-400"}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.pinned && <Pin className="h-3 w-3 text-emerald-500 shrink-0" />}
                        <span className="text-sm text-slate-800 truncate">{a.title}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] border shrink-0 ${meta.chip}`}>{t(`tag.${a.tag}`)}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 line-clamp-2 leading-relaxed">{a.body}</p>
                      <div className="text-[11px] text-slate-400 mt-1">{new Date(a.date).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" })} · {a.author}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className="col-span-2 bg-white border border-slate-100 rounded-2xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-slate-900">{isAdmin ? t("dash.recentPredictions") : t("dash.myPredictions")}</div>
              <div className="text-xs text-slate-500 mt-0.5">
                {isAdmin ? t("dash.predictionsAdminSubtitle") : t("dash.predictionsFarmerSubtitle")}
              </div>
            </div>
            <button
              onClick={() => setView(isAdmin ? "farms" : "myfarm")}
              className="text-xs text-emerald-700 hover:underline flex items-center gap-1"
            >
              <Plus className="h-3.5 w-3.5" /> {t("dash.newPrediction")}
            </button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-500 border-b border-slate-100">
                <th className="text-left py-2.5">{t("dash.colFarmBarangay")}</th>
                <th className="text-left">{t("dash.colCrop")}</th>
                <th className="text-left">{t("dash.colArea")}</th>
                <th className="text-left">{t("dash.colPredicted")}</th>
                <th className="text-left">{t("dash.colConfidence")}</th>
                <th />
              </tr>
            </thead>
            <tbody className="text-slate-700">
              {scopedPredictions.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-sm text-slate-500">
                    {t("dash.noPredictionsYet")}
                  </td>
                </tr>
              )}
              {scopedPredictions.slice(0, 5).map((p) => (
                <tr key={p.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <MapPin className="h-3.5 w-3.5 text-emerald-500" />
                      <span>{p.plotId} · {p.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")}</span>
                    </div>
                  </td>
                  <td>{p.crop === "Corn" ? t("common.crop.corn") : t("common.crop.palay")}</td>
                  <td><AreaValue valueHa={p.area} /></td>
                  <td className="text-emerald-700"><YieldValue valueTHa={p.predictedYield} className="text-emerald-700" /></td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${p.confidence}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{p.confidence}%</span>
                    </div>
                  </td>
                  <td className="text-right">
                    <button
                      onClick={() => {
                        setCurrent(p);
                        setView(isAdmin ? "yield" : "myfarm");
                      }}
                      className="text-xs text-emerald-700 hover:underline"
                    >
                      {t("dash.view")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isAdmin ? (
          <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 rounded-2xl p-5 text-white relative overflow-hidden">
            <div className="absolute -right-8 -bottom-8 h-40 w-40 rounded-full bg-emerald-500/20 blur-2xl" />
            <div className="text-xs text-emerald-200/90">{t("dash.todaysRecommendation")}</div>
            <div className="mt-2 tracking-tight text-xl">
              {conditionsPick ? `${t("dash.favorToday")} ${conditionsPick.top === "Palay" ? t("common.crop.palay") : t("common.crop.corn")} ${t("dash.todayWord")}` : weatherError ? t("dash.weatherUnavailable") : t("dash.loadingConditions")}
            </div>
            <p className="mt-3 text-sm text-emerald-100/85 leading-relaxed">
              {conditionsPick && weather
                ? `Based on today's weather in Binalonan (${weather.temperature}°C, ${pagasaRainfallCategory(weather.rainfall).label.toLowerCase()} — ${weather.rainfall} mm), ${conditionsPick.top} is currently the better-aligned crop${conditionsPick.edge > 0 ? ` — roughly a ${conditionsPick.edge}% edge over the alternative under these conditions` : ""}.`
                : weatherError
                ? t("dash.weatherUnreachable")
                : t("dash.fetchingConditions")}
            </p>
            <button
              onClick={() => {
                setView("recommend");
                toast.success(t("dash.showingRecommendationsToast"));
              }}
              className="mt-5 px-4 py-2 rounded-lg bg-white text-emerald-800 text-sm"
            >
              {t("dash.viewDetailedPlan")}
            </button>
          </div>
        ) : (
          <WeekPlan />
        )}
      </div>

      {postOpen && <PostAnnouncementModal onClose={() => setPostOpen(false)} />}
    </div>
  );
}
