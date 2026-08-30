import { useMemo, useRef, useState } from "react";
import { User, Mail, Phone, MapPin, ShieldCheck, Save, Camera, Trash2, ArrowLeft } from "lucide-react";
import { useStore } from "../store";
import { useT } from "../i18n";
import { BARANGAY_DATA } from "../data/binalonan";
import { toast } from "sonner";
import { ImageCropper } from "./ImageCropper";

const inputCls = "w-full h-11 pl-9 pr-3 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";

export function Profile() {
  const { user, profile, updateProfile, updateAvatar, setView } = useStore();
  const t = useT();
  const isAdmin = user?.role === "Admin";

  // Self-service edit goes through the real backend's "my own record"
  // endpoint (updateProfile), not the staff-only user-management one —
  // a Farmer account can't PATCH /users/{id} for anyone, including
  // themselves.
  const [name, setName]         = useState(user?.name ?? "");
  const [email, setEmail]       = useState(profile?.email ?? "");
  const [phone, setPhone]       = useState(profile?.phone ?? "");
  const [barangay, setBarangay] = useState(profile?.barangay ?? "Poblacion");

  // Sync local edit fields once the real profile has loaded (it's
  // fetched async on sign-in, so it may arrive after first render).
  useMemo(() => {
    if (profile) {
      setName(profile.name);
      setEmail(profile.email);
      setPhone(profile.phone);
      setBarangay(profile.barangay);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  function saveProfile() {
    if (!name.trim()) { toast.error(t("settings.nameEmptyError")); return; }
    if (!email.trim()) { toast.error("Email can't be empty."); return; }
    updateProfile({ name, email, phone, barangay })
      .then(() => toast.success(t("settings.profileUpdated")))
      .catch((err) => toast.error(err instanceof Error && err.message ? err.message : t("settings.profileSaveError")));
  }

  // ── Profile picture (crop-before-save) ──
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [pickedImage, setPickedImage] = useState<string | null>(null); // raw picked file, pre-crop
  const avatarUrl = user?.avatarUrl;

  function onAvatarPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // let picking the same file again re-trigger onChange
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please choose an image file."); return; }
    if (file.size > 8 * 1024 * 1024) { toast.error("That image is too large (max 8MB)."); return; }
    const reader = new FileReader();
    reader.onerror = () => toast.error("Couldn't read that file.");
    reader.onload = () => setPickedImage(reader.result as string);
    reader.readAsDataURL(file);
  }

  async function saveCroppedAvatar(dataUrl: string) {
    setAvatarBusy(true);
    try {
      await updateAvatar(dataUrl);
      toast.success("Profile picture updated.");
      setPickedImage(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update your profile picture.");
    } finally {
      setAvatarBusy(false);
    }
  }

  async function removeAvatar() {
    try {
      await updateAvatar(null);
      toast.success("Profile picture removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't remove your profile picture.");
    }
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-3xl mx-auto space-y-6">
      <button
        onClick={() => setView("settings")}
        className="text-sm text-slate-500 hover:text-slate-800 flex items-center gap-1.5"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> {t("meta.settings.title")}
      </button>

      {pickedImage && (
        <ImageCropper
          imageSrc={pickedImage}
          onCancel={() => setPickedImage(null)}
          onSave={saveCroppedAvatar}
          title="Crop your profile picture"
        />
      )}

      {/* Account summary + profile picture */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-800 text-white rounded-2xl p-6">
        <div className="flex items-center gap-4">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarBusy}
              className="h-16 w-16 rounded-2xl bg-white/15 flex items-center justify-center text-2xl overflow-hidden group relative"
              aria-label="Change profile picture"
            >
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                user?.initials ?? "?"
              )}
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                <Camera className="h-5 w-5 text-white opacity-0 group-hover:opacity-100 transition-opacity" />
              </span>
            </button>
            <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarPicked} />
            {avatarUrl && (
              <button
                type="button"
                onClick={removeAvatar}
                className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-white text-rose-600 flex items-center justify-center shadow"
                aria-label="Remove profile picture"
                title="Remove photo"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
          <div className="min-w-0">
            <div className="text-lg tracking-tight">{name || user?.name}</div>
            <div className="text-sm text-emerald-100/80">{email}</div>
            <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/15 text-xs">
              <ShieldCheck className="h-3 w-3" />
              {isAdmin ? t("settings.adminBadge") : t("settings.farmerBadge")}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => avatarInputRef.current?.click()}
          disabled={avatarBusy}
          className="mt-4 h-9 px-3 rounded-lg bg-white/15 hover:bg-white/25 text-sm flex items-center gap-2 disabled:opacity-60"
        >
          <Camera className="h-3.5 w-3.5" /> {avatarBusy ? "Uploading…" : "Edit profile picture"}
        </button>
      </div>

      {/* Profile fields */}
      <div className="bg-white border border-slate-100 rounded-2xl p-6">
        <div className="flex items-start gap-3 mb-5">
          <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <User className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-slate-900">{t("settings.profileTitle")}</div>
            <div className="text-xs text-slate-500 mt-0.5">{t("settings.profileDesc")}</div>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block col-span-2">
            <div className="text-sm text-slate-700 mb-1.5">{t("settings.fullName")}</div>
            <div className="relative">
              <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
          </label>
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("settings.email")}</div>
            <div className="relative">
              <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" className={inputCls} />
            </div>
          </label>
          <label className="block">
            <div className="text-sm text-slate-700 mb-1.5">{t("settings.phone")}</div>
            <div className="relative">
              <Phone className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" className={inputCls} />
            </div>
          </label>
          <label className="block col-span-2">
            <div className="text-sm text-slate-700 mb-1.5">{t("settings.barangay")}</div>
            <div className="relative">
              <MapPin className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <select value={barangay} onChange={(e) => setBarangay(e.target.value)} className={`${inputCls} appearance-none`}>
                {Object.entries(BARANGAY_DATA)
                  .sort((a, b) => a[1].label.localeCompare(b[1].label))
                  .map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
              </select>
            </div>
          </label>
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={saveProfile} className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-2">
            <Save className="h-4 w-4" /> {t("settings.saveChanges")}
          </button>
        </div>
      </div>
    </div>
  );
}
