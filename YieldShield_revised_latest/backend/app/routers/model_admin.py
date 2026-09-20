"""
Admin-triggered model retraining — POST to kick off a run of the
YieldShield_ML R pipeline against the live database, GET to poll its
status. See app/ml_retrain.py for the actual job logic; this router is
just the auth-gated HTTP surface over it.

Restricted to the "analyst" and "master" admin tiers (require_admin_role
always lets "master" through regardless of the list passed in) — see
store.tsx's ADMIN_ROLE_META on the frontend for why: verification/corn/
palay officers manage day-to-day farm data, not the prediction model
itself.
"""
from fastapi import APIRouter, Depends, HTTPException, status

from .. import ml_retrain
from ..db import get_conn
from ..deps import CurrentUser, require_admin_role
from ..schemas import ModelRetrainStatusOut

router = APIRouter(prefix="/admin/model", tags=["model-admin"])


def _display_name(user: CurrentUser) -> str:
    with get_conn(user_id=user.user_id, role=user.role) as conn, conn.cursor() as cur:
        cur.execute("SELECT full_name FROM yieldshield.user_account WHERE user_id = %s", (user.user_id,))
        row = cur.fetchone()
    return row["full_name"] if row else user.username


def _to_out(state: dict) -> ModelRetrainStatusOut:
    return ModelRetrainStatusOut(
        status=state["status"],
        step=state["step"],
        startedAt=state["started_at"],
        finishedAt=state["finished_at"],
        error=state["error"],
        triggeredBy=state["triggered_by"],
    )


@router.get("/status", response_model=ModelRetrainStatusOut)
def get_retrain_status(user: CurrentUser = Depends(require_admin_role("analyst"))):
    return _to_out(ml_retrain.get_status())


@router.post("/retrain", response_model=ModelRetrainStatusOut)
def trigger_retrain(user: CurrentUser = Depends(require_admin_role("analyst"))):
    try:
        state = ml_retrain.start_retrain(user, _display_name(user))
    except ml_retrain.RetrainAlreadyRunning as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc))
    return _to_out(state)
