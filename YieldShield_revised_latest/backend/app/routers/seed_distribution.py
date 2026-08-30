"""
DA/Municipal Agriculture Office seed hand-outs — scheduled and tallied
per barangay. Separate from farm_input.py: that records what a farmer
actually planted; this records what the office handed out, so the
corn/palay coordinators can plan and reconcile distribution runs.

Restricted end-to-end to the corn/palay commodity coordinators and a
master admin (require_admin_role("corn", "palay") — master always
passes per deps.py). RLS (migration 21) additionally allows any staff
role to read/write at the DB layer, matching the announcement/
app_audit_log division of labor elsewhere in this schema; the tighter
admin_role-tier gate is enforced here, at the API layer.
"""
import datetime as dt

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ..audit_utils import write_audit
from ..db import get_conn
from ..deps import CurrentUser, require_admin_role
from ..push import send_push
from ..schemas import SeedDistributionCreateRequest, SeedDistributionOut, SeedDistributionUpdateRequest

router = APIRouter(prefix="/seed-distribution", tags=["seed-distribution"])

STAFF_TIERS = ("corn", "palay")


def _notify(cur, user_id: int, category: str, title: str, body_text: str, barangay: str | None = None) -> None:
    """Same insert as farm_input.py's _notify — duplicated rather than
    imported cross-router, matching how _resolve_barangay_and_crop is
    already duplicated between the two rather than shared."""
    cur.execute(
        "INSERT INTO yieldshield.notification (user_id, category, title, body, barangay) VALUES (%s, %s, %s, %s, %s)",
        (user_id, category, title, body_text, barangay),
    )

_SELECT_SQL = """
    SELECT sd.distribution_id, ct.crop_name, b.barangay_name, sd.ecosystem, sd.seed_type,
           sd.quantity_kg, sd.beneficiary_count, sd.scheduled_date, sd.distributed_date,
           sd.status, sd.notes, sd.updated_at, u.full_name AS created_by_name
      FROM yieldshield.seed_distribution sd
      JOIN yieldshield.crop_type ct ON ct.crop_type_id = sd.crop_type_id
      JOIN yieldshield.barangay b ON b.barangay_id = sd.barangay_id
      LEFT JOIN yieldshield.user_account u ON u.user_id = sd.created_by
"""

# Office guideline: hybrid targets irrigated areas, either certified
# (Tagged CS) category targets rainfed areas. A row that departs from
# this — most commonly a rainfed barangay still requesting hybrid for
# its higher yield potential — is allowed; onGuideline just flags it
# for the coordinator so it isn't a silent surprise on the tally.
def _on_guideline(ecosystem: str, seed_type: str) -> bool:
    if seed_type == "Hybrid":
        return ecosystem == "Irrigated"
    return ecosystem == "Rainfed"


def _to_out(row) -> SeedDistributionOut:
    crop_label = "Palay (Rice)" if row["crop_name"] == "Palay" else "Corn"
    return SeedDistributionOut(
        id=str(row["distribution_id"]),
        crop=crop_label,
        barangay=row["barangay_name"],
        ecosystem=row["ecosystem"],
        seedType=row["seed_type"],
        quantityKg=float(row["quantity_kg"]),
        beneficiaryCount=row["beneficiary_count"],
        scheduledDate=row["scheduled_date"].isoformat(),
        distributedDate=row["distributed_date"].isoformat() if row["distributed_date"] else None,
        status=row["status"],
        notes=row["notes"] or "",
        onGuideline=_on_guideline(row["ecosystem"], row["seed_type"]),
        createdBy=row["created_by_name"],
        updatedAt=int(row["updated_at"].timestamp() * 1000),
    )


def _resolve_barangay_and_crop(cur, barangay_label: str, crop_label: str) -> tuple[int, int]:
    # normalize() both sides — see the identical comment in
    # farm_input.py's _resolve_barangay_and_crop for why an exact `=`
    # isn't safe for an accented name like "Santo Niño".
    cur.execute(
        "SELECT barangay_id FROM yieldshield.barangay WHERE normalize(barangay_name, NFC) = normalize(%s, NFC)",
        (barangay_label,),
    )
    b_row = cur.fetchone()
    if b_row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown barangay: {barangay_label}")
    cur.execute(
        "SELECT crop_type_id FROM yieldshield.crop_type WHERE crop_name = %s ORDER BY crop_type_id LIMIT 1",
        ("Palay" if crop_label == "Palay (Rice)" else "Corn",),
    )
    c_row = cur.fetchone()
    if c_row is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown crop: {crop_label}")
    return b_row["barangay_id"], c_row["crop_type_id"]


def _require_crop_scope(user: CurrentUser, crop_label: str) -> None:
    """A corn-tier admin may only touch corn distributions, a palay-tier
    admin only palay — same crop-locking already applied client-side
    via adminCrop() in Planning.tsx/AdminFarms.tsx, enforced here too
    so the restriction isn't just a UI nicety."""
    if user.admin_role == "corn" and crop_label != "Corn":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The Corn Program Officer role can only manage corn seed distribution.")
    if user.admin_role == "palay" and crop_label != "Palay (Rice)":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The Palay Program Officer role can only manage palay seed distribution.")


@router.get("", response_model=list[SeedDistributionOut])
def list_seed_distributions(
    crop: str | None = Query(None, description='"Palay (Rice)" or "Corn" — omit for both (master only sees both anyway)'),
    barangay: str | None = Query(None),
    status_filter: str | None = Query(None, alias="status"),
    user: CurrentUser = Depends(require_admin_role(*STAFF_TIERS)),
):
    # A commodity-tier coordinator only ever sees their own crop's rows,
    # regardless of what (if anything) they pass in `crop`.
    effective_crop = crop
    if user.admin_role == "corn":
        effective_crop = "Corn"
    elif user.admin_role == "palay":
        effective_crop = "Palay (Rice)"

    clauses, params = [], []
    if effective_crop:
        clauses.append("ct.crop_name = %s")
        params.append("Palay" if effective_crop == "Palay (Rice)" else "Corn")
    if barangay:
        # normalize() here too — same reasoning as _resolve_barangay_and_crop.
        clauses.append("normalize(b.barangay_name, NFC) = normalize(%s, NFC)")
        params.append(barangay)
    if status_filter:
        clauses.append("sd.status = %s")
        params.append(status_filter)

    sql = _SELECT_SQL
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY sd.scheduled_date DESC, b.barangay_name"

    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
    return [_to_out(r) for r in rows]


@router.post("", response_model=SeedDistributionOut, status_code=status.HTTP_201_CREATED)
def create_seed_distribution(body: SeedDistributionCreateRequest, user: CurrentUser = Depends(require_admin_role(*STAFF_TIERS))):
    _require_crop_scope(user, body.crop)
    pending_pushes: list[tuple[int, str, str]] = []
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            barangay_id, crop_type_id = _resolve_barangay_and_crop(cur, body.barangay, body.crop)
            cur.execute(
                """
                INSERT INTO yieldshield.seed_distribution
                    (crop_type_id, barangay_id, ecosystem, seed_type, quantity_kg,
                     beneficiary_count, scheduled_date, notes, created_by, updated_by)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING distribution_id
                """,
                (
                    crop_type_id, barangay_id, body.ecosystem, body.seed_type, body.quantity_kg,
                    body.beneficiary_count, body.scheduled_date, body.notes, user.user_id, user.user_id,
                ),
            )
            new_id = cur.fetchone()["distribution_id"]
            write_audit(
                cur, user, "seed_distribution",
                f"Scheduled {body.quantity_kg:g} kg of {body.seed_type} seed for {body.barangay} ({body.ecosystem})",
                body.barangay,
            )

            # Personal notification to every farmer registered in the
            # target barangay — they're the ones who actually need to
            # know to show up on the scheduled date, not just whoever
            # happens to check the general Announcements feed.
            scheduled_label = f"{body.scheduled_date:%B} {body.scheduled_date.day}, {body.scheduled_date.year}"
            notif_title = "Seed distribution scheduled"
            notif_body = (
                f"{body.quantity_kg:g} kg of {body.seed_type} {body.crop} seed is scheduled for "
                f"{body.barangay} on {scheduled_label}."
            )
            cur.execute(
                "SELECT user_id, full_name FROM yieldshield.user_account WHERE barangay_id = %s AND role = 'Farmer'",
                (barangay_id,),
            )
            farmers = cur.fetchall()
            for farmer in farmers:
                _notify(cur, farmer["user_id"], "task", notif_title, notif_body, barangay=body.barangay)
                pending_pushes.append((farmer["user_id"], notif_title, notif_body))

            # Also a municipality-wide announcement (tagged "schedule",
            # same category the app already uses for this kind of
            # notice) — visible to every farmer and staff member, not
            # just the ones already correctly registered under this
            # exact barangay, and it stays visible/searchable in the
            # Announcements feed after the fact rather than only
            # existing as a personal notification that gets dismissed.
            cur.execute("SELECT full_name FROM yieldshield.user_account WHERE user_id = %s", (user.user_id,))
            author_label = cur.fetchone()["full_name"]
            cur.execute(
                """
                INSERT INTO yieldshield.announcement (title, body, announce_date, tag, author_id, author_label)
                VALUES (%s, %s, %s, 'schedule', %s, %s)
                """,
                (
                    f"Seed distribution — {body.barangay}",
                    notif_body + (f" {body.notes}" if body.notes else ""),
                    dt.date.today(),
                    user.user_id, author_label,
                ),
            )

            cur.execute(_SELECT_SQL + " WHERE sd.distribution_id = %s", (new_id,))
            row = cur.fetchone()

    for push_user_id, push_title, push_body in pending_pushes:
        send_push(push_user_id, push_title, push_body)

    return _to_out(row)


@router.patch("/{distribution_id}", response_model=SeedDistributionOut)
def update_seed_distribution(
    distribution_id: int, body: SeedDistributionUpdateRequest, user: CurrentUser = Depends(require_admin_role(*STAFF_TIERS))
):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " WHERE sd.distribution_id = %s", (distribution_id,))
            existing = cur.fetchone()
            if existing is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Seed distribution record not found.")
            _require_crop_scope(user, "Palay (Rice)" if existing["crop_name"] == "Palay" else "Corn")

            fields, values = [], []
            if body.ecosystem is not None:
                fields.append("ecosystem = %s"); values.append(body.ecosystem)
            if body.seed_type is not None:
                fields.append("seed_type = %s"); values.append(body.seed_type)
            if body.quantity_kg is not None:
                fields.append("quantity_kg = %s"); values.append(body.quantity_kg)
            if body.beneficiary_count is not None:
                fields.append("beneficiary_count = %s"); values.append(body.beneficiary_count)
            if body.scheduled_date is not None:
                fields.append("scheduled_date = %s"); values.append(body.scheduled_date)
            if body.notes is not None:
                fields.append("notes = %s"); values.append(body.notes)

            # Marking as Distributed without an explicit date defaults
            # to today; moving off Distributed clears the date so the
            # "distributed_date requires status" constraint never trips
            # on a status change alone.
            if body.status is not None:
                fields.append("status = %s"); values.append(body.status)
                if body.status == "Distributed" and body.distributed_date is None and existing["distributed_date"] is None:
                    fields.append("distributed_date = %s"); values.append(dt.date.today())
                elif body.status != "Distributed":
                    fields.append("distributed_date = NULL")
            if body.distributed_date is not None:
                fields.append("distributed_date = %s"); values.append(body.distributed_date)

            fields.append("updated_by = %s"); values.append(user.user_id)

            if fields:
                values.append(distribution_id)
                cur.execute(
                    f"UPDATE yieldshield.seed_distribution SET {', '.join(fields)} WHERE distribution_id = %s", values
                )
            write_audit(
                cur, user, "seed_distribution",
                f"Updated seed distribution for {existing['barangay_name']} ({existing['seed_type']})",
                existing["barangay_name"],
            )
            cur.execute(_SELECT_SQL + " WHERE sd.distribution_id = %s", (distribution_id,))
            row = cur.fetchone()
    return _to_out(row)


@router.delete("/{distribution_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_seed_distribution(distribution_id: int, user: CurrentUser = Depends(require_admin_role(*STAFF_TIERS))):
    with get_conn(user_id=user.user_id, role=user.role) as conn:
        with conn.cursor() as cur:
            cur.execute(_SELECT_SQL + " WHERE sd.distribution_id = %s", (distribution_id,))
            row = cur.fetchone()
            if row is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Seed distribution record not found.")
            _require_crop_scope(user, "Palay (Rice)" if row["crop_name"] == "Palay" else "Corn")
            cur.execute("DELETE FROM yieldshield.seed_distribution WHERE distribution_id = %s", (distribution_id,))
            write_audit(cur, user, "seed_distribution", f"Deleted seed distribution schedule for {row['barangay_name']}", row["barangay_name"])
