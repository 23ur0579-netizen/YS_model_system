import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { Dashboard } from "./components/Dashboard";
import { YieldResult } from "./components/YieldResult";
import { CropRecommendation } from "./components/CropRecommendation";
import { Planning } from "./components/Planning";
import { SeedDistribution } from "./components/SeedDistribution";
import { MyFarm } from "./components/MyFarm";
import { Calendar } from "./components/Calendar";
import { ManageUsers } from "./components/ManageUsers";
import { AdminFarms } from "./components/AdminFarms";
import { Settings } from "./components/Settings";
import { Profile } from "./components/Profile";
import { Notifications } from "./components/Notifications";
import { Simulation } from "./components/Simulation";
import { AuditLog } from "./components/AuditLog";
import { ModelAdmin } from "./components/ModelAdmin";
import { Login } from "./components/Login";
import { StoreProvider, useStore, View } from "./store";
import { useT } from "./i18n";
import { Toaster } from "sonner";
import { useState, useEffect } from "react";

// Page title/subtitle per view, sourced from i18n (meta.<view>.title /
// meta.<view>.subtitle) so the Topbar header translates with the rest
// of the app instead of staying pinned to English.
function useMeta(t: (k: string) => string): Record<View, { title: string; subtitle: string }> {
  const views: View[] = ["dashboard", "yield", "recommend", "planning", "myfarm", "calendar", "users", "farms", "settings", "notifications", "simulation", "audit", "profile", "seeddist", "model"];
  return Object.fromEntries(views.map((v) => [v, { title: t(`meta.${v}.title`), subtitle: t(`meta.${v}.subtitle`) }])) as Record<View, { title: string; subtitle: string }>;
}

function Shell() {
  const { user, view, authLoading } = useStore();
  const t = useT();
  const META = useMeta(t);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  if (authLoading) {
    return (
      <div className="size-full flex items-center justify-center bg-slate-50 text-slate-500">
        {t("app.loading")}
      </div>
    );
  }

  if (!user) return <Login />;

  const greeting = view === "dashboard" ? `${t("app.goodDay")}, ${user.name.split(" ")[0]}` : META[view].title;
  const subtitle = view === "dashboard" ? META.dashboard.subtitle : META[view].subtitle;

  return (
    <div className="size-full flex bg-slate-50 text-slate-900">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <Topbar title={greeting} subtitle={subtitle} onMenu={() => setSidebarOpen(true)} />
        <div className="flex-1 overflow-auto">
          {view === "dashboard"  && <Dashboard />}
          {view === "yield"      && <YieldResult />}
          {view === "recommend"  && <CropRecommendation />}
          {view === "planning"   && <Planning />}
          {view === "seeddist"   && <SeedDistribution />}
          {view === "myfarm"     && <MyFarm />}
          {view === "calendar"   && <Calendar />}
          {view === "users"      && <ManageUsers />}
          {view === "farms"      && <AdminFarms />}
          {view === "settings"      && <Settings />}
          {view === "profile"       && <Profile />}
          {view === "notifications" && <Notifications />}
          {view === "simulation"    && <Simulation />}
          {view === "audit"         && <AuditLog />}
          {view === "model"         && <ModelAdmin />}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  useEffect(() => {
    document.title = "YieldShield";
  }, []);

  return (
    <StoreProvider>
      <Shell />
      <Toaster position="bottom-right" richColors closeButton />
    </StoreProvider>
  );
}
