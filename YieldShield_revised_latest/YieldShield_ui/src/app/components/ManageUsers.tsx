import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Users, UserPlus, Search, Shield, Sprout, MoreVertical, Pencil, Trash2, Power, X, Mail, Phone, MapPin, CheckCircle2, Tractor, Leaf, Wheat, CalendarClock, TrendingUp, KeyRound, Eye, EyeOff, RefreshCw, Copy, Check, ShieldCheck, UserCheck, Clock, FileText, Home, XCircle } from "lucide-react";
import { useStore, ManagedUser, Prediction, maturityDays, AdminRole, ADMIN_ROLE_META, Registration } from "../store";
import { BARANGAY_DATA } from "../data/binalonan";
import * as api from "../lib/api";
import { YieldValue, AreaValue } from "./UnitValue";
import { StatCard } from "./StatCard";
import { toast } from "sonner";

function addDays(dateStr: string, n: number) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d;
}
function fmt(d: Date | string) {
  return new Date(d).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
}

const barangayOptions = Object.entries(BARANGAY_DATA)
  .map(([key, v]) => ({ key, label: v.label }))
  .sort((a, b) => a.label.localeCompare(b.label));

function labelFor(key: string) {
  return BARANGAY_DATA[key]?.label ?? key.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function avatarInitials(name: string) {
  return name.split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

type Draft = {
  name: string;
  email: string;
  phone: string;
  role: "Farmer" | "Admin";
  adminRole: AdminRole;
  barangay: string;
};

const emptyDraft: Draft = { name: "", email: "", phone: "", role: "Farmer", adminRole: "corn", barangay: "Poblacion" };

export function ManageUsers() {
  const { user, users, predictions, addUser, updateUser, toggleUserStatus, deleteUser, setCurrent, setView,
          registrations, approveRegistration, rejectRegistration } = useStore();
  const isMaster = user?.adminRole === "master";
  const canVerify = isMaster || user?.adminRole === "verification";
  const pendingCount = registrations.filter((r) => r.status === "pending").length;
  const [tab, setTab] = useState<"directory" | "verification">("directory");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<"All" | "Farmer" | "Admin">("All");
  const [modal, setModal] = useState<null | { mode: "add" } | { mode: "edit"; user: ManagedUser }>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ManagedUser | null>(null);
  const [farmsFor, setFarmsFor] = useState<ManagedUser | null>(null);
  const [resetFor, setResetFor] = useState<ManagedUser | null>(null);

  const plotCount = useMemo(() => {
    const m: Record<string, number> = {};
    for (const p of predictions) m[p.ownerId] = (m[p.ownerId] ?? 0) + 1;
    return m;
  }, [predictions]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter !== "All" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        labelFor(u.barangay).toLowerCase().includes(q)
      );
    });
  }, [users, query, roleFilter]);

  const stats = {
    total: users.length,
    farmers: users.filter((u) => u.role === "Farmer").length,
    admins: users.filter((u) => u.role === "Admin").length,
    active: users.filter((u) => u.status === "Active").length,
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6" onClick={() => setMenuFor(null)}>
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard icon={Users} tint="bg-emerald-50 text-emerald-600" label="Total accounts" value={stats.total} sub={`${stats.active} active`} />
        <StatCard icon={Sprout} tint="bg-amber-50 text-amber-600" label="Farmers" value={stats.farmers} sub="registered growers" />
        <StatCard icon={Shield} tint="bg-sky-50 text-sky-600" label="Administrators" value={stats.admins} sub="MAO staff" />
        <StatCard icon={CheckCircle2} tint="bg-violet-50 text-violet-600" label="Active this cycle" value={stats.active} sub={`${stats.total - stats.active} inactive`} />
      </div>

      {/* Tabs — verification queue only for master / verification admins */}
      {canVerify && (
        <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 self-start w-fit">
          <button onClick={() => setTab("directory")}
            className={`h-9 px-4 rounded-lg text-sm flex items-center gap-2 transition-colors ${tab === "directory" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
            <Users className="h-4 w-4" /> User Directory
          </button>
          <button onClick={() => setTab("verification")}
            className={`h-9 px-4 rounded-lg text-sm flex items-center gap-2 transition-colors ${tab === "verification" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
            <UserCheck className="h-4 w-4" /> Account Verification
            {pendingCount > 0 && <span className="h-5 min-w-5 px-1 rounded-full bg-amber-500 text-white text-[10px] flex items-center justify-center">{pendingCount}</span>}
          </button>
        </div>
      )}

      {canVerify && tab === "verification" && (
        <VerificationQueue
          registrations={registrations}
          onApprove={(id, name) => {
            approveRegistration(id)
              .then((token) => toast.success(`${name} approved. Link code ${token} emailed.`))
              .catch((err) => {
                console.error("Failed to approve registration", err);
                toast.error(err instanceof api.ApiError ? `Couldn't approve: ${err.message}` : "Couldn't approve — please try again.");
              });
          }}
          onReject={(id, name) => {
            rejectRegistration(id)
              .then(() => toast(`${name}'s registration was rejected.`))
              .catch((err) => {
                console.error("Failed to reject registration", err);
                toast.error(err instanceof api.ApiError ? `Couldn't reject: ${err.message}` : "Couldn't reject — please try again.");
              });
          }}
        />
      )}

      {(!canVerify || tab === "directory") && (
      <>
      {/* Directory */}
      <div className="bg-white border border-slate-100 rounded-2xl">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-emerald-600" />
            <span className="text-slate-900">User Directory</span>
            <span className="text-xs text-slate-400">· {filtered.length} of {users.length}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, barangay…"
                className="h-9 w-64 pl-9 pr-3 rounded-lg border border-slate-200 text-sm focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none"
              />
            </div>
            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              {(["All", "Farmer", "Admin"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setRoleFilter(r)}
                  className={`px-3 py-1.5 rounded-md text-xs transition-colors ${
                    roleFilter === r ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              onClick={() => setModal({ mode: "add" })}
              className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-2"
            >
              <UserPlus className="h-4 w-4" /> Add user
            </button>
          </div>
        </div>

        {/* Scrollable table on narrow screens */}
        <div className="overflow-x-auto">
        <div className="min-w-[760px]">
        {/* Table header */}
        <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-100 text-xs text-slate-400">
          <div className="col-span-4">User</div>
          <div className="col-span-2">Role</div>
          <div className="col-span-2">Barangay</div>
          <div className="col-span-1 text-center">Plots</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-1 text-right">Actions</div>
        </div>

        <div className="divide-y divide-slate-100">
          {filtered.map((u) => (
            <div key={u.id} className="grid grid-cols-12 gap-4 px-6 py-3.5 items-center hover:bg-slate-50/60">
              <div className="col-span-4 flex items-center gap-3 min-w-0">
                <div className={`h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs overflow-hidden ${
                  u.role === "Admin" ? "bg-gradient-to-br from-sky-500 to-sky-700" : "bg-gradient-to-br from-emerald-400 to-emerald-700"
                }`}>
                  {u.adminRole === "master" ? (
                    <Shield className="h-4 w-4" />
                  ) : u.avatarUrl ? (
                    <img src={u.avatarUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    avatarInitials(u.name)
                  )}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-slate-800 truncate">{u.adminRole === "master" ? "Master Administrator" : u.name}</div>
                  <div className="text-xs text-slate-400 truncate">{u.adminRole === "master" ? "" : u.email}</div>
                </div>
              </div>
              <div className="col-span-2">
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${
                  u.role === "Admin" ? "bg-sky-50 border-sky-200 text-sky-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"
                }`}>
                  {u.role === "Admin" ? <Shield className="h-3 w-3" /> : <Sprout className="h-3 w-3" />}
                  {u.role === "Admin" ? ADMIN_ROLE_META[u.adminRole ?? "master"].short : u.role}
                </span>
              </div>
              <div className="col-span-2 text-sm text-slate-600 flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-slate-400" /> {labelFor(u.barangay)}
              </div>
              <div className="col-span-1 text-center">
                <button
                  onClick={(e) => { e.stopPropagation(); setFarmsFor(u); }}
                  disabled={(plotCount[u.id] ?? 0) === 0}
                  className="text-sm text-emerald-700 hover:underline disabled:text-slate-400 disabled:no-underline disabled:cursor-default"
                >
                  {plotCount[u.id] ?? 0}
                </button>
              </div>
              <div className="col-span-2">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (u.adminRole === "master") return;
                    toggleUserStatus(u.id);
                    toast(`${u.name} set to ${u.status === "Active" ? "Inactive" : "Active"}.`);
                  }}
                  disabled={u.adminRole === "master"}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs transition-colors ${
                    u.status === "Active" ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  } ${u.adminRole === "master" ? "cursor-default hover:bg-emerald-50" : ""}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${u.status === "Active" ? "bg-emerald-500" : "bg-slate-400"}`} />
                  {u.status}
                </button>
              </div>
              <div className="col-span-1 flex justify-end relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (menuFor === u.id) {
                      setMenuFor(null);
                      return;
                    }
                    const rect = e.currentTarget.getBoundingClientRect();
                    const menuWidth = 176; // w-44
                    const menuHeight = 190; // approx panel height
                    const spaceBelow = window.innerHeight - rect.bottom;
                    const top = spaceBelow < menuHeight
                      ? Math.max(8, rect.top - menuHeight - 6)
                      : rect.bottom + 6;
                    const left = Math.min(
                      Math.max(8, rect.right - menuWidth),
                      window.innerWidth - menuWidth - 8
                    );
                    setMenuPos({ top, left });
                    setMenuFor(u.id);
                  }}
                  className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-slate-500">No users match your search.</div>
          )}
        </div>
        </div>
        </div>
      </div>

      {menuFor && menuPos && typeof document !== "undefined" && createPortal(
        (() => {
          const u = filtered.find((x) => x.id === menuFor);
          if (!u) return null;
          return (
            <div
              className="fixed z-50 w-44 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden"
              style={{ top: menuPos.top, left: menuPos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              {u.adminRole !== "master" && (
                <button onClick={() => { setFarmsFor(u); setMenuFor(null); }} className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                  <Tractor className="h-3.5 w-3.5 text-slate-400" /> View farms
                </button>
              )}
              <button onClick={() => { setModal({ mode: "edit", user: u }); setMenuFor(null); }} className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <Pencil className="h-3.5 w-3.5 text-slate-400" /> Edit details
              </button>
              <button onClick={() => { setResetFor(u); setMenuFor(null); }} className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-slate-400" /> Reset password
              </button>
              {u.adminRole !== "master" && (
                <>
                  <button onClick={() => { toggleUserStatus(u.id); setMenuFor(null); }} className="w-full px-3 py-2.5 text-left text-sm text-slate-700 hover:bg-slate-50 flex items-center gap-2">
                    <Power className="h-3.5 w-3.5 text-slate-400" /> {u.status === "Active" ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => { setConfirmDelete(u); setMenuFor(null); }} className="w-full px-3 py-2.5 text-left text-sm text-rose-600 hover:bg-rose-50 flex items-center gap-2">
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </>
              )}
            </div>
          );
        })(),
        document.body
      )}
      </>
      )}

      {modal && (
        <UserModal
          canAssignAdmin={isMaster}
          initial={modal.mode === "edit" ? modal.user : undefined}
          onClose={() => setModal(null)}
          onSave={(draft) => {
            const payload = { ...draft, adminRole: draft.role === "Admin" ? draft.adminRole : undefined };
            if (modal.mode === "edit") {
              updateUser(modal.user.id, payload);
              toast.success(`${draft.name}'s details updated.`);
            } else {
              addUser(payload);
              toast.success(`${draft.name} added as ${draft.role === "Admin" ? ADMIN_ROLE_META[draft.adminRole].label : "Farmer"}.`);
            }
            setModal(null);
          }}
        />
      )}

      {farmsFor && (
        <FarmsModal
          user={farmsFor}
          farms={predictions.filter((p) => p.ownerId === farmsFor.id)}
          onClose={() => setFarmsFor(null)}
          onOpen={(p) => { setCurrent(p); setView("yield"); }}
        />
      )}

      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmModal
          user={confirmDelete}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => {
            deleteUser(confirmDelete.id);
            toast.success(`${confirmDelete.name} removed.`);
            setConfirmDelete(null);
          }}
        />
      )}
    </div>
  );
}

function RegistrationDetailModal({ r, onClose }: { r: Registration; onClose: () => void }) {
  const fullName = [r.firstName, r.middleName, r.lastName].filter(Boolean).join(" ");
  // The attached ID is stored as a data: URL, e.g. "data:image/jpeg;base64,..."
  // or "data:application/pdf;base64,...". Show it inline when it's a
  // viewable image, otherwise offer it as an "Open" link (PDFs open fine
  // in a new tab from a data: URL).
  const isImage = r.idFileUrl?.startsWith("data:image/");

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-emerald-600" />
            <span className="text-slate-900">Registration details</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full shrink-0 flex items-center justify-center text-white bg-gradient-to-br from-slate-400 to-slate-600">
              {(r.firstName[0] ?? "") + (r.lastName[0] ?? "")}
            </div>
            <div>
              <div className="text-slate-900">{fullName}</div>
              <div className="text-xs text-slate-400">Submitted {r.submittedAt}</div>
            </div>
          </div>

          {/* All the input data the applicant submitted, laid out clearly */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-slate-400">Email</div>
              <div className="text-sm text-slate-800 flex items-center gap-1.5 mt-0.5"><Mail className="h-3.5 w-3.5 text-slate-400" /> {r.email}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Phone</div>
              <div className="text-sm text-slate-800 flex items-center gap-1.5 mt-0.5"><Phone className="h-3.5 w-3.5 text-slate-400" /> {r.phone || "—"}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Barangay</div>
              <div className="text-sm text-slate-800 flex items-center gap-1.5 mt-0.5"><MapPin className="h-3.5 w-3.5 text-slate-400" /> {labelFor(r.barangay)}</div>
            </div>
            <div>
              <div className="text-xs text-slate-400">Status</div>
              <div className="text-sm text-slate-800 capitalize mt-0.5">{r.status}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-slate-400">Address</div>
              <div className="text-sm text-slate-800 flex items-center gap-1.5 mt-0.5"><Home className="h-3.5 w-3.5 text-slate-400" /> {r.address}</div>
            </div>
          </div>

          {r.status === "approved" && r.token && (
            <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2">
              Link code issued: <span className="font-medium">{r.token}</span>{r.completed && " · account activated"}
            </div>
          )}

          {/* Attached ID */}
          <div>
            <div className="text-xs text-slate-400 mb-1.5 flex items-center gap-1.5"><FileText className="h-3.5 w-3.5" /> Attached ID — {r.idFileName || "no file"}</div>
            {r.idFileUrl ? (
              isImage ? (
                <a href={r.idFileUrl} target="_blank" rel="noreferrer">
                  <img src={r.idFileUrl} alt="Attached ID" className="w-full max-h-80 object-contain rounded-lg border border-slate-200 bg-slate-50" />
                </a>
              ) : (
                <a href={r.idFileUrl} target="_blank" rel="noreferrer" download={r.idFileName || "id-document"}
                  className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                  <FileText className="h-3.5 w-3.5" /> Open attached document
                </a>
              )
            ) : (
              <div className="text-sm text-slate-400 italic border border-dashed border-slate-200 rounded-lg px-3 py-6 text-center">
                No document was attached to this submission.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

function VerificationQueue({ registrations, onApprove, onReject }: {
  registrations: Registration[];
  onApprove: (id: string, name: string) => void;
  onReject: (id: string, name: string) => void;
}) {
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("pending");
  const [detail, setDetail] = useState<Registration | null>(null);
  const sorted = [...registrations].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const shown = filter === "all" ? sorted : sorted.filter((r) => r.status === filter);
  const fullName = (r: Registration) => [r.lastName, r.firstName].filter(Boolean).join(", ") + (r.middleName ? ` ${r.middleName[0]}.` : "");

  const statusChip: Record<Registration["status"], string> = {
    pending:  "bg-amber-50 text-amber-700 border-amber-200",
    approved: "bg-emerald-50 text-emerald-700 border-emerald-200",
    rejected: "bg-rose-50 text-rose-700 border-rose-200",
  };

  return (
    <div className="bg-white border border-slate-100 rounded-2xl">
      <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <UserCheck className="h-4 w-4 text-emerald-600" />
          <span className="text-slate-900">Account Verification Queue</span>
          <span className="text-xs text-slate-400">· {shown.length} shown</span>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
          {(["pending", "approved", "rejected", "all"] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs capitalize transition-colors ${filter === f ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {shown.length === 0 && (
          <div className="px-6 py-12 text-center text-sm text-slate-500">No registrations in this category.</div>
        )}
        {shown.map((r) => (
          <div key={r.id} className="px-6 py-4">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-start gap-3 min-w-0">
                <div className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-white text-xs bg-gradient-to-br from-slate-400 to-slate-600">
                  {(r.firstName[0] ?? "") + (r.lastName[0] ?? "")}
                </div>
                <div className="min-w-0">
                  <div className="text-sm text-slate-800">{fullName(r)}</div>
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{r.email}</span>
                    <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{r.phone || "—"}</span>
                    <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{labelFor(r.barangay)}</span>
                  </div>
                  <div className="text-xs text-slate-400 flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                    <span className="flex items-center gap-1"><Home className="h-3 w-3" />{r.address}</span>
                    <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{r.idFileName}</span>
                    <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{r.submittedAt}</span>
                  </div>
                  {r.status === "approved" && r.token && (
                    <div className="mt-1.5 text-xs text-emerald-700">Link code issued: <span className="font-medium">{r.token}</span>{r.completed && " · account activated"}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`px-2 py-0.5 rounded-full text-xs border capitalize ${statusChip[r.status]}`}>{r.status}</span>
                <button onClick={() => setDetail(r)} className="h-8 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
                  <FileText className="h-3.5 w-3.5" /> View details
                </button>
                {r.status === "pending" && (
                  <>
                    <button onClick={() => onReject(r.id, r.firstName)} className="h-8 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 flex items-center gap-1.5">
                      <XCircle className="h-3.5 w-3.5" /> Reject
                    </button>
                    <button onClick={() => onApprove(r.id, r.firstName)} className="h-8 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Approve &amp; send link
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {detail && <RegistrationDetailModal r={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

const inputCls = "w-full h-10 px-3 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";

function UserModal({ initial, canAssignAdmin, onClose, onSave }: { initial?: ManagedUser; canAssignAdmin: boolean; onClose: () => void; onSave: (d: Draft) => void }) {
  const [draft, setDraft] = useState<Draft>(
    initial ? { name: initial.name, email: initial.email, phone: initial.phone, role: initial.role, adminRole: initial.adminRole ?? "corn", barangay: initial.barangay } : emptyDraft
  );
  function set<K extends keyof Draft>(k: K, v: Draft[K]) { setDraft((d) => ({ ...d, [k]: v })); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) { toast.error("Name is required."); return; }
    if (!draft.email.trim() || !draft.email.includes("@")) { toast.error("A valid email is required."); return; }
    onSave({ ...draft, name: draft.name.trim(), email: draft.email.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()} onSubmit={submit} className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="text-slate-900">{initial ? "Edit user" : "Add new user"}</div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-6 space-y-4">
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">Full name</div>
            <input className={inputCls} value={draft.name} onChange={(e) => set("name", e.target.value)} placeholder="Juan dela Cruz" />
          </label>
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">Email</div>
            <div className="relative">
              <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-9`} value={draft.email} onChange={(e) => set("email", e.target.value)} placeholder="name@yieldsh.ph" />
            </div>
          </label>
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">Phone</div>
            <div className="relative">
              <Phone className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input className={`${inputCls} pl-9`} value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="0917 000 0000" />
            </div>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-slate-700 mb-1.5">Role</div>
              <div className="grid grid-cols-2 gap-2">
                {(["Farmer", "Admin"] as const).map((r) => {
                  const disabled = r === "Admin" && !canAssignAdmin;
                  return (
                    <button
                      key={r}
                      type="button"
                      disabled={disabled}
                      title={disabled ? "Only a Master Administrator can create admin accounts" : undefined}
                      onClick={() => set("role", r)}
                      className={`h-10 rounded-lg border text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
                        draft.role === r ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="block">
              <div className="text-sm text-slate-700 mb-1.5">Barangay</div>
              <select className={inputCls} value={draft.barangay} onChange={(e) => set("barangay", e.target.value)}>
                {barangayOptions.map((b) => (
                  <option key={b.key} value={b.key}>{b.label}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Admin privilege — master only */}
          {draft.role === "Admin" && canAssignAdmin && (
            <div>
              <div className="text-sm text-slate-700 mb-1.5 flex items-center gap-1.5"><ShieldCheck className="h-4 w-4 text-sky-600" /> Admin privilege</div>
              <div className="grid grid-cols-2 gap-2">
                {(["master", "verification", "corn", "palay"] as AdminRole[]).map((r) => (
                  <button key={r} type="button" onClick={() => set("adminRole", r)}
                    className={`text-left rounded-lg border p-2.5 transition-colors ${draft.adminRole === r ? "border-sky-400 bg-sky-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <div className="text-xs text-slate-800">{ADMIN_ROLE_META[r].label}</div>
                    <div className="text-[10px] text-slate-400 leading-snug mt-0.5">{ADMIN_ROLE_META[r].desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
          <button type="button" onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button type="submit" className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white">
            {initial ? "Save changes" : "Add user"}
          </button>
        </div>
      </form>
    </div>
  );
}

function FarmsModal({ user, farms, onClose, onOpen }: { user: ManagedUser; farms: Prediction[]; onClose: () => void; onOpen: (p: Prediction) => void }) {
  const sorted = [...farms].sort((a, b) => new Date(b.plantingDate).getTime() - new Date(a.plantingDate).getTime());
  const totalArea = sorted.reduce((s, p) => s + p.area, 0);
  const harvestedCount = sorted.filter((p) => p.actualYield != null || p.harvestDate).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-2xl bg-white rounded-2xl shadow-xl overflow-hidden max-h-[85vh] flex flex-col">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-full shrink-0 flex items-center justify-center text-white text-sm bg-gradient-to-br from-emerald-400 to-emerald-700 overflow-hidden">
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" /> : avatarInitials(user.name)}
            </div>
            <div className="min-w-0">
              <div className="text-slate-900 flex items-center gap-2">{user.name}<span className="text-xs text-slate-400">· {labelFor(user.barangay)}</span></div>
              <div className="text-xs text-slate-500">{sorted.length} plot{sorted.length === 1 ? "" : "s"} · <AreaValue valueHa={totalArea} /> total · {harvestedCount} harvested</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        <div className="overflow-auto p-4 space-y-3">
          {sorted.length === 0 && (
            <div className="py-12 text-center text-sm text-slate-500">This user has no registered farms yet.</div>
          )}
          {sorted.map((p) => {
            const harvested = p.actualYield != null || !!p.harvestDate;
            const est = addDays(p.plantingDate, maturityDays(p.crop));
            return (
              <button
                key={p.id}
                onClick={() => onOpen(p)}
                className="w-full text-left rounded-xl border border-slate-100 hover:border-emerald-200 hover:bg-emerald-50/30 p-4 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${p.crop === "Corn" ? "bg-amber-50" : "bg-emerald-50"}`}>
                      {p.crop === "Corn" ? <Wheat className="h-4 w-4 text-amber-600" /> : <Leaf className="h-4 w-4 text-emerald-600" />}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm text-slate-800">{p.plotId}</div>
                      <div className="text-xs text-slate-400">{p.crop} · {labelFor(p.barangay)} · <AreaValue valueHa={p.area} /></div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div>
                    <div className="text-slate-400 flex items-center gap-1"><CalendarClock className="h-3 w-3" />Planted</div>
                    <div className="text-slate-700 mt-0.5">{fmt(p.plantingDate)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 flex items-center gap-1"><Wheat className="h-3 w-3" />{harvested ? "Harvested" : "Est. harvest"}</div>
                    <div className="text-slate-700 mt-0.5">{harvested && p.harvestDate ? fmt(p.harvestDate) : fmt(est)}</div>
                  </div>
                  <div>
                    <div className="text-slate-400 flex items-center gap-1"><TrendingUp className="h-3 w-3" />{harvested ? "Actual yield" : "Predicted"}</div>
                    <div className="text-slate-700 mt-0.5">
                      <YieldValue valueTHa={harvested && p.actualYield != null ? p.actualYield : p.predictedYield} className="text-slate-700" />
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50/50 text-xs text-slate-400">
          Click a plot to open its full yield prediction and harvest record.
        </div>
      </div>
    </div>
  );
}

function generateTempPassword() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const specials = "!@#$%";
  let pw = "";
  for (let i = 0; i < 9; i++) pw += chars[Math.floor(Math.random() * chars.length)];
  pw += specials[Math.floor(Math.random() * specials.length)];
  return pw;
}

function ResetPasswordModal({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const [mode, setMode] = useState<"generate" | "manual">("generate");
  const [temp, setTemp] = useState(() => generateTempPassword());
  const [manual, setManual] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);

  const newPassword = mode === "generate" ? temp : manual;

  function copy() {
    navigator.clipboard?.writeText(newPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function submit() {
    if (mode === "manual") {
      if (manual.length < 8) { toast.error("Password must be at least 8 characters."); return; }
      if (manual !== confirm) { toast.error("Passwords do not match."); return; }
    }
    // Frontend-only: no password is stored on the account, so we surface the new
    // credential to the admin and simulate notifying the farmer.
    setDone(newPassword);
    if (notify) toast.success(`Temporary password sent to ${user.email}.`);
    else toast.success(`Password reset for ${user.name}.`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
              <KeyRound className="h-4 w-4" />
            </div>
            <div>
              <div className="text-slate-900">Reset password</div>
              <div className="text-xs text-slate-500">{user.name} · {user.email}</div>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="h-4 w-4" /></button>
        </div>

        {done ? (
          <div className="p-6 space-y-5">
            <div className="flex items-start gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800">
                Password for <span className="font-medium">{user.name}</span> has been reset.
                {notify && <> An email with the new credential was sent to {user.email}.</>}
              </div>
            </div>
            <div>
              <div className="text-sm text-slate-700 mb-1.5">New password</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 h-11 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center text-sm text-slate-800 tracking-wide">{done}</code>
                <button onClick={() => { navigator.clipboard?.writeText(done); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="h-11 px-3 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm text-slate-600 flex items-center gap-1.5">
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-2">Share this securely with the farmer. They will be asked to change it on next sign-in.</p>
            </div>
            <div className="flex justify-end">
              <button onClick={onClose} className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white">Done</button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {/* Mode toggle */}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => setMode("generate")}
                className={`h-10 rounded-lg border text-sm transition-colors ${mode === "generate" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                Generate temporary
              </button>
              <button onClick={() => setMode("manual")}
                className={`h-10 rounded-lg border text-sm transition-colors ${mode === "manual" ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                Set manually
              </button>
            </div>

            {mode === "generate" ? (
              <div>
                <div className="text-sm text-slate-700 mb-1.5">Generated password</div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 h-11 px-3 rounded-lg border border-slate-200 bg-slate-50 flex items-center text-sm text-slate-800 tracking-wide">{temp}</code>
                  <button onClick={() => setTemp(generateTempPassword())} title="Regenerate"
                    className="h-11 w-11 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center">
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button onClick={copy} title="Copy"
                    className="h-11 w-11 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 flex items-center justify-center">
                    {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <label className="block">
                  <div className="text-sm text-slate-700 mb-1.5">New password</div>
                  <div className="relative">
                    <input value={manual} onChange={(e) => setManual(e.target.value)} type={show ? "text" : "password"}
                      className={`${inputCls} pr-10`} placeholder="Min. 8 characters" />
                    <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </label>
                <label className="block">
                  <div className="text-sm text-slate-700 mb-1.5">Confirm password</div>
                  <input value={confirm} onChange={(e) => setConfirm(e.target.value)} type={show ? "text" : "password"}
                    className={`${inputCls} ${confirm && confirm !== manual ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : ""}`} placeholder="Repeat password" />
                  {confirm && confirm !== manual && <p className="text-xs text-rose-600 mt-1">Passwords do not match.</p>}
                </label>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-200" />
              Email the new password to {user.email}
            </label>

            <div className="rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5 text-xs text-amber-700">
              The farmer will be prompted to set their own password the next time they sign in.
            </div>

            <div className="flex items-center justify-end gap-3 pt-1">
              <button onClick={onClose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
              <button onClick={submit} className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2">
                <KeyRound className="h-4 w-4" /> Reset password
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmModal({ user, onCancel, onConfirm }: { user: ManagedUser; onCancel: () => void; onConfirm: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onCancel}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="p-6">
          <div className="h-11 w-11 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
            <Trash2 className="h-5 w-5" />
          </div>
          <div className="mt-4 text-slate-900">Remove {user.name}?</div>
          <div className="mt-1 text-sm text-slate-500">
            This will permanently remove the account from the YieldShield directory. Their existing plot records are kept.
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-end gap-3 bg-slate-50/50">
          <button onClick={onCancel} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          <button onClick={onConfirm} className="px-5 h-10 rounded-lg text-sm bg-rose-600 hover:bg-rose-700 text-white">Remove user</button>
        </div>
      </div>
    </div>
  );
}
