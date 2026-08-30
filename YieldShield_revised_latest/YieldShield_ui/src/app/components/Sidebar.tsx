import { LayoutDashboard, Database, Settings, LogOut, ClipboardList, Tractor, CalendarDays, Users, Wheat, Megaphone, FlaskConical, ScrollText, Sprout } from "lucide-react";
import logo from "../../imports/Untitled_design__9_.png";
import { useStore, View, ADMIN_ROLE_META } from "../store";
import { useT } from "../i18n";
import { toast } from "sonner";

const FARMER_NAV: { id: View; tkey: string; icon: any }[] = [
  { id: "dashboard",     tkey: "nav.dashboard",     icon: LayoutDashboard },
  { id: "myfarm",        tkey: "nav.myfarm",        icon: Tractor },
  { id: "calendar",      tkey: "nav.calendar",      icon: CalendarDays },
  { id: "notifications", tkey: "nav.notifications", icon: Megaphone },
];

// Admin nav items tagged with which privileges may see them.
const ADMIN_NAV: { id: View; tkey: string; icon: any; privileges?: string[] }[] = [
  { id: "dashboard",     tkey: "nav.dashboard",     icon: LayoutDashboard },
  { id: "simulation",    tkey: "nav.simulation",    icon: FlaskConical },
  { id: "farms",         tkey: "nav.farms",         icon: Wheat },
  { id: "planning",      tkey: "nav.planning",      icon: ClipboardList, privileges: ["master", "corn", "palay"] },
  { id: "seeddist",      tkey: "nav.seedDist",      icon: Sprout,        privileges: ["master", "corn", "palay"] },
  { id: "users",         tkey: "nav.users",         icon: Users,          privileges: ["master", "verification"] },
  { id: "audit",         tkey: "nav.audit",         icon: ScrollText,     privileges: ["master"] },
  { id: "notifications", tkey: "nav.notifications", icon: Megaphone },
];

export function Sidebar({ open = false, onClose }: { open?: boolean; onClose?: () => void }) {
  const { view, setView, user, logout, notifications, unseenAnnouncementCount } = useStore();
  const t = useT();
  const isAdmin = user?.role === "Admin";
  const role = user?.adminRole ?? "master";
  const items = isAdmin
    ? ADMIN_NAV.filter((it) => !it.privileges || it.privileges.includes(role))
    : FARMER_NAV;
  // Same total the topbar bell shows — unread notifications + unseen
  // announcements — so the nav badge and the bell always agree.
  const sidebarBadge = notifications.filter((n) => !n.read).length + unseenAnnouncementCount;

  function go(v: View) {
    setView(v);
    onClose?.();
  }

  return (
    <>
      {/* Mobile backdrop */}
      {open && <div className="fixed inset-0 z-30 bg-slate-900/40 lg:hidden" onClick={onClose} />}
    <aside
      className={`w-64 shrink-0 border-r border-emerald-100 bg-white flex flex-col z-40
        fixed inset-y-0 left-0 transition-transform lg:static lg:translate-x-0
        ${open ? "translate-x-0" : "-translate-x-full"}`}
    >
      <div className="px-6 py-5 border-b border-emerald-100 flex items-center gap-2.5">
        <img src={logo} alt="YieldShield logo" className="h-9 w-9 rounded-xl object-contain" />
        <div>
          <div className="text-emerald-900 tracking-tight">YieldShield</div>
          <div className="text-xs text-emerald-600/70">Crop Intelligence</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1.5">
        {items.map((it) => {
          const Icon = it.icon;
          const isActive = view === it.id;
          return (
            <button
              key={it.id}
              onClick={() => go(it.id)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-colors text-left ${
                isActive ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50 active:bg-slate-100"
              }`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${isActive ? "text-emerald-600" : "text-slate-400"}`} />
              <span className="text-sm sm:text-base">{t(it.tkey)}</span>
              {it.id === "notifications" && sidebarBadge > 0 && (
                <span className="ml-auto h-5 min-w-5 px-1.5 rounded-full bg-rose-500 text-white text-xs flex items-center justify-center leading-none">
                  {sidebarBadge > 99 ? "99+" : sidebarBadge}
                </span>
              )}
              {isActive && !(it.id === "notifications" && sidebarBadge > 0) && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" />}
            </button>
          );
        })}

        <div className="pt-4 mt-4 border-t border-slate-100 space-y-1.5">
          <button
            onClick={() => go("settings")}
            className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl transition-colors text-left ${
              view === "settings" ? "bg-emerald-50 text-emerald-800" : "text-slate-600 hover:bg-slate-50 active:bg-slate-100"
            }`}
          >
            <Settings className={`h-5 w-5 shrink-0 ${view === "settings" ? "text-emerald-600" : "text-slate-400"}`} />
            <span className="text-sm sm:text-base">{t("nav.settings")}</span>
            {view === "settings" && <span className="ml-auto h-2 w-2 rounded-full bg-emerald-500" />}
          </button>
        </div>
      </nav>

      <div className="m-3 p-3.5 rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white">
        <div className="text-xs text-emerald-100/80">Logged in as</div>
        <div className="mt-0.5 text-sm sm:text-base">{user?.name ?? "Guest"}</div>
        <div className="text-xs text-emerald-100/70 mt-0.5">
          {user?.role === "Admin"
            ? `MAO Binalonan · ${ADMIN_ROLE_META[user.adminRole ?? "master"].short}`
            : "Binalonan Farmer"}
        </div>
        <button
          onClick={() => {
            logout();
            toast("You have been signed out.");
          }}
          className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/25 text-sm"
        >
          <LogOut className="h-4 w-4" /> {t("nav.logout")}
        </button>
      </div>
    </aside>
    </>
  );
}
