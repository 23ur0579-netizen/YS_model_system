import { ArrowUpRight, ArrowDownRight } from "lucide-react";

// Shared by every "row of summary numbers" across the app — Dashboard,
// AdminFarms, ManageUsers, MyFarm, Planning (x3), AuditLog. All six
// used to carry their own copy-pasted version of this exact markup;
// consolidated here so sizing/spacing only needs changing in one place.
export function StatCard({
  icon: Icon,
  tint,
  label,
  value,
  sub,
  unit,
  delta,
  up,
}: {
  icon: any;
  tint: string;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  // Inline unit shown next to the value (Dashboard.tsx's weather/plot-
  // count stats, e.g. "24.9" + "°C") — mutually exclusive with `sub`
  // in practice, but nothing stops passing both.
  unit?: React.ReactNode;
  // Optional trend badge (Dashboard.tsx's weather/yield stats) — omit
  // for a plain count card.
  delta?: React.ReactNode;
  up?: boolean;
}) {
  return (
    <div className="bg-white border border-slate-100 rounded-xl p-3.5">
      <div className="flex items-start justify-between">
        <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${tint}`}>
          <Icon className="h-4 w-4" />
        </div>
        {delta != null && (
          <div className={`flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full ${up ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>
            {up ? <ArrowUpRight className="h-2.5 w-2.5" /> : <ArrowDownRight className="h-2.5 w-2.5" />}
            {delta}
          </div>
        )}
      </div>
      <div className="mt-2.5 text-slate-500 text-xs">{label}</div>
      {unit != null ? (
        <div className="mt-0.5 flex items-baseline gap-1">
          <span className="text-slate-900 text-xl tracking-tight">{value}</span>
          <span className="text-slate-400 text-xs">{unit}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-slate-900 text-xl tracking-tight">{value}</div>
      )}
      {sub != null && <div className="text-[11px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}
