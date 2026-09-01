import { createContext, useContext, useState, useEffect, useRef, ReactNode } from "react";
import { toast } from "sonner";
import * as api from "./lib/api";
import { clearToken } from "./lib/api";
import { YieldUnit } from "./lib/units";

// Backend user records don't carry pre-computed initials (only the
// /auth/login response does) — derive the same "first + last initial"
// shape client-side so a restored session looks identical to a fresh
// login.
function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export type View = "dashboard" | "yield" | "recommend" | "planning" | "myfarm" | "calendar" | "users" | "farms" | "settings" | "notifications" | "simulation" | "audit" | "profile" | "seeddist";

const ALL_VIEWS: View[] = ["dashboard", "yield", "recommend", "planning", "myfarm", "calendar", "users", "farms", "settings", "notifications", "simulation", "audit", "profile", "seeddist"];

// Which views make sense to restore after a reload for a given role —
// mirrors Sidebar.tsx's FARMER_NAV/ADMIN_NAV (plus "yield"/"settings"/
// "profile", which are reachable by both roles but aren't in the nav
// itself). Used only to avoid restoring a farmer into an admin-only
// screen (or vice versa) on reload — not a security boundary (the
// API/RLS already enforce that regardless of which screen is showing).
function viewValidForRole(v: View, role: "Farmer" | "Admin"): boolean {
  if (v === "yield" || v === "settings" || v === "notifications" || v === "dashboard" || v === "profile") return true;
  const farmerOnly: View[] = ["myfarm", "calendar"];
  const adminOnly: View[] = ["simulation", "farms", "planning", "users", "audit", "seeddist"];
  if (role === "Farmer") return !adminOnly.includes(v);
  return !farmerOnly.includes(v);
}

// Interface language. YieldShield supports English plus the two languages
// spoken across Binalonan, Pangasinan: Tagalog (Filipino) and Ilocano.
export type Lang = "en" | "tl" | "ilo";

// Admin privilege tiers. A "master" admin can assign privileges and create
// other admin accounts; a "verification" admin reviews account registrations;
// "corn" / "palay" admins manage a single commodity.
export type AdminRole = "master" | "verification" | "corn" | "palay";

export const ADMIN_ROLE_META: Record<AdminRole, { label: string; short: string; desc: string }> = {
  master:       { label: "Master Administrator", short: "Master",       desc: "Full control — assigns privileges and creates admin accounts." },
  verification: { label: "Verification Officer",  short: "Verification", desc: "Reviews and approves farmer account registrations." },
  corn:         { label: "Corn Program Officer",  short: "Corn",         desc: "Manages corn croppings, advisories, and planning." },
  palay:        { label: "Palay Program Officer", short: "Palay",        desc: "Manages palay croppings, advisories, and planning." },
};

// Which crop a given admin is allowed to act on. Master admins see everything.
export function adminCrop(role?: AdminRole): "Palay (Rice)" | "Corn" | "all" | "none" {
  if (role === "corn") return "Corn";
  if (role === "palay") return "Palay (Rice)";
  if (role === "master") return "all";
  return "none";
}

export type Prediction = {
  id: string;
  ownerId: string;
  farmer: string;
  plotId: string;
  fieldId?: string;
  barangay: string;
  crop: "Palay (Rice)" | "Corn";
  area: number;
  ph: number;
  moisture: number;
  temperature: number;
  rainfall: number;
  notes: string;
  plantingDate: string;
  quantity: number;
  quantityUnit: string;
  // Agronomic factors that influence the yield model.
  variety?: string;
  technique?: string;
  spacing?: number;   // crop distance / plant spacing in cm
  seedRate?: number;  // seeding / transplanting rate (kg or seedlings per ha)
  // Optional classification the official Area Planted / Area
  // Harvested municipal reports group by — see AdminFarms.tsx's
  // Reports panel and backend/app/reports.py.
  ecosystem?: "Irrigated" | "Rainfed";
  seedType?: "Hybrid" | "RS-CS" | "Tagged CS (RCEF)" | "Tagged CS (Commercial)" | "Farmer Saved Seeds";
  predictedYield: number;
  confidence: number;
  // Which scoring path produced predictedYield/confidence, once the server
  // has responded — e.g. the trained Random Forest model's name, or the
  // client-side heuristic if the model wasn't available for this request.
  // Undefined until the server confirms (still showing the optimistic
  // client-side estimate).
  algorithm?: string;
  createdAt: number;
  actualYield?: number;
  harvestDate?: string;
  harvestNotes?: string;
  // Backend farm_input_log.input_log_id, once this record has been
  // persisted — undefined for an optimistic record still saving.
  inputLogId?: number;
  // True when staff filed this on the owner's behalf (AdminFarms.tsx)
  // rather than the farmer submitting it themselves — undefined for a
  // still-saving optimistic record, false once confirmed as a normal
  // self-submission.
  filedByStaff?: boolean;
};

// A physical field a farmer owns. A field can host many cropping periods
// (each Prediction with a matching fieldId is one cropping cycle).
export type Field = {
  id: string;
  ownerId: string;
  farmer: string;
  name: string;
  barangay: string;
  location: string; // exact street address
  area: number;      // physical size in hectares
  latitude?: number;
  longitude?: number;
  // Plotted corners, in order around the plot — set via the map's
  // "plot your field" flow in AddFieldModal. Undefined if the farmer
  // only dropped a single pin (or set no location at all).
  boundary?: { lat: number; lng: number }[];
  notes?: string; // legacy — no longer set by Add Field, may still exist on older records
  createdAt: number;
};

export type User = { id: string; name: string; role: "Farmer" | "Admin"; initials: string; adminRole?: AdminRole; avatarUrl?: string };

// Profile pictures are stored client-side only (no backend endpoint for
// this yet) — a base64 data URL per user id in localStorage. Small helper
// so every place a User/ManagedUser is built can attach whatever picture
// that person last chose, and the Settings page can update it.
const AVATAR_KEY_PREFIX = "yieldshield.avatar.";
export function getStoredAvatar(userId: string): string | undefined {
  try { return localStorage.getItem(AVATAR_KEY_PREFIX + userId) ?? undefined; } catch { return undefined; }
}
function setStoredAvatar(userId: string, dataUrl: string | null) {
  try {
    if (dataUrl) localStorage.setItem(AVATAR_KEY_PREFIX + userId, dataUrl);
    else localStorage.removeItem(AVATAR_KEY_PREFIX + userId);
  } catch {}
}

// A pending farmer account request. Password is NOT captured here — the farmer
// only sets it after a verification admin approves the request and issues a
// continue-registration link.
export type Registration = {
  id: string;
  firstName: string;
  middleName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  barangay: string;
  idFileName: string;
  idFileUrl?: string; // data: URL of the attached ID — populated for staff reads only
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  token?: string;      // continue-registration token issued on approval
  completed?: boolean; // farmer has set their password and activated the account
};

// A farmer's crop-care to-do — typically a watering or fertilizer reminder.
export type CropTaskType = "water" | "fertilizer" | "pre_planting" | "other";
export type CropTask = {
  id: string;
  ownerId: string;
  type: CropTaskType;
  text: string;
  date: string;
  done: boolean;
  predictionId?: string;
};

// Master-admin audit trail of privileged actions.
export type AuditCategory = "verification" | "announcement" | "account" | "privilege" | "seed_distribution";
export type AuditEntry = {
  id: string;
  at: number;                 // timestamp
  actorId: string;
  actorName: string;
  actorRole?: AdminRole;
  category: AuditCategory;
  action: string;            // human-readable summary
  target?: string;           // who/what was affected
};

export type NotifCategory = "alert" | "prediction" | "harvest" | "task" | "system" | "weather";
export type AppNotification = {
  id: string;
  title: string;
  body: string;
  time: string;
  read: boolean;
  category: NotifCategory;
  plotId?: string;
  barangay?: string;
};

export type AnnouncementTag = "advisory" | "program" | "schedule" | "policy" | "reminder";
export type Announcement = {
  id: string;
  title: string;
  body: string;
  date: string;
  tag: AnnouncementTag;
  author: string;
  pinned?: boolean;
};

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: "Farmer" | "Admin";
  adminRole?: AdminRole;
  barangay: string;
  status: "Active" | "Inactive";
  joinedAt: string;
  avatarUrl?: string;
};

type Store = {
  user: User | null;
  authLoading: boolean;
  view: View;
  weather: api.ApiWeather | null;
  weatherError: boolean;
  predictions: Prediction[];
  visiblePredictions: Prediction[];
  fields: Field[];
  visibleFields: Field[];
  addField: (f: Omit<Field, "id" | "ownerId" | "farmer" | "createdAt"> & { ownerId?: string; farmer?: string }) => Field;
  deleteField: (id: string) => void;
  current: Prediction | null;
  notifications: AppNotification[];
  loadingFarms: boolean;
  loadingUsers: boolean;
  setView: (v: View) => void;
  login: (u: User) => void;
  logout: () => void;
  addPrediction: (p: Omit<Prediction, "id" | "predictedYield" | "confidence" | "createdAt" | "ownerId"> & { ownerId?: string }) => Prediction;
  // Returns a Promise, not the value directly — see the implementation:
  // a save failure must be reported and rolled back, not just left as
  // an optimistic local value that quietly stops matching the server.
  updatePrediction: (id: string, patch: Partial<Omit<Prediction, "id" | "ownerId" | "predictedYield" | "confidence" | "createdAt">>) => Promise<Prediction | null>;
  setCurrent: (p: Prediction | null) => void;
  recordHarvest: (id: string, actualYield: number, harvestDate: string, harvestNotes?: string) => void;
  deletePrediction: (id: string) => void;
  markNotificationsRead: () => void;
  markOneRead: (id: string) => void;
  dismissNotification: (id: string) => void;
  announcements: Announcement[];
  addAnnouncement: (a: Omit<Announcement, "id">) => void;
  hasUnseenAnnouncement: boolean;
  unseenAnnouncementCount: number;
  markAnnouncementsSeen: () => void;
  updateAnnouncement: (id: string, patch: Partial<Omit<Announcement, "id">>) => void;
  deleteAnnouncement: (id: string) => void;
  pinAnnouncement: (id: string) => void;
  users: ManagedUser[];
  profile: ManagedUser | null;
  loadingProfile: boolean;
  refreshFarms: () => Promise<void>;
  refreshUsers: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  addUser: (u: Omit<ManagedUser, "id" | "joinedAt" | "status">) => void;
  updateUser: (id: string, patch: Partial<Omit<ManagedUser, "id">>) => void;
  updateProfile: (patch: Partial<Pick<ManagedUser, "name" | "email" | "phone" | "barangay">>) => Promise<void>;
  updateAvatar: (dataUrl: string | null) => Promise<void>;
  toggleUserStatus: (id: string) => void;
  deleteUser: (id: string) => void;
  // Account verification (farmer registration) workflow.
  registrations: Registration[];
  addRegistration: (r: Omit<Registration, "id" | "status" | "submittedAt" | "token" | "completed" | "idFileUrl"> & { idFileData?: string | null }) => Promise<void>;
  approveRegistration: (id: string) => Promise<string>; // resolves to the issued token
  rejectRegistration: (id: string) => Promise<void>;
  completeRegistration: (email: string, token: string, password: string) => Promise<boolean>; // farmer sets password → activates
  // Farmer crop-care tasks (watering / fertilizer reminders).
  tasks: CropTask[];
  visibleTasks: CropTask[];
  addTask: (t: Omit<CropTask, "id" | "ownerId" | "done">) => void;
  toggleTask: (id: string) => void;
  // Read-only NSIC/PhilRice variety catalog (yieldshield.crop_variety) —
  // feeds MyFarm.tsx's variety picker.
  cropVarieties: api.CropVariety[];
  deleteTask: (id: string) => void;
  refreshWeatherTasks: () => void;
  // Master-admin audit log.
  auditLog: AuditEntry[];
  logAudit: (entry: Pick<AuditEntry, "category" | "action" | "target">) => void;
  // Interface language.
  lang: Lang;
  setLang: (l: Lang) => void;
  // Display unit for yield figures. predictedYield/actualYield are always
  // stored/sent as metric tonnes per hectare (t/ha) — this only controls
  // how they're formatted/typed in the UI (see lib/units.ts).
  yieldUnit: YieldUnit;
};

const Ctx = createContext<Store | null>(null);

// The backend stores full barangay names (e.g. "San Felipe Central");
// the UI indexes BARANGAY_DATA/BARANGAY_FACTS with a camelCase key
// (e.g. "SanFelipeCentral") matching the GADM boundary data the map/
// dropdowns are built around (src/imports/Binalonan_Pangasinan_
// Barangays.json). Almost every barangay round-trips cleanly through
// a plain space-insert/strip transform — but four don't, because the
// backend's own barangay table is populated from the Municipal
// Agriculture Office's historical Central Data records, which spell
// or abbreviate these four differently than the GADM boundary data
// does: Camangaan/Camanggaan, Mangcasuy/Mangkasuy, and Sta. (not
// Santa) Catalina/Maria Norte. Without this exception map, a farmer
// in any of these four barangays would get "Unknown barangay" trying
// to save a field or cropping at all, since the backend's resolver
// does an exact match against its own table — this isn't just a
// display glitch on the heatmap, it silently blocked real submissions.
const BARANGAY_KEY_TO_BACKEND_LABEL: Record<string, string> = {
  Camangaan: "Camanggaan",
  Mangcasuy: "Mangkasuy",
  SantaCatalina: "Sta. Catalina",
  SantaMariaNorte: "Sta. Maria Norte",
};
const BACKEND_LABEL_TO_BARANGAY_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(BARANGAY_KEY_TO_BACKEND_LABEL).map(([k, v]) => [v, k]),
);
// How much of a field isn't already claimed by a still-growing
// cropping — a harvested cropping's land is free again for the next
// planting, so only ones with no recorded actual yield yet count as
// "occupying" space. Pass excludeId when checking this for a cropping
// that's currently being edited, so its own current area doesn't
// count against itself. Shared by MyFarm.tsx's CroppingModal (caps the
// area input) and its field-detail view (gates the Add Cropping
// button before the form ever opens), and AdminFarms.tsx's on-behalf-
// of field picker — one rule, not three copies of it.
export function remainingFieldArea(field: Field, predictions: Prediction[], excludeId?: string): number {
  const occupied = predictions
    .filter((p) => p.fieldId === field.id && p.actualYield === undefined && p.id !== excludeId)
    .reduce((sum, p) => sum + p.area, 0);
  return Math.max(0, field.area - occupied);
}

export function keyToLabel(key: string): string {
  return BARANGAY_KEY_TO_BACKEND_LABEL[key] ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}
export function labelToKey(label: string): string {
  // NFC-normalize first: "Santo Niño" can arrive from the backend with
  // "ñ" as either one composed codepoint or "n" + a separate combining-
  // tilde mark — visually identical, byte-for-byte different, and a
  // plain JS string/object-key comparison treats them as unequal. Bit
  // for bit this is the exact same failure mode the seed script's
  // load_barangays() just hit and got fixed for — normalizing here
  // means it can't quietly resurface in the live app for any barangay
  // with an accented name, regardless of which form a migration, an
  // editor, or Postgres itself happened to store it in.
  const normalized = label.normalize("NFC");
  return BACKEND_LABEL_TO_BARANGAY_KEY[normalized] ?? normalized.replace(/\s+/g, "");
}

function apiFarmToPrediction(f: api.ApiFarm): Prediction {
  return {
    id: f.id,
    ownerId: f.ownerId,
    farmer: f.farmer,
    plotId: f.plotId,
    fieldId: f.fieldId ?? undefined,
    barangay: labelToKey(f.barangay),
    crop: f.crop,
    area: f.area,
    ph: f.ph ?? 0,
    moisture: f.moisture ?? 0,
    temperature: f.temperature ?? 0,
    rainfall: f.rainfall ?? 0,
    notes: f.notes ?? "",
    plantingDate: f.plantingDate ?? "",
    quantity: f.quantity ?? 0,
    quantityUnit: f.quantityUnit ?? "",
    variety: f.variety ?? undefined,
    technique: f.technique ?? undefined,
    spacing: f.spacing ?? undefined,
    seedRate: f.seedRate ?? undefined,
    ecosystem: f.ecosystem ?? undefined,
    seedType: f.seedType ?? undefined,
    predictedYield: f.predictedYield ?? 0,
    confidence: f.confidence ?? 0,
    createdAt: f.createdAt,
    actualYield: f.actualYield ?? undefined,
    harvestDate: f.harvestDate ?? undefined,
    harvestNotes: f.harvestNotes ?? undefined,
    inputLogId: Number(f.id),
    filedByStaff: f.filedByStaff,
  };
}

function apiUserToManagedUser(u: api.AdminUser): ManagedUser {
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    role: u.role,
    adminRole: u.adminRole ?? undefined,
    barangay: u.barangay ? labelToKey(u.barangay) : "",
    status: u.status,
    joinedAt: u.joinedAt,
    // The backend is now the source of truth (migration 15_user_avatar.sql);
    // fall back to the locally-cached copy only for accounts that haven't
    // synced yet (e.g. offline, or a picture set before that migration ran).
    avatarUrl: u.avatarUrl ?? getStoredAvatar(u.id),
  };
}

function apiFieldToField(f: api.ApiField): Field {
  return {
    id: f.id,
    ownerId: f.ownerId,
    farmer: f.farmer,
    name: f.name,
    barangay: labelToKey(f.barangay),
    location: f.location,
    area: f.area,
    latitude: f.latitude ?? undefined,
    longitude: f.longitude ?? undefined,
    boundary: f.boundary ? f.boundary.map(([lat, lng]) => ({ lat, lng })) : undefined,
    notes: f.notes,
    createdAt: f.createdAt,
  };
}

function apiTaskToTask(t: api.ApiCropTask): CropTask {
  return { id: t.id, ownerId: t.ownerId, type: t.type, text: t.text, date: t.date, done: t.done, predictionId: t.predictionId ?? undefined };
}

function apiAnnouncementToAnnouncement(a: api.ApiAnnouncement): Announcement {
  return { id: a.id, title: a.title, body: a.body, date: a.date, tag: a.tag, author: a.author, pinned: a.pinned };
}

function apiNotificationToAppNotification(n: api.ApiNotification): AppNotification {
  return {
    id: n.id,
    title: n.title,
    body: n.body,
    time: n.time,
    read: n.read,
    category: n.category,
    plotId: n.plotId ?? undefined,
    barangay: n.barangay ?? undefined,
  };
}

function apiRegistrationToRegistration(r: api.ApiRegistration): Registration {
  return {
    id: r.id,
    firstName: r.firstName,
    middleName: r.middleName,
    lastName: r.lastName,
    email: r.email,
    phone: r.phone,
    address: r.address,
    barangay: labelToKey(r.barangay),
    idFileName: r.idFileName,
    idFileUrl: r.idFileUrl ?? undefined,
    status: r.status,
    submittedAt: r.submittedAt,
    token: r.token ?? undefined,
    completed: r.completed,
  };
}

function apiAuditToEntry(a: api.ApiAuditEntry): AuditEntry {
  return { id: a.id, at: a.at, actorId: a.actorId, actorName: a.actorName, actorRole: a.actorRole ?? undefined, category: a.category, action: a.action, target: a.target ?? undefined };
}

// Populated once cropVarieties loads (see refreshCropVarieties below) —
// kept as a plain module-level map, not React state, so maturityDays()
// below can stay a simple synchronous function every existing caller
// (AdminFarms.tsx, ManageUsers.tsx, WeekPlan.tsx) already uses, rather
// than becoming async everywhere just to look one thing up.
const VARIETY_MATURITY_CACHE = new Map<string, number>();
function varietyCacheKey(crop: Prediction["crop"], variety: string) {
  return `${crop}::${variety}`;
}

// Real per-variety maturity (yieldshield.crop_variety catalog) when the
// cropping's free-text variety matches something in it — a 105-day
// variety and a 130-day variety otherwise shared one flat 120-day
// assumption, which threw off the harvest countdown here and the
// auto-generated schedule's maturity-anchored tasks server-side
// (farm_input.py mirrors this same fallback order). Falls back to the
// flat crop-level default when the variety isn't known yet or doesn't
// match anything in the catalog.
export function maturityDays(crop: Prediction["crop"], variety?: string) {
  if (variety) {
    const cached = VARIETY_MATURITY_CACHE.get(varietyCacheKey(crop, variety));
    if (cached != null) return cached;
  }
  return crop === "Palay (Rice)" ? 120 : 90;
}

// Ideal planting months per crop (0 = Jan), drawn from the Binalonan
// cropping calendar: wet-season and dry-season transplanting/seeding windows.
const PLANTING_WINDOWS: Record<Prediction["crop"], { months: number[]; label: string }[]> = {
  "Palay (Rice)": [
    { months: [5, 6], label: "Wet season (Jun–Jul)" },   // Jun, Jul
    { months: [10, 11], label: "Dry season (Nov–Dec)" }, // Nov, Dec
  ],
  Corn: [
    { months: [4, 5], label: "Wet season (May–Jun)" },   // May, Jun
    { months: [10, 11], label: "Dry season (Nov–Dec)" }, // Nov, Dec
  ],
};

// Circular distance (in months) between two month indices.
function monthDistance(a: number, b: number) {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

export type PlantingWindow = {
  score: number;        // 0..1 alignment with the ideal window
  distance: number;     // months from the nearest ideal window
  inWindow: boolean;
  nearest: string;      // label of the nearest recommended window
};

// How well a planting date aligns with the crop's ideal calendar window.
export function plantingWindow(crop: Prediction["crop"], plantingDate: string): PlantingWindow {
  const month = new Date(plantingDate).getMonth();
  let best = { distance: 99, label: "" };
  for (const w of PLANTING_WINDOWS[crop]) {
    for (const m of w.months) {
      const dist = monthDistance(month, m);
      if (dist < best.distance) best = { distance: dist, label: w.label };
    }
  }
  const score = Math.max(0, 1 - best.distance * 0.25); // 0 mo→1.0, 1→0.75, 2→0.5…
  return { score, distance: best.distance, inWindow: best.distance === 0, nearest: best.label };
}

// Yield multiplier per planting technique — high-intensity methods (e.g. SRI)
// lift yields, basic broadcasting is neutral.
const TECHNIQUE_BONUS: Record<string, number> = {
  "System of Rice Intensification (SRI)": 0.12,
  "Row Planting (Furrow Method)": 0.06,
  "Transplanting (Pindot)": 0.05,
  "Strip Cropping with Legumes": 0.04,
  "Contour Farming": 0.03,
  "Hill Planting": 0.03,
  "Wet Direct Seeding": 0.02,
  "Dry Direct Seeding": 0.0,
};

// Ideal plant spacing (cm) per crop — closer alignment scores higher.
function idealSpacing(crop: Prediction["crop"]) {
  return crop === "Corn" ? 25 : 20;
}

export type PredictionInput = {
  crop: Prediction["crop"];
  ph: number;
  moisture: number;
  temperature: number;
  rainfall: number;
  plantingDate: string;
  technique?: string;
  spacing?: number;
  // The selected variety's documented average yield (yieldshield.crop_variety,
  // e.g. "NSIC Rc222 averages 5.5 t/ha") — when known, replaces the flat
  // 4.0/5.0 t/ha crop-generic assumption below as the baseline the
  // environmental/timing/spacing factors then scale up or down. Omitted
  // (free-text variety not in the catalog, or none picked) keeps the
  // exact previous behavior.
  varietyAvgYieldTHa?: number;
};

// Deterministic agronomic scoring formula. This doubles as the payload
// sent to the backend as predicted_yield_mt_ha/confidence (see
// backend/app/routers/farm_input.py — there's no live ML model service
// in this build yet, so the backend trusts and persists this client
// computation rather than silently losing it).
function score(p: PredictionInput) {
  const phScore = 1 - Math.min(1, Math.abs(p.ph - 6.4) / 2);
  const moistScore = 1 - Math.min(1, Math.abs(p.moisture - (p.crop === "Corn" ? 55 : 65)) / 40);
  const tempScore = 1 - Math.min(1, Math.abs(p.temperature - 28) / 12);
  const rainScore = 1 - Math.min(1, Math.abs(p.rainfall - (p.crop === "Corn" ? 110 : 150)) / 120);
  const envScore = phScore * 0.3 + moistScore * 0.3 + tempScore * 0.2 + rainScore * 0.2;

  // Planting-date alignment with the cropping calendar.
  const windowScore = plantingWindow(p.crop, p.plantingDate).score;

  // Crop-distance alignment with the ideal spacing for the crop.
  const ideal = idealSpacing(p.crop);
  const spacingScore = p.spacing ? 1 - Math.min(1, Math.abs(p.spacing - ideal) / ideal) : 0.8;

  const composite = envScore * 0.6 + windowScore * 0.25 + spacingScore * 0.15;

  const techBonus = p.technique ? TECHNIQUE_BONUS[p.technique] ?? 0 : 0;

  const base = p.varietyAvgYieldTHa ?? (p.crop === "Corn" ? 4.0 : 5.0);
  const yieldPerHa = +(base * (0.5 + 0.5 * composite) * (1 + techBonus)).toFixed(2);
  const confidence = Math.min(99, Math.round(70 + 25 * composite + techBonus * 30));
  return { yieldPerHa, confidence };
}

// Public helper so the UI can preview a yield without persisting a cropping.
export function predictYield(input: PredictionInput) {
  return score(input);
}

// Local-only id, used for optimistic records before the backend confirms
// them. Distinguishable from a real backend id (always numeric).
function localId(prefix: string) {
  return `local-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}
function isLocalId(id: string) {
  return id.startsWith("local-");
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  // True until the session-restore check below resolves — lets App.tsx
  // show a loading state instead of flashing the Login screen for a
  // split second on every reload while a valid token is still being
  // verified.
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setViewState] = useState<View>(() => {
    try {
      const stored = localStorage.getItem("yieldshield.view");
      if (stored && ALL_VIEWS.includes(stored as View)) return stored as View;
    } catch {}
    return "dashboard";
  });
  const setView = (v: View) => {
    setViewState(v);
    try {
      localStorage.setItem("yieldshield.view", v);
    } catch {}
    // Push a real history entry per screen so the browser's back/forward
    // buttons move between in-app screens instead of leaving the app
    // entirely (there's no per-view URL, so this keeps the same address
    // and just carries the view in history state).
    try {
      if (window.history.state?.view !== v) {
        window.history.pushState({ view: v }, "", window.location.pathname + window.location.search);
      }
    } catch {}
  };

  // Handle the browser's back/forward buttons — restore whichever view
  // was current when that history entry was created. Also seeds the
  // very first history entry with the current view, so back/forward
  // works correctly from the first navigation rather than only from the
  // second one onward.
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const v = (e.state as { view?: View } | null)?.view;
      if (v && ALL_VIEWS.includes(v)) {
        setViewState(v);
        try {
          localStorage.setItem("yieldshield.view", v);
        } catch {}
      }
    }
    window.addEventListener("popstate", onPopState);
    try {
      if (!(window.history.state as { view?: View } | null)?.view) {
        window.history.replaceState({ view }, "", window.location.pathname + window.location.search);
      }
    } catch {}
    return () => window.removeEventListener("popstate", onPopState);
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [lang, setLangState] = useState<Lang>(() => {
    try {
      const stored = localStorage.getItem("yieldshield.lang");
      if (stored === "en" || stored === "tl" || stored === "ilo") return stored;
    } catch {}
    return "en";
  });
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [current, setCurrent] = useState<Prediction | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [profile, setProfile] = useState<ManagedUser | null>(null);
  const [loadingFarms, setLoadingFarms] = useState(false);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  // Tracks whether the farmer/admin has opened the Announcement Board
  // since the newest announcement was posted, so Sidebar/tab nav can
  // show a red "new announcement" dot. Persisted client-side (per
  // browser, like view/lang above) since announcements have no
  // per-user read state on the backend.
  const [lastSeenAnnouncementAt, setLastSeenAnnouncementAtState] = useState<string>(() => {
    try {
      return localStorage.getItem("yieldshield.lastSeenAnnouncementAt") ?? "";
    } catch {
      return "";
    }
  });
  const markAnnouncementsSeen = () => {
    const now = new Date().toISOString();
    setLastSeenAnnouncementAtState(now);
    try {
      localStorage.setItem("yieldshield.lastSeenAnnouncementAt", now);
    } catch {}
  };
  const hasUnseenAnnouncement = announcements.some((a) => new Date(a.date).toISOString() > lastSeenAnnouncementAt);
  // How many, not just whether — feeds the topbar bell badge (added to
  // unread notifications) and the Announcement Board tab pill, so both
  // show a real number instead of a bare red dot.
  const unseenAnnouncementCount = announcements.filter((a) => new Date(a.date).toISOString() > lastSeenAnnouncementAt).length;
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [tasks, setTasks] = useState<CropTask[]>([]);
  const [cropVarieties, setCropVarieties] = useState<api.CropVariety[]>([]);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  // Real notifications now (migration 09 / routers/notifications.py) —
  // populated by refreshNotifications() below, replacing what used to
  // be three hardcoded rows baked directly into this file.
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  // Live weather for Binalonan today (Open-Meteo, via backend/app/weather.py)
  // — shared here so Dashboard.tsx and Topbar.tsx both show the same real
  // value instead of each fetching it independently.
  const [weather, setWeather] = useState<api.ApiWeather | null>(null);
  const [weatherError, setWeatherError] = useState(false);

  async function refreshFarms() {
    if (!api.getToken()) return;
    setLoadingFarms(true);
    try {
      const farms = await api.listFarms();
      setPredictions(farms.map(apiFarmToPrediction));
    } catch (err) {
      console.error("Failed to load farms from the API", err);
    } finally {
      setLoadingFarms(false);
    }
  }

  async function refreshProfile() {
    if (!api.getToken()) return;
    setLoadingProfile(true);
    try {
      const me = await api.getMyProfile();
      const mu = apiUserToManagedUser(me);
      setProfile(mu);
      // `user` (the session identity shown in Topbar etc.) doesn't carry
      // every profile field, but it does carry avatarUrl — keep it in
      // sync with what the backend actually has for this account.
      setUser((u) => (u && u.id === mu.id ? { ...u, avatarUrl: mu.avatarUrl } : u));
    } catch (err) {
      console.error("Failed to load the signed-in user's profile", err);
    } finally {
      setLoadingProfile(false);
    }
  }

  async function refreshUsers() {
    if (!api.getToken()) return;
    setLoadingUsers(true);
    try {
      const list = await api.listUsers();
      setUsers(list.map(apiUserToManagedUser));
    } catch (err) {
      console.error("Failed to load users from the API", err);
    } finally {
      setLoadingUsers(false);
    }
  }

  async function refreshFields() {
    if (!api.getToken()) return;
    try {
      const list = await api.listFields();
      setFields(list.map(apiFieldToField));
    } catch (err) {
      console.error("Failed to load fields from the API", err);
    }
  }

  async function refreshTasks() {
    if (!api.getToken()) return;
    try {
      const list = await api.listTasks();
      setTasks(list.map(apiTaskToTask));
    } catch (err) {
      console.error("Failed to load tasks from the API", err);
    }
  }

  // Read-only NSIC/PhilRice variety catalog (yieldshield.crop_variety) —
  // feeds MyFarm.tsx's variety picker and, via VARIETY_MATURITY_CACHE
  // above, every maturityDays() call's harvest-timing estimate. Fetched
  // once at login/session-restore, same as fields/tasks/announcements;
  // it's read-only reference data that doesn't change during a session.
  async function refreshCropVarieties() {
    if (!api.getToken()) return;
    try {
      const list = await api.listCropVarieties();
      setCropVarieties(list);
      for (const v of list) {
        if (v.maturityDays != null) VARIETY_MATURITY_CACHE.set(varietyCacheKey(v.crop, v.name), v.maturityDays);
      }
    } catch (err) {
      console.error("Failed to load crop varieties from the API", err);
    }
  }

  // Re-checks live weather for upcoming water/fertilizer tasks — the
  // "changes depending on weather" half of the auto-generated calendar
  // (the initial plotting happens server-side when a cropping is
  // submitted; see backend/app/farm_calendar.py). Called at login/session
  // restore, on the realtime forecast poll below, and again whenever
  // Calendar.tsx is opened, so both it and the Dashboard's "What to do
  // this week" (WeekPlan.tsx) — which read the same `tasks` list — stay
  // current without requiring a visit to the Calendar page first.
  async function refreshWeatherTasks() {
    if (!api.getToken()) return;
    try {
      const changed = await api.refreshWeatherTasks();
      if (changed.length === 0) return;
      const byId = new Map(changed.map((t) => [t.id, apiTaskToTask(t)]));
      setTasks((prev) => prev.map((t) => byId.get(t.id) ?? t));
    } catch (err) {
      console.error("Failed to refresh weather-sensitive tasks", err);
    }
  }

  async function refreshAnnouncements() {
    if (!api.getToken()) return;
    try {
      const list = await api.listAnnouncements();
      setAnnouncements(list.map(apiAnnouncementToAnnouncement));
    } catch (err) {
      console.error("Failed to load announcements from the API", err);
    }
  }

  async function refreshNotifications() {
    if (!api.getToken()) return;
    try {
      const list = await api.listNotifications();
      setNotifications(list.map(apiNotificationToAppNotification));
    } catch (err) {
      console.error("Failed to load notifications from the API", err);
    }
  }

  async function refreshWeather() {
    if (!api.getToken()) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const w = await api.getWeather(today);
      setWeather(w);
      setWeatherError(false);
    } catch (err) {
      console.error("Failed to load today's weather", err);
      setWeatherError(true);
    }
  }

  async function refreshRegistrations() {
    if (!api.getToken()) return;
    try {
      const list = await api.listRegistrations();
      setRegistrations(list.map(apiRegistrationToRegistration));
    } catch (err) {
      console.error("Failed to load registrations from the API", err);
    }
  }

  async function refreshAuditLog() {
    if (!api.getToken()) return;
    try {
      const list = await api.listAuditLog();
      setAuditLog(list.map(apiAuditToEntry));
    } catch (err) {
      console.error("Failed to load the audit log from the API", err);
    }
  }

  // Internal helper so privileged store actions record themselves. The
  // backend also writes its own audit rows for actions it performs
  // (announcements, user management, registrations) — this local push
  // just makes the entry appear instantly, and refreshAuditLog() will
  // reconcile it with the server's copy next time it's called.
  const pushAudit = (entry: Pick<AuditEntry, "category" | "action" | "target">) =>
    setAuditLog((prev) => [
      {
        ...entry,
        id: localId("aud"),
        at: Date.now(),
        actorId: user?.id ?? "anonymous",
        actorName: user?.name ?? "Unknown",
        actorRole: user?.adminRole,
      },
      ...prev,
    ]);

  const visiblePredictions =
    !user || user.role === "Admin" ? predictions : predictions.filter((p) => p.ownerId === user.id);
  const visibleTasks = !user ? [] : tasks.filter((t) => t.ownerId === user.id);
  const visibleFields =
    !user || user.role === "Admin" ? fields : fields.filter((f) => f.ownerId === user.id);

  // Restore the session on page load/reload. The JWT in localStorage
  // survives a reload just fine, but `user` is plain React state and
  // resets to null every time this component remounts -- without this,
  // App.tsx's `if (!user) return <Login />` kicks in on every refresh
  // even though the token is still valid. Ask the backend who we are,
  // and only fall back to the login screen if that actually fails
  // (expired/invalid token).
  useEffect(() => {
    if (!api.getToken()) {
      setAuthLoading(false);
      return;
    }
    let cancelled = false;
    api
      .getMyProfile()
      .then((me) => {
        if (cancelled) return;
        setUser({
          id: me.id,
          name: me.name,
          role: me.role,
          initials: initialsFromName(me.name),
          adminRole: me.adminRole ?? undefined,
          avatarUrl: getStoredAvatar(me.id),
        });
        if (!viewValidForRole(view, me.role)) setView("dashboard");
        refreshFarms();
        refreshFields();
        refreshTasks();
        refreshCropVarieties();
        refreshAnnouncements();
        refreshNotifications();
        refreshWeather();
        // "What to do this week" on the Dashboard reads the same task
        // list the Calendar shows — without this, it could still show
        // stale task dates from when the cropping was first planted,
        // since the weather-based reschedule otherwise only ran once
        // the person actually opened the Calendar page.
        refreshWeatherTasks();
        if (me.role === "Admin") {
          refreshUsers();
          refreshRegistrations();
          refreshAuditLog();
        }
      })
      .catch((err) => {
        console.error("Failed to restore session", err);
        clearToken();
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime-ish notification check: GET /notifications already computes
  // a live weather advisory from the latest forecast on every read (see
  // backend/app/routers/notifications.py), so periodically re-polling it
  // here is enough to surface a newly-issued or updated forecast advisory
  // without the person needing to reload the page.
  const lastWeatherAdvisoryRef = useRef<string | null>(null);
  useEffect(() => {
    if (!user) return;
    const FORECAST_CHECK_MS = 5 * 60 * 1000; // every 5 minutes
    const check = async () => {
      if (!api.getToken()) return;
      try {
        const list = await api.listNotifications();
        const advisory = list.find((n) => n.id.startsWith("weather-"));
        const signature = advisory ? `${advisory.id}:${advisory.body}` : null;
        // Skip the toast on the very first check after login/reload —
        // only alert when the forecast actually changes afterwards.
        if (lastWeatherAdvisoryRef.current !== null && signature !== lastWeatherAdvisoryRef.current && advisory) {
          toast(advisory.title, { description: advisory.body });
        }
        lastWeatherAdvisoryRef.current = signature;
        setNotifications(list.map(apiNotificationToAppNotification));
      } catch (err) {
        console.error("Failed to check for a new forecast", err);
      }
      refreshWeather();
      // Keep "What to do this week" (Dashboard) and the Calendar's task
      // list current too — their dates depend on the same live forecast.
      refreshWeatherTasks();
    };
    check();
    const id = setInterval(check, FORECAST_CHECK_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const value: Store = {
    user,
    authLoading,
    view,
    weather,
    weatherError,
    predictions,
    visiblePredictions,
    fields,
    visibleFields,
    addField: (f) => {
      const nf: Field = {
        ...f,
        id: localId("fld"),
        ownerId: f.ownerId ?? user?.id ?? "anonymous",
        farmer: f.farmer ?? user?.name ?? "Unknown",
        createdAt: Date.now(),
      };
      setFields((prev) => [nf, ...prev]);
      api
        .createField({
          name: nf.name, barangay: keyToLabel(nf.barangay), location: nf.location, area: nf.area,
          latitude: nf.latitude, longitude: nf.longitude, ownerId: f.ownerId,
          boundary: nf.boundary ? nf.boundary.map((p) => [p.lat, p.lng]) : null,
        })
        .then((saved) => setFields((prev) => prev.map((x) => (x.id === nf.id ? apiFieldToField(saved) : x))))
        .catch((err) => {
          console.error("Failed to save field", err);
          toast.error("Couldn't save the field — please try again.");
          setFields((prev) => prev.filter((x) => x.id !== nf.id));
        });
      return nf;
    },
    deleteField: (id) => {
      setFields((prev) => prev.filter((f) => f.id !== id));
      setPredictions((prev) => prev.filter((p) => p.fieldId !== id));
      if (!isLocalId(id)) {
        api.deleteField(id).catch((err) => {
          console.error("Failed to delete field", err);
          toast.error("Couldn't delete the field on the server.");
        });
      }
    },
    current,
    notifications,
    loadingFarms,
    loadingUsers,
    setView,
    login: (u) => {
      setUser(u);
      setView("dashboard");
      // Fire-and-forget: every screen renders its own empty/loading
      // state, so callers don't need to await sign-in on these.
      refreshFarms();
      refreshProfile();
      refreshFields();
      refreshTasks();
      refreshCropVarieties();
      refreshAnnouncements();
      refreshNotifications();
      refreshWeather();
      refreshWeatherTasks();
      if (u.role === "Admin") {
        refreshUsers();
        refreshRegistrations();
        refreshAuditLog();
      }
    },
    logout: () => {
      clearToken();
      setUser(null);
      setView("dashboard");
      setCurrent(null);
      setPredictions([]);
      setFields([]);
      setUsers([]);
      setProfile(null);
      setAnnouncements([]);
      setRegistrations([]);
      setTasks([]);
      setAuditLog([]);
    },
    addPrediction: (p) => {
      const { yieldPerHa, confidence } = score(p);
      const pred: Prediction = {
        ...p,
        id: localId("pred"),
        // Admins may enter a record on behalf of a farmer (explicit ownerId);
        // otherwise the record belongs to the signed-in user.
        ownerId: p.ownerId ?? user?.id ?? "anonymous",
        predictedYield: yieldPerHa,
        confidence,
        createdAt: Date.now(),
      };
      setPredictions((prev) => [pred, ...prev]);
      setCurrent(pred);

      api
        .submitFarmInput({
          plot_id: pred.plotId,
          field_id: pred.fieldId ? Number(pred.fieldId) : undefined,
          barangay: keyToLabel(pred.barangay),
          crop: pred.crop,
          planting_date: pred.plantingDate,
          area_ha: pred.area,
          quantity: pred.quantity,
          quantity_unit: pred.quantityUnit,
          notes: pred.notes,
          variety: pred.variety,
          technique: pred.technique,
          spacing: pred.spacing,
          seed_rate: pred.seedRate,
          ecosystem: pred.ecosystem,
          seed_type: pred.seedType,
          ph: pred.ph,
          moisture: pred.moisture,
          temperature: pred.temperature,
          rainfall: pred.rainfall,
          soil_type: "",
          predicted_yield_mt_ha: yieldPerHa,
          confidence,
          // p.ownerId (not pred.ownerId) — only present when this is a
          // genuine on-behalf submission; pred.ownerId always has a
          // value (defaulted to the signed-in user above), and sending
          // that back for an ordinary farmer submission would trip the
          // backend's staff-only check on this field.
          ownerId: p.ownerId,
        })
        .then((saved) => {
          // The server tries the trained model first (see
          // backend/app/routers/farm_input.py) and only falls back to the
          // heuristic estimate we submitted above if the model isn't
          // available for this request. Prefer whatever it actually
          // returned — that's the authoritative, potentially
          // model-backed number — instead of keeping our optimistic
          // client-side guess forever.
          const reconciled: Prediction = {
            ...pred,
            id: String(saved.input_log_id),
            inputLogId: saved.input_log_id,
            predictedYield: saved.predicted_yield_mt_ha ?? pred.predictedYield,
            confidence: saved.confidence ?? pred.confidence,
            algorithm: saved.algorithm ?? undefined,
          };
          setPredictions((prev) => prev.map((x) => (x.id === pred.id ? reconciled : x)));
          setCurrent((c) => (c && c.id === pred.id ? reconciled : c));
        })
        .catch((err) => {
          console.error("Failed to save the cropping record", err);
          // This record never made it into the database — remove the
          // optimistic copy instead of leaving something in the UI that
          // looks saved (same as any other cropping) but isn't. Show the
          // server's actual reason when we have one (e.g. a permission
          // or validation error), not just a generic network message.
          setPredictions((prev) => prev.filter((x) => x.id !== pred.id));
          setCurrent((c) => (c && c.id === pred.id ? null : c));
          toast.error(
            err instanceof api.ApiError
              ? `Couldn't save this cropping: ${err.message}`
              : "Couldn't reach the server — this cropping was not saved. Please try again."
          );
        });

      return pred;
    },
    updatePrediction: (id, patch) => {
      let updated: Prediction | null = null;
      let previous: Prediction | null = null;
      setPredictions((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          previous = p;
          const merged = { ...p, ...patch };
          const { yieldPerHa, confidence } = score(merged);
          updated = { ...merged, predictedYield: yieldPerHa, confidence };
          return updated;
        }),
      );
      setCurrent((c) => (c && c.id === id && updated ? updated : c));

      if (!updated || isLocalId(id)) {
        return Promise.resolve(updated);
      }

      const u = updated as Prediction;
      return api
        .updateFarmInput(Number(id), {
          barangay: patch.barangay ? keyToLabel(patch.barangay) : undefined,
          crop: patch.crop,
          planting_date: patch.plantingDate,
          area_ha: patch.area,
          quantity: patch.quantity,
          quantity_unit: patch.quantityUnit,
          notes: patch.notes,
          variety: patch.variety,
          technique: patch.technique,
          spacing: patch.spacing,
          seed_rate: patch.seedRate,
          ecosystem: patch.ecosystem,
          seed_type: patch.seedType,
          ph: patch.ph,
          moisture: patch.moisture,
          temperature: patch.temperature,
          rainfall: patch.rainfall,
          predicted_yield_mt_ha: u.predictedYield,
          confidence: u.confidence,
        })
        .then((saved) => {
          const reconciled: Prediction = {
            ...u,
            predictedYield: saved.predicted_yield_mt_ha ?? u.predictedYield,
            confidence: saved.confidence ?? u.confidence,
            algorithm: saved.algorithm ?? undefined,
          };
          setPredictions((prev) => prev.map((x) => (x.id === id ? reconciled : x)));
          setCurrent((c) => (c && c.id === id ? reconciled : c));
          // A changed planting date or technique may have just made
          // the backend recalculate this cropping's auto-generated
          // care schedule (see farm_input.py's update_farm_input) —
          // re-fetch so Calendar.tsx and WeekPlan.tsx (both read the
          // same `tasks` list) pick up the new due dates right away,
          // not just on the next full reload.
          refreshTasks();
          return reconciled;
        })
        .catch((err) => {
          console.error("Failed to save cropping edits", err);
          // Roll back the optimistic update — leaving it in place made
          // an actual save failure look identical to success until the
          // next reload silently revealed the server never got it.
          // Surfacing the failure by throwing (instead of swallowing it
          // behind a toast here) lets the caller — MyFarm.tsx's save()
          // — keep its modal open and show a real error the person
          // can't miss, rather than closing as if nothing went wrong.
          if (previous) {
            const revert = previous;
            setPredictions((prev) => prev.map((x) => (x.id === id ? revert : x)));
            setCurrent((c) => (c && c.id === id ? revert : c));
          }
          throw err;
        });
    },
    setCurrent: (p) => {
      if (p && user && user.role !== "Admin" && p.ownerId !== user.id) return;
      setCurrent(p);
    },
    recordHarvest: (id, actualYield, harvestDate, harvestNotes) => {
      setPredictions((prev) => prev.map((p) => (p.id === id ? { ...p, actualYield, harvestDate, harvestNotes } : p)));
      setCurrent((c) => (c && c.id === id ? { ...c, actualYield, harvestDate, harvestNotes } : c));
      if (!isLocalId(id)) {
        api.recordHarvest(Number(id), actualYield, harvestDate, harvestNotes).catch((err) => {
          console.error("Failed to save the harvest record", err);
          toast.error("Harvest saved locally, but couldn't reach the server.");
        });
      }
    },
    deletePrediction: (id) => {
      const removed = predictions.find((p) => p.id === id);
      setPredictions((prev) => prev.filter((p) => p.id !== id));
      // The backend cascades this cropping's crop_task rows too (see
      // migration 17), so drop them here as well rather than leaving
      // them to linger as "no crop" reminders until the next refresh.
      setTasks((prev) => prev.filter((t) => t.predictionId !== id));
      setCurrent((c) => (c && c.id === id ? null : c));
      if (!isLocalId(id)) {
        api.deleteFarmInput(Number(id)).catch((err) => {
          console.error("Failed to delete the cropping", err);
          toast.error("Couldn't delete the cropping on the server — please try again.");
          if (removed) setPredictions((prev) => [...prev, removed]);
        });
      }
    },
    markNotificationsRead: () => {
      setNotifications((n) => n.map((x) => ({ ...x, read: true })));
      api.markAllNotificationsRead().catch((err) => console.error("Failed to mark notifications read", err));
    },
    markOneRead: (id) => {
      setNotifications((n) => n.map((x) => (x.id === id ? { ...x, read: true } : x)));
      if (/^\d+$/.test(id)) {
        api.markNotificationRead(id).catch((err) => console.error("Failed to mark notification read", err));
      }
    },
    dismissNotification: (id) => {
      setNotifications((n) => n.filter((x) => x.id !== id));
      if (/^\d+$/.test(id)) {
        api.dismissNotificationApi(id).catch((err) => console.error("Failed to dismiss notification", err));
      }
    },
    announcements,
    hasUnseenAnnouncement,
    unseenAnnouncementCount,
    markAnnouncementsSeen,
    addAnnouncement: (a) => {
      const optimistic: Announcement = { ...a, id: localId("ann") };
      setAnnouncements((prev) => [optimistic, ...prev]);
      pushAudit({ category: "announcement", action: "Posted announcement", target: a.title });
      api
        .createAnnouncement({ title: a.title, body: a.body, date: a.date, tag: a.tag })
        .then((saved) => setAnnouncements((prev) => prev.map((x) => (x.id === optimistic.id ? apiAnnouncementToAnnouncement(saved) : x))))
        .catch((err) => {
          console.error("Failed to save announcement", err);
          toast.error("Couldn't post the announcement — please try again.");
          setAnnouncements((prev) => prev.filter((x) => x.id !== optimistic.id));
        });
    },
    updateAnnouncement: (id, patch) => {
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      const existing = announcements.find((a) => a.id === id);
      pushAudit({ category: "announcement", action: "Edited announcement", target: patch.title ?? existing?.title });
      if (!isLocalId(id)) {
        api.updateAnnouncement(id, patch).catch((err) => {
          console.error("Failed to save announcement edits", err);
          toast.error("Edits saved locally, but couldn't reach the server.");
        });
      }
    },
    deleteAnnouncement: (id) => {
      const existing = announcements.find((a) => a.id === id);
      setAnnouncements((prev) => prev.filter((a) => a.id !== id));
      pushAudit({ category: "announcement", action: "Deleted announcement", target: existing?.title });
      if (!isLocalId(id)) {
        api.deleteAnnouncement(id).catch((err) => {
          console.error("Failed to delete announcement", err);
          toast.error("Couldn't delete the announcement on the server.");
        });
      }
    },
    pinAnnouncement: (id) => {
      setAnnouncements((prev) => prev.map((a) => (a.id === id ? { ...a, pinned: !a.pinned } : a)));
      if (!isLocalId(id)) {
        api.pinAnnouncement(id).catch((err) => console.error("Failed to save pin state", err));
      }
    },
    registrations,
    addRegistration: async (r) => {
      const saved = await api.submitRegistration({
        firstName: r.firstName,
        middleName: r.middleName,
        lastName: r.lastName,
        email: r.email,
        phone: r.phone,
        address: r.address,
        barangay: keyToLabel(r.barangay),
        idFileName: r.idFileName,
        idFileData: r.idFileData ?? null,
      });
      setRegistrations((prev) => [apiRegistrationToRegistration(saved), ...prev]);
    },
    approveRegistration: async (id) => {
      const res = await api.approveRegistration(id);
      setRegistrations((prev) => prev.map((r) => (r.id === id ? apiRegistrationToRegistration(res.registration) : r)));
      const reg = registrations.find((r) => r.id === id);
      if (reg) pushAudit({ category: "verification", action: "Approved farmer registration", target: [reg.firstName, reg.lastName].filter(Boolean).join(" ") });
      return res.token;
    },
    rejectRegistration: async (id) => {
      const res = await api.rejectRegistration(id);
      setRegistrations((prev) => prev.map((r) => (r.id === id ? apiRegistrationToRegistration(res) : r)));
      const reg = registrations.find((r) => r.id === id);
      if (reg) pushAudit({ category: "verification", action: "Rejected farmer registration", target: [reg.firstName, reg.lastName].filter(Boolean).join(" ") });
    },
    completeRegistration: async (email, token, password) => {
      try {
        await api.completeRegistration(email, token, password);
        setRegistrations((prev) => prev.map((r) => (r.email.toLowerCase() === email.trim().toLowerCase() ? { ...r, completed: true } : r)));
        return true;
      } catch (err) {
        console.error("Failed to complete registration", err);
        return false;
      }
    },
    tasks,
    visibleTasks,
    cropVarieties,
    addTask: (t) => {
      const nt: CropTask = { ...t, id: localId("task"), ownerId: user?.id ?? "anonymous", done: false };
      setTasks((prev) => [...prev, nt]);
      api
        .createTask({ type: t.type, text: t.text, date: t.date, predictionId: t.predictionId })
        .then((saved) => setTasks((prev) => prev.map((x) => (x.id === nt.id ? apiTaskToTask(saved) : x))))
        .catch((err) => {
          console.error("Failed to save task", err);
          toast.error("Couldn't save the reminder — please try again.");
          setTasks((prev) => prev.filter((x) => x.id !== nt.id));
        });
    },
    toggleTask: (id) => {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
      if (!isLocalId(id)) {
        api.toggleTask(id).catch((err) => console.error("Failed to save task state", err));
      }
    },
    deleteTask: (id) => {
      setTasks((prev) => prev.filter((t) => t.id !== id));
      if (!isLocalId(id)) {
        api.deleteTask(id).catch((err) => console.error("Failed to delete task", err));
      }
    },
    refreshWeatherTasks,
    auditLog,
    logAudit: pushAudit,
    lang,
    setLang: (l: Lang) => {
      setLangState(l);
      try { localStorage.setItem("yieldshield.lang", l); } catch {}
    },
    users,
    profile,
    loadingProfile,
    refreshFarms,
    refreshUsers,
    refreshProfile,
    addUser: (u) => {
      api
        .createUser({ name: u.name, email: u.email, phone: u.phone, role: u.role, adminRole: u.adminRole, barangay: keyToLabel(u.barangay) })
        .then((res) => {
          setUsers((prev) => [apiUserToManagedUser(res.user), ...prev]);
          toast.success(`Account created. Temporary password: ${res.temporary_password}`);
        })
        .catch((err) => {
          console.error("Failed to create user", err);
          toast.error(err instanceof api.ApiError ? err.message : "Couldn't create the account — please try again.");
        });
    },
    updateUser: (id, patch) => {
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...patch } : u)));
      const body: Partial<{ name: string; email: string; phone: string; role: "Farmer" | "Admin"; adminRole: AdminRole | null; barangay: string }> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.email !== undefined) body.email = patch.email;
      if (patch.phone !== undefined) body.phone = patch.phone;
      if (patch.role !== undefined) body.role = patch.role;
      if (patch.adminRole !== undefined) body.adminRole = patch.adminRole ?? null;
      if (patch.barangay !== undefined) body.barangay = keyToLabel(patch.barangay);
      api
        .updateUser(id, body)
        .then((updated) => {
          const mu = apiUserToManagedUser(updated);
          setUsers((prev) => prev.map((x) => (x.id === id ? mu : x)));
          setProfile((prev) => (prev && prev.id === id ? mu : prev));
        })
        .catch((err) => {
          console.error("Failed to save user edits", err);
          toast.error("Edits saved locally, but couldn't reach the server.");
        });
    },
    updateProfile: async (patch) => {
      const body: Partial<{ name: string; email: string; phone: string; barangay: string }> = {};
      if (patch.name !== undefined) body.name = patch.name;
      if (patch.email !== undefined) body.email = patch.email;
      if (patch.phone !== undefined) body.phone = patch.phone;
      if (patch.barangay !== undefined) body.barangay = keyToLabel(patch.barangay);
      const updated = await api.updateMyProfile(body);
      const mu = apiUserToManagedUser(updated);
      setProfile(mu);
      // Keep the admin directory in sync if this account also appears there.
      setUsers((prev) => prev.map((x) => (x.id === mu.id ? mu : x)));
    },
    updateAvatar: async (dataUrl) => {
      // Persisted server-side now (migration 15_user_avatar.sql, PATCH
      // /users/me) so it follows the account across devices/sessions —
      // localStorage is kept only as an instant-paint cache and an
      // offline fallback if the request fails. Update every place that
      // id's User/ManagedUser is currently held so the new picture (or
      // its removal) shows up immediately everywhere.
      const id = profile?.id ?? user?.id;
      if (!id) return;
      setStoredAvatar(id, dataUrl);
      setUser((u) => (u && u.id === id ? { ...u, avatarUrl: dataUrl ?? undefined } : u));
      setProfile((p) => (p && p.id === id ? { ...p, avatarUrl: dataUrl ?? undefined } : p));
      setUsers((prev) => prev.map((x) => (x.id === id ? { ...x, avatarUrl: dataUrl ?? undefined } : x)));
      if (!api.getToken()) return; // not signed in against the real API — local-only is all we can do
      await api.updateMyProfile({ avatarUrl: dataUrl ?? "" });
    },
    toggleUserStatus: (id) => {
      const before = users.find((u) => u.id === id);
      setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: u.status === "Active" ? "Inactive" : "Active" } : u)));
      if (before) pushAudit({ category: "account", action: before.status === "Active" ? "Deactivated account" : "Reactivated account", target: before.name });
      api
        .toggleUserStatus(id)
        .then((updated) => {
          const mu = apiUserToManagedUser(updated);
          setUsers((prev) => prev.map((x) => (x.id === id ? mu : x)));
        })
        .catch((err) => {
          console.error("Failed to save status change", err);
          toast.error("Couldn't reach the server to save this — please retry.");
        });
    },
    deleteUser: (id) => {
      const before = users.find((u) => u.id === id);
      setUsers((prev) => prev.filter((u) => u.id !== id));
      setPredictions((prev) => prev.filter((p) => p.ownerId !== id));
      if (before) pushAudit({ category: "account", action: "Deleted account", target: before.name });
      api.deleteUser(id).catch((err) => {
        console.error("Failed to delete user", err);
        toast.error("Couldn't reach the server to delete this account — please retry.");
      });
    },
    // Fixed for now (see Settings.tsx, where it's shown read-only); kept
    // as a store value rather than a literal so every consumer already
    // goes through the same single source of truth if this becomes
    // user-configurable later.
    yieldUnit: "t/ha",
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used within StoreProvider");
  return c;
}
