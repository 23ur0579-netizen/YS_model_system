// Thin client for the YieldShield API (see /backend). Talks to real
// Postgres-backed endpoints for auth and farm-input submission —
// everything else in this UI is still the original in-memory mock.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  // getToken() (defined below) checks this tab's own sessionStorage
  // first, falling back to localStorage only for a "remembered" login.
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      // FastAPI validation errors come back as { detail: [...] } with
      // one entry per invalid field; plain HTTPExceptions are
      // { detail: "message" }.
      if (typeof body.detail === "string") message = body.detail;
      else if (Array.isArray(body.detail)) message = body.detail.map((d: any) => d.msg).join(" ");
    } catch {
      // response wasn't JSON — fall back to the generic message above
    }
    throw new ApiError(message, res.status);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export type AdminRole = "master" | "verification" | "corn" | "palay" | "analyst";

export type LoginResponse = {
  token: string;
  user_id: number;
  name: string;
  role: "Farmer" | "Admin" | "Agricultural Technician" | "Analyst";
  initials: string;
  admin_role: AdminRole | null;
};

// The sign-in form no longer has a Farmer/Admin tab, so `role` is
// optional — omit it and the backend matches on identifier+password
// alone and returns whichever role the account actually has.
export function login(identifier: string, password: string, role?: "Farmer" | "Admin") {
  return request<LoginResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier, password, ...(role ? { role } : {}) }),
  });
}

export function register(input: {
  full_name: string;
  email: string;
  phone: string;
  barangay: string;
  password: string;
}) {
  return request<LoginResponse>("/auth/register", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function forgotPassword(email: string) {
  return request<{ message: string }>("/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function resetPassword(token: string, new_password: string) {
  return request<{ message: string }>("/auth/reset-password", {
    method: "POST",
    body: JSON.stringify({ token, new_password }),
  });
}

export type FarmInputPayload = {
  plot_id: string;
  plot_name?: string | null;
  field_id?: number | null;
  barangay: string; // full label, e.g. "Pasileng Norte" — not the UI's internal key
  crop: "Palay (Rice)" | "Corn";
  planting_date: string; // YYYY-MM-DD
  area_ha: number;
  quantity: number;
  quantity_unit: string;
  notes: string;
  variety?: string | null;
  technique?: string | null;
  spacing?: number | null;
  seed_rate?: number | null;
  // Feeds the official Area Planted / Area Harvested municipal
  // reports (backend/app/reports.py) — optional, not every farmer
  // will specify these.
  ecosystem?: "Irrigated" | "Rainfed" | null;
  seed_type?: "Hybrid" | "RS-CS" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)" | "Farmer Saved Seeds" | null;
  ph: number;
  moisture: number;
  temperature: number;
  rainfall: number;
  soil_type: string;
  // Computed client-side by store.tsx's score() and sent as an optimistic
  // fallback. The server tries the real trained model first
  // (backend/app/routers/farm_input.py) and only uses this value if that
  // model isn't available for the request — the response's own
  // predicted_yield_mt_ha/confidence/algorithm are what should actually be
  // shown once it comes back.
  predicted_yield_mt_ha?: number | null;
  confidence?: number | null;
  // Only staff may set this — files the cropping under a farmer's
  // account instead of the caller's own (AdminFarms.tsx's on-behalf
  // flow). Omit entirely for a normal self-submission; the backend
  // 403s a non-staff caller that sends this at all, even if it just
  // repeats their own id.
  ownerId?: string;
};

export type FarmInputResult = {
  input_log_id: number;
  farm_id: number;
  field_id: number | null;
  predicted_yield_mt_ha: number | null;
  predicted_production_mt: number | null;
  algorithm: string | null;
  confidence: number | null;
  prediction_status: "ready" | "pending";
};

export function submitFarmInput(payload: FarmInputPayload) {
  return request<FarmInputResult>("/farm-input", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type FarmInputUpdatePayload = Partial<{
  barangay: string;
  crop: "Palay (Rice)" | "Corn";
  planting_date: string;
  area_ha: number;
  quantity: number;
  quantity_unit: string;
  notes: string;
  plot_name: string | null;
  variety: string | null;
  technique: string | null;
  spacing: number | null;
  seed_rate: number | null;
  ecosystem: "Irrigated" | "Rainfed" | null;
  seed_type: "Hybrid" | "RS-CS" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)" | "Farmer Saved Seeds" | null;
  ph: number;
  moisture: number;
  temperature: number;
  rainfall: number;
  predicted_yield_mt_ha: number | null;
  confidence: number | null;
}>;

export function updateFarmInput(inputLogId: number, patch: FarmInputUpdatePayload) {
  return request<FarmInputResult>(`/farm-input/${inputLogId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export type HarvestResult = {
  input_log_id: number;
  actual_yield_mt_ha: number;
  harvest_date: string;
  harvest_notes: string | null;
};

export function recordHarvest(inputLogId: number, actualYieldMtHa: number, harvestDate: string, harvestNotes?: string) {
  return request<HarvestResult>(`/farm-input/${inputLogId}/harvest`, {
    method: "PATCH",
    body: JSON.stringify({
      actual_yield_mt_ha: actualYieldMtHa,
      harvest_date: harvestDate,
      harvest_notes: harvestNotes ?? "",
    }),
  });
}

// Deletes a cropping entirely (backend cascades its prediction/crop-task
// rows with it — see backend/migrations/17_crop_task_cascade_delete.sql).
export function deleteFarmInput(inputLogId: number) {
  return request<void>(`/farm-input/${inputLogId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------
// Admin — user management (backs ManageUsers.tsx)
// ---------------------------------------------------------------------
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "Farmer" | "Admin";
  adminRole: AdminRole | null;
  barangay: string | null; // full label, e.g. "San Felipe Central" — convert with store.tsx's labelToKey()
  status: "Active" | "Inactive";
  joinedAt: string;
  avatarUrl: string | null;
};

export function listUsers() {
  return request<AdminUser[]>("/users");
}

// Any signed-in user (Farmer included) can fetch their own record —
// unlike listUsers() above, this isn't staff-only. Backs the Settings
// screen so farmers can see their real email/phone/barangay.
export function getMyProfile() {
  return request<AdminUser>("/users/me");
}

// Self-service edit for Settings — never sends `role` (only PATCH
// /users/{id}, staff-only, can change that). avatarUrl: omit to leave
// unchanged, "" to clear the picture, or a base64 data URL to set it.
export function updateMyProfile(patch: Partial<{ name: string; email: string; phone: string; barangay: string; avatarUrl: string }>) {
  return request<AdminUser>("/users/me", { method: "PATCH", body: JSON.stringify(patch) });
}

export function createUser(input: {
  name: string;
  email: string;
  phone: string;
  role: "Farmer" | "Admin";
  adminRole?: AdminRole | null;
  barangay: string;
}) {
  return request<{ user: AdminUser; temporary_password: string }>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateUser(
  userId: string,
  patch: Partial<{ name: string; email: string; phone: string; role: "Farmer" | "Admin"; adminRole: AdminRole | null; barangay: string }>
) {
  return request<AdminUser>(`/users/${userId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function toggleUserStatus(userId: string) {
  return request<AdminUser>(`/users/${userId}/status`, { method: "PATCH" });
}

export function deleteUser(userId: string) {
  return request<void>(`/users/${userId}`, { method: "DELETE" });
}

export function resetUserPassword(
  userId: string,
  input: { mode: "generate" | "manual"; new_password?: string; notify: boolean }
) {
  return request<{ new_password: string }>(`/users/${userId}/reset-password`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

// ---------------------------------------------------------------------
// Farms / plots listing (backs AdminFarms.tsx, MyFarm.tsx, Dashboard.tsx…)
// ---------------------------------------------------------------------
export type ApiFarm = {
  id: string;
  ownerId: string;
  farmer: string;
  plotId: string;
  plotName: string | null;
  fieldId: string | null;
  barangay: string; // full label — convert with store.tsx's labelToKey()
  crop: "Palay (Rice)" | "Corn";
  area: number;
  ph: number | null;
  moisture: number | null;
  temperature: number | null;
  rainfall: number | null;
  notes: string;
  plantingDate: string | null;
  quantity: number | null;
  quantityUnit: string | null;
  variety: string | null;
  technique: string | null;
  spacing: number | null;
  seedRate: number | null;
  ecosystem: "Irrigated" | "Rainfed" | null;
  seedType: "Hybrid" | "RS-CS" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)" | "Farmer Saved Seeds" | null;
  predictedYield: number | null;
  confidence: number | null;
  createdAt: number;
  actualYield: number | null;
  harvestDate: string | null;
  harvestNotes: string | null;
  filedByStaff: boolean;
};

export function listFarms() {
  return request<ApiFarm[]>("/farms");
}

export function saveToken(token: string, remember: boolean = true) {
  // sessionStorage: cleared per-tab, so a login here never bleeds into
  // (or gets overwritten by) another tab's session — see getToken.
  // localStorage: opted into via "Keep me signed in" on the login
  // form — survives closing/reopening the browser. Always write to
  // sessionStorage regardless of `remember`, so THIS tab is correct
  // immediately either way; also always clear the other slot so a
  // stale token from a previous, differently-checked login here never
  // lingers and gets picked up by a future tab that falls back to it.
  sessionStorage.setItem("ys_token", token);
  if (remember) {
    localStorage.setItem("ys_token", token);
  } else {
    localStorage.removeItem("ys_token");
  }
}

export function getToken() {
  // Prefer this tab's own session; only a "remembered" login (opted
  // into shared, cross-restart storage) falls back to localStorage —
  // see saveToken. Two *different* tabs that both check "Keep me
  // signed in" still share that one slot, same trade-off as most
  // sites' remember-me: expected, not a bug, and opt-in.
  return sessionStorage.getItem("ys_token") ?? localStorage.getItem("ys_token");
}

export function clearToken() {
  sessionStorage.removeItem("ys_token");
  localStorage.removeItem("ys_token");
}

// ---------------------------------------------------------------------
// Fields — physical plots (backs MyFarm.tsx)
// ---------------------------------------------------------------------
export type ApiField = {
  id: string;
  ownerId: string;
  farmer: string;
  name: string;
  barangay: string;
  location: string;
  area: number;
  notes: string;
  latitude?: number | null;
  longitude?: number | null;
  // Plotted corners, [[lat, lng], ...] in order — null if only a single
  // pin was dropped (or no location was set at all).
  boundary?: number[][] | null;
  createdAt: number;
};

export function listFields() {
  return request<ApiField[]>("/fields");
}

export function createField(input: {
  name: string;
  barangay: string;
  location: string;
  area: number;
  ownerId?: string;
  latitude?: number;
  longitude?: number;
  boundary?: number[][] | null;
}) {
  return request<ApiField>("/fields", { method: "POST", body: JSON.stringify(input) });
}

export function deleteField(fieldId: string) {
  return request<void>(`/fields/${fieldId}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------
// Crop tasks — watering/fertilizer reminders (backs Calendar.tsx / WeekPlan.tsx)
// ---------------------------------------------------------------------
export type ApiCropTask = {
  id: string;
  ownerId: string;
  type: "water" | "fertilizer" | "pre_planting" | "other";
  text: string;
  date: string;
  endDate: string | null;
  done: boolean;
  predictionId: string | null;
  textKey?: string | null;
  noteKey?: string | null;
  noteRainfall?: number | null;
};

export function listTasks() {
  return request<ApiCropTask[]>("/tasks");
}

export function createTask(input: { type: "water" | "fertilizer" | "pre_planting" | "other"; text: string; date: string; end_date?: string | null; predictionId?: string | null }) {
  return request<ApiCropTask>("/tasks", { method: "POST", body: JSON.stringify(input) });
}

export function toggleTask(taskId: string) {
  return request<ApiCropTask>(`/tasks/${taskId}/toggle`, { method: "PATCH" });
}

export function deleteTask(taskId: string) {
  return request<void>(`/tasks/${taskId}`, { method: "DELETE" });
}

// Re-checks live weather for the caller's own upcoming water/fertilizer
// tasks and updates their note if the forecast has changed since they
// were generated — returns only the tasks that actually changed.
export function refreshWeatherTasks() {
  return request<ApiCropTask[]>("/tasks/refresh-weather", { method: "POST" });
}

// ---------------------------------------------------------------------
// Announcements (backs Notifications.tsx / Dashboard.tsx)
// ---------------------------------------------------------------------
export type ApiAnnouncement = {
  id: string;
  title: string;
  body: string;
  date: string;
  tag: "advisory" | "program" | "schedule" | "policy" | "reminder";
  author: string;
  pinned: boolean;
};

export function listAnnouncements() {
  return request<ApiAnnouncement[]>("/announcements");
}

export function createAnnouncement(input: { title: string; body: string; date: string; tag: ApiAnnouncement["tag"] }) {
  return request<ApiAnnouncement>("/announcements", { method: "POST", body: JSON.stringify(input) });
}

export function updateAnnouncement(id: string, patch: Partial<{ title: string; body: string; date: string; tag: ApiAnnouncement["tag"] }>) {
  return request<ApiAnnouncement>(`/announcements/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
}

export function pinAnnouncement(id: string) {
  return request<ApiAnnouncement>(`/announcements/${id}/pin`, { method: "PATCH" });
}

export function deleteAnnouncement(id: string) {
  return request<void>(`/announcements/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------
// Notifications (backs Notifications.tsx / Dashboard.tsx) — real events
// (prediction ready, low soil moisture, harvest recorded) plus a live
// weather advisory computed server-side from the same weather service
// /weather uses. See backend/app/routers/notifications.py.
// ---------------------------------------------------------------------
export type ApiNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  category: "alert" | "weather" | "prediction" | "harvest" | "task" | "system" | "advisory";
  plotId?: string | null;
  barangay?: string | null;
  titleKey?: string | null;
  bodyKey?: string | null;
  params?: Record<string, string | number> | null;
};

export function listNotifications() {
  return request<ApiNotification[]>("/notifications");
}

export function markNotificationRead(id: string) {
  return request<ApiNotification | null>(`/notifications/${id}/read`, { method: "PATCH" });
}

export function markAllNotificationsRead() {
  return request<{ ok: boolean }>("/notifications/read-all", { method: "PATCH" });
}

export function dismissNotificationApi(id: string) {
  return request<void>(`/notifications/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------
// Registrations — farmer sign-up approval workflow (backs Login.tsx /
// ManageUsers.tsx "Account Verification" tab)
// ---------------------------------------------------------------------
export type ApiRegistration = {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  barangay: string;
  idFileName: string;
  // Data: URL of the attached ID (staff-facing reads only — null on the
  // applicant's own submit response).
  idFileUrl: string | null;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  token: string | null;
  completed: boolean;
};

export function submitRegistration(input: {
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  barangay: string;
  idFileName: string;
  idFileData?: string | null;
}) {
  return request<ApiRegistration>("/registrations", { method: "POST", body: JSON.stringify(input) });
}

export function listRegistrations() {
  return request<ApiRegistration[]>("/registrations");
}

export function approveRegistration(id: string) {
  return request<{ registration: ApiRegistration; token: string }>(`/registrations/${id}/approve`, { method: "PATCH" });
}

export function rejectRegistration(id: string) {
  return request<ApiRegistration>(`/registrations/${id}/reject`, { method: "PATCH" });
}

export function completeRegistration(email: string, token: string, password: string) {
  return request<{ message: string }>("/registrations/complete", {
    method: "POST",
    body: JSON.stringify({ email, token, password }),
  });
}

// ---------------------------------------------------------------------
// Audit log — master-admin privileged-action trail (backs AuditLog.tsx)
// ---------------------------------------------------------------------
export type ApiAuditEntry = {
  id: string;
  at: number;
  actorId: string;
  actorName: string;
  actorRole: AdminRole | null;
  category: "verification" | "announcement" | "account" | "privilege";
  action: string;
  target: string | null;
};

export function listAuditLog() {
  return request<ApiAuditEntry[]>("/audit");
}

// ---------------------------------------------------------------------
// Weather (live, via Open-Meteo — see backend/app/weather.py)
// ---------------------------------------------------------------------
export type ApiWeather = {
  date: string;
  temperature: number; // °C
  rainfall: number;    // mm for the day
  source: "forecast" | "historical" | "climatology_average";
};

export function getWeather(date: string) {
  return request<ApiWeather>(`/weather?date=${encodeURIComponent(date)}`);
}

// ---------------------------------------------------------------------
// Web Push (device notifications) — free, browser-native. See
// backend/app/push.py and lib/push.ts for the actual subscribe flow.
// ---------------------------------------------------------------------
export function getVapidPublicKey() {
  return request<{ key: string }>("/push/vapid-public-key");
}

export function subscribePush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }) {
  return request<{ ok: boolean }>("/push/subscribe", { method: "POST", body: JSON.stringify(sub) });
}

export function unsubscribePush(endpoint: string) {
  return request<{ ok: boolean }>("/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) });
}

// ---------------------------------------------------------------------
// Reports (Area Planted / Area Harvested .xlsx downloads) — backs
// AdminFarms.tsx's Reports panel. These return a binary file, not JSON,
// so they can't go through request() above; this fetches the same way
// (auth header, same error-message parsing) but triggers a browser
// download instead of returning parsed JSON.
// ---------------------------------------------------------------------
export type ReportParams = {
  crop: "Palay (Rice)" | "Corn";
  // Which ecosystem's figures to report — "All" combines Irrigated +
  // Rainfed into one sheet (matches the office's own TOTAL tab), so a
  // dry-season-only municipality can still just use "Irrigated" as before.
  ecosystem: "Irrigated" | "Rainfed" | "All";
  date_from: string; // YYYY-MM-DD
  date_to: string;   // YYYY-MM-DD
  season_label: string;
  as_of_label: string;
  prepared_by: string;
  prepared_title?: string;
  noted_by?: string;
  noted_title?: string;
};

async function downloadReport(path: string, params: ReportParams, filenameFallback: string) {
  const token = getToken();
  const query = new URLSearchParams(params as unknown as Record<string, string>).toString();
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}?${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
  } catch (err) {
    // The fetch itself failed — network down, backend unreachable, or a
    // CORS rejection. This never reaches the res.ok branch below, and
    // the toast that shows for it would otherwise say something generic
    // and unhelpful; log the real browser-reported reason instead.
    console.error("Report download request failed before getting a response (network/CORS):", err);
    throw new ApiError("Couldn't reach the server to generate the report — check that the backend is running and reachable.", 0);
  }
  if (!res.ok) {
    let message = `Couldn't generate the report (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      // response wasn't JSON — fall back to the generic message above
    }
    console.error("Report download failed:", res.status, message);
    throw new ApiError(message, res.status);
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  const filename = match?.[1] ?? filenameFallback;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadAreaPlantedReport(params: ReportParams) {
  return downloadReport("/reports/area-planted", params, "area-planted.xlsx");
}

export function downloadAreaHarvestedReport(params: ReportParams) {
  return downloadReport("/reports/area-harvested", params, "area-harvested.xlsx");
}

export type ReportDateRange = { minDate: string | null; maxDate: string | null };

// Backs AdminFarms.tsx's Reports panel's Area Planted/Area Harvested
// tabs — auto-fills a date window that actually has data instead of a
// blind default, since "harvested" specifically has a real chance of
// landing on a window full of still-growing crops otherwise (a
// correct, empty report that looks identical to a broken one).
export function getReportDateRange(crop: "Palay (Rice)" | "Corn", kind: "planted" | "harvested") {
  return request<ReportDateRange>(`/reports/date-range?crop=${encodeURIComponent(crop)}&kind=${kind}`);
}

// ---------------------------------------------------------------------
// Seed distribution (backend/app/routers/seed_distribution.py) — DA/MAO
// seed hand-outs scheduled and tallied per barangay. Restricted to
// corn/palay coordinators + master admins server-side; the frontend
// additionally only shows the nav link to those tiers (Sidebar.tsx).
// ---------------------------------------------------------------------
export type SeedDistSeedType = "Hybrid" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)";

export type SeedDistribution = {
  id: string;
  crop: "Palay (Rice)" | "Corn";
  barangay: string;
  seedType: SeedDistSeedType;
  quantityKg: number;
  beneficiaryCount: number | null;
  scheduledDate: string; // YYYY-MM-DD
  distributedDate: string | null;
  status: "Scheduled" | "Distributed" | "Cancelled";
  notes: string;
  createdBy: string | null;
  updatedAt: number;
};

export type SeedDistributionCreate = {
  crop: "Palay (Rice)" | "Corn";
  barangay: string;
  seed_type: SeedDistSeedType;
  quantity_kg: number;
  beneficiary_count?: number;
  scheduled_date: string;
  notes?: string;
};

export type SeedDistributionUpdate = Partial<{
  seed_type: SeedDistSeedType;
  quantity_kg: number;
  beneficiary_count: number;
  scheduled_date: string;
  distributed_date: string;
  status: "Scheduled" | "Distributed" | "Cancelled";
  notes: string;
}>;

export function listSeedDistributions(filters?: { crop?: "Palay (Rice)" | "Corn"; barangay?: string; status?: string }) {
  const entries = Object.entries(filters ?? {}).filter(([, v]) => v != null && v !== "") as [string, string][];
  const query = new URLSearchParams(entries).toString();
  return request<SeedDistribution[]>(`/seed-distribution${query ? `?${query}` : ""}`);
}

export function createSeedDistribution(body: SeedDistributionCreate) {
  return request<SeedDistribution>("/seed-distribution", { method: "POST", body: JSON.stringify(body) });
}

export function updateSeedDistribution(id: string, body: SeedDistributionUpdate) {
  return request<SeedDistribution>(`/seed-distribution/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

export function deleteSeedDistribution(id: string) {
  return request<void>(`/seed-distribution/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------
// Crop varieties — read-only NSIC/PhilRice reference catalog (backs the
// variety picker in MyFarm.tsx's cropping form / Simulation.tsx).
// ---------------------------------------------------------------------
export type CropVariety = {
  id: string;
  crop: "Palay (Rice)" | "Corn";
  nsicCode: string | null;
  name: string;
  category: string | null;
  averageYieldTHa: number | null;
  maximumYieldTHa: number | null;
  maturityDays: number | null;
  recommendedEcosystem: string | null;
  grainType: string | null;
  droughtTolerance: string | null;
  floodTolerance: string | null;
  diseaseResistance: string | null;
};

export function listCropVarieties(crop?: "Palay (Rice)" | "Corn") {
  const query = crop ? `?crop=${encodeURIComponent(crop)}` : "";
  return request<CropVariety[]>(`/crop-varieties${query}`);
}

// ---------------------------------------------------------------------
// Admin-triggered model retraining (analyst/master tiers only — see
// backend/app/routers/model_admin.py and ModelAdmin.tsx). Status is
// polled, not pushed, since the retrain runs as a background job on
// the server.
// ---------------------------------------------------------------------
export type ModelRetrainStatus = {
  status: "idle" | "running" | "succeeded" | "failed";
  step: "extracting_data" | "training" | "copying_artifacts" | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  triggeredBy: string | null;
};

export function getModelRetrainStatus() {
  return request<ModelRetrainStatus>("/admin/model/status");
}

export function triggerModelRetrain() {
  return request<ModelRetrainStatus>("/admin/model/retrain", { method: "POST" });
}
