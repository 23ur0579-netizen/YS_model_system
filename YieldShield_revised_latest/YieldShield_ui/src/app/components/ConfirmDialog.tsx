import { AlertTriangle, Trash2 } from "lucide-react";

/**
 * A styled confirmation dialog matching the rest of the app — used in
 * place of the browser's native confirm() (which looks jarring/
 * out-of-place and can't be styled) for anything destructive: delete
 * a field, a cropping, a seed-distribution schedule, etc.
 *
 * Usage:
 *   const [confirming, setConfirming] = useState(false);
 *   ...
 *   <button onClick={() => setConfirming(true)}>Delete</button>
 *   {confirming && (
 *     <ConfirmDialog
 *       title={`Delete "${field.name}" and its ${croppings.length} cropping period(s)?`}
 *       body="This can't be undone."
 *       confirmLabel="Delete field"
 *       onCancel={() => setConfirming(false)}
 *       onConfirm={() => { doDelete(); setConfirming(false); }}
 *     />
 *   )}
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  destructive = true,
  onCancel,
  onConfirm,
}: {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6">
          <div className={`h-11 w-11 rounded-xl flex items-center justify-center ${destructive ? "bg-rose-50 text-rose-600" : "bg-amber-50 text-amber-600"}`}>
            {destructive ? <Trash2 className="h-5 w-5" /> : <AlertTriangle className="h-5 w-5" />}
          </div>
          <div className="mt-4 text-slate-900">{title}</div>
          {body && <div className="mt-1 text-sm text-slate-500">{body}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
          <button onClick={onCancel} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{cancelLabel}</button>
          <button
            onClick={onConfirm}
            className={`px-5 h-10 rounded-lg text-sm text-white ${destructive ? "bg-rose-600 hover:bg-rose-700" : "bg-emerald-600 hover:bg-emerald-700"}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
