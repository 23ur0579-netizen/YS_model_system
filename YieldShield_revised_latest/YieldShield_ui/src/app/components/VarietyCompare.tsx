import { useMemo, useState } from "react";
import { X, Plus, Wheat, Leaf, Scale } from "lucide-react";
import { useStore } from "../store";
import { SearchableSelect, SearchableOption } from "./SearchableSelect";

// Curated local/farmer-saved varieties (see MyFarm.tsx / Simulation.tsx) —
// offered alongside the DA catalog so the comparison isn't limited to
// varieties that happen to have full agronomic metadata on file.
const PALAY_VARIETIES = [
  "NSIC Rc 222 (Hybrid Inbred)", "NSIC Rc 216", "NSIC Rc 160", "Mestizo 20 (Hybrid)", "PSB Rc 82",
  "Sinandomeng (Traditional)", "Wagwag (Traditional)", "Dinorado (Traditional)", "Milagrosa (Traditional)",
];
const CORN_VARIETIES = [
  "IPB Var 6 (Yellow Hybrid)", "Pioneer P3862", "NK 6410", "Macho F1", "USM Var 10 (OPV)",
  "Lagkitan (Traditional)",
];

const MAX_SLOTS = 4;
const MIN_SLOTS = 2;

type Slot = { crop: "Palay (Rice)" | "Corn"; variety: string };

function emptySlot(crop: "Palay (Rice)" | "Corn" = "Palay (Rice)"): Slot {
  return { crop, variety: "" };
}

// A row of the comparison table — how to read one attribute off either a
// catalog CropVariety or a bare curated-list string (which has no metadata).
function Row({ label, values }: { label: string; values: (string | number | null | undefined)[] }) {
  const allEmpty = values.every((v) => v == null || v === "");
  if (allEmpty) return null;
  return (
    <tr className="border-b border-slate-50 last:border-0">
      <td className="py-2.5 pr-3 text-xs text-slate-500 whitespace-nowrap align-top">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-2.5 px-3 text-sm text-slate-800 align-top">{v == null || v === "" ? "—" : v}</td>
      ))}
    </tr>
  );
}

export function VarietyCompareModal({ onClose, initialCrop }: { onClose: () => void; initialCrop?: "Palay (Rice)" | "Corn" }) {
  const { cropVarieties } = useStore();
  const [slots, setSlots] = useState<Slot[]>([emptySlot(initialCrop), emptySlot(initialCrop)]);

  function optionsFor(crop: "Palay (Rice)" | "Corn"): SearchableOption[] {
    const catalog = cropVarieties
      .filter((v) => v.crop === crop)
      .map((v) => ({ value: v.name, label: v.name, subtitle: v.category ?? undefined }));
    const curatedNames = crop === "Corn" ? CORN_VARIETIES : PALAY_VARIETIES;
    const curated = curatedNames
      .filter((name) => !catalog.some((c) => c.value === name))
      .map((name) => ({ value: name, label: name, subtitle: "Local / farmer-saved" }));
    return [...catalog, ...curated];
  }

  function setSlot(i: number, patch: Partial<Slot>) {
    setSlots((s) => s.map((sl, idx) => (idx === i ? { ...sl, ...patch } : sl)));
  }

  function addSlot() {
    setSlots((s) => (s.length >= MAX_SLOTS ? s : [...s, emptySlot(s[s.length - 1]?.crop ?? "Palay (Rice)")]));
  }

  function removeSlot(i: number) {
    setSlots((s) => (s.length <= MIN_SLOTS ? s : s.filter((_, idx) => idx !== i)));
  }

  // Resolve each filled slot to its catalog record (if any) — a curated
  // local variety with no catalog entry still compares fine, it just
  // shows "—" for every metadata row via Row's allEmpty check.
  const resolved = useMemo(
    () =>
      slots.map((sl) => ({
        ...sl,
        catalog: sl.variety ? cropVarieties.find((v) => v.crop === sl.crop && v.name === sl.variety) : undefined,
      })),
    [slots, cropVarieties]
  );

  const anyFilled = resolved.some((r) => r.variety);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-[95vw] sm:w-[85vw] max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-emerald-50 flex items-center justify-center">
              <Scale className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <div className="text-slate-900">Compare varieties</div>
              <div className="text-xs text-slate-500">Pick 2–{MAX_SLOTS} seed varieties (Palay or Corn) to compare side by side</div>
            </div>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Slot pickers */}
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
            {slots.map((sl, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2 relative">
                {slots.length > MIN_SLOTS && (
                  <button
                    type="button"
                    onClick={() => removeSlot(i)}
                    className="absolute top-2 right-2 h-6 w-6 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600"
                    title="Remove this slot"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="flex items-center gap-1.5 pr-6">
                  {sl.crop === "Corn" ? <Wheat className="h-3.5 w-3.5 text-amber-600" /> : <Leaf className="h-3.5 w-3.5 text-emerald-600" />}
                  <select
                    value={sl.crop}
                    onChange={(e) => setSlot(i, { crop: e.target.value as "Palay (Rice)" | "Corn", variety: "" })}
                    className="text-xs bg-transparent border-none outline-none cursor-pointer text-slate-600"
                  >
                    <option value="Palay (Rice)">Palay (Rice)</option>
                    <option value="Corn">Corn</option>
                  </select>
                </div>
                <SearchableSelect
                  value={sl.variety}
                  onChange={(v) => setSlot(i, { variety: v })}
                  options={optionsFor(sl.crop)}
                  placeholder="Type to search a variety…"
                  allowCustom
                  customLabel={(q) => `Compare "${q}" anyway`}
                />
              </div>
            ))}
            {slots.length < MAX_SLOTS && (
              <button
                type="button"
                onClick={addSlot}
                className="rounded-xl border-2 border-dashed border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/40 flex flex-col items-center justify-center gap-1 py-4 text-slate-400 hover:text-emerald-600 transition-colors min-h-[84px]"
              >
                <Plus className="h-5 w-5" />
                <span className="text-xs">Add variety</span>
              </button>
            )}
          </div>

          {/* Comparison table */}
          {anyFilled ? (
            <div className="overflow-x-auto rounded-xl border border-slate-100">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="py-2.5 pr-3 pl-3 text-left text-xs text-slate-400 font-normal">Attribute</th>
                    {resolved.map((r, i) => (
                      <th key={i} className="py-2.5 px-3 text-left text-sm text-slate-900 font-normal">
                        {r.variety || <span className="text-slate-300">—</span>}
                        {r.variety && !r.catalog && <div className="text-[11px] text-slate-400 font-normal">Local / farmer-saved</div>}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <Row label="Crop" values={resolved.map((r) => r.crop)} />
                  <Row label="Category" values={resolved.map((r) => r.catalog?.category)} />
                  <Row label="NSIC code" values={resolved.map((r) => r.catalog?.nsicCode)} />
                  <Row label="Maturity (days)" values={resolved.map((r) => r.catalog?.maturityDays)} />
                  <Row label="Average yield (t/ha)" values={resolved.map((r) => r.catalog?.averageYieldTHa)} />
                  <Row label="Maximum yield (t/ha)" values={resolved.map((r) => r.catalog?.maximumYieldTHa)} />
                  <Row label="Recommended ecosystem" values={resolved.map((r) => r.catalog?.recommendedEcosystem)} />
                  <Row label="Grain type" values={resolved.map((r) => r.catalog?.grainType)} />
                  <Row label="Drought tolerance" values={resolved.map((r) => r.catalog?.droughtTolerance)} />
                  <Row label="Flood tolerance" values={resolved.map((r) => r.catalog?.floodTolerance)} />
                  <Row label="Disease resistance" values={resolved.map((r) => r.catalog?.diseaseResistance)} />
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center text-sm text-slate-400 py-6">Pick at least one variety above to see its details.</div>
          )}
        </div>
      </div>
    </div>
  );
}
