import { useMemo, useState } from "react";
import { ScrollText, ShieldCheck, Megaphone, UserCog, KeyRound, Sprout, Search, Filter } from "lucide-react";
import { useStore, AuditCategory, AuditEntry, ADMIN_ROLE_META } from "../store";
import { StatCard } from "./StatCard";

const CAT_META: Record<AuditCategory, { label: string; icon: any; tint: string; chip: string }> = {
  verification: { label: "Verification", icon: ShieldCheck, tint: "bg-emerald-50 text-emerald-600", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  announcement: { label: "Announcement", icon: Megaphone, tint: "bg-sky-50 text-sky-600", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  account:      { label: "Account", icon: UserCog, tint: "bg-amber-50 text-amber-600", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  privilege:    { label: "Privilege", icon: KeyRound, tint: "bg-violet-50 text-violet-600", chip: "bg-violet-50 text-violet-700 border-violet-200" },
  seed_distribution: { label: "Seed Distribution", icon: Sprout, tint: "bg-lime-50 text-lime-600", chip: "bg-lime-50 text-lime-700 border-lime-200" },
};

function relTime(ts: number) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

function fullStamp(ts: number) {
  return new Date(ts).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function AuditLog() {
  const { auditLog } = useStore();
  const [cat, setCat] = useState<AuditCategory | "all">("all");
  const [q, setQ] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    auditLog.forEach((e) => { c[e.category] = (c[e.category] ?? 0) + 1; });
    return c;
  }, [auditLog]);

  const filtered = useMemo(() => {
    let list = [...auditLog].sort((a, b) => b.at - a.at);
    if (cat !== "all") list = list.filter((e) => e.category === cat);
    if (q.trim()) {
      const t = q.toLowerCase();
      list = list.filter((e) => e.action.toLowerCase().includes(t) || (e.target ?? "").toLowerCase().includes(t) || e.actorName.toLowerCase().includes(t));
    }
    return list;
  }, [auditLog, cat, q]);

  // Group by day for a timeline feel.
  const groups = useMemo(() => {
    const g: { day: string; items: AuditEntry[] }[] = [];
    filtered.forEach((e) => {
      const day = new Date(e.at).toLocaleDateString("en-PH", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
      const last = g[g.length - 1];
      if (last && last.day === day) last.items.push(e);
      else g.push({ day, items: [e] });
    });
    return g;
  }, [filtered]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
        {(["verification", "announcement", "account", "privilege", "seed_distribution"] as const).map((c) => {
          const m = CAT_META[c];
          return <StatCard key={c} icon={m.icon} tint={m.tint} label={`${m.label} events`} value={counts[c] ?? 0} />;
        })}
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-slate-900 flex items-center gap-2"><ScrollText className="h-4 w-4 text-emerald-600" /> Audit Trail</div>
            <div className="text-xs text-slate-500 mt-0.5">{filtered.length} of {auditLog.length} events · master-admin oversight</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search className="h-4 w-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search actor, action, target…"
                className="h-9 pl-9 pr-3 rounded-lg border border-slate-200 text-sm w-full sm:w-64 focus:outline-none focus:ring-2 focus:ring-emerald-500/30" />
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {(["all", "verification", "announcement", "account", "privilege", "seed_distribution"] as const).map((c) => (
                <button key={c} onClick={() => setCat(c)}
                  className={`px-3 py-1.5 rounded-md text-xs capitalize transition-colors ${cat === c ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
                  {c === "all" ? "All" : CAT_META[c].label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {groups.length === 0 && (
            <div className="py-10 text-center text-sm text-slate-500 flex flex-col items-center gap-2">
              <Filter className="h-5 w-5 text-slate-300" /> No audit events match your filters.
            </div>
          )}
          {groups.map((grp) => (
            <div key={grp.day}>
              <div className="text-xs uppercase tracking-wide text-slate-400 mb-3">{grp.day}</div>
              <div className="relative pl-6 space-y-4 before:absolute before:left-[7px] before:top-1 before:bottom-1 before:w-px before:bg-slate-100">
                {grp.items.map((e) => {
                  const m = CAT_META[e.category];
                  const Icon = m.icon;
                  return (
                    <div key={e.id} className="relative">
                      <span className={`absolute -left-6 top-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${m.tint.split(" ")[0]}`} />
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={`px-2 py-0.5 rounded-full text-xs border ${m.chip} flex items-center gap-1`}>
                              <Icon className="h-3 w-3" /> {m.label}
                            </span>
                            <span className="text-sm text-slate-800">{e.action}</span>
                            {e.target && <span className="text-sm text-slate-500">· {e.target}</span>}
                          </div>
                          <div className="text-xs text-slate-400 mt-1">
                            by <span className="text-slate-600">{e.actorName}</span>
                            {e.actorRole && <span> · {ADMIN_ROLE_META[e.actorRole].short}</span>}
                          </div>
                        </div>
                        <span className="text-xs text-slate-400 shrink-0" title={fullStamp(e.at)}>{relTime(e.at)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
