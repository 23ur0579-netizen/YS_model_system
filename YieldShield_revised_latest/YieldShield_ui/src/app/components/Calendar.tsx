import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Wheat, Leaf, CheckCircle2, CalendarDays, Clock, CloudRain, ThermometerSun, Plus, Trash2, ListTodo, Droplets, FlaskConical, Tractor, Sprout, History } from "lucide-react";
import { useStore, Prediction, CropTask, CropTaskType } from "../store";
import { MONTHLY_CLIMATE } from "../data/binalonan";
import { useT } from "../i18n";

const TASK_META: Record<CropTaskType, { label: string; icon: any; chip: string; dot: string }> = {
  water:        { label: "Watering",      icon: Droplets,     chip: "bg-sky-50 text-sky-700 border-sky-200",          dot: "bg-sky-500" },
  fertilizer:   { label: "Fertilizer",    icon: FlaskConical, chip: "bg-violet-50 text-violet-700 border-violet-200", dot: "bg-violet-500" },
  pre_planting: { label: "Pre-Planting",  icon: Tractor,      chip: "bg-orange-50 text-orange-700 border-orange-200", dot: "bg-orange-500" },
  other:        { label: "Other",         icon: ListTodo,     chip: "bg-slate-50 text-slate-600 border-slate-200",   dot: "bg-slate-400" },
};

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function addDays(date: Date, n: number) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function fmtShort(dateStr: string) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

function TodoList({ prefillDate, tasks }: { prefillDate?: string; tasks?: CropTask[] }) {
  const t = useT();
  const { visibleTasks: allTasks, visiblePredictions, addTask, toggleTask, deleteTask } = useStore();
  const visibleTasks = tasks ?? allTasks;
  const [text, setText] = useState("");
  const [type, setType] = useState<CropTaskType>("water");
  const [date, setDate] = useState(prefillDate ?? new Date().toISOString().slice(0, 10));
  const [plotId, setPlotId] = useState<string>("");

  function add() {
    const t = text.trim();
    if (!t) return;
    addTask({ type, text: t, date, predictionId: plotId || undefined });
    setText("");
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const pending = [...visibleTasks.filter((t) => !t.done)].sort((a, b) => a.date.localeCompare(b.date));
  const completed = visibleTasks.filter((t) => t.done);

  return (
    <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
        <ListTodo className="h-4 w-4 text-emerald-600" />
        <span className="text-sm text-slate-700">{t("cal.cropTodo")}</span>
        {visibleTasks.length > 0 && (
          <span className="ml-auto text-[11px] text-slate-400">{completed.length}/{visibleTasks.length} done</span>
        )}
      </div>

      {/* Composer */}
      <div className="px-4 py-3 space-y-2 border-b border-slate-100">
        {visibleTasks.some((x) => x.predictionId) && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-[11px] text-amber-800 leading-snug">
            <CloudRain className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>Activities for your croppings are auto-planned from typical timing for the crop. Dates and advice can shift depending on weather and other field conditions — check back as the date gets closer.</span>
          </div>
        )}
        <div className="grid grid-cols-4 gap-1.5">
          {(["water", "fertilizer", "pre_planting", "other"] as CropTaskType[]).map((tp) => {
            const m = TASK_META[tp];
            const Icon = m.icon;
            return (
              <button key={tp} onClick={() => setType(tp)}
                className={`h-8 rounded-lg border text-xs flex items-center justify-center gap-1 transition-colors ${type === tp ? "border-emerald-400 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}>
                <Icon className="h-3.5 w-3.5" /> {m.label}
              </button>
            );
          })}
        </div>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={type === "water" ? "e.g. Irrigate palay field" : type === "fertilizer" ? "e.g. Apply urea top-dress" : type === "pre_planting" ? "e.g. Plow and harrow the field" : "Add a task…"}
          className="w-full h-9 px-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
        />
        <div className="flex gap-1.5">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
            className="flex-1 h-9 px-2 rounded-lg border border-slate-200 text-xs focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none" />
          <select value={plotId} onChange={(e) => setPlotId(e.target.value)}
            className="flex-1 h-9 px-2 rounded-lg border border-slate-200 text-xs bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none">
            <option value="">No crop</option>
            {visiblePredictions.map((p) => <option key={p.id} value={p.id}>{p.plotId}</option>)}
          </select>
          <button onClick={add} disabled={!text.trim()}
            className="h-9 w-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 flex items-center justify-center shrink-0">
            <Plus className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="divide-y divide-slate-50 max-h-72 overflow-y-auto">
        {visibleTasks.length === 0 && (
          <div className="px-4 py-6 text-xs text-slate-400 text-center">{t("cal.noReminders")}</div>
        )}
        {pending.map((t) => {
          const m = TASK_META[t.type];
          const Icon = m.icon;
          const overdue = t.date < todayISO;
          return (
            <div key={t.id} className="px-4 py-2.5 flex items-start gap-2.5 group hover:bg-slate-50">
              <button onClick={() => toggleTask(t.id)} className="shrink-0 mt-0.5">
                <CheckCircle2 className="h-4 w-4 text-slate-200 hover:text-emerald-500 transition-colors" />
              </button>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-slate-700 leading-snug">{t.text}</div>
                <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border ${m.chip}`}>
                    <Icon className="h-2.5 w-2.5" /> {m.label}
                  </span>
                  <span className={`text-[10px] ${overdue ? "text-rose-500" : "text-slate-400"}`}>{overdue ? "Overdue · " : ""}{fmtShort(t.date)}</span>
                </div>
              </div>
              <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-400 transition-all shrink-0 mt-0.5">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
        {completed.length > 0 && (
          <>
            <div className="px-4 py-1.5 bg-slate-50">
              <span className="text-[10px] text-slate-400 uppercase tracking-wide">Completed</span>
            </div>
            {completed.map((t) => (
              <div key={t.id} className="px-4 py-2.5 flex items-center gap-2.5 group hover:bg-slate-50">
                <button onClick={() => toggleTask(t.id)} className="shrink-0">
                  <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                </button>
                <span className="flex-1 text-sm text-slate-400 line-through leading-snug">{t.text}</span>
                <button onClick={() => deleteTask(t.id)} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-400 transition-all shrink-0">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

type FarmEvent = {
  date: Date;
  type: "planting" | "harvest";
  label: string;
  crop: Prediction["crop"];
  plotId: string;
  prediction: Prediction;
};

function harvestDays(crop: Prediction["crop"]) {
  return crop === "Palay (Rice)" ? 120 : 90;
}

export function Calendar() {
  const t = useT();
  const { visiblePredictions, visibleTasks, toggleTask, setCurrent, setView, user, refreshWeatherTasks } = useStore();
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selected, setSelected] = useState<Date | null>(null);

  // Filters — everything here (Poblacion's harvest next to Corn's next
  // to a different farmer's tasks, for an admin) was one undifferentiated
  // list before; narrow it down to one crop and/or one field at a time.
  const [cropFilter, setCropFilter] = useState<"All" | "Palay (Rice)" | "Corn">("All");
  const [fieldFilter, setFieldFilter] = useState<string>("All");

  const fieldOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of visiblePredictions) {
      if (p.fieldId && (cropFilter === "All" || p.crop === cropFilter)) map.set(p.fieldId, p.plotId);
    }
    return Array.from(map.entries());
  }, [visiblePredictions, cropFilter]);

  // Reset the field filter if it no longer applies once the crop filter changes.
  useEffect(() => {
    if (fieldFilter !== "All" && !fieldOptions.some(([id]) => id === fieldFilter)) setFieldFilter("All");
  }, [fieldOptions, fieldFilter]);

  const filteredPredictions = useMemo(
    () => visiblePredictions.filter((p) => (cropFilter === "All" || p.crop === cropFilter) && (fieldFilter === "All" || p.fieldId === fieldFilter)),
    [visiblePredictions, cropFilter, fieldFilter]
  );

  // Individual croppings (one planting/harvest cycle each) available under
  // the current crop/field filter above, newest first. "Present" ones are
  // those still growing — no harvest has been logged for them yet.
  const croppingTabs = useMemo(
    () =>
      [...filteredPredictions]
        .sort((a, b) => b.plantingDate.localeCompare(a.plantingDate))
        .map((p) => ({
          id: p.id,
          crop: p.crop,
          label: `${p.plotId} · ${p.crop === "Palay (Rice)" ? "Palay" : "Corn"}`,
          present: !p.harvestDate,
        })),
    [filteredPredictions]
  );
  const presentCroppingIds = useMemo(
    () => new Set(croppingTabs.filter((c) => c.present).map((c) => c.id)),
    [croppingTabs]
  );

  // Which cropping(s) the calendar is scoped to: "present" (the default —
  // only croppings still growing right now), a single chosen cropping, or
  // "all" (every cropping under the crop/field filter, including past ones).
  const [croppingTab, setCroppingTab] = useState<"present" | "all" | string>("present");
  // If the cropping this tab points to disappears (e.g. deleted, or no
  // longer matches the crop/field filter above), fall back to "present"
  // rather than silently showing nothing.
  useEffect(() => {
    if (croppingTab !== "present" && croppingTab !== "all" && !croppingTabs.some((c) => c.id === croppingTab)) {
      setCroppingTab("present");
    }
  }, [croppingTabs, croppingTab]);

  const scopedPredictions = useMemo(() => {
    if (croppingTab === "all") return filteredPredictions;
    if (croppingTab === "present") return filteredPredictions.filter((p) => presentCroppingIds.has(p.id));
    return filteredPredictions.filter((p) => p.id === croppingTab);
  }, [filteredPredictions, croppingTab, presentCroppingIds]);

  // A task with no linked cropping is a general reminder — always shown,
  // regardless of the crop/field filter.
  const filteredTasks = useMemo(() => {
    if (cropFilter === "All" && fieldFilter === "All" && croppingTab === "all") return visibleTasks;
    const scopedIds = new Set(scopedPredictions.map((p) => p.id));
    return visibleTasks.filter((tk) => {
      if (!tk.predictionId) return true;
      return scopedIds.has(tk.predictionId);
    });
  }, [visibleTasks, scopedPredictions, cropFilter, fieldFilter, croppingTab]);

  // The initial schedule is auto-plotted server-side when a cropping is
  // submitted (backend/app/farm_calendar.py) — this just picks up any
  // change in the live forecast for upcoming water/fertilizer tasks
  // since then.
  useEffect(() => {
    refreshWeatherTasks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const events = useMemo<FarmEvent[]>(() => {
    const list: FarmEvent[] = [];
    scopedPredictions.forEach((p) => {
      const planting = new Date(p.plantingDate);
      list.push({ date: planting, type: "planting", label: `Plant ${p.crop === "Palay (Rice)" ? "Palay" : "Corn"} · ${p.plotId}`, crop: p.crop, plotId: p.plotId, prediction: p });
      const harvest = addDays(planting, harvestDays(p.crop));
      list.push({ date: harvest, type: "harvest", label: `Harvest ${p.crop === "Palay (Rice)" ? "Palay" : "Corn"} · ${p.plotId}`, crop: p.crop, plotId: p.plotId, prediction: p });
    });
    return list;
  }, [scopedPredictions]);

  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  function eventsOn(date: Date | null): FarmEvent[] {
    if (!date) return [];
    return events.filter((e) => sameDay(e.date, date));
  }

  function tasksOn(date: Date | null): CropTask[] {
    if (!date) return [];
    return filteredTasks.filter((t) => sameDay(new Date(t.date + "T00:00:00"), date));
  }

  const selectedEvents = selected ? eventsOn(selected) : [];
  const selectedTasks = selected ? tasksOn(selected) : [];

  const upcomingEvents = events
    .filter((e) => e.date >= today)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 8);

  function prevMonth() {
    setCursor(new Date(year, month - 1, 1));
    setSelected(null);
  }
  function nextMonth() {
    setCursor(new Date(year, month + 1, 1));
    setSelected(null);
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex items-center gap-1 bg-slate-100 rounded-xl p-1">
          {(["All", "Palay (Rice)", "Corn"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCropFilter(c)}
              className={`px-4 py-2 rounded-lg text-sm transition-colors ${
                cropFilter === c ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
              }`}
            >
              {c === "Palay (Rice)" ? "🌾 Palay" : c === "Corn" ? "🌽 Corn" : c}
            </button>
          ))}
        </div>
        {fieldOptions.length > 1 && (
          <select
            value={fieldFilter}
            onChange={(e) => setFieldFilter(e.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-200 bg-white text-sm text-slate-700 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
          >
            <option value="All">All fields</option>
            {fieldOptions.map(([id, plotId]) => (
              <option key={id} value={id}>{plotId}</option>
            ))}
          </select>
        )}
      </div>

      {/* One tab per individual cropping — "Growing Now" (the default) scopes
          the whole calendar below to only croppings still growing right
          now; pick a specific cropping's tab to see just its activities,
          or "Show past too" to bring back every completed cropping. */}
      {croppingTabs.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
          <button
            onClick={() => setCroppingTab("present")}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm border-2 transition-colors ${
              croppingTab === "present"
                ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-200"
            }`}
          >
            <Sprout className="h-4 w-4" /> Growing Now
          </button>
          {croppingTabs.map((c) => (
            <button
              key={c.id}
              onClick={() => setCroppingTab(c.id)}
              className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm border-2 transition-colors ${
                croppingTab === c.id
                  ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-200"
              }`}
            >
              {c.crop === "Palay (Rice)" ? <Wheat className="h-4 w-4" /> : <Leaf className="h-4 w-4" />}
              {c.label}
              {c.present && <span className={`h-2 w-2 rounded-full ${croppingTab === c.id ? "bg-white" : "bg-emerald-500"}`} title="Still growing" />}
            </button>
          ))}
          <button
            onClick={() => setCroppingTab("all")}
            className={`shrink-0 flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm border-2 transition-colors ${
              croppingTab === "all"
                ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
                : "bg-white text-slate-700 border-slate-200 hover:bg-emerald-50 hover:border-emerald-200"
            }`}
          >
            <History className="h-4 w-4" /> Show past too
          </button>
        </div>
      )}

      <div className="flex gap-6">
        {/* Calendar grid */}
        <div className="flex-1 bg-white border border-slate-100 rounded-2xl overflow-hidden">
          {/* Month nav */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
            <button onClick={prevMonth} className="h-10 w-10 rounded-xl hover:bg-emerald-50 active:bg-emerald-100 flex items-center justify-center text-slate-600" aria-label="Previous month">
              <ChevronLeft className="h-5 w-5" />
            </button>
            <div className="text-slate-900 text-base sm:text-lg">{MONTH_NAMES[month]} {year}</div>
            <button onClick={nextMonth} className="h-10 w-10 rounded-xl hover:bg-emerald-50 active:bg-emerald-100 flex items-center justify-center text-slate-600" aria-label="Next month">
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Day header */}
          <div className="grid grid-cols-7 border-b border-slate-100">
            {DAY_LABELS.map((d) => (
              <div key={d} className="py-2 text-center text-xs sm:text-sm text-slate-400">{d}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {cells.map((date, i) => {
              if (!date) return <div key={`empty-${i}`} className="min-h-[92px] border-b border-r border-slate-50" />;
              const dayEvents = eventsOn(date);
              const dayTasks = tasksOn(date);
              const isToday = sameDay(date, today);
              const isSelected = selected && sameDay(date, selected);
              const plantingEvts = dayEvents.filter((e) => e.type === "planting");
              const harvestEvts = dayEvents.filter((e) => e.type === "harvest");
              return (
                <button
                  key={date.toISOString()}
                  onClick={() => setSelected(isSelected ? null : date)}
                  className={`min-h-[92px] p-1.5 border-b border-r border-slate-50 text-left flex flex-col gap-1 transition-colors overflow-hidden ${
                    isSelected ? "bg-emerald-50 ring-2 ring-inset ring-emerald-300" : isToday ? "bg-emerald-50/40" : "hover:bg-slate-50"
                  }`}
                >
                  <span className={`h-7 w-7 flex items-center justify-center rounded-full text-sm shrink-0 ${
                    isToday ? "bg-emerald-600 text-white" : isSelected ? "text-emerald-800" : "text-slate-600"
                  }`}>
                    {date.getDate()}
                  </span>
                  {(() => {
                    // Combine planting/harvest events + crop tasks into one
                    // mini agenda so the day cell shows what's actually due
                    // (e.g. "Plow and prepare the field"), not just dots.
                    type Item = { key: string; text: string; chip: string; done?: boolean };
                    const items: Item[] = [
                      ...plantingEvts.map((e, idx) => ({ key: `p${idx}`, text: e.label, chip: "bg-emerald-50 text-emerald-700" })),
                      ...harvestEvts.map((e, idx) => ({ key: `h${idx}`, text: e.label, chip: "bg-amber-50 text-amber-700" })),
                      ...dayTasks.map((task) => ({ key: task.id, text: task.text, chip: TASK_META[task.type].chip, done: task.done })),
                    ];
                    const MAX_SHOWN = 2;
                    const shown = items.slice(0, MAX_SHOWN);
                    const overflow = items.length - shown.length;
                    if (items.length === 0) return null;
                    return (
                      <div className="flex flex-col gap-0.5 min-w-0">
                        {shown.map((it) => (
                          <span key={it.key} className={`block w-full truncate rounded px-1 py-0.5 text-[9px] leading-tight border ${it.chip} ${it.done ? "line-through opacity-60" : ""}`} title={it.text}>
                            {it.text}
                          </span>
                        ))}
                        {overflow > 0 && (
                          <span className="text-[9px] text-slate-400 px-1">+{overflow} {t("cal.more")}</span>
                        )}
                      </div>
                    );
                  })()}
                </button>
              );
            })}
          </div>

          {/* Legend */}
          <div className="px-6 py-3 border-t border-slate-100 flex items-center gap-5">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> {t("cal.plantingDate")}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> {t("cal.estHarvest")}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-sky-500" /> {t("cal.watering")}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-violet-500" /> {t("cal.fertilizer")}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500" /> {t("cal.prePlanting")}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="h-5 w-5 rounded-full bg-emerald-600 flex items-center justify-center text-white text-[9px]">•</span> {t("cal.today")}
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="w-72 shrink-0 space-y-4">
          {/* To-do list */}
          <TodoList tasks={filteredTasks} />

          {/* Selected day detail */}
          {selected && (
            <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-emerald-600" />
                <span className="text-sm text-slate-700">
                  {selected.toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}
                </span>
              </div>
              <div className="divide-y divide-slate-100">
                {selectedEvents.length === 0 && selectedTasks.length === 0 && (
                  <div className="px-4 py-6 text-xs text-slate-400 text-center">{t("cal.noEvents")}</div>
                )}
                {selectedTasks.map((t) => {
                  const m = TASK_META[t.type];
                  const Icon = m.icon;
                  return (
                    <button key={t.id} onClick={() => toggleTask(t.id)} className="w-full px-4 py-3 hover:bg-slate-50 text-left flex items-start gap-3">
                      <CheckCircle2 className={`mt-0.5 h-4 w-4 shrink-0 ${t.done ? "text-emerald-500" : "text-slate-200"}`} />
                      <div className="min-w-0">
                        <div className={`text-xs ${t.done ? "text-slate-400 line-through" : "text-slate-700"}`}>{t.text}</div>
                        <div className="mt-0.5"><span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border ${m.chip}`}><Icon className="h-2.5 w-2.5" /> {m.label}</span></div>
                      </div>
                    </button>
                  );
                })}
                {selectedEvents.map((e, i) => (
                  <button
                    key={i}
                    onClick={() => { setCurrent(e.prediction); setView(user?.role === "Admin" ? "yield" : "myfarm"); }}
                    className="w-full px-4 py-3 hover:bg-slate-50 text-left flex items-start gap-3"
                  >
                    <span className={`mt-0.5 h-2 w-2 rounded-full shrink-0 ${e.type === "planting" ? "bg-emerald-500" : "bg-amber-500"}`} />
                    <div>
                      <div className="text-xs text-slate-700">{e.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {e.type === "planting" ? t("cal.plantingDay") : t("cal.estimatedHarvest")}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Upcoming events */}
          <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <Clock className="h-4 w-4 text-emerald-600" />
              <span className="text-sm text-slate-700">{t("cal.upcoming")}</span>
            </div>
            <div className="divide-y divide-slate-100">
              {upcomingEvents.length === 0 && (
                <div className="px-4 py-6 text-xs text-slate-400 text-center">{t("cal.noUpcoming")}</div>
              )}
              {upcomingEvents.map((e, i) => {
                const daysAway = Math.ceil((e.date.getTime() - today.getTime()) / 86400000);
                return (
                  <button
                    key={i}
                    onClick={() => { setCursor(new Date(e.date.getFullYear(), e.date.getMonth(), 1)); setSelected(e.date); }}
                    className="w-full px-4 py-3 hover:bg-slate-50 text-left flex items-center gap-3"
                  >
                    <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center ${
                      e.type === "planting" ? "bg-emerald-50" : "bg-amber-50"
                    }`}>
                      {e.type === "planting"
                        ? <Leaf className="h-4 w-4 text-emerald-600" />
                        : <Wheat className="h-4 w-4 text-amber-600" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs text-slate-700 truncate">{e.label}</div>
                      <div className="text-[11px] text-slate-400 mt-0.5">
                        {e.date.toLocaleDateString("en-PH", { month: "short", day: "numeric" })} · {daysAway === 0 ? t("cal.today") : `${daysAway}d`}
                      </div>
                    </div>
                    <span className={`ml-auto shrink-0 h-1.5 w-1.5 rounded-full ${e.type === "planting" ? "bg-emerald-400" : "bg-amber-400"}`} />
                  </button>
                );
              })}
            </div>
          </div>
          {/* Climate outlook for the viewed month */}
          {(() => {
            const c = MONTHLY_CLIMATE[month];
            const maxRain = Math.max(...MONTHLY_CLIMATE.map((m) => m.rainfall));
            return (
              <div className="bg-white border border-slate-100 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
                  <CloudRain className="h-4 w-4 text-sky-600" />
                  <span className="text-sm text-slate-700">{t("cal.climateOutlook")} · {MONTH_NAMES[month]}</span>
                  <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${c.season === "Wet" ? "bg-sky-100 text-sky-700" : "bg-amber-100 text-amber-700"}`}>{c.season === "Wet" ? t("cal.wetSeasonShort") : t("cal.drySeasonShort")}</span>
                </div>
                <div className="p-4 space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2">
                      <div className="text-[11px] text-slate-500 flex items-center gap-1"><CloudRain className="h-3 w-3 text-sky-600" />Rainfall</div>
                      <div className="mt-0.5 text-sm text-slate-800">{c.rainfall} mm</div>
                    </div>
                    <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2">
                      <div className="text-[11px] text-slate-500 flex items-center gap-1"><ThermometerSun className="h-3 w-3 text-amber-600" />Avg temp</div>
                      <div className="mt-0.5 text-sm text-slate-800">{c.temp}°C</div>
                    </div>
                  </div>
                  <div className="flex items-end gap-1 h-12">
                    {MONTHLY_CLIMATE.map((m, i) => (
                      <div key={m.short} className="flex-1 flex flex-col items-center gap-1" title={`${m.month}: ${m.rainfall} mm`}>
                        <div
                          className={`w-full rounded-sm ${i === month ? "bg-sky-500" : "bg-sky-200"}`}
                          style={{ height: `${Math.max(8, (m.rainfall / maxRain) * 40)}px` }}
                        />
                        <span className={`text-[8px] ${i === month ? "text-sky-700" : "text-slate-300"}`}>{m.short[0]}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] text-slate-400">Type I climate (PAGASA) · monthly rainfall pattern across Binalonan</div>
                </div>
              </div>
            );
          })()}

        </div>
      </div>
    </div>
  );
}
