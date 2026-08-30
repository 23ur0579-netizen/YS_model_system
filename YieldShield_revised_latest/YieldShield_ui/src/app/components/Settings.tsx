import { useEffect, useState } from "react";
import {
  Bell, Sprout, Wheat,
  CloudSun, Layers, Map as MapIcon, KeyRound, LogOut, Check, Languages, User as UserIcon,
} from "lucide-react";
import { useStore } from "../store";
import * as api from "../lib/api";
import { LANGS, useT } from "../i18n";
import { isPushSupported, isPushEnabled, enablePush, disablePush } from "../lib/push";
import { toast } from "sonner";

function Section({ icon: Icon, title, desc, children }: { icon: any; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-6">
      <div className="flex items-start gap-3 mb-5">
        <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
          <Icon className="h-4 w-4 text-emerald-600" />
        </div>
        <div>
          <div className="text-slate-900">{title}</div>
          <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
        </div>
      </div>
      {children}
    </div>
  );
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-6 w-11 rounded-full transition-colors relative shrink-0 ${on ? "bg-emerald-500" : "bg-slate-200"}`}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

function ToggleRow({ label, desc, on, onToggle }: { label: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm text-slate-800">{label}</div>
        <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
      </div>
      <Toggle on={on} onClick={onToggle} />
    </div>
  );
}

export function Settings() {
  const { user, profile, logout, lang, setLang, setView } = useStore();
  const t = useT();
  const isAdmin = user?.role === "Admin";

  // ── Notification prefs ──
  const [notif, setNotif] = useState({
    plantingWindow: true,
    harvestReminder: true,
    weather: true,
    announcements: isAdmin ? true : false,
  });
  const flip = (k: keyof typeof notif) => setNotif((n) => ({ ...n, [k]: !n[k] }));

  // ── Device push (real notifications, not just in-app) ──
  const [pushOn, setPushOn] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  useEffect(() => {
    isPushEnabled().then(setPushOn);
  }, []);

  async function togglePush() {
    if (pushBusy) return;
    setPushBusy(true);
    try {
      if (pushOn) {
        await disablePush();
        setPushOn(false);
        toast.success(t("settings.pushDisabled"));
      } else {
        const ok = await enablePush();
        setPushOn(ok);
        if (ok) toast.success(t("settings.pushEnabled"));
        else toast.error(t("settings.pushEnableError"));
      }
    } catch (err) {
      console.error("Failed to toggle device notifications", err);
      toast.error(t("settings.pushGenericError"));
    } finally {
      setPushBusy(false);
    }
  }

  // ── App preferences ──
  const [defaultCrop, setDefaultCrop] = useState<"Palay" | "Corn">("Palay");

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      {/* Profile — quick access to the standalone Profile screen */}
      <button
        onClick={() => setView("profile")}
        className="w-full bg-gradient-to-br from-emerald-600 to-emerald-800 text-white rounded-2xl p-6 flex items-center gap-4 text-left hover:from-emerald-700 hover:to-emerald-900 transition-colors"
      >
        <div className="h-14 w-14 rounded-2xl bg-white/15 flex items-center justify-center text-xl overflow-hidden shrink-0">
          {user?.avatarUrl ? (
            <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            user?.initials ?? "?"
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg tracking-tight">{profile?.name || user?.name}</div>
          <div className="text-sm text-emerald-100/80">{profile?.email}</div>
        </div>
        <UserIcon className="h-4 w-4 text-emerald-100/80 shrink-0" />
      </button>

      {/* Language */}
      <Section icon={Languages} title={t("settings.languageTitle")} desc={t("settings.languageDesc")}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {LANGS.map((l) => (
            <button
              key={l.code}
              onClick={() => { setLang(l.code); toast.success(`${t("settings.languageSetToast")} ${l.label}`); }}
              className={`h-14 rounded-lg border text-sm flex flex-col items-center justify-center gap-0.5 transition-colors ${lang === l.code ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              <span className="flex items-center gap-1.5">
                {l.label}
                {lang === l.code && <Check className="h-4 w-4" />}
              </span>
              <span className="text-xs text-slate-400">{l.native}</span>
            </button>
          ))}
        </div>
      </Section>

      {/* Notifications */}
      <Section icon={Bell} title={t("settings.notifTitle")} desc={t("settings.notifDesc")}>
        <div className="divide-y divide-slate-50">
          {isPushSupported() ? (
            <ToggleRow
              label={t("settings.pushDeviceLabel")}
              desc={pushBusy ? t("settings.pushWorking") : t("settings.pushDeviceDesc")}
              on={pushOn}
              onToggle={togglePush}
            />
          ) : (
            <div className="py-3 text-xs text-slate-400">
              {t("settings.pushUnsupported")}
            </div>
          )}
          <ToggleRow label={t("settings.notifPlantingWindow")} desc={t("settings.notifPlantingWindowDesc")} on={notif.plantingWindow} onToggle={() => flip("plantingWindow")} />
          <ToggleRow label={t("settings.notifHarvest")} desc={t("settings.notifHarvestDesc")} on={notif.harvestReminder} onToggle={() => flip("harvestReminder")} />
          <ToggleRow label={t("settings.notifWeather")} desc={t("settings.notifWeatherDesc")} on={notif.weather} onToggle={() => flip("weather")} />
          {isAdmin && (
            <ToggleRow label={t("settings.notifAnnouncements")} desc={t("settings.notifAnnouncementsDesc")} on={notif.announcements} onToggle={() => flip("announcements")} />
          )}
        </div>
      </Section>

      {/* Crop preferences */}
      <Section icon={Sprout} title={t("settings.cropPrefsTitle")} desc={t("settings.cropPrefsDesc")}>
        <div className="text-sm text-slate-700 mb-2">{t("settings.defaultCrop")}</div>
        <div className="grid grid-cols-2 gap-3">
          {(["Palay", "Corn"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setDefaultCrop(c)}
              className={`h-12 rounded-lg border text-sm flex items-center justify-center gap-2 transition-colors ${defaultCrop === c ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
            >
              {c === "Palay" ? <Sprout className="h-4 w-4 text-emerald-600" /> : <Wheat className="h-4 w-4 text-amber-600" />}
              {c === "Palay" ? t("common.crop.palay") : t("common.crop.corn")}
              {defaultCrop === c && <Check className="h-4 w-4 ml-1" />}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
          <div className="text-sm text-slate-700">{t("settings.yieldUnit")}</div>
          <div className="text-sm text-slate-500">{t("settings.yieldUnitValue")}</div>
        </div>
      </Section>

      {/* Data sources (read-only) */}
      <Section icon={Layers} title={t("settings.dataSourcesTitle")} desc={t("settings.dataSourcesDesc")}>
        <div className="space-y-2.5">
          {[
            { icon: CloudSun, label: t("settings.climateData"), value: t("settings.climateDataValue") },
            { icon: Layers, label: t("settings.soilParams"), value: t("settings.soilParamsValue") },
            { icon: MapIcon, label: t("settings.barangayBoundaries"), value: t("settings.barangayBoundariesValue") },
          ].map((d) => (
            <div key={d.label} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-3">
              <div className="flex items-center gap-2.5 text-sm text-slate-700">
                <d.icon className="h-4 w-4 text-slate-400" /> {d.label}
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                {d.value}
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-xs">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> {t("settings.connected")}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Security */}
      <Section icon={KeyRound} title={t("settings.securityTitle")} desc={t("settings.securityDesc")}>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => {
              const email = profile?.email;
              if (!email) { toast.error(t("settings.noEmailError")); return; }
              api.forgotPassword(email)
                .then(() => toast.success(t("settings.resetSent")))
                .catch(() => toast.error(t("settings.resetError")));
            }}
            className="flex-1 h-11 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm flex items-center justify-center gap-2"
          >
            <KeyRound className="h-4 w-4" /> {t("settings.changePassword")}
          </button>
          <button
            onClick={() => { logout(); toast(t("settings.signedOutToast")); }}
            className="flex-1 h-11 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 text-sm flex items-center justify-center gap-2"
          >
            <LogOut className="h-4 w-4" /> {t("settings.signOut")}
          </button>
        </div>
      </Section>

      <div className="text-center text-xs text-slate-400 pt-2">
        {t("settings.footer")}
      </div>
    </div>
  );
}
