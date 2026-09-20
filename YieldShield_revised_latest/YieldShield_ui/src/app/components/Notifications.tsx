import { useState } from "react";
import {
  Bell, AlertTriangle, CloudRain, Sparkles, Wheat, Settings2, X, CheckCheck,
  Trash2, BellOff, Megaphone, Pin, PinOff, Plus, CalendarDays, Tag,
  BookOpen, ShieldAlert, Clock, Loader2, Pencil, Tractor, Sprout,
} from "lucide-react";
import { useStore, AppNotification, NotifCategory, AnnouncementTag, Announcement } from "../store";
import { useT } from "../i18n";

// ── Notification tab ─────────────────────────────────────────────────────────

// Formats a notification's raw ISO timestamp (e.g. from the backend as
// "2026-08-28T12:54:36.167974+08:00") into something a person can
// actually read: the real date/time, plus a short relative label once
// it's recent enough for that to be useful ("· 1 min. ago").
function formatNotificationTime(iso: string): { absolute: string; relative: string } {
  const date = new Date(iso);
  if (isNaN(date.getTime())) return { absolute: iso, relative: "" }; // defensive fallback for an unexpected value
  const absolute = date.toLocaleString("en-PH", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
  const diffMs = Date.now() - date.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return { absolute, relative: "just now" };
  if (mins < 60) return { absolute, relative: `${mins} min${mins === 1 ? "" : "s"}. ago` };
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return { absolute, relative: `${hrs} hr${hrs === 1 ? "" : "s"}. ago` };
  const days = Math.floor(hrs / 24);
  if (days < 7) return { absolute, relative: `${days} day${days === 1 ? "" : "s"} ago` };
  return { absolute, relative: "" }; // old enough that the date alone is clearer than "X weeks ago"
}

function categoryMeta(t: (k: string) => string): Record<NotifCategory, { label: string; icon: any; chip: string }> {
  return {
    alert:      { label: t("notif.catAlert"),      icon: AlertTriangle, chip: "bg-rose-50 text-rose-700 border-rose-200"        },
    weather:    { label: t("notif.catWeather"),    icon: CloudRain,     chip: "bg-sky-50 text-sky-700 border-sky-200"           },
    prediction: { label: t("notif.catPrediction"), icon: Sparkles,      chip: "bg-violet-50 text-violet-700 border-violet-200"  },
    harvest:    { label: t("notif.catHarvest"),    icon: Wheat,         chip: "bg-emerald-50 text-emerald-700 border-emerald-200"},
    task:       { label: t("notif.catTask"),       icon: Tractor,       chip: "bg-orange-50 text-orange-700 border-orange-200"  },
    system:     { label: t("notif.catSystem"),     icon: Settings2,     chip: "bg-slate-100 text-slate-600 border-slate-200"    },
    advisory:   { label: t("notif.catAdvisory"),   icon: Sprout,        chip: "bg-lime-50 text-lime-700 border-lime-200"        },
  };
}

function notifFilters(t: (k: string) => string): { key: "all" | NotifCategory; label: string }[] {
  return [
    { key: "all", label: t("notif.filterAll") },
    { key: "alert", label: t("notif.filterAlerts") },
    { key: "weather", label: t("notif.catWeather") },
    { key: "prediction", label: t("notif.filterPredictions") },
    { key: "harvest", label: t("notif.catHarvest") },
    { key: "task", label: t("notif.catTask") },
    { key: "advisory", label: t("notif.catAdvisory") },
    { key: "system", label: t("notif.catSystem") },
  ];
}

function NotifCard({ n, onRead, onDismiss }: { n: AppNotification; onRead: () => void; onDismiss: () => void }) {
  const t = useT();
  const meta = categoryMeta(t)[n.category];
  const Icon = meta.icon;
  const { absolute, relative } = formatNotificationTime(n.time);
  // Server-generated advisories carry a translation key + params
  // (see backend/app/advisory_types.py) — rendered in whatever
  // language is currently selected. Anything without a key (admin
  // announcements, older stored rows) falls back to its plain text.
  const displayTitle = n.titleKey ? t(n.titleKey, n.params) : n.title;
  const displayBody = n.bodyKey ? t(n.bodyKey, n.params) : n.body;
  return (
    <div className={`rounded-2xl border p-4 flex gap-3 ${n.read ? "bg-white border-slate-100" : "bg-white border-emerald-100 shadow-sm shadow-emerald-50"}`}>
      <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center mt-0.5 ${n.read ? "bg-slate-50" : "bg-emerald-50"}`}>
        <Icon className={`h-4 w-4 ${n.read ? "text-slate-400" : "text-emerald-600"}`} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            {!n.read && <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0 mt-1" />}
            <span className="text-sm text-slate-900">{displayTitle}</span>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${meta.chip}`}>{meta.label}</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {!n.read && (
              <button onClick={onRead} title={t("notif.markAsRead")} className="h-7 w-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-emerald-600">
                <CheckCheck className="h-3.5 w-3.5" />
              </button>
            )}
            <button onClick={onDismiss} title={t("notif.dismiss")} className="h-7 w-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">{displayBody}</p>
        <div className="mt-2 flex items-center gap-3 flex-wrap text-xs text-slate-400">
          <span>{absolute}{relative && ` · ${relative}`}</span>
          {n.barangay && <><span className="text-slate-200">·</span><span>{n.barangay.replace(/([a-z])([A-Z])/g, "$1 $2")}</span></>}
          {n.plotId && <><span className="text-slate-200">·</span><span>{n.plotId}</span></>}
        </div>
      </div>
    </div>
  );
}

function NotificationsTab() {
  const { notifications, markNotificationsRead, markOneRead, dismissNotification } = useStore();
  const t = useT();
  const [filter, setFilter] = useState<"all" | NotifCategory>("all");
  const unread = notifications.filter((n) => !n.read);

  const visible = notifications.filter((n) => filter === "all" || n.category === filter);
  const visibleUnread = visible.filter((n) => !n.read);
  const visibleRead   = visible.filter((n) => n.read);

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500">{notifications.length} {t("notif.totalUnread")} {unread.length} {t("notif.unread")}</div>
        <div className="flex items-center gap-2">
          {unread.length > 0 && (
            <button onClick={markNotificationsRead} className="h-8 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <CheckCheck className="h-3.5 w-3.5" /> {t("notif.markAllRead")}
            </button>
          )}
          {notifications.length > 0 && (
            <button onClick={() => notifications.forEach((n) => dismissNotification(n.id))} className="h-8 px-3 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200 flex items-center gap-1.5">
              <Trash2 className="h-3.5 w-3.5" /> {t("notif.clearAll")}
            </button>
          )}
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {notifFilters(t).map((f) => {
          const count = f.key === "all" ? notifications.length : notifications.filter((n) => n.category === f.key).length;
          return (
            <button key={f.key} onClick={() => setFilter(f.key)}
              className={`h-8 px-3 rounded-full border text-xs flex items-center gap-1.5 transition-colors ${filter === f.key ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {f.label}
              <span className={`h-4 min-w-4 px-1 rounded-full text-[10px] flex items-center justify-center ${filter === f.key ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Unread */}
      {visibleUnread.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-100" /> {t("notif.new")} <span className="h-px flex-1 bg-slate-100" />
          </div>
          {visibleUnread.map((n) => <NotifCard key={n.id} n={n} onRead={() => markOneRead(n.id)} onDismiss={() => dismissNotification(n.id)} />)}
        </div>
      )}

      {/* Read / earlier */}
      {visibleRead.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-px flex-1 bg-slate-100" /> {t("notif.earlier")} <span className="h-px flex-1 bg-slate-100" />
          </div>
          {visibleRead.map((n) => <NotifCard key={n.id} n={n} onRead={() => markOneRead(n.id)} onDismiss={() => dismissNotification(n.id)} />)}
        </div>
      )}

      {visible.length === 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white px-6 py-16 flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-slate-50 flex items-center justify-center">
            <BellOff className="h-7 w-7 text-slate-300" />
          </div>
          <div className="text-slate-500 text-sm">{t("notif.noNotifications")}</div>
        </div>
      )}
    </div>
  );
}

// ── Announcement Board ────────────────────────────────────────────────────────

function tagMeta(t: (k: string) => string): Record<AnnouncementTag, { label: string; icon: any; chip: string }> {
  return {
    advisory:  { label: t("notif.tagAdvisory"), icon: ShieldAlert,   chip: "bg-rose-50 text-rose-700 border-rose-200"          },
    program:   { label: t("notif.tagProgram"),  icon: BookOpen,      chip: "bg-violet-50 text-violet-700 border-violet-200"     },
    schedule:  { label: t("notif.tagSchedule"), icon: CalendarDays,  chip: "bg-sky-50 text-sky-700 border-sky-200"              },
    policy:    { label: t("notif.tagPolicy"),   icon: Tag,           chip: "bg-amber-50 text-amber-700 border-amber-200"        },
    reminder:  { label: t("notif.tagReminder"), icon: Clock,         chip: "bg-emerald-50 text-emerald-700 border-emerald-200"  },
  };
}

function tagFilters(t: (k: string) => string): { key: "all" | AnnouncementTag; label: string }[] {
  return [
    { key: "all", label: t("notif.filterAll") },
    { key: "advisory", label: t("notif.tagAdvisory") },
    { key: "program", label: t("notif.tagProgram") },
    { key: "schedule", label: t("notif.tagSchedule") },
    { key: "policy", label: t("notif.tagPolicy") },
    { key: "reminder", label: t("notif.tagReminder") },
  ];
}

const BLANK_POST = { title: "", body: "", tag: "advisory" as AnnouncementTag };

function AnnouncementCard({ a, isAdmin, onPin, onEdit, onDelete }: {
  a: Announcement; isAdmin: boolean; onPin: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const t = useT();
  const meta = tagMeta(t)[a.tag];
  const Icon = meta.icon;
  return (
    <div className={`bg-white rounded-2xl border p-5 space-y-3 ${a.pinned ? "border-emerald-200 shadow-sm shadow-emerald-50" : "border-slate-100"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`h-9 w-9 shrink-0 rounded-xl flex items-center justify-center ${a.pinned ? "bg-emerald-50" : "bg-slate-50"}`}>
            <Icon className={`h-4 w-4 ${a.pinned ? "text-emerald-600" : "text-slate-400"}`} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {a.pinned && (
                <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-200">
                  <Pin className="h-2.5 w-2.5" /> {t("notif.pinned")}
                </span>
              )}
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${meta.chip}`}>
                {meta.label}
              </span>
            </div>
            <div className="mt-1 text-slate-900 leading-snug">{a.title}</div>
          </div>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={onPin} title={a.pinned ? t("notif.unpin") : t("notif.pin")} className="h-7 w-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-emerald-600">
              {a.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
            </button>
            <button onClick={onEdit} title={t("notif.edit")} className="h-7 w-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-sky-600">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={onDelete} title={t("notif.delete")} className="h-7 w-7 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-rose-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-slate-600 leading-relaxed pl-12">{a.body}</p>
      <div className="pl-12 flex items-center gap-3 text-xs text-slate-400">
        <CalendarDays className="h-3 w-3" />
        <span>{new Date(a.date).toLocaleDateString("en-PH", { month: "long", day: "numeric", year: "numeric" })}</span>
        <span className="text-slate-200">·</span>
        <span>{a.author}</span>
      </div>
    </div>
  );
}

function AnnouncementBoard() {
  const { user, announcements, addAnnouncement, updateAnnouncement, deleteAnnouncement, pinAnnouncement } = useStore();
  const t = useT();
  const isAdmin = user?.role === "Admin";
  const [tagFilter, setTagFilter] = useState<"all" | AnnouncementTag>("all");
  const [composing, setComposing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [post, setPost] = useState(BLANK_POST);
  const [posting, setPosting] = useState(false);

  function startEdit(a: Announcement) {
    setEditingId(a.id);
    setPost({ title: a.title, body: a.body, tag: a.tag });
    setComposing(true);
  }
  function cancelCompose() {
    setComposing(false);
    setEditingId(null);
    setPost(BLANK_POST);
  }

  const sorted = [...announcements]
    .filter((a) => tagFilter === "all" || a.tag === tagFilter)
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!post.title.trim() || !post.body.trim()) return;
    setPosting(true);
    setTimeout(() => {
      if (editingId) {
        updateAnnouncement(editingId, { title: post.title.trim(), body: post.body.trim(), tag: post.tag });
      } else {
        addAnnouncement({
          title: post.title.trim(),
          body: post.body.trim(),
          tag: post.tag,
          date: new Date().toISOString().slice(0, 10),
          author: user?.name ?? "MAO Binalonan",
          pinned: false,
        });
      }
      cancelCompose();
      setPosting(false);
    }, 600);
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="text-xs text-slate-500">{announcements.length} {announcements.length !== 1 ? t("notif.post_plural") : t("notif.post_singular")}</div>
        {isAdmin && !composing && (
          <button onClick={() => { setEditingId(null); setPost(BLANK_POST); setComposing(true); }} className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-2">
            <Plus className="h-4 w-4" /> {t("notif.postAnnouncement")}
          </button>
        )}
      </div>

      {/* Compose form (admin only) */}
      {composing && isAdmin && (
        <form onSubmit={submit} className="bg-white border border-emerald-200 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-900">
              <Megaphone className="h-4 w-4 text-emerald-600" /> {editingId ? t("notif.editAnnouncement") : t("notif.newAnnouncement")}
            </div>
            <button type="button" onClick={cancelCompose} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div>
            <div className="text-sm text-slate-700 mb-1.5">{t("notif.tag")}</div>
            <div className="flex gap-2 flex-wrap">
              {(Object.keys(tagMeta(t)) as AnnouncementTag[]).map((tg) => (
                <button key={tg} type="button" onClick={() => setPost((p) => ({ ...p, tag: tg }))}
                  className={`h-8 px-3 rounded-full border text-xs transition-colors ${post.tag === tg ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
                  {tagMeta(t)[tg].label}
                </button>
              ))}
            </div>
          </div>

          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("notif.title")}</div>
            <input value={post.title} onChange={(e) => setPost((p) => ({ ...p, title: e.target.value }))}
              className="w-full h-11 px-3 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
              placeholder={t("notif.titlePlaceholder")} />
          </label>

          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("notif.body")}</div>
            <textarea value={post.body} onChange={(e) => setPost((p) => ({ ...p, body: e.target.value }))}
              rows={4}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm resize-none"
              placeholder={t("notif.bodyPlaceholder")} />
          </label>

          <div className="flex items-center justify-end gap-3">
            <button type="button" onClick={cancelCompose} className="px-4 h-10 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{t("notif.cancel")}</button>
            <button type="submit" disabled={posting || !post.title.trim() || !post.body.trim()}
              className="px-5 h-10 rounded-lg text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white flex items-center gap-2">
              {posting && <Loader2 className="h-4 w-4 animate-spin" />}
              {posting ? t("notif.saving") : editingId ? t("notif.saveChanges") : t("notif.post")}
            </button>
          </div>
        </form>
      )}

      {/* Tag filter pills */}
      <div className="flex items-center gap-2 flex-wrap">
        {tagFilters(t).map((f) => {
          const count = f.key === "all" ? announcements.length : announcements.filter((a) => a.tag === f.key).length;
          return (
            <button key={f.key} onClick={() => setTagFilter(f.key)}
              className={`h-8 px-3 rounded-full border text-xs flex items-center gap-1.5 transition-colors ${tagFilter === f.key ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
              {f.label}
              <span className={`h-4 min-w-4 px-1 rounded-full text-[10px] flex items-center justify-center ${tagFilter === f.key ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-500"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Announcement cards */}
      {sorted.length === 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white px-6 py-16 flex flex-col items-center gap-3">
          <div className="h-14 w-14 rounded-2xl bg-slate-50 flex items-center justify-center">
            <Megaphone className="h-7 w-7 text-slate-300" />
          </div>
          <div className="text-slate-500 text-sm">{t("notif.noAnnouncementsYet")}</div>
        </div>
      )}
      <div className="space-y-3">
        {sorted.map((a) => (
          <AnnouncementCard key={a.id} a={a} isAdmin={isAdmin}
            onPin={() => pinAnnouncement(a.id)}
            onEdit={() => startEdit(a)}
            onDelete={() => deleteAnnouncement(a.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function Notifications() {
  const { notifications, hasUnseenAnnouncement, unseenAnnouncementCount, markAnnouncementsSeen } = useStore();
  const t = useT();
  const [tab, setTab] = useState<"notif" | "board">("notif");
  const unread = notifications.filter((n) => !n.read).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-5">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <Bell className="h-5 w-5 text-emerald-600" />
        <span className="text-slate-900 text-lg tracking-tight">{t("notif.pageTitle")}</span>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 self-start">
        <button onClick={() => setTab("notif")}
          className={`h-9 px-4 rounded-lg text-sm flex items-center gap-2 transition-colors ${tab === "notif" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
          <Bell className="h-4 w-4" />
          {t("notif.tabNotifications")}
          {unread > 0 && (
            <span className="h-5 min-w-5 px-1 rounded-full bg-emerald-500 text-white text-[10px] flex items-center justify-center">{unread}</span>
          )}
        </button>
        <button onClick={() => { setTab("board"); if (hasUnseenAnnouncement) markAnnouncementsSeen(); }}
          className={`h-9 px-4 rounded-lg text-sm flex items-center gap-2 transition-colors ${tab === "board" ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-800"}`}>
          <Megaphone className="h-4 w-4" />
          {t("notif.tabBoard")}
          {unseenAnnouncementCount > 0 && (
            <span className="h-5 min-w-5 px-1 rounded-full bg-rose-500 text-white text-[10px] flex items-center justify-center">{unseenAnnouncementCount}</span>
          )}
        </button>
      </div>

      {tab === "notif"  && <NotificationsTab />}
      {tab === "board"  && <AnnouncementBoard />}
    </div>
  );
}
