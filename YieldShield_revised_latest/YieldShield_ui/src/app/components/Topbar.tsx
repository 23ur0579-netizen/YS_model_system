import { Bell, CloudSun, Menu, Languages } from "lucide-react";
import { useState } from "react";
import { useStore } from "../store";
import { LANGS, useT } from "../i18n";
import { pagasaRainfallCategory } from "../lib/pagasaWeather";
import { toast } from "sonner";

export function Topbar({ title, subtitle, onMenu }: { title: string; subtitle: string; onMenu?: () => void }) {
  const { user, notifications, setView, lang, setLang, weather, weatherError, unseenAnnouncementCount } = useStore();
  const t = useT();
  const unread = notifications.filter((n) => !n.read).length;
  // The bell badge is the total of things the person hasn't looked at
  // yet — unread notifications AND unseen announcements — not just
  // notifications, so the number matches what's waiting across both
  // tabs of the Notifications screen.
  const badgeCount = unread + unseenAnnouncementCount;
  const [langOpen, setLangOpen] = useState(false);
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0];

  return (
    <header className="h-16 border-b border-slate-100 bg-white px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-3 relative z-10">
      <div className="flex items-center gap-3 min-w-0">
        <button
          onClick={onMenu}
          className="lg:hidden h-9 w-9 shrink-0 rounded-lg bg-slate-50 hover:bg-slate-100 flex items-center justify-center"
          aria-label={t("topbar.openMenu")}
        >
          <Menu className="h-4 w-4 text-slate-600" />
        </button>
        <div className="min-w-0">
          <h1 className="text-slate-900 tracking-tight truncate">{title}</h1>
          <div className="text-xs text-slate-500 mt-0.5 truncate hidden sm:block">{subtitle}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3 shrink-0">
        <div className="relative">
          <button
            onClick={() => setLangOpen((o) => !o)}
            className="flex items-center gap-1.5 px-2 sm:px-3 h-9 rounded-lg bg-slate-50 border border-slate-100 hover:bg-slate-100"
            aria-label={t("topbar.changeLanguage")}
          >
            <Languages className="h-4 w-4 text-slate-600" />
            <span className="text-sm text-slate-700 uppercase">{current.code}</span>
          </button>
          {langOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setLangOpen(false)} />
              <div className="absolute right-0 mt-2 w-44 rounded-xl border border-slate-100 bg-white shadow-lg py-1 z-20">
                {LANGS.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => { setLang(l.code); setLangOpen(false); toast.success(`${t("topbar.languageSetTo")} ${l.label}`); }}
                    className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between hover:bg-slate-50 ${l.code === lang ? "text-emerald-700" : "text-slate-700"}`}
                  >
                    <span>{l.label}</span>
                    <span className="text-xs text-slate-400">{l.native}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <button
          onClick={() =>
            toast(
              weather
                ? `Binalonan: ${weather.temperature.toFixed(1)}°C, ${pagasaRainfallCategory(weather.rainfall).label} (${weather.rainfall}mm) — ${weather.source}`
                : weatherError
                ? t("topbar.weatherError")
                : t("topbar.weatherLoading")
            )
          }
          className="flex items-center gap-2 px-2 sm:px-3 h-9 rounded-lg bg-amber-50 border border-amber-100 hover:bg-amber-100"
        >
          <CloudSun className="h-4 w-4 text-amber-600" />
          <span className="text-sm text-amber-800 hidden sm:inline">
            Binalonan · {weather ? `${weather.temperature.toFixed(1)}°C` : weatherError ? "—" : "…"}
          </span>
          <span className="text-sm text-amber-800 sm:hidden">
            {weather ? `${weather.temperature.toFixed(1)}°C` : weatherError ? "—" : "…"}
          </span>
        </button>
        <button
          onClick={() => setView("notifications")}
          className="relative h-9 w-9 rounded-lg bg-slate-50 hover:bg-slate-100 flex items-center justify-center"
          aria-label={t("topbar.notifications")}
        >
          <Bell className="h-4 w-4 text-slate-600" />
          {badgeCount > 0 && (
            <span className="absolute top-1 right-1 h-4 min-w-4 px-1 rounded-full bg-emerald-500 text-white text-[9px] flex items-center justify-center leading-none">
              {badgeCount > 99 ? "99+" : badgeCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setView("profile")}
          className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-700 text-white flex items-center justify-center text-sm overflow-hidden"
          aria-label="Open profile"
        >
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            user?.initials ?? "?"
          )}
        </button>
      </div>
    </header>
  );
}
