import { useMemo } from "react";
import { Droplets, Sprout, Wheat, CalendarClock, CheckCircle2, Circle, ListChecks, CalendarDays, Tractor } from "lucide-react";
import { useStore, maturityDays, plantingWindow } from "../store";
import { useT } from "../i18n";

const DAY = 86400000;

type Item = {
  id: string;
  icon: any;
  tint: string;
  label: string;
  detail: string;
  when: string;
  urgent: boolean;
  toggle?: () => void;
  done?: boolean;
};

// Derives the farmer's actionable to-dos for the next 7 days from their
// crop-care tasks and the growth stage of their plots.
export function WeekPlan() {
  const { visibleTasks, visiblePredictions, toggleTask, setView } = useStore();
  const t = useT();

  const items = useMemo<Item[]>(() => {
    const now = Date.now();
    const horizon = now + 7 * DAY;
    const out: Item[] = [];

    // Tasks tied to a cropping that's already been harvested are done —
    // the Calendar's "Growing Now" view hides those too, so this list
    // should never show a watering/fertilizer reminder for a plot that's
    // no longer actually growing.
    const harvestedPredictionIds = new Set(
      visiblePredictions.filter((p) => p.actualYield != null || !!p.harvestDate).map((p) => p.id)
    );
    // Looked up per task so each reminder can say which specific
    // cropping it's for — a farmer with more than one plot otherwise
    // has no way to tell "Apply fertilizer" apart across plots.
    const predictionsById = new Map(visiblePredictions.map((p) => [p.id, p]));

    // 1) Crop-care tasks (watering / fertilizer) due within the week or overdue.
    for (const task of visibleTasks) {
      if (task.done) continue;
      if (task.predictionId && harvestedPredictionIds.has(task.predictionId)) continue;
      const due = new Date(task.date).getTime();
      if (due > horizon) continue;
      const overdue = due < now - DAY / 2;
      const today = !overdue && due <= now + DAY;
      const cropping = task.predictionId ? predictionsById.get(task.predictionId) : undefined;
      const plotLabel = cropping ? `${cropping.plotId} · ${cropping.crop.replace(" (Rice)", "")}` : undefined;
      const category = task.type === "water" ? t("week.water") : task.type === "fertilizer" ? t("week.fertilize") : task.type === "pre_planting" ? t("week.prePlanting") : "";
      out.push({
        id: task.id,
        icon: task.type === "water" ? Droplets : task.type === "fertilizer" ? Sprout : task.type === "pre_planting" ? Tractor : CalendarClock,
        tint: task.type === "water" ? "bg-sky-50 text-sky-600" : task.type === "fertilizer" ? "bg-amber-50 text-amber-600" : task.type === "pre_planting" ? "bg-orange-50 text-orange-600" : "bg-slate-100 text-slate-500",
        label: task.text,
        detail: plotLabel ? `${category} · ${plotLabel}` : category,
        when: overdue ? t("week.overdue") : today ? t("week.today") : new Date(task.date).toLocaleDateString("en-PH", { weekday: "short" }),
        urgent: overdue || today,
        toggle: () => toggleTask(task.id),
        done: task.done,
      });
    }

    // 2) Plots nearing harvest, and not-yet-planted plots whose planting window is open.
    for (const p of visiblePredictions) {
      const label = `${p.plotId} · ${p.crop.replace(" (Rice)", "")}`;
      const harvested = p.actualYield != null || !!p.harvestDate;
      const plantAt = new Date(p.plantingDate).getTime();
      const alreadyPlanted = plantAt <= now;

      if (!harvested && alreadyPlanted) {
        const daysSincePlanting = Math.round((now - plantAt) / DAY);
        const daysToMaturity = maturityDays(p.crop) - daysSincePlanting;
        if (daysToMaturity <= 10 && daysToMaturity >= 0) {
          out.push({
            id: `harvest-${p.id}`,
            icon: Wheat,
            tint: "bg-emerald-50 text-emerald-600",
            label,
            detail: `${t("week.harvest")} · ~${daysToMaturity}d`,
            when: daysToMaturity <= 3 ? t("week.today") : `${daysToMaturity}d`,
            urgent: daysToMaturity <= 3,
          });
        }
      } else if (!alreadyPlanted) {
        const win = plantingWindow(p.crop, p.plantingDate);
        if (plantAt <= horizon && win.inWindow) {
          out.push({
            id: `plant-${p.id}`,
            icon: Sprout,
            tint: "bg-lime-50 text-lime-600",
            label,
            detail: `${t("week.plant")} · ${win.nearest}`,
            when: new Date(p.plantingDate).toLocaleDateString("en-PH", { month: "short", day: "numeric" }),
            urgent: false,
          });
        }
      }
    }

    // Urgent items first.
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent));
  }, [visibleTasks, visiblePredictions, toggleTask, t]);

  return (
    <div className={`bg-white border border-slate-100 rounded-2xl p-5 flex flex-col ${items.length === 0 ? "aspect-square" : ""}`}>
      <div className="flex items-center gap-2 text-slate-900">
        <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
          <ListChecks className="h-4 w-4 text-emerald-600" />
        </div>
        <div>
          <div className="tracking-tight">{t("week.title")}</div>
          <div className="text-xs text-slate-500 mt-0.5">{t("week.subtitle")}</div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 py-10 text-slate-400 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-200" />
          <span className="text-sm max-w-[15rem]">{t("week.allClear")}</span>
        </div>
      ) : (
        <div className="mt-4 space-y-2.5">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <div key={it.id} className={`rounded-xl border p-3 flex items-start gap-3 ${it.urgent ? "border-emerald-100 bg-emerald-50/40" : "border-slate-100"}`}>
                {it.toggle ? (
                  <button onClick={it.toggle} className="mt-0.5 shrink-0 text-slate-300 hover:text-emerald-500" aria-label="Mark done">
                    {it.done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5" />}
                  </button>
                ) : (
                  <div className={`h-8 w-8 rounded-lg shrink-0 flex items-center justify-center ${it.tint}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-slate-800 truncate">{it.label}</div>
                  {it.detail && <div className="text-xs text-slate-500 mt-0.5">{it.detail}</div>}
                </div>
                <span className={`text-xs shrink-0 px-2 py-0.5 rounded-full ${it.urgent ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                  {it.when}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <button
        onClick={() => setView("calendar")}
        className="mt-4 h-10 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm flex items-center justify-center gap-2"
      >
        <CalendarDays className="h-4 w-4 text-emerald-600" /> {t("week.viewCalendar")}
      </button>
    </div>
  );
}
