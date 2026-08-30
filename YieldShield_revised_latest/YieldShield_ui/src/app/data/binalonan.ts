// Real agricultural production facts for Binalonan, Pangasinan.
// Derived from the Municipal Agricultural Office central production dataset
// (per-barangay soil, terrain, hydrology, land area, and historical palay yield).
// Keys match GADM NAME_3 values used across the app.

import { Sprout, Waves, Wind, Rows3, Shovel, Leaf } from "lucide-react";

export type BarangayFacts = {
  soilType: string;
  terrain: string;
  elevation: number; // meters above sea level
  waterBody: string;
  landSize: number; // total agricultural land (ha)
  irrigatedArea: number; // ha
  rainfedArea: number; // ha
  historicalYield: number; // avg palay yield MT/ha (10+ yr record)
  humidity: number; // avg %
};

export const BARANGAY_FACTS: Record<string, BarangayFacts> = {
  Balangobong: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 281.4, irrigatedArea: 55.9, rainfedArea: 25.2, historicalYield: 4.8, humidity: 80.2 },
  Bued: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 210.8, irrigatedArea: 44.7, rainfedArea: 35.8, historicalYield: 4.3, humidity: 81.4 },
  Bugayong: { soilType: "Sandy Loam / Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Aloragat River", landSize: 346.1, irrigatedArea: 14.7, rainfedArea: 44.5, historicalYield: 4.9, humidity: 80.2 },
  Camangaan: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 244.4, irrigatedArea: 11.9, rainfedArea: 74.6, historicalYield: 4.8, humidity: 80.2 },
  Canarvacanan: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 320.0, irrigatedArea: 48.0, rainfedArea: 60.0, historicalYield: 4.6, humidity: 80.6 },
  Capas: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 377.2, irrigatedArea: 60.3, rainfedArea: 116.1, historicalYield: 5.9, humidity: 80.2 },
  Cili: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Alibeng River", landSize: 264.6, irrigatedArea: 25.7, rainfedArea: 81.8, historicalYield: 3.4, humidity: 80.8 },
  Dumayat: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 266.3, irrigatedArea: 40.8, rainfedArea: 31.2, historicalYield: 3.1, humidity: 81.4 },
  Linmansangan: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 492.2, irrigatedArea: 49.6, rainfedArea: 123.1, historicalYield: 2.4, humidity: 81.4 },
  Mangcasuy: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 802.2, irrigatedArea: 37.9, rainfedArea: 171.9, historicalYield: 4.4, humidity: 80.2 },
  Moreno: { soilType: "Sandy Loam", terrain: "Moderately Sloping / Highland", elevation: 90, waterBody: "Alibeng River", landSize: 641.8, irrigatedArea: 37.9, rainfedArea: 121.7, historicalYield: 4.7, humidity: 81.1 },
  PasilengNorte: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 140.3, irrigatedArea: 35.1, rainfedArea: 16.6, historicalYield: 5.7, humidity: 80.2 },
  PasilengSur: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 415.0, irrigatedArea: 68.7, rainfedArea: 31.8, historicalYield: 5.2, humidity: 80.2 },
  Poblacion: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 120.0, irrigatedArea: 42.0, rainfedArea: 18.0, historicalYield: 5.5, humidity: 80.4 },
  SanFelipeCentral: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 452.8, irrigatedArea: 56.0, rainfedArea: 45.3, historicalYield: 4.8, humidity: 80.5 },
  SanFelipeSur: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 504.0, irrigatedArea: 55.8, rainfedArea: 38.4, historicalYield: 5.0, humidity: 80.2 },
  SanPablo: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "San Pablo Creek", landSize: 215.0, irrigatedArea: 43.1, rainfedArea: 28.7, historicalYield: 5.3, humidity: 80.2 },
  SantaCatalina: { soilType: "Fine Sand / Sandy Loam", terrain: "Moderately Sloping / Highland", elevation: 90, waterBody: "None (rainfed)", landSize: 709.8, irrigatedArea: 37.2, rainfedArea: 165.1, historicalYield: 4.9, humidity: 81.0 },
  SantaMariaNorte: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 157.1, irrigatedArea: 15.3, rainfedArea: 33.9, historicalYield: 3.9, humidity: 80.5 },
  Santiago: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 283.1, irrigatedArea: 57.9, rainfedArea: 114.0, historicalYield: 5.4, humidity: 80.3 },
  SantoNiño: { soilType: "Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 180.0, irrigatedArea: 30.0, rainfedArea: 40.0, historicalYield: 4.5, humidity: 80.6 },
  Sumabnit: { soilType: "Silty Clay Loam / Fine Sandy Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Tagamusing River", landSize: 406.6, irrigatedArea: 65.4, rainfedArea: 102.1, historicalYield: 4.9, humidity: 80.2 },
  Tabuyoc: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "None (rainfed)", landSize: 277.2, irrigatedArea: 64.7, rainfedArea: 43.0, historicalYield: 4.3, humidity: 80.2 },
  Vacante: { soilType: "Silty Clay Loam", terrain: "Flat / Lowland", elevation: 30, waterBody: "Aloragat River", landSize: 484.7, irrigatedArea: 23.2, rainfedArea: 81.3, historicalYield: 3.6, humidity: 81.4 },
};

// Season classification (PAGASA, Type I climate — western Luzon incl.
// Pangasinan/Binalonan): dry season Dec–May (cool-dry Dec–Feb, hot-dry
// Mar–May) and wet/rainy season Jun–Nov, when the southwest monsoon
// (Habagat) is active. This reflects PAGASA's current seasonal-cycle
// framing and its recent onset announcements (dry/warm season declared
// late Mar, rainy-season onset declared early Jun) — not the older
// "dry Nov–Apr / wet May–Oct" textbook split, which now runs about a
// month early against how PAGASA actually calls the seasons.
export type MonthClimate = { month: string; short: string; rainfall: number; temp: number; season: "Dry" | "Wet" };

export const MONTHLY_CLIMATE: MonthClimate[] = [
  { month: "January", short: "Jan", rainfall: 42, temp: 24.0, season: "Dry" },
  { month: "February", short: "Feb", rainfall: 38, temp: 24.8, season: "Dry" },
  { month: "March", short: "Mar", rainfall: 59, temp: 26.6, season: "Dry" },
  { month: "April", short: "Apr", rainfall: 88, temp: 28.1, season: "Dry" },
  { month: "May", short: "May", rainfall: 148, temp: 27.7, season: "Dry" },
  { month: "June", short: "Jun", rainfall: 216, temp: 27.4, season: "Wet" },
  { month: "July", short: "Jul", rainfall: 268, temp: 26.9, season: "Wet" },
  { month: "August", short: "Aug", rainfall: 292, temp: 26.7, season: "Wet" },
  { month: "September", short: "Sep", rainfall: 244, temp: 26.6, season: "Wet" },
  { month: "October", short: "Oct", rainfall: 156, temp: 26.4, season: "Wet" },
  { month: "November", short: "Nov", rainfall: 92, temp: 26.2, season: "Wet" },
  { month: "December", short: "Dec", rainfall: 55, temp: 24.6, season: "Dry" },
];

// Cropping calendar windows observed in the municipal record.
export const CROPPING_CALENDAR = {
  "Palay (Rice)": {
    dry: { plant: "Nov – Dec", harvest: "Mar – Apr", label: "Dry season (DS)" },
    wet: { plant: "Jun – Jul", harvest: "Oct – Nov", label: "Wet season (WS)" },
    maturity: 115, // days
  },
  Corn: {
    dry: { plant: "Nov – Dec", harvest: "Feb – Mar", label: "Dry season (DS)" },
    wet: { plant: "May – Jun", harvest: "Aug – Sep", label: "Wet season (WS)" },
    maturity: 105,
  },
} as const;

// Real agronomic practices recorded per crop, keyed by dominant soil family.
export const CROP_PRACTICES = {
  "Palay (Rice)": {
    "Sandy Loam": {
      technique: "Transplanting (Pindot) or Direct Seeding (Pinaghandaan)",
      tillage: "Conventional Tillage: 2 plowings + 2 harrowings; soil workable when moist",
      water: "Intermittent irrigation (Alternate Wetting and Drying — AWD); moderate retention",
    },
    "Clay Loam": {
      technique: "Transplanting (Pindot) — optimal for clay-loam paddy fields",
      tillage: "Wet Tillage (Puddling): 2 plowings + thorough harrowing under flooded condition",
      water: "Continuous flooding 2–5 cm depth during vegetative stage; drain 2 weeks before harvest",
    },
  },
  Corn: {
    "Sandy Loam": {
      technique: "Direct Seeding (Hill Planting / Furrow Method)",
      tillage: "Conventional Tillage: 1 deep plow (20–25 cm) + 1 harrowing; good tilth easily achieved",
      water: "Rainfed with supplemental furrow irrigation during dry spells",
    },
    "Clay Loam": {
      technique: "Direct Seeding (Furrow Method on Raised Beds)",
      tillage: "Deep Tillage (25 cm): 1–2 plowings; form raised beds 20–25 cm high to prevent waterlogging",
      water: "Managed drainage on raised beds; avoid waterlogging in heavy soils",
    },
  },
} as const;

export function soilFamily(soilType: string): "Sandy Loam" | "Clay Loam" {
  return /clay/i.test(soilType) ? "Clay Loam" : "Sandy Loam";
}

// ---------------------------------------------------------------------
// Moved from the now-deleted components/DataInput.tsx (the "Data Input"
// screen was removed from navigation a while back — see AdminFarms.tsx /
// MyFarm.tsx for the current add-cropping flows). These are still used
// by several screens (barangay pickers, planting-technique suggestions).
// ---------------------------------------------------------------------

// 24 barangays of Binalonan, Pangasinan — keys match GADM NAME_3 exactly
export const BARANGAY_DATA: Record<string, { label: string; ph: number; moisture: number; temperature: number; rainfall: number; soilType: string }> = {
  "Balangobong":      { label: "Balangobong",        ph: 6.0, moisture: 56, temperature: 30, rainfall: 122, soilType: "Sandy loam" },
  "Bued":             { label: "Bued",               ph: 6.2, moisture: 59, temperature: 29, rainfall: 135, soilType: "Loam" },
  "Bugayong":         { label: "Bugayong",           ph: 6.3, moisture: 61, temperature: 29, rainfall: 138, soilType: "Clay loam" },
  "Camangaan":        { label: "Camangaan",          ph: 6.4, moisture: 63, temperature: 29, rainfall: 145, soilType: "Clay loam" },
  "Canarvacanan":     { label: "Canarvacanan",       ph: 6.3, moisture: 61, temperature: 29, rainfall: 140, soilType: "Clay loam" },
  "Capas":            { label: "Capas",              ph: 6.0, moisture: 56, temperature: 30, rainfall: 120, soilType: "Sandy loam" },
  "Cili":             { label: "Cili",               ph: 6.2, moisture: 60, temperature: 29, rainfall: 134, soilType: "Loam" },
  "Dumayat":          { label: "Dumayat",            ph: 6.1, moisture: 58, temperature: 30, rainfall: 128, soilType: "Loam" },
  "Linmansangan":     { label: "Linmansangan",       ph: 6.1, moisture: 58, temperature: 30, rainfall: 128, soilType: "Loam" },
  "Mangcasuy":        { label: "Mangcasuy",          ph: 6.0, moisture: 57, temperature: 30, rainfall: 124, soilType: "Sandy loam" },
  "Moreno":           { label: "Moreno",             ph: 6.5, moisture: 66, temperature: 28, rainfall: 150, soilType: "Silt loam" },
  "PasilengNorte":    { label: "Pasileng Norte",     ph: 6.4, moisture: 64, temperature: 28, rainfall: 145, soilType: "Clay loam" },
  "PasilengSur":      { label: "Pasileng Sur",       ph: 6.3, moisture: 61, temperature: 29, rainfall: 138, soilType: "Clay loam" },
  "Poblacion":        { label: "Poblacion",          ph: 6.6, moisture: 68, temperature: 28, rainfall: 156, soilType: "Silt loam" },
  "SanFelipeCentral": { label: "San Felipe Central", ph: 6.5, moisture: 65, temperature: 28, rainfall: 150, soilType: "Silt loam" },
  "SanFelipeSur":     { label: "San Felipe Sur",     ph: 6.4, moisture: 63, temperature: 29, rainfall: 144, soilType: "Clay loam" },
  "SanPablo":         { label: "San Pablo",          ph: 6.3, moisture: 62, temperature: 29, rainfall: 140, soilType: "Clay loam" },
  "SantaCatalina":    { label: "Santa Catalina",     ph: 6.3, moisture: 62, temperature: 29, rainfall: 140, soilType: "Clay loam" },
  "SantaMariaNorte":  { label: "Santa Maria Norte",  ph: 6.2, moisture: 60, temperature: 29, rainfall: 136, soilType: "Clay loam" },
  "Santiago":         { label: "Santiago",           ph: 6.1, moisture: 59, temperature: 30, rainfall: 130, soilType: "Loam" },
  "SantoNiño":        { label: "Santo Niño",         ph: 6.1, moisture: 59, temperature: 29, rainfall: 132, soilType: "Loam" },
  "Sumabnit":         { label: "Sumabnit",           ph: 6.0, moisture: 57, temperature: 30, rainfall: 126, soilType: "Loam" },
  "Tabuyoc":          { label: "Tabuyoc",            ph: 6.2, moisture: 60, temperature: 29, rainfall: 134, soilType: "Loam" },
  "Vacante":          { label: "Vacante",            ph: 6.0, moisture: 56, temperature: 30, rainfall: 122, soilType: "Sandy loam" },
};

// Overlay the real soil families from the municipal production record so every
// module (input, planning, heatmap) references the same field-surveyed soil type.
for (const key of Object.keys(BARANGAY_DATA)) {
  const facts = BARANGAY_FACTS[key];
  if (facts) BARANGAY_DATA[key].soilType = facts.soilType;
}

export type Season = "Wet" | "Dry";

export type Technique = {
  // Canonical id — NOT translated. Used for storage (Prediction.technique),
  // form values, and yield-model lookups (TECHNIQUE_BONUS, seed-rate
  // tables in MyFarm.tsx/store.tsx). Always render `nameKey` via t(),
  // never this field, when showing text to the farmer.
  name: string;
  nameKey: string;
  descKey: string;
  icon: any;
  tagKey: string;
  tagColor: string;
  conditionsKey?: string;
  conditionsParams?: Record<string, string | number>;
  // Whether this technique fits the current season/moisture/rainfall/soil
  // inputs. All techniques for the crop are always returned (so every one
  // is selectable when adding/editing/simulating a cropping) — this flag
  // just tells the UI which ones to badge as "Not recommended" for the
  // conditions entered, rather than hiding them outright.
  recommended: boolean;
};

const TECHNIQUES: Record<"Palay (Rice)" | "Corn", (env: { moisture: number; rainfall: number; soilType: string }, season: Season) => Technique[]> = {
  "Palay (Rice)": (env, season) => {
    const list: Technique[] = [];
    list.push({
      name: "Transplanting (Pindot)",
      nameKey: "technique.transplanting.name",
      descKey: "technique.transplanting.desc",
      icon: Sprout,
      tagKey: "technique.tag.recommended",
      tagColor: "bg-emerald-100 text-emerald-800",
      recommended: season === "Wet" || env.moisture >= 65,
    });
    list.push({
      name: "Wet Direct Seeding",
      nameKey: "technique.wetDirectSeeding.name",
      descKey: "technique.wetDirectSeeding.desc",
      icon: Waves,
      tagKey: "technique.tag.highRainfall",
      tagColor: "bg-sky-100 text-sky-800",
      conditionsKey: "technique.cond.bestAtRainfall",
      conditionsParams: { rainfall: env.rainfall },
      recommended: season === "Wet" && env.rainfall >= 140,
    });
    list.push({
      name: "Dry Direct Seeding",
      nameKey: "technique.dryDirectSeeding.name",
      descKey: "technique.dryDirectSeeding.desc",
      icon: Wind,
      tagKey: "technique.tag.drySeason",
      tagColor: "bg-amber-100 text-amber-800",
      recommended: season === "Dry" || env.moisture < 65,
    });
    list.push({
      name: "System of Rice Intensification (SRI)",
      nameKey: "technique.sri.name",
      descKey: "technique.sri.desc",
      icon: Rows3,
      tagKey: "technique.tag.highYield",
      tagColor: "bg-violet-100 text-violet-800",
      recommended: true,
    });
    return list;
  },
  "Corn": (env, season) => {
    const list: Technique[] = [];
    list.push({
      name: "Hill Planting",
      nameKey: "technique.hillPlanting.name",
      descKey: "technique.hillPlanting.desc",
      icon: Shovel,
      tagKey: "technique.tag.standard",
      tagColor: "bg-amber-100 text-amber-800",
      recommended: true,
    });
    list.push({
      name: "Row Planting (Furrow Method)",
      nameKey: "technique.rowPlanting.name",
      descKey: "technique.rowPlanting.desc",
      icon: Rows3,
      tagKey: "technique.tag.mechanized",
      tagColor: "bg-sky-100 text-sky-800",
      conditionsKey: env.soilType.includes("Clay") ? "technique.cond.idealForSoil" : undefined,
      conditionsParams: env.soilType.includes("Clay") ? { soil: env.soilType } : undefined,
      recommended: true,
    });
    list.push({
      name: "Strip Cropping with Legumes",
      nameKey: "technique.stripCropping.name",
      descKey: "technique.stripCropping.desc",
      icon: Leaf,
      tagKey: "technique.tag.drySeason",
      tagColor: "bg-emerald-100 text-emerald-800",
      recommended: season === "Dry" || env.moisture < 58,
    });
    list.push({
      name: "Contour Farming",
      nameKey: "technique.contourFarming.name",
      descKey: "technique.contourFarming.desc",
      icon: Waves,
      tagKey: "technique.tag.erosionControl",
      tagColor: "bg-rose-100 text-rose-800",
      conditionsKey: "technique.cond.rainfallErosion",
      conditionsParams: { rainfall: env.rainfall },
      recommended: env.rainfall >= 130,
    });
    return list;
  },
};

// Maps a technique's canonical (English, storage-level) name back to its
// i18n display key — for the many places a Prediction/form only has the
// stored `technique` string on hand (not the full Technique object with
// nameKey already attached), e.g. summaries, toasts, "Technique: X" stats.
export const TECHNIQUE_NAME_KEYS: Record<string, string> = {
  "Transplanting (Pindot)": "technique.transplanting.name",
  "Wet Direct Seeding": "technique.wetDirectSeeding.name",
  "Dry Direct Seeding": "technique.dryDirectSeeding.name",
  "System of Rice Intensification (SRI)": "technique.sri.name",
  "Hill Planting": "technique.hillPlanting.name",
  "Row Planting (Furrow Method)": "technique.rowPlanting.name",
  "Strip Cropping with Legumes": "technique.stripCropping.name",
  "Contour Farming": "technique.contourFarming.name",
};

// Translate a stored technique name (or undefined/unrecognized) for display.
export function techniqueLabel(t: (key: string) => string, name?: string | null): string {
  if (!name) return "";
  const key = TECHNIQUE_NAME_KEYS[name];
  return key ? t(key) : name;
}

export function getPlantingTechniques(
  crop: "Palay (Rice)" | "Corn",
  env: { moisture: number; rainfall: number; soilType: string },
  season: Season,
): Technique[] {
  // Recommended-for-current-conditions techniques first (so "Best fit"
  // still lands on a genuinely fitting option), least-fitting last —
  // but every technique for the crop is always included so all of them
  // stay selectable, not just the ones that happen to fit right now.
  return [...TECHNIQUES[crop](env, season)].sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

// Derive the planting season from a month index (0 = Jan .. 11 = Dec):
// wet Jun–Nov, dry Dec–May — see the note on MonthClimate above for why.
export function seasonForMonth(monthIndex: number): Season {
  return monthIndex >= 5 && monthIndex <= 10 ? "Wet" : "Dry";
}

