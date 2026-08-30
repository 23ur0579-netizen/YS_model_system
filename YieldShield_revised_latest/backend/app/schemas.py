import re
import datetime as _dt
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator

USERNAME_RE = re.compile(r"^[a-zA-Z0-9._-]{3,50}$")

AdminRole = Literal["master", "verification", "corn", "palay"]


# ---------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------
class LoginRequest(BaseModel):
    identifier: str = Field(..., description="Username or email, matches the UI's single field")
    password: str
    # Optional: the sign-in form no longer forces a Farmer/Admin tab choice.
    # When provided it's used the same way as before (must match the
    # account's DB role); when omitted, login() matches on identifier +
    # password alone and returns whatever role the account actually has.
    role: str | None = Field(None, description='"Farmer" or "Admin" — optional now that sign-in has a single form')

    @field_validator("role")
    @classmethod
    def role_must_be_known(cls, v):
        if v is not None and v not in ("Farmer", "Admin"):
            raise ValueError('role must be "Farmer" or "Admin"')
        return v


class LoginResponse(BaseModel):
    token: str
    user_id: int
    name: str
    role: str
    initials: str
    admin_role: AdminRole | None = None


class RegisterRequest(BaseModel):
    """Legacy direct self-registration (creates the account immediately,
    no approval step). Kept for API completeness; the current sign-up
    form uses the approval workflow in RegistrationSubmitRequest below
    instead."""

    full_name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(..., min_length=1, max_length=30)
    barangay: str
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain an uppercase letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain a number.")
        return v


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8, max_length=128)

    @field_validator("new_password")
    @classmethod
    def password_strength(cls, v):
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain an uppercase letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain a number.")
        return v


# ---------------------------------------------------------------------
# Farm input module — mirrors the `form` + `env` state in DataInput.tsx
# ---------------------------------------------------------------------
class FarmInputRequest(BaseModel):
    plot_id: str = Field(..., min_length=1, max_length=50)
    field_id: int | None = Field(None, description="Physical field (yieldshield.field) this cropping belongs to")
    barangay: str = Field(..., description="Barangay key/label as shown in the UI, e.g. 'Poblacion'")
    crop: str = Field(..., description='"Palay (Rice)" or "Corn"')
    planting_date: _dt.date
    area_ha: float = Field(..., gt=0, le=1000)
    quantity: float = Field(..., gt=0)
    quantity_unit: str = Field(..., max_length=30)
    notes: str = Field("", max_length=2000)

    # Agronomic factors (Simulation.tsx / DataInput.tsx "Planting technique" section)
    variety: str | None = Field(None, max_length=120)
    technique: str | None = Field(None, max_length=120)
    spacing: float | None = Field(None, gt=0, description="Crop distance / spacing in cm")
    seed_rate: float | None = Field(None, ge=0, description="Seeding/seedling rate, kg or seedlings per ha")
    # Feeds the official Planting Status / Area Harvested municipal
    # reports (reports.py) — optional, since not every farmer will know
    # or care to specify these.
    ecosystem: str | None = Field(None, pattern="^(Irrigated|Rainfed)$")
    seed_type: str | None = Field(None, pattern="^(Hybrid|RS-CS|Tagged CS \\(RCEF\\)|Tagged CS \\(Commercial\\)|Farmer Saved Seeds)$")

    # Auto-fetched soil/climate snapshot (the `env` object in the UI)
    ph: float = Field(..., ge=0, le=14)
    moisture: float = Field(..., ge=0, le=100)
    temperature: float = Field(..., ge=-10, le=60)
    rainfall: float = Field(..., ge=0, le=2000)
    soil_type: str = Field("", max_length=120)

    # The frontend's deterministic agronomic scoring formula (store.tsx
    # score(), also used by the walk-in Simulation screen) computes this
    # and submits it as a fallback. The server tries the real trained
    # model first (see farm_input.py's _score_submission) and only
    # falls back to this value if the model or required feature data
    # isn't available for the request.
    predicted_yield_mt_ha: float | None = Field(None, gt=0)
    confidence: int | None = Field(None, ge=0, le=100)

    # Same on-behalf pattern as FieldCreateRequest.ownerId (routers/fields.py)
    # — Admin/Agricultural Technician may file this cropping under a
    # farmer's account instead of their own.
    ownerId: str | None = None

    @field_validator("crop")
    @classmethod
    def crop_known(cls, v):
        if v not in ("Palay (Rice)", "Corn"):
            raise ValueError('crop must be "Palay (Rice)" or "Corn"')
        return v


class FarmInputResponse(BaseModel):
    input_log_id: int
    farm_id: int
    field_id: int | None = None
    predicted_yield_mt_ha: float | None = None
    predicted_production_mt: float | None = None
    algorithm: str | None = None
    confidence: int | None = Field(None, description="Model R^2 expressed as a 0-100 confidence score")
    prediction_status: str = Field(
        "ready",
        description='"ready" once a prediction is attached, "pending" if the prediction model is not yet connected',
    )


class PredictionUpdateRequest(BaseModel):
    """Edits an existing cropping record's agronomic inputs (MyFarm.tsx
    'Edit cropping'). Re-scores and persists a new prediction the same
    way FarmInputRequest does on create."""

    barangay: str | None = None
    crop: str | None = None
    planting_date: _dt.date | None = None
    area_ha: float | None = Field(None, gt=0, le=1000)
    # ge=0, not gt=0 like FarmInputRequest's — a record whose quantity
    # was never properly recorded (an older/imported row, or the
    # frontend defaulting a NULL to 0 for display) must still be
    # editable. Requiring >0 here meant re-saving any other field on
    # such a record re-sent that same 0 and got the *entire* edit
    # rejected with a 422, not just the quantity part of it.
    quantity: float | None = Field(None, ge=0)
    quantity_unit: str | None = Field(None, max_length=30)
    notes: str | None = Field(None, max_length=2000)
    variety: str | None = Field(None, max_length=120)
    technique: str | None = Field(None, max_length=120)
    spacing: float | None = Field(None, gt=0)
    seed_rate: float | None = Field(None, ge=0)
    ecosystem: str | None = Field(None, pattern="^(Irrigated|Rainfed)$")
    seed_type: str | None = Field(None, pattern="^(Hybrid|RS-CS|Tagged CS \\(RCEF\\)|Tagged CS \\(Commercial\\)|Farmer Saved Seeds)$")
    ph: float | None = Field(None, ge=0, le=14)
    moisture: float | None = Field(None, ge=0, le=100)
    temperature: float | None = Field(None, ge=-10, le=60)
    rainfall: float | None = Field(None, ge=0, le=2000)
    predicted_yield_mt_ha: float | None = Field(None, gt=0)
    confidence: int | None = Field(None, ge=0, le=100)


class HarvestRequest(BaseModel):
    actual_yield_mt_ha: float = Field(..., gt=0, le=100)
    harvest_date: _dt.date
    harvest_notes: str = Field("", max_length=2000)


class HarvestResponse(BaseModel):
    input_log_id: int
    actual_yield_mt_ha: float
    harvest_date: _dt.date
    harvest_notes: str | None = None


# ---------------------------------------------------------------------
# Farms / plots listing — backs AdminFarms.tsx, MyFarm.tsx, Dashboard.tsx
# ---------------------------------------------------------------------
class FarmOut(BaseModel):
    id: str
    ownerId: str
    farmer: str
    plotId: str
    fieldId: str | None = None
    barangay: str
    crop: str
    area: float
    ph: float | None = None
    moisture: float | None = None
    temperature: float | None = None
    rainfall: float | None = None
    notes: str = ""
    plantingDate: str | None = None
    quantity: float | None = None
    quantityUnit: str | None = None
    variety: str | None = None
    technique: str | None = None
    spacing: float | None = None
    seedRate: float | None = None
    # Classification the official Planting Status / Area Harvested
    # municipal reports group by — see reports.py. None on older rows,
    # or where the farmer didn't specify.
    ecosystem: str | None = None
    seedType: str | None = None
    predictedYield: float | None = None
    confidence: int | None = None
    createdAt: int
    actualYield: float | None = None
    harvestDate: str | None = None
    harvestNotes: str | None = None
    # True when a staff account filed this on the owner's behalf
    # (AdminFarms.tsx) rather than the farmer submitting it themselves —
    # lets MyFarm.tsx nudge them to review/edit it.
    filedByStaff: bool = False


# ---------------------------------------------------------------------
# Admin — user management (backs ManageUsers.tsx / Settings.tsx)
# ---------------------------------------------------------------------
class AdminUserOut(BaseModel):
    id: str
    name: str
    email: str
    phone: str
    role: Literal["Farmer", "Admin"]
    adminRole: AdminRole | None = None
    barangay: str | None = None
    status: Literal["Active", "Inactive"]
    joinedAt: str
    avatarUrl: str | None = None


class AdminCreateUserRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    email: EmailStr
    phone: str = Field(..., min_length=1, max_length=30)
    role: Literal["Farmer", "Admin"]
    adminRole: AdminRole | None = None
    barangay: str


class AdminCreateUserResponse(BaseModel):
    user: AdminUserOut
    temporary_password: str


class AdminUpdateUserRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    email: EmailStr | None = None
    phone: str | None = Field(None, min_length=1, max_length=30)
    role: Literal["Farmer", "Admin"] | None = None
    adminRole: AdminRole | None = None
    barangay: str | None = None
    # Base64 data URL for the profile picture. An empty string means
    # "clear the picture" (stored as NULL) — distinct from omitting the
    # field entirely, which means "leave it unchanged".
    avatarUrl: str | None = Field(None, max_length=300_000)


class AdminResetPasswordRequest(BaseModel):
    mode: Literal["generate", "manual"]
    new_password: str | None = Field(None, min_length=8, max_length=128)
    notify: bool = False


class AdminResetPasswordResponse(BaseModel):
    new_password: str


# ---------------------------------------------------------------------
# Fields — physical plots (backs MyFarm.tsx, Simulation/DataInput field picker)
# ---------------------------------------------------------------------
class FieldOut(BaseModel):
    id: str
    ownerId: str
    farmer: str
    name: str
    barangay: str
    location: str
    area: float
    notes: str = ""
    latitude: float | None = None
    longitude: float | None = None
    # Plotted corners, [[lat, lng], ...] in order — None if only a single
    # pin was dropped (or no location was set at all).
    boundary: list[list[float]] | None = None
    createdAt: int


class FieldCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    barangay: str
    # Exact street address (was a free-text "location details" note
    # before this revision).
    location: str = Field(..., min_length=1, max_length=200)
    area: float = Field(..., ge=0)
    # Exact plot pin from the map picker in Add Field. Optional — an
    # older client, or a field added before a pin was placed, still works.
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    # Corners the farmer tapped out on the map, [[lat, lng], ...] — the
    # centroid of these is what latitude/longitude above should be set
    # to. Optional, and capped well above what a real plot ever needs.
    boundary: list[list[float]] | None = Field(None, max_length=200)
    # Admin may create a field on behalf of a farmer.
    ownerId: str | None = None


# ---------------------------------------------------------------------
# Crop tasks — watering/fertilizer to-dos (backs Calendar.tsx / WeekPlan.tsx)
# ---------------------------------------------------------------------
class CropTaskOut(BaseModel):
    id: str
    ownerId: str
    type: Literal["water", "fertilizer", "pre_planting", "other"]
    text: str
    date: str
    done: bool
    predictionId: str | None = None


class CropTaskCreateRequest(BaseModel):
    type: Literal["water", "fertilizer", "pre_planting", "other"]
    text: str = Field(..., min_length=1, max_length=255)
    date: _dt.date
    predictionId: str | None = None


# ---------------------------------------------------------------------
# Announcements (backs Notifications.tsx / Dashboard.tsx)
# ---------------------------------------------------------------------
class AnnouncementOut(BaseModel):
    id: str
    title: str
    body: str
    date: str
    tag: Literal["advisory", "program", "schedule", "policy", "reminder"]
    author: str
    pinned: bool = False


class AnnouncementCreateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    body: str = Field(..., min_length=1)
    date: _dt.date
    tag: Literal["advisory", "program", "schedule", "policy", "reminder"]


class AnnouncementUpdateRequest(BaseModel):
    title: str | None = Field(None, min_length=1, max_length=200)
    body: str | None = None
    date: _dt.date | None = None
    tag: Literal["advisory", "program", "schedule", "policy", "reminder"] | None = None


# ---------------------------------------------------------------------
# Seed distribution — DA/MAO seed hand-outs scheduled and tallied per
# barangay (backs the Seed Distribution screen). Managed by corn/palay
# coordinators and master admins only (see require_admin_role in
# routers/seed_distribution.py); seed_type here excludes "Farmer Saved
# Seeds" since the DA can't distribute seed a farmer already has.
# ---------------------------------------------------------------------
SeedDistSeedType = Literal["Hybrid", "Tagged CS (RCEF)", "Tagged CS (Commercial)"]


class SeedDistributionOut(BaseModel):
    id: str
    crop: Literal["Palay (Rice)", "Corn"]
    barangay: str
    ecosystem: Literal["Irrigated", "Rainfed"]
    seedType: SeedDistSeedType
    quantityKg: float
    beneficiaryCount: int | None = None
    scheduledDate: str
    distributedDate: str | None = None
    status: Literal["Scheduled", "Distributed", "Cancelled"]
    notes: str = ""
    # True when seedType/ecosystem follows the office's own guideline
    # (Hybrid->Irrigated, either Tagged CS->Rainfed) — False flags a
    # deliberate exception (e.g. Hybrid requested in a Rainfed
    # barangay), surfaced in the UI, never blocked.
    onGuideline: bool
    createdBy: str | None = None
    updatedAt: int


class SeedDistributionCreateRequest(BaseModel):
    crop: Literal["Palay (Rice)", "Corn"]
    barangay: str = Field(..., min_length=1, max_length=80)
    ecosystem: Literal["Irrigated", "Rainfed"]
    seed_type: SeedDistSeedType
    quantity_kg: float = Field(..., gt=0)
    beneficiary_count: int | None = Field(None, ge=0)
    scheduled_date: _dt.date
    notes: str = Field("", max_length=2000)


class SeedDistributionUpdateRequest(BaseModel):
    ecosystem: Literal["Irrigated", "Rainfed"] | None = None
    seed_type: SeedDistSeedType | None = None
    quantity_kg: float | None = Field(None, gt=0)
    beneficiary_count: int | None = Field(None, ge=0)
    scheduled_date: _dt.date | None = None
    distributed_date: _dt.date | None = None
    status: Literal["Scheduled", "Distributed", "Cancelled"] | None = None
    notes: str | None = Field(None, max_length=2000)


# ---------------------------------------------------------------------
# Registrations — farmer sign-up approval workflow (backs Login.tsx /
# ManageUsers.tsx "Account Verification" tab)
# ---------------------------------------------------------------------
class RegistrationSubmitRequest(BaseModel):
    firstName: str = Field(..., min_length=1, max_length=80)
    middleName: str = Field("", max_length=80)
    lastName: str = Field(..., min_length=1, max_length=80)
    email: EmailStr
    phone: str = Field("", max_length=30)
    address: str = Field(..., min_length=1)
    barangay: str
    idFileName: str = Field(..., min_length=1, max_length=255)
    # The applicant's ID, as a data: URL (e.g. "data:image/jpeg;base64,...")
    # read client-side via FileReader before submit. Optional so an old
    # client build (or a resubmission without re-picking the file) still
    # works without the file itself.
    idFileData: str | None = Field(None, max_length=3_000_000)


class RegistrationOut(BaseModel):
    id: str
    firstName: str
    middleName: str
    lastName: str
    email: str
    phone: str
    address: str
    barangay: str
    idFileName: str
    # Only populated for staff-facing reads (list/approve/reject) — the
    # attached ID itself, so a verification admin can view it alongside
    # the rest of the applicant's submitted data.
    idFileUrl: str | None = None
    status: Literal["pending", "approved", "rejected"]
    submittedAt: str
    token: str | None = None
    completed: bool = False


class RegistrationApproveResponse(BaseModel):
    registration: RegistrationOut
    token: str


class RegistrationCompleteRequest(BaseModel):
    email: EmailStr
    token: str = Field(..., min_length=1)
    password: str = Field(..., min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v):
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain an uppercase letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain a number.")
        return v


# ---------------------------------------------------------------------
# Crop varieties — read-only NSIC/PhilRice reference catalog (backs the
# MyFarm.tsx/Simulation.tsx variety picker). See migration 08.
# ---------------------------------------------------------------------
# ---------------------------------------------------------------------
# Municipal reports — backs the Area Planted/Area Harvested date-range
# auto-suggestion in AdminFarms.tsx's Reports panel (see
# routers/reports.py's /reports/date-range).
# ---------------------------------------------------------------------
class ReportDateRangeOut(BaseModel):
    minDate: str | None = None
    maxDate: str | None = None


class CropVarietyOut(BaseModel):
    id: str
    crop: Literal["Palay (Rice)", "Corn"]
    nsicCode: str | None = None
    name: str
    category: str | None = None
    averageYieldTHa: float | None = None
    maximumYieldTHa: float | None = None
    maturityDays: int | None = None
    recommendedEcosystem: str | None = None
    grainType: str | None = None
    droughtTolerance: str | None = None
    floodTolerance: str | None = None
    diseaseResistance: str | None = None


# ---------------------------------------------------------------------
# Audit log — master-admin privileged-action trail (backs AuditLog.tsx)
# ---------------------------------------------------------------------
class AuditEntryOut(BaseModel):
    id: str
    at: int
    actorId: str
    actorName: str
    actorRole: AdminRole | None = None
    category: Literal["verification", "announcement", "account", "privilege", "seed_distribution"]
    action: str
    target: str | None = None


class AuditEntryCreateRequest(BaseModel):
    category: Literal["verification", "announcement", "account", "privilege", "seed_distribution"]
    action: str = Field(..., min_length=1, max_length=255)
    target: str | None = Field(None, max_length=255)


class WeatherOut(BaseModel):
    date: str
    temperature: float  # °C
    rainfall: float     # mm for the day
    source: Literal["forecast", "historical", "climatology_average"]


# ---------------------------------------------------------------------
# Notifications (backs Notifications.tsx / Dashboard.tsx)
# ---------------------------------------------------------------------
class NotificationOut(BaseModel):
    id: str
    title: str
    body: str
    time: str
    read: bool
    category: Literal["alert", "weather", "prediction", "harvest", "task", "system"]
    plotId: str | None = None
    barangay: str | None = None


# ---------------------------------------------------------------------
# Web Push subscriptions (device notifications) — free, browser-native.
# Shape matches the browser's PushSubscription.toJSON() exactly, so the
# frontend can forward it here with no reshaping.
# ---------------------------------------------------------------------
class PushSubscriptionKeys(BaseModel):
    p256dh: str
    auth: str


class PushSubscribeRequest(BaseModel):
    endpoint: str = Field(..., max_length=2000)
    keys: PushSubscriptionKeys


class PushUnsubscribeRequest(BaseModel):
    endpoint: str = Field(..., max_length=2000)

