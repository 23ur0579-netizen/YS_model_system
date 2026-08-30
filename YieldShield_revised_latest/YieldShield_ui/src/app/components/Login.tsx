import { useRef, useState } from "react";
import { Eye, EyeOff, Loader2, ArrowLeft, Mail, CheckCircle2, User, MapPin, Lock, Home, Paperclip, X as XIcon, ChevronDown, ChevronUp, ShieldCheck, Wheat, Leaf, ClipboardCheck, Tractor } from "lucide-react";
import { useStore, getStoredAvatar } from "../store";
import { BARANGAY_DATA } from "../data/binalonan";
import * as api from "../lib/api";
import { toast } from "sonner";
import { useT } from "../i18n";
import heroImg from "../../imports/ChatGPT_Image_Jun_21__2026__07_38_40_PM.png";
import logo from "../../imports/Untitled_design__9_.png";

type Panel = "signin" | "register" | "forgot" | "reset" | "continue";

function heroCopy(t: (k: string) => string): Record<Panel, { title: string; sub: string }> {
  return {
    signin:  { title: t("login.heroSigninTitle"), sub: t("login.heroSigninSub") },
    register:{ title: t("login.heroRegisterTitle"), sub: t("login.heroRegisterSub") },
    forgot:  { title: t("login.heroForgotTitle"), sub: t("login.heroForgotSub") },
    reset:   { title: t("login.heroResetTitle"), sub: t("login.heroResetSub") },
    continue:{ title: t("login.heroContinueTitle"), sub: t("login.heroContinueSub") },
  };
}

function BrandHeader() {
  const t = useT();
  return (
    <div className="text-center mb-6">
      <img src={logo} alt="YieldShield logo" className="h-14 w-14 object-contain mx-auto mb-2" />
      <div className="tracking-tight text-3xl font-bold">
        <span className="text-emerald-600">Yield</span><span className="text-slate-800">Shield</span>
      </div>
      <div className="text-xs text-slate-400 mt-1">
        {t("login.brandTagline")}<br />{t("login.brandTagline2")}
      </div>
    </div>
  );
}

function InputRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm text-slate-700 mb-1.5">{label}</div>
      {children}
    </label>
  );
}

const cls = "w-full h-11 px-3 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";
const clsIcon = "w-full h-11 pl-9 pr-3 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm";

export function Login() {
  const { login, addRegistration, completeRegistration } = useStore();
  const t = useT();
  const initialParams = new URLSearchParams(window.location.search);
  const initialToken = initialParams.get("token");
  // Both the password-reset and registration-approval emails link back here
  // with ?token=…, but only the registration-approval one also includes
  // ?email=… (see backend/app/email_utils.py) — that's what tells them
  // apart. Without this, an approved applicant's link would land on the
  // password-reset panel, which calls a completely different endpoint for
  // an account that doesn't exist yet.
  const initialEmail = initialParams.get("email");
  const isContinueLink = !!initialToken && !!initialEmail;
  const [panel, setPanel] = useState<Panel>(isContinueLink ? "continue" : initialToken ? "reset" : "signin");

  // ── Sign-in state ──
  const [siEmail,    setSiEmail]    = useState("");
  const [siPassword, setSiPassword] = useState("");
  const [siShow,     setSiShow]     = useState(false);
  const [siRemember, setSiRemember] = useState(true);
  const [siLoading,  setSiLoading]  = useState(false);

  // ── Register state ──
  const [regFirst,      setRegFirst]      = useState("");
  const [regMiddle,     setRegMiddle]     = useState("");
  const [regLast,       setRegLast]       = useState("");
  const [regEmail,      setRegEmail]      = useState("");
  const [regPhone,      setRegPhone]      = useState("");
  const [regAddress,    setRegAddress]    = useState("");
  const [regBarangay,   setRegBarangay]   = useState("Poblacion");
  const [regIdFile,     setRegIdFile]     = useState<File | null>(null);
  const [regLoading,    setRegLoading]    = useState(false);
  const [regDone,       setRegDone]       = useState(false);
  const regIdRef = useRef<HTMLInputElement>(null);

  // ── Forgot state ──
  const [fgEmail,   setFgEmail]   = useState("");
  const [fgLoading, setFgLoading] = useState(false);
  const [fgSent,    setFgSent]    = useState(false);

  // ── Reset password state ──
  const [rsToken,   setRsToken]   = useState(isContinueLink ? "" : initialToken ?? "");
  const [rsNew,     setRsNew]     = useState("");
  const [rsConfirm, setRsConfirm] = useState("");
  const [rsShow,    setRsShow]    = useState(false);
  const [rsLoading, setRsLoading] = useState(false);
  const [rsDone,    setRsDone]    = useState(false);

  // ── Continue registration (set password after admin approval) ──
  const [ctEmail,   setCtEmail]   = useState(isContinueLink ? initialEmail ?? "" : "");
  const [ctToken,   setCtToken]   = useState(isContinueLink ? initialToken ?? "" : "");
  const [ctPass,    setCtPass]    = useState("");
  const [ctConfirm, setCtConfirm] = useState("");
  const [ctShow,    setCtShow]    = useState(false);
  const [ctLoading, setCtLoading] = useState(false);
  const [ctDone,    setCtDone]    = useState(false);

  function signIn(e: React.FormEvent) {
    e.preventDefault();
    if (!siEmail || !siPassword) { toast.error(t("login.fillAllFields")); return; }
    setSiLoading(true);
    // No Farmer/Admin tab anymore — the backend matches on
    // identifier+password alone and tells us which role the account is.
    api
      .login(siEmail.trim(), siPassword)
      .then((res) => {
        api.saveToken(res.token);
        // The API can also return "Agricultural Technician" — this UI
        // only distinguishes Farmer vs. staff, so fold it into Admin.
        const uiRole: "Farmer" | "Admin" = res.role === "Farmer" ? "Farmer" : "Admin";
        login({ id: String(res.user_id), name: res.name, role: uiRole, initials: res.initials, adminRole: res.admin_role ?? undefined, avatarUrl: getStoredAvatar(String(res.user_id)) });
        toast.success(`${t("login.welcomeBack")} ${res.name.split(" ")[0]}!`);
      })
      .catch((err: api.ApiError) => toast.error(err.message))
      .finally(() => setSiLoading(false));
  }

  function register(e: React.FormEvent) {
    e.preventDefault();
    if (!regLast.trim() || !regFirst.trim()) { toast.error(t("login.lastFirstRequired")); return; }
    if (!regEmail.trim() || !regEmail.includes("@")) { toast.error(t("login.validEmailRequired")); return; }
    if (!regAddress.trim()) { toast.error(t("login.addressRequired")); return; }
    if (!regIdFile) { toast.error(t("login.idRequired")); return; }
    setRegLoading(true);
    // No password at sign-up — this creates a pending registration for the
    // verification admin to review before a continue-registration link is
    // issued. The ID is read as a data: URL here so the actual document
    // (not just its filename) is attached for the reviewer to see.
    const reader = new FileReader();
    reader.onerror = () => {
      toast.error(t("login.regSubmitError"));
      setRegLoading(false);
    };
    reader.onload = () => {
      addRegistration({
        firstName: regFirst.trim(), middleName: regMiddle.trim(), lastName: regLast.trim(),
        email: regEmail.trim(), phone: regPhone.trim(), address: regAddress.trim(),
        barangay: regBarangay, idFileName: regIdFile.name, idFileData: reader.result as string,
      })
        .then(() => setRegDone(true))
        .catch((err) => toast.error(err instanceof api.ApiError ? err.message : t("login.regSubmitError")))
        .finally(() => setRegLoading(false));
    };
    reader.readAsDataURL(regIdFile);
  }

  function continueRegistration(e: React.FormEvent) {
    e.preventDefault();
    if (!ctEmail.trim() || !ctToken.trim()) { toast.error(t("login.enterEmailCode")); return; }
    if (ctPass.length < 8) { toast.error(t("login.passwordMin8")); return; }
    if (ctPass !== ctConfirm) { toast.error(t("login.passwordsNoMatch")); return; }
    setCtLoading(true);
    completeRegistration(ctEmail.trim(), ctToken.trim(), ctPass)
      .then((ok) => {
        if (!ok) { toast.error(t("login.noApprovedRegMatch")); return; }
        setCtDone(true);
      })
      .finally(() => setCtLoading(false));
  }

  function resetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!rsNew) { toast.error(t("login.enterNewPassword")); return; }
    if (rsNew.length < 8) { toast.error(t("login.passwordMin8")); return; }
    if (rsNew !== rsConfirm) { toast.error(t("login.passwordsNoMatch")); return; }
    if (!rsToken) { toast.error(t("login.missingResetToken")); return; }
    setRsLoading(true);
    api
      .resetPassword(rsToken, rsNew)
      .then(() => setRsDone(true))
      .catch((err: api.ApiError) => toast.error(err.message))
      .finally(() => setRsLoading(false));
  }

  function forgotPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!fgEmail) { toast.error(t("login.enterEmailAddress")); return; }
    setFgLoading(true);
    api
      .forgotPassword(fgEmail.trim())
      .then(() => setFgSent(true))
      .catch((err: api.ApiError) => toast.error(err.message))
      .finally(() => setFgLoading(false));
  }

  const hero = heroCopy(t)[panel];

  return (
    <div className="size-full grid lg:grid-cols-2 bg-slate-50">
      {/* ── Left hero panel ── */}
      <div className="hidden lg:flex flex-col justify-end p-10 text-white relative overflow-hidden">
        {/* Hero photo */}
        <img src={heroImg} alt="Farmer using a tablet in a green crop field with a tractor in the background" className="absolute inset-0 h-full w-full object-cover" />
        {/* Subtle bottom scrim so the caption stays readable while the photo reads clean */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-emerald-950/85 via-emerald-950/25 to-transparent" />

        <div className="relative space-y-3 max-w-md">
          <div className="text-2xl tracking-tight leading-snug drop-shadow">{hero.title}</div>
          <p className="text-emerald-50/90 leading-relaxed drop-shadow-sm">{hero.sub}</p>
          <div className="flex items-center gap-3 pt-2 text-xs text-emerald-100/85">
            <span>{t("login.barangaysCount")}</span>
            <span className="h-1 w-1 rounded-full bg-emerald-100/60" />
            <span>{t("login.palayAndCorn")}</span>
            <span className="h-1 w-1 rounded-full bg-emerald-100/60" />
            <span>MAO Binalonan</span>
          </div>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="flex items-center justify-center p-8 overflow-y-auto">
        <div className="w-full max-w-sm">

          {/* Consistent brand header (hidden on the create-account panel) */}
          {panel !== "register" && <BrandHeader />}

          {/* Back link */}
          {panel !== "signin" && !(panel === "reset" && rsDone) && !(panel === "continue" && ctDone) && (
            <button
              onClick={() => { setPanel("signin"); setRegDone(false); setFgSent(false); setRsDone(false); setRsNew(""); setRsConfirm(""); setCtDone(false); setCtPass(""); setCtConfirm(""); }}
              className="mb-6 flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700"
            >
              <ArrowLeft className="h-4 w-4" /> {t("login.backToSignin")}
            </button>
          )}

          {/* ── SIGN IN ── */}
          {panel === "signin" && (
            <form onSubmit={signIn} className="space-y-5">
              {/* Welcome heading with divider */}
              <div className="text-center">
                <div className="border-t border-slate-100 mb-4" />
                <div className="text-slate-900 text-2xl tracking-tight">{t("login.welcomeTitle")}</div>
                <div className="text-sm text-slate-500 mt-1">{t("login.signinSub")}</div>
              </div>

              <InputRow label={t("Email")}>
                <div className="relative">
                  <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={siEmail} onChange={(e) => setSiEmail(e.target.value)} type="email" className={clsIcon} placeholder="you@yieldsh.ph" />
                </div>
              </InputRow>

              <InputRow label={t("login.password")}>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={siPassword} onChange={(e) => setSiPassword(e.target.value)}
                    type={siShow ? "text" : "password"}
                    className="w-full h-11 pl-9 pr-10 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setSiShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {siShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </InputRow>

              {/* Remember me / Forgot */}
              <div className="flex items-center justify-between -mt-1">
                <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={siRemember}
                    onChange={(e) => setSiRemember(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-200"
                  />
                  {t("login.rememberMe")}
                </label>
                <button type="button" onClick={() => setPanel("forgot")} className="text-sm text-emerald-700 hover:underline">
                  {t("login.forgotPassword")}
                </button>
              </div>

              <button type="submit" disabled={siLoading}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm flex items-center justify-center gap-2"
              >
                {siLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {siLoading ? t("login.signingIn") : t("login.signIn")}
              </button>

              <p className="text-center text-sm text-slate-500">
                {t("login.newHere")}{" "}
                <button type="button" onClick={() => setPanel("register")} className="text-emerald-700 hover:underline">
                  {t("login.createAccount")}
                </button>
              </p>

            </form>
          )}

          {/* ── REGISTER ── */}
          {panel === "register" && !regDone && (
            <form onSubmit={register} className="space-y-4">
              <div className="mb-4">
                <div className="text-slate-900 text-2xl tracking-tight">{t("login.createAccountTitle")}</div>
                <div className="text-sm text-slate-500 mt-1">{t("login.registerSub")}</div>
              </div>

              {/* Name row — Last, First, Middle */}
              <div className="grid grid-cols-3 gap-2">
                <InputRow label={t("login.lastName")}>
                  <div className="relative">
                    <User className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input value={regLast} onChange={(e) => setRegLast(e.target.value)} type="text" className={clsIcon} placeholder="dela Cruz" />
                  </div>
                </InputRow>
                <InputRow label={t("login.firstName")}>
                  <input value={regFirst} onChange={(e) => setRegFirst(e.target.value)} type="text" className={cls} placeholder="Juan" />
                </InputRow>
                <InputRow label={t("login.middleName")}>
                  <input value={regMiddle} onChange={(e) => setRegMiddle(e.target.value)} type="text" className={cls} placeholder="Cruz (opt.)" />
                </InputRow>
              </div>

              <InputRow label={t("login.emailAddress")}>
                <div className="relative">
                  <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={regEmail} onChange={(e) => setRegEmail(e.target.value)} type="email" className={clsIcon} placeholder="you@email.com" />
                </div>
              </InputRow>

              <InputRow label={t("login.phoneNumber")}>
                <input value={regPhone} onChange={(e) => setRegPhone(e.target.value)} type="tel" className={cls} placeholder="e.g. 0917 123 4567" />
              </InputRow>

              <InputRow label={t("login.fullAddress")}>
                <div className="relative">
                  <Home className="h-4 w-4 absolute left-3 top-3 text-slate-400" />
                  <textarea
                    value={regAddress}
                    onChange={(e) => setRegAddress(e.target.value)}
                    rows={2}
                    className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm resize-none"
                    placeholder={t("login.addressPlaceholder")}
                  />
                </div>
              </InputRow>

              <InputRow label={t("login.barangay")}>
                <div className="relative">
                  <MapPin className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <select value={regBarangay} onChange={(e) => setRegBarangay(e.target.value)} className={`${clsIcon} appearance-none`}>
                    {Object.entries(BARANGAY_DATA)
                      .sort((a, b) => a[1].label.localeCompare(b[1].label))
                      .map(([key, v]) => <option key={key} value={key}>{v.label}</option>)}
                  </select>
                </div>
              </InputRow>

              {/* Government ID upload */}
              <div>
                <div className="text-sm text-slate-700 mb-1.5">{t("login.govId")} <span className="text-rose-500">*</span></div>
                <input
                  ref={regIdRef}
                  type="file"
                  accept="image/*,.pdf"
                  className="hidden"
                  onChange={(e) => setRegIdFile(e.target.files?.[0] ?? null)}
                />
                {regIdFile ? (
                  <div className="flex items-center gap-2 h-11 px-3 rounded-lg border border-emerald-300 bg-emerald-50 text-sm text-emerald-700">
                    <Paperclip className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{regIdFile.name}</span>
                    <button type="button" onClick={() => setRegIdFile(null)} className="text-slate-400 hover:text-rose-500">
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => regIdRef.current?.click()}
                    className="w-full h-11 rounded-lg border border-dashed border-slate-300 hover:border-emerald-400 hover:bg-emerald-50/50 flex items-center gap-2 px-3 text-sm text-slate-500 hover:text-emerald-700 transition-colors"
                  >
                    <Paperclip className="h-4 w-4" />
                    {t("login.clickAttachId")}
                  </button>
                )}
                <p className="text-xs text-slate-400 mt-1">{t("login.acceptedIds")}</p>
              </div>

              <div className="rounded-lg bg-sky-50 border border-sky-100 px-3 py-2.5 text-xs text-sky-700">
                {t("login.noPasswordNotice")}
              </div>

              <button type="submit" disabled={regLoading}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm flex items-center justify-center gap-2"
              >
                {regLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {regLoading ? t("login.submitting") : t("login.submitForVerification")}
              </button>

              <p className="text-center text-sm text-slate-500">
                {t("login.receivedLink")}{" "}
                <button type="button" onClick={() => setPanel("continue")} className="text-emerald-700 hover:underline">{t("login.completeRegistration")}</button>
              </p>

              <p className="text-center text-sm text-slate-500">
                {t("login.alreadyHaveAccount")}{" "}
                <button type="button" onClick={() => setPanel("signin")} className="text-emerald-700 hover:underline">{t("login.signIn")}</button>
              </p>
            </form>
          )}

          {/* ── REGISTER SUCCESS ── */}
          {panel === "register" && regDone && (
            <div className="text-center space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <div className="text-slate-900 text-xl tracking-tight">{t("login.submittedForVerification")}</div>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t("login.submittedDesc")}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-sm text-slate-600 text-left space-y-1.5">
                <div><span className="text-slate-400">{t("login.summaryName")}</span> · {[regFirst, regMiddle, regLast].filter(Boolean).join(" ")}</div>
                <div><span className="text-slate-400">{t("login.summaryEmail")}</span> · {regEmail}</div>
                <div><span className="text-slate-400">{t("login.summaryAddress")}</span> · {regAddress}</div>
                <div><span className="text-slate-400">{t("login.summaryBarangay")}</span> · {BARANGAY_DATA[regBarangay]?.label}</div>
                {regIdFile && <div><span className="text-slate-400">{t("login.summaryIdAttached")}</span> · {regIdFile.name}</div>}
              </div>
              <button onClick={() => { setPanel("signin"); setRegDone(false); }}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
              >
                {t("login.backToSignin")}
              </button>
            </div>
          )}

          {/* ── FORGOT PASSWORD ── */}
          {panel === "forgot" && !fgSent && (
            <form onSubmit={forgotPassword} className="space-y-5">
              <div className="mb-6">
                <div className="text-slate-900 text-2xl tracking-tight">{t("login.forgotPasswordTitle")}</div>
                <div className="text-sm text-slate-500 mt-1">{t("login.forgotPasswordSub")}</div>
              </div>

              <InputRow label={t("login.emailAddress")}>
                <div className="relative">
                  <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={fgEmail} onChange={(e) => setFgEmail(e.target.value)} type="email" className={clsIcon} placeholder="you@yieldsh.ph" autoFocus />
                </div>
              </InputRow>

              <button type="submit" disabled={fgLoading}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm flex items-center justify-center gap-2"
              >
                {fgLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {fgLoading ? t("login.sending") : t("login.sendResetLink")}
              </button>
            </form>
          )}

          {/* ── FORGOT SUCCESS ── */}
          {panel === "forgot" && fgSent && (
            <div className="text-center space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
                <Mail className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <div className="text-slate-900 text-xl tracking-tight">{t("login.checkYourInbox")}</div>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t("login.resetSentDesc1")} <span className="text-slate-700">{fgEmail}</span>. {t("login.resetSentDesc2")}
                </p>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-left space-y-2.5">
                {[
                  t("login.step1"),
                  t("login.step2"),
                  t("login.step3"),
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-slate-600">
                    <span className="h-5 w-5 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0 text-[10px]">{i + 1}</span>
                    {step}
                  </div>
                ))}
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-700 text-left">
                {t("login.didNotReceive")}
              </div>
              <button
                onClick={() => { setFgSent(false); setPanel("reset"); }}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
              >
                {t("login.receivedLinkSetPassword")}
              </button>
              <button onClick={() => { setPanel("signin"); setFgSent(false); setFgEmail(""); }}
                className="w-full text-sm text-slate-500 hover:text-slate-700"
              >
                {t("login.backToSignin")}
              </button>
            </div>
          )}

          {/* ── RESET PASSWORD ── */}
          {panel === "reset" && !rsDone && (
            <form onSubmit={resetPassword} className="space-y-5">
              <div className="mb-6">
                <div className="text-slate-900 text-2xl tracking-tight">{t("login.setNewPasswordTitle")}</div>
                <div className="text-sm text-slate-500 mt-1">{t("login.setNewPasswordSub")}</div>
              </div>

              {!rsToken && (
                <InputRow label={t("login.resetToken")}>
                  <input
                    value={rsToken} onChange={(e) => setRsToken(e.target.value)}
                    type="text" className={cls}
                    placeholder={t("login.pasteToken")}
                  />
                </InputRow>
              )}

              <InputRow label={t("login.newPassword")}>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={rsNew} onChange={(e) => setRsNew(e.target.value)}
                    type={rsShow ? "text" : "password"}
                    className="w-full h-11 pl-9 pr-10 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
                    placeholder={t("login.min8chars")}
                    autoFocus
                  />
                  <button type="button" onClick={() => setRsShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {rsShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </InputRow>

              {/* Password strength */}
              {rsNew.length > 0 && (
                <div className="space-y-1 -mt-1">
                  <div className="flex gap-1">
                    {[1, 2, 3, 4].map((i) => {
                      const strength = [rsNew.length >= 8, /[A-Z]/.test(rsNew), /[0-9]/.test(rsNew), /[^A-Za-z0-9]/.test(rsNew)].filter(Boolean).length;
                      return <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i <= strength ? strength < 2 ? "bg-rose-400" : strength < 3 ? "bg-amber-400" : "bg-emerald-500" : "bg-slate-100"}`} />;
                    })}
                  </div>
                  <p className="text-xs text-slate-400">
                    {(() => {
                      const s = [rsNew.length >= 8, /[A-Z]/.test(rsNew), /[0-9]/.test(rsNew), /[^A-Za-z0-9]/.test(rsNew)].filter(Boolean).length;
                      return s < 2 ? t("login.strengthWeak") : s < 3 ? t("login.strengthModerate") : s < 4 ? t("login.strengthStrong") : t("login.strengthVeryStrong");
                    })()}
                  </p>
                </div>
              )}

              <InputRow label={t("login.confirmNewPassword")}>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    value={rsConfirm} onChange={(e) => setRsConfirm(e.target.value)}
                    type={rsShow ? "text" : "password"}
                    className={`w-full h-11 pl-9 pr-3 rounded-lg border bg-white focus:ring-2 outline-none text-sm ${rsConfirm && rsConfirm !== rsNew ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-emerald-400 focus:ring-emerald-100"}`}
                    placeholder={t("login.repeatNewPassword")}
                  />
                </div>
                {rsConfirm && rsConfirm !== rsNew && (
                  <p className="text-xs text-rose-600 mt-1">{t("login.passwordsNoMatch")}</p>
                )}
                {rsConfirm && rsConfirm === rsNew && rsNew.length >= 8 && (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><CheckCircle2 className="h-3 w-3" /> {t("login.passwordsMatch")}</p>
                )}
              </InputRow>

              <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2.5 space-y-1.5">
                {[
                  { rule: t("login.ruleMin8"), pass: rsNew.length >= 8 },
                  { rule: t("login.ruleUppercase"), pass: /[A-Z]/.test(rsNew) },
                  { rule: t("login.ruleNumber"), pass: /[0-9]/.test(rsNew) },
                  { rule: t("login.ruleSpecial"), pass: /[^A-Za-z0-9]/.test(rsNew) },
                ].map((r) => (
                  <div key={r.rule} className="flex items-center gap-2 text-xs">
                    <span className={`h-4 w-4 rounded-full flex items-center justify-center shrink-0 ${r.pass ? "bg-emerald-100" : "bg-slate-100"}`}>
                      {r.pass ? <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" /> : <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />}
                    </span>
                    <span className={r.pass ? "text-emerald-700" : "text-slate-400"}>{r.rule}</span>
                  </div>
                ))}
              </div>

              <button type="submit" disabled={rsLoading}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm flex items-center justify-center gap-2"
              >
                {rsLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {rsLoading ? t("login.updatingPassword") : t("login.updatePassword")}
              </button>
            </form>
          )}

          {/* ── RESET SUCCESS ── */}
          {panel === "reset" && rsDone && (
            <div className="text-center space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <div className="text-slate-900 text-xl tracking-tight">{t("login.passwordUpdated")}</div>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t("login.passwordUpdatedDesc")}
                </p>
              </div>
              <button
                onClick={() => { setPanel("signin"); setRsDone(false); setRsNew(""); setRsConfirm(""); }}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
              >
                {t("login.signInNow")}
              </button>
            </div>
          )}

          {/* ── CONTINUE REGISTRATION (set password after approval) ── */}
          {panel === "continue" && !ctDone && (
            <form onSubmit={continueRegistration} className="space-y-5">
              <div className="mb-2">
                <div className="text-slate-900 text-2xl tracking-tight">{t("login.completeRegTitle")}</div>
                <div className="text-sm text-slate-500 mt-1">{t("login.completeRegSub")}</div>
              </div>

              <InputRow label={t("login.emailAddress")}>
                <div className="relative">
                  <Mail className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={ctEmail} onChange={(e) => setCtEmail(e.target.value)} type="email" className={clsIcon} placeholder="you@email.com" />
                </div>
              </InputRow>

              <InputRow label={t("login.verificationCode")}>
                <input value={ctToken} onChange={(e) => setCtToken(e.target.value)} type="text" className={cls} placeholder="e.g. YS-4821" />
              </InputRow>

              <InputRow label={t("login.createPassword")}>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={ctPass} onChange={(e) => setCtPass(e.target.value)} type={ctShow ? "text" : "password"}
                    className="w-full h-11 pl-9 pr-10 rounded-lg border border-slate-200 bg-white focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100 outline-none text-sm"
                    placeholder={t("login.min8chars")} />
                  <button type="button" onClick={() => setCtShow((s) => !s)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {ctShow ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </InputRow>

              <InputRow label={t("login.confirmPassword")}>
                <div className="relative">
                  <Lock className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input value={ctConfirm} onChange={(e) => setCtConfirm(e.target.value)} type={ctShow ? "text" : "password"}
                    className={`w-full h-11 pl-9 pr-3 rounded-lg border bg-white focus:ring-2 outline-none text-sm ${ctConfirm && ctConfirm !== ctPass ? "border-rose-300 focus:border-rose-400 focus:ring-rose-100" : "border-slate-200 focus:border-emerald-400 focus:ring-emerald-100"}`}
                    placeholder={t("login.repeatPassword")} />
                </div>
                {ctConfirm && ctConfirm !== ctPass && <p className="text-xs text-rose-600 mt-1">{t("login.passwordsNoMatch")}</p>}
              </InputRow>

              <button type="submit" disabled={ctLoading}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-70 text-white text-sm flex items-center justify-center gap-2">
                {ctLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {ctLoading ? t("login.activating") : t("login.activateAccount")}
              </button>
            </form>
          )}

          {/* ── CONTINUE SUCCESS ── */}
          {panel === "continue" && ctDone && (
            <div className="text-center space-y-5">
              <div className="h-16 w-16 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mx-auto">
                <CheckCircle2 className="h-8 w-8 text-emerald-600" />
              </div>
              <div>
                <div className="text-slate-900 text-xl tracking-tight">{t("login.accountActivated")}</div>
                <p className="text-sm text-slate-500 mt-2 leading-relaxed">
                  {t("login.accountActivatedDesc")}
                </p>
              </div>
              <button
                onClick={() => { setPanel("signin"); setCtDone(false); setSiEmail(ctEmail); setCtPass(""); setCtConfirm(""); setCtToken(""); }}
                className="w-full h-11 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
              >
                {t("login.signInNow")}
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
