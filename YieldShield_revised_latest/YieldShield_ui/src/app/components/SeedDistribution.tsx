import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Sprout, Plus, X, Loader2, Trash2, Pencil, CheckCircle2, Package, Wheat } from "lucide-react";
import { useStore, adminCrop, keyToLabel, labelToKey } from "../store";
import { ConfirmDialog } from "./ConfirmDialog";
import { BARANGAY_DATA } from "../data/binalonan";
import * as api from "../lib/api";
import { toast } from "sonner";

// DA-distributable categories only — a farmer's own saved seed
// ("Farmer Saved Seeds" on the cropping form) isn't something the
// office hands out, so it doesn't appear here.
const DA_SEED_TYPES: api.SeedDistSeedType[] = ["Hybrid", "Tagged CS (RCEF)", "Tagged CS (Commercial)"];

const STATUS_META: Record<api.SeedDistribution["status"], { label: string; chip: string }> = {
  Scheduled: { label: "Scheduled", chip: "bg-sky-50 text-sky-700 border-sky-200" },
  Distributed: { label: "Distributed", chip: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  Cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-500 border-slate-200" },
};

function labelFor(key: string) {
  return BARANGAY_DATA[key]?.label ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}
function fmtDate(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

const selectCls = "h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-700 bg-white";
const inputCls = "w-full h-10 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";

export function SeedDistribution() {
  const { user } = useStore();
  // Same crop-locking already applied to Planning.tsx/AdminFarms.tsx —
  // a corn/palay-tier admin only ever manages their own commodity's
  // seed distribution; master sees and can create for both.
  const lockedCrop = adminCrop(user?.adminRole);
  const isCropLocked = lockedCrop === "Corn" || lockedCrop === "Palay (Rice)";

  const [records, setRecords] = useState<api.SeedDistribution[]>([]);
  // Which record is pending a delete confirmation, if any — replaces
  // the native browser confirm() popup with the same styled dialog
  // the rest of the app uses for destructive actions.
  const [confirmDelete, setConfirmDelete] = useState<api.SeedDistribution | null>(null);
  const [loading, setLoading] = useState(true);
  const [cropFilter, setCropFilter] = useState<"Palay (Rice)" | "Corn" | "all">(isCropLocked ? (lockedCrop as "Palay (Rice)" | "Corn") : "all");
  const [barangayFilter, setBarangayFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | api.SeedDistribution["status"]>("all");
  const [formOpen, setFormOpen] = useState<null | "add" | api.SeedDistribution>(null);

  async function load(crop: "Palay (Rice)" | "Corn" | "all") {
    setLoading(true);
    try {
      const list = await api.listSeedDistributions({ crop: crop === "all" ? undefined : crop });
      // Normalize each record's barangay to the same frontend key format
      // BARANGAY_DATA/barangayOptions use (e.g. "SantaCatalina", not the
      // backend's "Sta. Catalina") — same reasoning as store.tsx's
      // apiFarmToPrediction — so the barangay filter dropdown and the
      // per-barangay tally actually match records up correctly instead
      // of silently excluding the four barangays whose backend spelling
      // differs from the GADM-based key.
      setRecords(list.map((r) => ({ ...r, barangay: labelToKey(r.barangay) })));
    } catch (err) {
      toast.error(err instanceof api.ApiError ? err.message : "Couldn't load seed distribution records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(cropFilter); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cropFilter]);

  const filtered = useMemo(
    () =>
      records.filter((r) => {
        if (barangayFilter !== "all" && r.barangay !== barangayFilter) return false;
        if (statusFilter !== "all" && r.status !== statusFilter) return false;
        return true;
      }),
    [records, barangayFilter, statusFilter]
  );

  // Tally per barangay. Distributed = seed actually in farmers' hands
  // (the real "tally"); scheduled-but-not-yet-out is shown alongside
  // so it's never mistaken for stock already delivered.
  const tally = useMemo(() => {
    const map: Record<string, { distributedKg: number; scheduledKg: number; beneficiaries: number }> = {};
    for (const r of records) {
      const t = map[r.barangay] ?? (map[r.barangay] = { distributedKg: 0, scheduledKg: 0, beneficiaries: 0 });
      if (r.status === "Distributed") {
        t.distributedKg += r.quantityKg;
        t.beneficiaries += r.beneficiaryCount ?? 0;
      } else if (r.status === "Scheduled") {
        t.scheduledKg += r.quantityKg;
      }
    }
    return map;
  }, [records]);

  const barangayOptions = useMemo(
    () => Object.keys(BARANGAY_DATA).sort((a, b) => labelFor(a).localeCompare(labelFor(b))),
    []
  );

  async function quickMarkDistributed(r: api.SeedDistribution) {
    try {
      const updated = await api.updateSeedDistribution(r.id, { status: "Distributed" });
      // Same barangay-key normalization as load() above — the API
      // response carries the backend's own spelling, not the frontend key.
      setRecords((rs) => rs.map((x) => (x.id === r.id ? { ...updated, barangay: labelToKey(updated.barangay) } : x)));
      toast.success(`Marked ${labelFor(r.barangay)}'s ${r.seedType} distribution as distributed.`);
    } catch (err) {
      toast.error(err instanceof api.ApiError ? err.message : "Couldn't update the record.");
    }
  }

  async function remove(r: api.SeedDistribution) {
    try {
      await api.deleteSeedDistribution(r.id);
      setRecords((rs) => rs.filter((x) => x.id !== r.id));
      toast.success("Deleted.");
    } catch (err) {
      toast.error(err instanceof api.ApiError ? err.message : "Couldn't delete the record.");
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {isCropLocked && (
          <span className="px-3 py-1 rounded-full text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
            <Wheat className="h-3.5 w-3.5" /> {lockedCrop} program scope
          </span>
        )}
        <div className="flex items-center gap-2 ml-auto flex-wrap">
          {!isCropLocked && (
            <select value={cropFilter} onChange={(e) => setCropFilter(e.target.value as typeof cropFilter)} className={selectCls}>
              <option value="all">All crops</option>
              <option value="Palay (Rice)">Palay (Rice)</option>
              <option value="Corn">Corn</option>
            </select>
          )}
          <select value={barangayFilter} onChange={(e) => setBarangayFilter(e.target.value)} className={selectCls}>
            <option value="all">All barangays</option>
            {barangayOptions.map((b) => (
              <option key={b} value={b}>{labelFor(b)}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={selectCls}>
            <option value="all">All statuses</option>
            <option value="Scheduled">Scheduled</option>
            <option value="Distributed">Distributed</option>
            <option value="Cancelled">Cancelled</option>
          </select>
          <button
            onClick={() => setFormOpen("add")}
            className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-2"
          >
            <Plus className="h-4 w-4" /> Schedule distribution
          </button>
        </div>
      </div>

      {/* Tally summary */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Package className="h-4 w-4 text-emerald-600" />
          <span className="text-sm text-slate-800">Seed distributed per barangay</span>
        </div>
        {loading ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : Object.keys(tally).length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No seed distribution records yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-2.5 font-normal">Barangay</th>
                  <th className="px-5 py-2.5 font-normal">Distributed (kg)</th>
                  <th className="px-5 py-2.5 font-normal">Scheduled, pending (kg)</th>
                  <th className="px-5 py-2.5 font-normal">Farmer-beneficiaries</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(tally)
                  .sort((a, b) => labelFor(a[0]).localeCompare(labelFor(b[0])))
                  .map(([b, t]) => (
                    <tr key={b} className="border-b border-slate-50 last:border-0">
                      <td className="px-5 py-2.5 text-slate-800">{labelFor(b)}</td>
                      <td className="px-5 py-2.5 text-slate-600">{t.distributedKg.toLocaleString()} kg</td>
                      <td className="px-5 py-2.5 text-slate-500">{t.scheduledKg.toLocaleString()} kg</td>
                      <td className="px-5 py-2.5 text-slate-600">{t.beneficiaries}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Schedule list */}
      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
          <Sprout className="h-4 w-4 text-emerald-600" />
          <span className="text-sm text-slate-800">Distribution schedule</span>
        </div>
        {loading ? (
          <div className="p-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No records match these filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-400 border-b border-slate-100">
                  <th className="px-5 py-2.5 font-normal">Barangay</th>
                  <th className="px-5 py-2.5 font-normal">Seed type</th>
                  <th className="px-5 py-2.5 font-normal">Qty (kg)</th>
                  <th className="px-5 py-2.5 font-normal">Farmers</th>
                  <th className="px-5 py-2.5 font-normal">Scheduled</th>
                  <th className="px-5 py-2.5 font-normal">Status</th>
                  <th className="px-5 py-2.5 font-normal"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0 align-top">
                    <td className="px-5 py-3 text-slate-800">{labelFor(r.barangay)}</td>
                    <td className="px-5 py-3 text-slate-600">{r.seedType}</td>
                    <td className="px-5 py-3 text-slate-600">{r.quantityKg.toLocaleString()}</td>
                    <td className="px-5 py-3 text-slate-600">{r.beneficiaryCount ?? "—"}</td>
                    <td className="px-5 py-3 text-slate-500">{fmtDate(r.scheduledDate)}</td>
                    <td className="px-5 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs border ${STATUS_META[r.status].chip}`}>{STATUS_META[r.status].label}</span>
                      {r.distributedDate && <div className="text-xs text-slate-400 mt-1">{fmtDate(r.distributedDate)}</div>}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {r.status === "Scheduled" && (
                          <button onClick={() => quickMarkDistributed(r)} title="Mark as distributed" className="h-8 w-8 rounded-lg hover:bg-emerald-50 text-emerald-600 flex items-center justify-center">
                            <CheckCircle2 className="h-4 w-4" />
                          </button>
                        )}
                        <button onClick={() => setFormOpen(r)} title="Edit" className="h-8 w-8 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={() => setConfirmDelete(r)} title="Delete" className="h-8 w-8 rounded-lg hover:bg-rose-50 text-rose-500 flex items-center justify-center">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {formOpen && (
        <ScheduleModal
          existing={formOpen === "add" ? undefined : formOpen}
          lockedCrop={isCropLocked ? (lockedCrop as "Palay (Rice)" | "Corn") : undefined}
          onClose={() => setFormOpen(null)}
          onSaved={(rec) => {
            setRecords((rs) => {
              const exists = rs.some((x) => x.id === rec.id);
              return exists ? rs.map((x) => (x.id === rec.id ? rec : x)) : [rec, ...rs];
            });
            setFormOpen(null);
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title={`Delete this seed distribution schedule for ${labelFor(confirmDelete.barangay)}?`}
          confirmLabel="Delete schedule"
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => { remove(confirmDelete); setConfirmDelete(null); }}
        />
      )}
    </div>
  );
}

function ScheduleModal({
  existing,
  lockedCrop,
  onClose,
  onSaved,
}: {
  existing?: api.SeedDistribution;
  lockedCrop?: "Palay (Rice)" | "Corn";
  onClose: () => void;
  onSaved: (r: api.SeedDistribution) => void;
}) {
  const barangayOptions = useMemo(
    () => Object.keys(BARANGAY_DATA).sort((a, b) => labelFor(a).localeCompare(labelFor(b))),
    []
  );
  const [form, setForm] = useState({
    crop: existing?.crop ?? lockedCrop ?? ("Palay (Rice)" as "Palay (Rice)" | "Corn"),
    barangay: existing?.barangay ?? barangayOptions[0],
    seedType: existing?.seedType ?? ("Hybrid" as api.SeedDistSeedType),
    quantityKg: existing ? String(existing.quantityKg) : "",
    beneficiaryCount: existing?.beneficiaryCount != null ? String(existing.beneficiaryCount) : "",
    scheduledDate: existing?.scheduledDate ?? new Date().toISOString().slice(0, 10),
    notes: existing?.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function save() {
    const qty = parseFloat(form.quantityKg);
    if (!qty || qty <= 0) { toast.error("Enter a quantity in kg greater than zero."); return; }
    setSaving(true);
    try {
      if (existing) {
        const updated = await api.updateSeedDistribution(existing.id, {
          seed_type: form.seedType,
          quantity_kg: qty,
          beneficiary_count: form.beneficiaryCount ? parseInt(form.beneficiaryCount, 10) : undefined,
          scheduled_date: form.scheduledDate,
          notes: form.notes.trim(),
        });
        // Same barangay-key normalization as load()/quickMarkDistributed
        // above — the API always returns its own spelling, not the
        // frontend key these records are otherwise stored/filtered by.
        onSaved({ ...updated, barangay: labelToKey(updated.barangay) });
        toast.success("Seed distribution record updated.");
      } else {
        const created = await api.createSeedDistribution({
          crop: form.crop,
          barangay: keyToLabel(form.barangay),
          seed_type: form.seedType,
          quantity_kg: qty,
          beneficiary_count: form.beneficiaryCount ? parseInt(form.beneficiaryCount, 10) : undefined,
          scheduled_date: form.scheduledDate,
          notes: form.notes.trim(),
        });
        onSaved({ ...created, barangay: labelToKey(created.barangay) });
        toast.success("Seed distribution scheduled.");
      }
    } catch (err) {
      toast.error(err instanceof api.ApiError ? err.message : "Couldn't save the record.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Sprout className="h-4 w-4 text-emerald-600" />
            </div>
            <span className="text-slate-900">{existing ? "Edit seed distribution" : "Schedule seed distribution"}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Crop</div>
              <select
                value={form.crop}
                disabled={!!lockedCrop || !!existing}
                onChange={(e) => set("crop", e.target.value)}
                className={`${inputCls} appearance-none ${lockedCrop || existing ? "bg-slate-50 text-slate-500 cursor-not-allowed" : ""}`}
              >
                <option value="Palay (Rice)">Palay (Rice)</option>
                <option value="Corn">Corn</option>
              </select>
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Barangay</div>
              <select
                value={form.barangay}
                disabled={!!existing}
                onChange={(e) => set("barangay", e.target.value)}
                className={`${inputCls} appearance-none ${existing ? "bg-slate-50 text-slate-500 cursor-not-allowed" : ""}`}
              >
                {barangayOptions.map((b) => (
                  <option key={b} value={b}>{labelFor(b)}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">Seed type</div>
            <select value={form.seedType} onChange={(e) => set("seedType", e.target.value)} className={`${inputCls} appearance-none`}>
              {DA_SEED_TYPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Quantity (kg)</div>
              <input type="number" min="0" step="0.01" value={form.quantityKg} onChange={(e) => set("quantityKg", e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Farmer-beneficiaries <span className="text-slate-400">(optional)</span></div>
              <input type="number" min="0" step="1" value={form.beneficiaryCount} onChange={(e) => set("beneficiaryCount", e.target.value)} className={inputCls} />
            </label>
          </div>

          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">Scheduled date</div>
            <input type="date" value={form.scheduledDate} onChange={(e) => set("scheduledDate", e.target.value)} className={inputCls} />
          </label>

          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">Notes <span className="text-slate-400">(optional)</span></div>
            <textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              rows={2}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm resize-none"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button
            onClick={save}
            disabled={saving}
            className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? "Saving…" : existing ? "Save changes" : "Schedule"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
