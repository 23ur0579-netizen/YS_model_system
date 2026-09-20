"""
Admin-triggered retraining of the yield-prediction model.

Runs YieldShield_ML's R pipeline (scripts/11_extract_farm_level_data.R
to pull fresh data from this same database, then run_pipeline.R for
01_data_audit.R through 10_export_serving_artifacts.R) as a background
thread so the triggering request returns immediately, then copies the
newly-exported artifacts into app/ml/artifacts/ and calls ml.reload()
so the running server picks up the new model without a restart.

This assumes R (plus the pipeline's R packages — see YieldShield_ML's
own requirements/README) is installed on the SAME machine as this API
process, since it shells out to Rscript directly. If your deployment
runs the API and the ML pipeline on separate machines, this endpoint
won't work as-is — you'd need to swap _run_job's subprocess calls for
a remote trigger (SSH, a job queue, etc.) instead.

State is kept in this process's memory only (a single dict guarded by
a lock) — fine for a single-worker deployment, but a restart clears
"currently running" status (a genuinely stuck job would need to be
re-triggered) and multiple worker processes would each track their own
status independently. The one durable record of every retrain attempt
is the app_audit_log entry written at the end either way.
"""
import datetime as dt
import logging
import os
import shutil
import subprocess
import threading

from .config import settings
from .db import get_conn
from .deps import CurrentUser
from .audit_utils import write_audit
from . import ml

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_state: dict = {
    "status": "idle",  # idle | running | succeeded | failed
    "step": None,       # "extracting_data" | "training" | "copying_artifacts" | None
    "started_at": None,
    "finished_at": None,
    "error": None,
    "triggered_by": None,  # actor's display name, for the status panel
}


class RetrainAlreadyRunning(RuntimeError):
    pass


def get_status() -> dict:
    with _lock:
        return dict(_state)


def start_retrain(actor: CurrentUser, actor_name: str) -> dict:
    with _lock:
        if _state["status"] == "running":
            raise RetrainAlreadyRunning("A retrain is already in progress.")
        _state.update(
            status="running", step="extracting_data", started_at=dt.datetime.utcnow().isoformat(),
            finished_at=None, error=None, triggered_by=actor_name,
        )
        snapshot = dict(_state)
    thread = threading.Thread(target=_run_job, args=(actor, actor_name), daemon=True)
    thread.start()
    return snapshot


def _run_job(actor: CurrentUser, actor_name: str):
    ml_dir = os.path.abspath(settings.ML_DIR)
    try:
        _run_rscript(["scripts/11_extract_farm_level_data.R"], ml_dir)
        with _lock:
            _state["step"] = "training"
        _run_rscript(["run_pipeline.R"], ml_dir)
        with _lock:
            _state["step"] = "copying_artifacts"
        info = _copy_artifacts(ml_dir)
        ml.reload()
        with _lock:
            _state.update(status="succeeded", step=None, finished_at=dt.datetime.utcnow().isoformat(), error=None)
        _log_audit(actor, actor_name, ok=True, detail=info)
    except Exception as exc:  # noqa: BLE001 — genuinely any failure here should be captured, not crash the thread silently
        logger.exception("Model retrain failed")
        with _lock:
            _state.update(status="failed", step=None, finished_at=dt.datetime.utcnow().isoformat(), error=str(exc))
        _log_audit(actor, actor_name, ok=False, detail=str(exc))


def _run_rscript(args: list[str], cwd: str):
    result = subprocess.run(
        [settings.RSCRIPT_BIN, *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        timeout=settings.ML_RETRAIN_TIMEOUT_SECONDS,
    )
    if result.returncode != 0:
        # Trim heavily — R's own script output can be very long, and
        # only the tail is usually the actual error.
        tail = (result.stderr or result.stdout or "").strip()[-2000:]
        raise RuntimeError(f"{args[0]} exited with code {result.returncode}: {tail}")


def _copy_artifacts(ml_dir: str) -> str:
    """Mirrors the manual step app/ml/model.py's own error message
    describes ("copy its output into backend/app/ml/artifacts/") —
    automated so a successful retrain actually takes effect."""
    serving_dir = os.path.join(ml_dir, "models", "serving")
    manifest_src = os.path.join(serving_dir, "feature_manifest.json")
    if not os.path.exists(manifest_src):
        raise RuntimeError(f"Pipeline finished but {manifest_src} was not produced.")
    artifact_dir = os.path.join(os.path.dirname(__file__), "ml", "artifacts")
    os.makedirs(artifact_dir, exist_ok=True)
    import json
    with open(manifest_src) as f:
        manifest = json.load(f)
    model_file = manifest.get("model_file", "xgb_model.json")
    model_src = os.path.join(serving_dir, model_file)
    if not os.path.exists(model_src):
        raise RuntimeError(f"Pipeline finished but model file {model_src} (named by feature_manifest.json) was not produced.")
    shutil.copy2(manifest_src, os.path.join(artifact_dir, "feature_manifest.json"))
    shutil.copy2(model_src, os.path.join(artifact_dir, model_file))
    return f"{manifest.get('algorithm', 'model')} — {model_file}"


def _log_audit(actor: CurrentUser, actor_name: str, ok: bool, detail: str):
    try:
        with get_conn(user_id=actor.user_id, role=actor.role) as conn, conn.cursor() as cur:
            action = f"Retrained the yield prediction model ({detail})" if ok else f"Model retrain failed: {detail[:300]}"
            write_audit(cur, actor, "model_retrain", action, None)
            conn.commit()
    except Exception:  # noqa: BLE001 — losing the audit trail shouldn't mask the retrain result itself
        logger.exception("Failed to write model_retrain audit entry")
