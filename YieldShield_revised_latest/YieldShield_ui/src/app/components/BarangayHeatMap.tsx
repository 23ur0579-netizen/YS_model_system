import { useMemo, useRef, useState } from "react";
import { MapPin, Upload, ZoomIn, ZoomOut, Maximize2, Trophy, Layers } from "lucide-react";
import { useStore } from "../store";
import { BARANGAY_FACTS } from "../data/binalonan";
import { YieldValue, AreaValue } from "./UnitValue";

// Try to load a GeoJSON of Binalonan's barangays at build time.
// Drop the file at `src/imports/binalonan.geojson` — anything from
// GADM (NAME_3), PSA, or an OSM export will work. We probe several
// common property keys to find the barangay name.
const geoModules = import.meta.glob(
  ["../../imports/*[Bb]inalonan*.geojson", "../../imports/*[Bb]inalonan*.json"],
  { eager: true, import: "default" }
) as Record<string, any>;

const geoData: any | null = Object.values(geoModules)[0] ?? null;

const NAME_KEYS = [
  "NAME_3", "name_3", "Name_3",
  "BRGY_NAME", "BARANGAY", "barangay", "BrgyName", "brgy_name",
  "ADM4_EN", "adm4_en", "ADM4_PCODE",
  "name", "NAME", "Name",
];

function getName(props: any): string {
  for (const k of NAME_KEYS) if (props?.[k]) return String(props[k]);
  return "Unknown";
}


// Pretty-print "PasilengNorte" → "Pasileng Norte"
function displayName(raw: string) {
  return raw.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

function colorFor(yieldVal: number) {
  const stops = [
    { v: 3.0, c: [254, 226, 226] },
    { v: 4.0, c: [254, 215, 170] },
    { v: 4.8, c: [253, 230, 138] },
    { v: 5.3, c: [167, 243, 208] },
    { v: 5.8, c: [52, 211, 153] },
    { v: 6.5, c: [4, 120, 87] },
  ];
  const v = Math.max(stops[0].v, Math.min(stops[stops.length - 1].v, yieldVal));
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    if (v >= a.v && v <= b.v) {
      const t = (v - a.v) / (b.v - a.v);
      const rgb = a.c.map((ac, idx) => Math.round(ac + (b.c[idx] - ac) * t));
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
    }
  }
  return "rgb(167, 243, 208)";
}

// A smooth CSS gradient across the same stops colorFor() uses, for the
// legend bar — reads as one continuous scale instead of six flat
// blocks, which is what a proper choropleth legend looks like.
const LEGEND_GRADIENT = `linear-gradient(to right, ${[3.0, 4.0, 4.8, 5.3, 5.8, 6.5].map((v) => colorFor(v)).join(", ")})`;

const SVG_W = 720;
const SVG_H = 480;
const PAD = 24;

// Build a simple equirectangular projection sized to the GeoJSON bbox.
// Adequate at a single-municipality scale; preserves shape better with
// a latitude-based aspect correction.
function buildProjection(geo: any) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const walk = (coords: any) => {
    if (typeof coords[0] === "number") {
      const [x, y] = coords;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    } else for (const c of coords) walk(c);
  };
  for (const f of geo.features ?? []) walk(f.geometry?.coordinates ?? []);
  const midLat = (minY + maxY) / 2;
  const lonScale = Math.cos((midLat * Math.PI) / 180);
  const w = (maxX - minX) * lonScale;
  const h = maxY - minY;
  const scale = Math.min((SVG_W - PAD * 2) / w, (SVG_H - PAD * 2) / h);
  const offsetX = (SVG_W - w * scale) / 2;
  const offsetY = (SVG_H - h * scale) / 2;
  return (lon: number, lat: number) => {
    const x = offsetX + (lon - minX) * lonScale * scale;
    const y = offsetY + (maxY - lat) * scale; // flip Y for SVG
    return [x, y] as const;
  };
}

function ringToPath(ring: number[][], project: (lon: number, lat: number) => readonly [number, number]) {
  return ring
    .map(([lon, lat], i) => {
      const [x, y] = project(lon, lat);
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ") + " Z";
}

function geometryToPath(geom: any, project: (lon: number, lat: number) => readonly [number, number]) {
  if (!geom) return "";
  if (geom.type === "Polygon") {
    return geom.coordinates.map((r: number[][]) => ringToPath(r, project)).join(" ");
  }
  if (geom.type === "MultiPolygon") {
    return geom.coordinates
      .flatMap((poly: number[][][]) => poly.map((r) => ringToPath(r, project)))
      .join(" ");
  }
  return "";
}

function geometryCentroid(geom: any): [number, number] {
  let xs: number[] = [], ys: number[] = [];
  const walk = (coords: any) => {
    if (typeof coords[0] === "number") {
      xs.push(coords[0]);
      ys.push(coords[1]);
    } else for (const c of coords) walk(c);
  };
  walk(geom?.coordinates ?? []);
  if (!xs.length) return [0, 0];
  return [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
}

const MIN_VB_W = SVG_W / 6; // max 6x zoom in
const MAX_VB_W = SVG_W;     // can't zoom out past the full extent

export function BarangayHeatMap({ crop = "All" }: { crop?: "All" | "Corn" | "Palay (Rice)" }) {
  const { predictions: allPredictions } = useStore();
  // Scoped to whichever crop tab the caller (Dashboard.tsx's All/Palay/
  // Corn switch) currently has selected — previously this always used
  // every prediction regardless of that tab, so picking "Palay" still
  // showed corn plots mixed into the same map/ranking.
  const predictions = useMemo(
    () => (crop === "All" ? allPredictions : allPredictions.filter((p) => p.crop === crop)),
    [allPredictions, crop]
  );
  const [selected, setSelected] = useState<string | null>(null);
  // Hover — a lightweight tooltip that follows the cursor, separate
  // from `selected` (a click, which stays pinned and opens the fuller
  // side panel below). Tracked in container-relative pixels since the
  // tooltip is a normal HTML overlay, not part of the SVG's own
  // (zoom/pan-scaled) coordinate space.
  const [hovered, setHovered] = useState<{ name: string; label: string; y: number; hasData: boolean; x: number; y2: number } | null>(null);
  const mapWrapRef = useRef<HTMLDivElement | null>(null);

  // Zoom/pan — this map is a hand-drawn SVG (no tile provider), so pan/
  // zoom is implemented directly against the SVG's viewBox rather than
  // through a mapping library.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: SVG_W, h: SVG_H });
  const dragRef = useRef<{ startX: number; startY: number; vbX: number; vbY: number; moved: boolean } | null>(null);
  const pinchRef = useRef<{ dist: number; vbW: number } | null>(null);
  const zoomLevel = SVG_W / vb.w;

  function clampVb(next: { x: number; y: number; w: number; h: number }) {
    const w = Math.max(MIN_VB_W, Math.min(MAX_VB_W, next.w));
    const h = w * (SVG_H / SVG_W);
    // Allow panning a bit past the edges so edge barangays aren't stuck
    // against the frame, but not so far the map disappears entirely.
    const slack = SVG_W * 0.4;
    const x = Math.max(-slack, Math.min(SVG_W - w + slack, next.x));
    const y = Math.max(-slack * (SVG_H / SVG_W), Math.min(SVG_H - h + slack * (SVG_H / SVG_W), next.y));
    return { x, y, w, h };
  }

  function zoomAround(cx: number, cy: number, factor: number) {
    setVb((cur) => {
      const w = cur.w / factor;
      const h = cur.h / factor;
      // Keep the point under the cursor/pinch-center fixed while scaling.
      const x = cx - (cx - cur.x) * (w / cur.w);
      const y = cy - (cy - cur.y) * (h / cur.h);
      return clampVb({ x, y, w, h });
    });
  }

  function screenToSvg(clientX: number, clientY: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: vb.x + ((clientX - rect.left) / rect.width) * vb.w,
      y: vb.y + ((clientY - rect.top) / rect.height) * vb.h,
    };
  }

  function handleWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const { x, y } = screenToSvg(e.clientX, e.clientY);
    zoomAround(x, y, e.deltaY < 0 ? 1.25 : 1 / 1.25);
  }

  function handleMouseDown(e: React.MouseEvent<SVGSVGElement>) {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, vbX: vb.x, vbY: vb.y, moved: false };
  }

  function handleMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const d = dragRef.current;
    if (!d) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dxScreen = e.clientX - d.startX;
    const dyScreen = e.clientY - d.startY;
    if (Math.abs(dxScreen) > 3 || Math.abs(dyScreen) > 3) d.moved = true;
    const dx = (dxScreen / rect.width) * vb.w;
    const dy = (dyScreen / rect.height) * vb.h;
    setVb((cur) => clampVb({ ...cur, x: d.vbX - dx, y: d.vbY - dy }));
  }

  function endDrag() {
    dragRef.current = null;
  }

  function touchDist(t: React.TouchList) {
    const dx = t[0].clientX - t[1].clientX;
    const dy = t[0].clientY - t[1].clientY;
    return Math.hypot(dx, dy);
  }

  function handleTouchStart(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length === 2) {
      pinchRef.current = { dist: touchDist(e.touches), vbW: vb.w };
      dragRef.current = null;
    } else if (e.touches.length === 1) {
      dragRef.current = { startX: e.touches[0].clientX, startY: e.touches[0].clientY, vbX: vb.x, vbY: vb.y, moved: false };
      pinchRef.current = null;
    }
  }

  function handleTouchMove(e: React.TouchEvent<SVGSVGElement>) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const dist = touchDist(e.touches);
      const factor = dist / pinchRef.current.dist;
      const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      const cy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      const { x, y } = screenToSvg(cx, cy);
      setVb(() => {
        const w = Math.max(MIN_VB_W, Math.min(MAX_VB_W, pinchRef.current!.vbW / factor));
        const h = w * (SVG_H / SVG_W);
        return clampVb({ x: x - (w / 2), y: y - (h / 2), w, h });
      });
    } else if (e.touches.length === 1 && dragRef.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const d = dragRef.current;
      const dxScreen = e.touches[0].clientX - d.startX;
      const dyScreen = e.touches[0].clientY - d.startY;
      if (Math.abs(dxScreen) > 3 || Math.abs(dyScreen) > 3) d.moved = true;
      const dx = (dxScreen / rect.width) * vb.w;
      const dy = (dyScreen / rect.height) * vb.h;
      setVb((cur) => clampVb({ ...cur, x: d.vbX - dx, y: d.vbY - dy }));
    }
  }

  function handleTouchEnd() {
    dragRef.current = null;
    pinchRef.current = null;
  }

  function zoomButton(factor: number) {
    zoomAround(vb.x + vb.w / 2, vb.y + vb.h / 2, factor);
  }

  function resetView() {
    setVb({ x: 0, y: 0, w: SVG_W, h: SVG_H });
  }

  // A click that followed a real drag shouldn't also select a barangay.
  function handlePathClick(name: string) {
    if (dragRef.current?.moved) return;
    setSelected((cur) => (cur === name ? null : name));
  }

  function handlePathHover(e: React.MouseEvent, e2: { name: string; label: string; y: number; hasData: boolean }) {
    const rect = mapWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setHovered({ ...e2, x: e.clientX - rect.left, y2: e.clientY - rect.top });
  }

  const stats = useMemo(() => {
    const map: Record<string, { count: number; total: number; ha: number }> = {};
    for (const p of predictions) {
      if (!map[p.barangay]) map[p.barangay] = { count: 0, total: 0, ha: 0 };
      map[p.barangay].count += 1;
      map[p.barangay].total += p.predictedYield;
      map[p.barangay].ha += p.area;
    }
    return map;
  }, [predictions]);

  function yieldFor(name: string): { value: number; hasData: boolean } {
    const s = stats[name];
    if (s && s.count > 0) return { value: +(s.total / s.count).toFixed(2), hasData: true };
    // No live predictions for this barangay yet — the historical baseline
    // is shown separately (in the selected-barangay panel, clearly
    // labeled "Historical yield"), never blended into what reads as a
    // live average here. The map/ranking treat this as "no data", full
    // stop, rather than quietly standing in a 10-year-old number for it.
    return { value: 0, hasData: false };
  }

  if (!geoData) {
    return (
      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <div className="flex items-center gap-2 text-slate-900">
          <MapPin className="h-4 w-4 text-emerald-600" /> Binalonan Yield Heatmap
        </div>
        <div className="mt-1 text-xs text-slate-500">Awaiting real barangay boundary data</div>

        <div className="mt-4 border-2 border-dashed border-emerald-200 bg-emerald-50/40 rounded-xl p-8 text-center">
          <Upload className="h-7 w-7 mx-auto text-emerald-600" />
          <div className="mt-3 text-slate-800">
            Drop a GeoJSON file at <code className="px-1.5 py-0.5 rounded bg-white border border-slate-200 text-xs">src/imports/binalonan.geojson</code>
          </div>
          <div className="mt-2 text-sm text-slate-600 max-w-xl mx-auto">
            Any FeatureCollection of the 24 barangays of Binalonan, Pangasinan works — exports from GADM (NAME_3),
            PSA, or OpenStreetMap (Overpass query for <code className="text-xs">admin_level=10</code>) will all be
            detected automatically. The map will redraw with the real boundaries as soon as the file is present.
          </div>
        </div>
      </div>
    );
  }

  const project = buildProjection(geoData);
  const features = geoData.features ?? [];

  const enriched = features.map((f: any) => {
    const name = getName(f.properties);
    const { value, hasData } = yieldFor(name);
    return { f, name, label: displayName(name), y: value, hasData, path: geometryToPath(f.geometry, project), centroid: geometryCentroid(f.geometry) };
  });

  // Only barangays with real live predictions are ranked — a barangay
  // with none isn't a "low performer", it's simply unmeasured, and
  // shouldn't be ranked against ones that do have data either way.
  const ranked = [...enriched].filter((e: any) => e.hasData).sort((a: any, b: any) => b.y - a.y);

  const active = selected ? enriched.find((e: any) => e.name === selected) : null;
  const activeStats = active ? stats[active.name] : null;

  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
            <MapPin className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <div className="text-slate-900">Binalonan Yield Heatmap</div>
            <div className="text-xs text-slate-500 mt-0.5">
              Average predicted yield (t/ha) per barangay — real boundaries from GeoJSON
            </div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-full px-3 py-1.5">
          <Layers className="h-3.5 w-3.5 text-slate-400" />
          {predictions.length} predictions · {features.length} barangays
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div ref={mapWrapRef} className="col-span-2 relative bg-gradient-to-br from-slate-50 to-emerald-50/40 rounded-xl border border-slate-100 overflow-hidden ring-1 ring-slate-900/5">
          <svg
            ref={svgRef}
            viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
            className="w-full h-[460px] touch-none"
            style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={endDrag}
            onMouseLeave={endDrag}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <defs>
              <pattern id="bgGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#e2e8f0" strokeWidth="0.5" />
              </pattern>
              <filter id="brgyShadow" x="-40%" y="-40%" width="180%" height="180%">
                <feDropShadow dx="0" dy="3" stdDeviation="4" floodColor="#047857" floodOpacity="0.28" />
              </filter>
            </defs>
            <rect x={-SVG_W} y={-SVG_H} width={SVG_W * 3} height={SVG_H * 3} fill="url(#bgGrid)" />

            {enriched.map((e: any) => {
              const isActive = selected === e.name;
              const isHovered = hovered?.name === e.name && !isActive;
              return (
                <path
                  key={e.name}
                  d={e.path}
                  fill={e.hasData ? colorFor(e.y) : "#e2e8f0"}
                  stroke={isActive ? "#047857" : isHovered ? "#10b981" : "#ffffff"}
                  strokeWidth={(isActive ? 2.5 : isHovered ? 1.75 : 1) / zoomLevel}
                  opacity={isHovered ? 0.92 : 1}
                  style={{
                    transition: "fill 150ms, stroke 150ms, opacity 150ms",
                    filter: isActive ? "url(#brgyShadow)" : "none",
                    cursor: "pointer",
                  }}
                  onClick={() => handlePathClick(e.name)}
                  onMouseEnter={(ev) => handlePathHover(ev, e)}
                  onMouseMove={(ev) => handlePathHover(ev, e)}
                  onMouseLeave={() => setHovered((cur) => (cur?.name === e.name ? null : cur))}
                />
              );
            })}

            {enriched.map((e: any) => {
              const [lon, lat] = e.centroid;
              const [cx, cy] = project(lon, lat);
              const tc = e.hasData && e.y >= 5.6 ? "#ffffff" : "#0f172a";
              return (
                <g key={`label-${e.name}`} style={{ pointerEvents: "none" }}>
                  <text x={cx} y={cy - 2} textAnchor="middle" fontSize={9 / zoomLevel} fill={tc}
                    style={{ paintOrder: "stroke", stroke: e.hasData && e.y >= 5.6 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.85)", strokeWidth: 2 / zoomLevel }}>
                    {e.label}
                  </text>
                  <text x={cx} y={cy + 10} textAnchor="middle" fontSize={9 / zoomLevel} fill={tc} opacity={0.9}
                    style={{ paintOrder: "stroke", stroke: e.hasData && e.y >= 5.6 ? "rgba(0,0,0,0.25)" : "rgba(255,255,255,0.85)", strokeWidth: 2 / zoomLevel }}>
                    {e.hasData ? e.y.toFixed(1) : "—"}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover tooltip — HTML overlay in container-relative pixels,
              separate from the SVG's own zoom/pan-scaled coordinates. */}
          {hovered && (
            <div
              className="absolute z-10 pointer-events-none bg-slate-900 text-white rounded-lg px-3 py-2 shadow-lg text-xs -translate-x-1/2 -translate-y-[calc(100%+10px)]"
              style={{ left: hovered.x, top: hovered.y2 }}
            >
              <div className="text-white">{hovered.label}</div>
              <div className="text-slate-300 mt-0.5">
                {hovered.hasData ? `${hovered.y.toFixed(2)} t/ha avg` : "No live predictions yet"}
              </div>
              <div className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-slate-900" />
            </div>
          )}

          {/* Fixed overlays — HTML, not SVG, so they stay put in the
              corner regardless of the map's zoom/pan state. */}
          <div className="absolute top-3 right-3 bg-white/95 backdrop-blur rounded-lg border border-slate-200 px-3 py-2 text-center pointer-events-none shadow-sm">
            <div className="text-[11px] text-slate-900">Municipality of Binalonan</div>
            <div className="text-[9px] text-slate-500">Pangasinan · {features.length} barangays</div>
          </div>

          <div className="absolute bottom-3 right-3 h-8 w-8 rounded-full bg-white border border-slate-200 flex flex-col items-center justify-center pointer-events-none shadow-sm">
            <span className="text-[8px] text-slate-500 leading-none">N</span>
            <svg width="8" height="10" viewBox="0 0 8 10" className="mt-0.5">
              <path d="M4,0 L8,10 L4,7 L0,10 Z" fill="#10b981" opacity="0.75" />
            </svg>
          </div>

          {/* Zoom controls */}
          <div className="absolute top-3 left-3 flex flex-col rounded-lg border border-slate-200 bg-white/95 backdrop-blur overflow-hidden shadow-sm">
            <button
              onClick={() => zoomButton(1.4)}
              disabled={zoomLevel >= SVG_W / MIN_VB_W - 0.01}
              className="h-8 w-8 flex items-center justify-center text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 transition-all disabled:opacity-30 disabled:hover:bg-white disabled:active:scale-100 border-b border-slate-100"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={() => zoomButton(1 / 1.4)}
              disabled={zoomLevel <= 1.01}
              className="h-8 w-8 flex items-center justify-center text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 transition-all disabled:opacity-30 disabled:hover:bg-white disabled:active:scale-100 border-b border-slate-100"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={resetView}
              disabled={zoomLevel <= 1.01 && vb.x === 0 && vb.y === 0}
              className="h-8 w-8 flex items-center justify-center text-slate-600 hover:bg-emerald-50 hover:text-emerald-700 active:scale-95 transition-all disabled:opacity-30 disabled:hover:bg-white disabled:active:scale-100"
              aria-label="Reset view"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="absolute bottom-3 left-3 right-3 bg-white/95 backdrop-blur rounded-lg border border-slate-200 px-3 py-2 flex items-center gap-2 flex-wrap shadow-sm">
            <span className="text-xs text-slate-500 mr-1">Low</span>
            <div className="h-2 flex-1 rounded-full min-w-[60px] shadow-inner" style={{ background: LEGEND_GRADIENT }} />
            <span className="text-xs text-slate-500 ml-1">High</span>
            <span className="text-xs text-slate-400 ml-2">t/ha</span>
            <span className="flex items-center gap-1 text-xs text-slate-400 ml-3">
              <span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ background: "#e2e8f0" }} /> No data
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div
            className={`rounded-xl border p-4 min-h-[168px] flex flex-col transition-colors ${
              active ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-white"
            }`}
          >
            {active ? (
              <>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs text-emerald-700">Selected barangay</div>
                    <div className="mt-1 text-slate-900">{active.label}</div>
                  </div>
                  <button
                    onClick={() => setSelected(null)}
                    className="text-xs text-slate-400 hover:text-slate-700"
                    aria-label="Clear selection"
                  >
                    Clear
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-white/70 border border-emerald-100 px-2.5 py-2">
                    <div className="text-xs text-slate-500">Avg yield</div>
                    <div className={active.hasData ? "text-emerald-800" : "text-slate-400 text-xs"}>
                      {active.hasData ? <YieldValue valueTHa={active.y} className="text-emerald-800" /> : "No live predictions yet"}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white/70 border border-emerald-100 px-2.5 py-2">
                    <div className="text-xs text-slate-500">Plots</div><div className="text-slate-800">{activeStats?.count ?? 0}</div>
                  </div>
                  <div className="rounded-lg bg-white/70 border border-emerald-100 px-2.5 py-2">
                    <div className="text-xs text-slate-500">Total area</div><div className="text-slate-800"><AreaValue valueHa={activeStats?.ha ?? 0} className="text-slate-800" /></div>
                  </div>
                  <div className="rounded-lg bg-white/70 border border-emerald-100 px-2.5 py-2">
                    <div className="text-xs text-slate-500">Est. output</div><div className="text-slate-800">{active.hasData ? `${((activeStats?.ha ?? 0) * active.y).toFixed(1)} t` : "—"}</div>
                  </div>
                </div>
                {BARANGAY_FACTS[active.name] && (
                  <div className="mt-3 pt-3 border-t border-emerald-100 space-y-1.5 text-xs">
                    <div className="flex justify-between"><span className="text-slate-500">Soil</span><span className="text-slate-700 text-right">{BARANGAY_FACTS[active.name].soilType}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Water source</span><span className="text-slate-700 text-right">{BARANGAY_FACTS[active.name].waterBody}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Farm land</span><span className="text-slate-700"><AreaValue valueHa={BARANGAY_FACTS[active.name].landSize} className="text-slate-700" /></span></div>
                    <div className="flex justify-between"><span className="text-slate-500">Historical yield</span><span className="text-slate-700"><YieldValue valueTHa={BARANGAY_FACTS[active.name].historicalYield} className="text-slate-700" /></span></div>
                  </div>
                )}
              </>
            ) : (
              <div className="m-auto text-center">
                <MapPin className="h-5 w-5 text-slate-300 mx-auto" />
                <div className="mt-2 text-sm text-slate-500">Click any barangay on the map to inspect its performance.</div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-100 p-3 max-h-[320px] overflow-auto">
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-2 px-1">
              <Trophy className="h-3.5 w-3.5 text-amber-400" /> Top performers
            </div>
            {ranked.length === 0 ? (
              <div className="text-xs text-slate-400 px-1 py-2">No barangays have live predictions yet.</div>
            ) : (
              <div className="space-y-1">
                {ranked.slice(0, 10).map((b: any, i: number) => {
                  const medal = i === 0 ? "bg-amber-100 text-amber-700" : i === 1 ? "bg-slate-200 text-slate-600" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-slate-50 text-slate-400";
                  const barPct = Math.max(6, (b.y / ranked[0].y) * 100);
                  return (
                    <button
                      key={b.name}
                      onClick={() => setSelected((cur) => (cur === b.name ? null : b.name))}
                      className={`w-full flex items-center gap-2 text-sm px-1.5 py-1.5 rounded-lg transition-colors ${selected === b.name ? "bg-emerald-50" : "hover:bg-slate-50"}`}
                    >
                      <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] shrink-0 ${medal}`}>{i + 1}</span>
                      <span className="flex-1 min-w-0 text-left">
                        <span className="block text-slate-700 truncate">{b.label}</span>
                        <span className="block h-1 mt-1 rounded-full bg-slate-100 overflow-hidden">
                          <span className="block h-full rounded-full" style={{ width: `${barPct}%`, background: colorFor(b.y) }} />
                        </span>
                      </span>
                      <span className="text-slate-500 text-xs shrink-0">{b.y.toFixed(2)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
