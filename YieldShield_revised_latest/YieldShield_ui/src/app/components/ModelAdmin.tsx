import { useEffect, useRef, useState } from "react";
import { Cpu, PlayCircle, Loader2, CheckCircle2, XCircle, Clock, Database, Sparkles, FileCog, AlertTriangle } from "lucide-react";
import { useStore } from "../store";
import * as api from "../lib/api";
import { toast } from "sonner";

const STEP_META: Record<NonNullable<api.ModelRetrainStatus["step"]>, { label: string; icon: any }> = {
  extracting_data:   { label: "Extracting fresh farm data from the database", icon: Database },
  training:          { label: "Running the R training pipeline (Random Forest / XGBoost)", icon: Sparkles },
  copying_artifacts: { label: "Copying the new model into the serving path", icon: FileCog },
};

function fullStamp(iso: string) {
  return new Date(iso).toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function duration(startIso: string, endIso: string) {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "under a minute";
  if (mins === 1) return "1 minute";
  return `${mins} minutes`;
}

export function ModelAdmin() {
  const { user } = useStore();
  const [status, setStatus] = useState<api.ModelRetrainStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  async function refresh() {
    try {
      const s = await api.getModelRetrainStatus();
      setStatus(s);
      return s;
    } catch (err) {
      console.error("Failed to load retrain status", err);
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Poll every 4s while a retrain is actually running; stop as soon as
  // it settles (succeeded/failed/idle) so this page doesn't keep
  // hitting the API forever after the job is long done.
  useEffect(() => {
    refresh();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (status?.status === "running" && !pollRef.current) {
      pollRef.current = setInterval(async () => {
        const s = await refresh();
        if (s && s.status !== "running" && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
          if (s.status === "succeeded") toast.success("Model retrained successfully — new predictions now use it.");
          else if (s.status === "failed") toast.error(`Model retrain failed: ${s.error ?? "unknown error"}`);
        }
      }, 4000);
    }
    return () => {
      if (status?.status !== "running" && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [status?.status]);

  async function startRetrain() {
    setTriggering(true);
    try {
      const s = await api.triggerModelRetrain();
      setStatus(s);
      toast.success("Retraining started — this can take a while.");
    } catch (err) {
      const msg = err instanceof api.ApiError ? err.message : "Could not start retraining.";
      toast.error(msg);
    } finally {
      setTriggering(false);
    }
  }

  const isRunning = status?.status === "running";

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <Cpu className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-slate-900 text-lg">Prediction model</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Re-run the YieldShield_ML training pipeline against the latest farm data to improve prediction quality.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-100 rounded-2xl p-5 space-y-4">
        {/* Status header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            {isRunning && <Loader2 className="h-4 w-4 text-sky-600 animate-spin" />}
            {status?.status === "succeeded" && <CheckCircle2 className="h-4 w-4 text-emerald-600" />}
            {status?.status === "failed" && <XCircle className="h-4 w-4 text-rose-600" />}
            {(status?.status === "idle" || !status) && <Clock className="h-4 w-4 text-slate-400" />}
            <span className="text-sm text-slate-700">
              {loading ? "Checking status…"
                : isRunning ? "Retraining in progress"
                : status?.status === "succeeded" ? "Last retrain succeeded"
                : status?.status === "failed" ? "Last retrain failed"
                : "No retrain has been run yet in this session"}
            </span>
          </div>
          <button
            onClick={startRetrain}
            disabled={isRunning || triggering || loading}
            className="px-4 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center gap-2 shrink-0"
          >
            {triggering || isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            {isRunning ? "Running…" : "Retrain model"}
          </button>
        </div>

        {/* Current step */}
        {isRunning && status?.step && (
          <div className="rounded-xl bg-sky-50/60 border border-sky-100 px-3.5 py-3 flex items-center gap-2.5 text-sm text-sky-800">
            {(() => {
              const Icon = STEP_META[status.step].icon;
              return <Icon className="h-4 w-4 shrink-0" />;
            })()}
            {STEP_META[status.step].label}
          </div>
        )}

        {/* Failure detail */}
        {status?.status === "failed" && status.error && (
          <div className="rounded-xl bg-rose-50/60 border border-rose-100 px-3.5 py-3 flex items-start gap-2.5 text-sm text-rose-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <span className="break-words">{status.error}</span>
          </div>
        )}

        {/* Run metadata */}
        {status && status.startedAt && (
          <div className="text-xs text-slate-400 space-y-1 pt-1 border-t border-slate-50">
            <div>Started {fullStamp(status.startedAt)}{status.triggeredBy ? ` by ${status.triggeredBy}` : ""}</div>
            {status.finishedAt && (
              <div>
                {status.status === "succeeded" ? "Finished" : "Stopped"} {fullStamp(status.finishedAt)} — took {duration(status.startedAt, status.finishedAt)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="text-xs text-slate-400 leading-relaxed px-1">
        This runs the full 01–10 R pipeline (data extraction, feature engineering, Random Forest + XGBoost training,
        evaluation, then export) on the server hosting this API, and hot-swaps the live prediction model with the
        newly trained one on success — no restart needed. It can take several minutes; you can navigate away and
        come back, the job keeps running on the server either way.
      </div>
    </div>
  );
}
