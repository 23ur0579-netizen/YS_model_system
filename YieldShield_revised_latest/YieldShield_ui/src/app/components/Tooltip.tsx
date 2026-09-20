import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { useStore } from "../store";

/**
 * A small "?" hint bubble to drop next to a field label, stat, or term
 * that could use a one-line plain-language explanation. Renders
 * nothing extra (just `children`) when the person has turned tooltips
 * off in Settings — see store.tsx's tooltipsEnabled.
 *
 * Usage:
 *   <div className="flex items-center gap-1">
 *     <span>{t("farm.confidenceWord")}</span>
 *     <Tooltip text={t("tip.confidence")} />
 *   </div>
 */
export function Tooltip({ text, className }: { text: string; className?: string }) {
  const { tooltipsEnabled } = useStore();
  const [open, setOpen] = useState(false);
  if (!tooltipsEnabled) return null;

  return (
    <span className={`relative inline-flex ${className ?? ""}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onBlur={() => setOpen(false)}
        className="h-4 w-4 rounded-full text-slate-400 hover:text-emerald-600 flex items-center justify-center shrink-0"
        aria-label="More info"
      >
        <HelpCircle className="h-3.5 w-3.5" />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[220px] rounded-lg bg-slate-900 text-white text-xs leading-snug px-2.5 py-1.5 shadow-lg pointer-events-none"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
        </span>
      )}
    </span>
  );
}

/**
 * Same hint bubble, but wraps around an existing element (e.g. an
 * icon or a whole row) instead of rendering its own "?" trigger —
 * for spots where hovering the thing itself should show the
 * explanation, rather than adding a separate icon next to it.
 */
export function TooltipWrap({ text, children, className }: { text: string; children: React.ReactNode; className?: string }) {
  const { tooltipsEnabled } = useStore();
  const [open, setOpen] = useState(false);
  if (!tooltipsEnabled) return <>{children}</>;

  return (
    <span
      className={`relative inline-flex ${className ?? ""}`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {children}
      {open && (
        <span
          role="tooltip"
          className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-max max-w-[220px] rounded-lg bg-slate-900 text-white text-xs leading-snug px-2.5 py-1.5 shadow-lg pointer-events-none"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
        </span>
      )}
    </span>
  );
}
