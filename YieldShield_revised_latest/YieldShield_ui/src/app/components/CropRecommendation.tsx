import { useMemo, useState } from "react";
import { Leaf, TrendingUp, Droplets, Sun, Star } from "lucide-react";
import { useStore, moisturePctToMm } from "../store";
import { toast } from "sonner";
import { useT } from "../i18n";
import { YieldValue } from "./UnitValue";

type Season = "Wet" | "Dry";

const CROPS = [
  {
    name: "Palay (Rice)",
    sub: "NSIC Rc 222 · Hybrid Inbred",
    yieldT: 5.3,
    water: "High",
    sun: "Full",
    ideal: { ph: 6.4, moisture: 65, rainfall: 150, temp: 28 },
    seasonBoost: { Wet: 8, Dry: -6 },
    accent: "from-emerald-500 to-emerald-700",
  },
  {
    name: "Corn",
    sub: "IPB Var 6 · Yellow Hybrid",
    yieldT: 4.1,
    water: "Medium",
    sun: "Full",
    ideal: { ph: 6.2, moisture: 55, rainfall: 110, temp: 29 },
    seasonBoost: { Wet: -4, Dry: 9 },
    accent: "from-amber-500 to-amber-700",
  },
];

export function CropRecommendation() {
  const { current, visiblePredictions, setView } = useStore();
  const t = useT();
  const p = current ?? visiblePredictions[0];
  const [season, setSeason] = useState<Season>("Wet");
  const [version, setVersion] = useState(0);

  const ranked = useMemo(() => {
    const ctx = p ?? { ph: 6.4, moisture: 62, rainfall: 142, temperature: 29 };
    return [...CROPS]
      .map((c) => {
        const phS = 1 - Math.min(1, Math.abs(ctx.ph - c.ideal.ph) / 2);
        const mS = 1 - Math.min(1, Math.abs(ctx.moisture - c.ideal.moisture) / 40);
        const rS = 1 - Math.min(1, Math.abs(ctx.rainfall - c.ideal.rainfall) / 120);
        const tS = 1 - Math.min(1, Math.abs(ctx.temperature - c.ideal.temp) / 12);
        const base = (phS * 0.3 + mS * 0.3 + rS * 0.2 + tS * 0.2) * 100;
        const score = Math.max(40, Math.min(98, Math.round(base + c.seasonBoost[season])));
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p, season, version]);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6">
      <div className="bg-white border border-slate-100 rounded-2xl p-6 flex items-center justify-between">
        <div>
          <div className="text-slate-900">{t("crop.bestFor")} {p?.plotId ?? t("crop.yourPlot")}</div>
          <div className="text-sm text-slate-500 mt-1">
            {t("crop.rankedBy")} {p?.ph ?? 6.6}, {moisturePctToMm(p?.moisture ?? 68)}mm {t("crop.moistureAnd")} {(p?.barangay ?? "Poblacion").replace(/([a-z])([A-Z])/g, "$1 $2")}, Binalonan.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <select value={season} onChange={(e) => setSeason(e.target.value as Season)} className="h-10 px-3 rounded-lg border border-slate-200 text-sm bg-white">
            <option value="Wet">{t("crop.wetSeasonRange")}</option>
            <option value="Dry">{t("crop.drySeasonRange")}</option>
          </select>
          <button
            onClick={() => {
              setVersion((v) => v + 1);
              toast.success(t("crop.rerankedToast"));
            }}
            className="h-10 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm"
          >
            {t("crop.rerank")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
        {ranked.map((c, i) => (
          <div key={c.name} className="bg-white border border-slate-100 rounded-2xl overflow-hidden flex">
            <div className={`w-2 bg-gradient-to-b ${c.accent}`} />
            <div className="flex-1 p-5">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`h-12 w-12 rounded-xl bg-gradient-to-br ${c.accent} flex items-center justify-center text-white`}>
                    <Leaf className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="text-slate-900">{c.name === "Corn" ? t("common.crop.corn") : t("common.crop.palay")}</div>
                    <div className="text-xs text-slate-500">{c.sub}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs text-slate-500">{t("crop.suitability")}</div>
                  <div className="text-2xl tracking-tight text-emerald-700">{c.score}</div>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm">
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500 flex items-center gap-1"><TrendingUp className="h-3 w-3" />{t("crop.yield")}</div>
                  <div className="text-slate-800"><YieldValue valueTHa={c.yieldT} className="text-slate-800" /></div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500 flex items-center gap-1"><Droplets className="h-3 w-3" />{t("crop.water")}</div>
                  <div className="text-slate-800">{c.water === "High" ? t("crop.waterHigh") : t("crop.waterMedium")}</div>
                </div>
                <div className="rounded-lg bg-slate-50 px-3 py-2">
                  <div className="text-xs text-slate-500 flex items-center gap-1"><Sun className="h-3 w-3" />{t("crop.sun")}</div>
                  <div className="text-slate-800">{t("crop.sunFull")}</div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex flex-wrap gap-1.5">
                  {i === 0 && (
                    <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 text-emerald-800">
                      <Star className="h-3 w-3 inline -mt-0.5 mr-1" />{t("crop.recommended")}
                    </span>
                  )}
                  <span className="text-xs px-2 py-1 rounded-full bg-slate-100 text-slate-600">{season === "Wet" ? t("cal.wetSeasonShort") : t("cal.drySeasonShort")} {t("crop.season")}</span>
                </div>
                <button
                  onClick={() => {
                    toast.success(`${t("crop.planGeneratedToast")} ${c.name === "Corn" ? t("common.crop.corn") : t("common.crop.palay")}.`);
                    setView("yield");
                  }}
                  className="text-sm text-emerald-700 hover:underline"
                >
                  {t("crop.plantPlan")}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
