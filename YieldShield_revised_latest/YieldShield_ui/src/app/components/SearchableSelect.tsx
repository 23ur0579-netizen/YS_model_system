import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export type SearchableOption = {
  value: string;
  label: string;
  // Short muted line shown under the option in the open list (e.g.
  // category/maturity for a catalog variety, or its known product type).
  subtitle?: string;
};

// Type-to-filter dropdown — a plain <select> gets unwieldy once there
// are more than a handful of options (the full NSIC/PhilRice catalog
// runs into the dozens per crop). Typing filters by label; clicking
// (or Enter on a highlighted row) selects. Falls back to showing every
// option when nothing's typed, same as a normal select's full list.
export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchableOption[];
  placeholder?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Matches against the subtitle too (category/grain type/maturity),
    // not just the bare name — that text is right there on screen for
    // every option, so typing e.g. "hybrid" to narrow down to hybrid
    // varieties is a reasonable thing to expect to work, not just an
    // exact-name lookup.
    return options.filter((o) => o.label.toLowerCase().includes(q) || (o.subtitle ?? "").toLowerCase().includes(q));
  }, [options, query]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
        <input
          type="text"
          value={open ? query : (selected?.label ?? value)}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!open) setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={className ?? "w-full h-10 pl-9 pr-8 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"}
        />
        <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
      </div>
      {open && (
        <div className="absolute z-20 mt-1 w-full max-h-56 overflow-y-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-slate-400">No matches</div>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 ${o.value === value ? "bg-emerald-50/60 text-emerald-800" : "text-slate-700"}`}
              >
                <div>{o.label}</div>
                {o.subtitle && <div className="text-xs text-slate-400">{o.subtitle}</div>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
