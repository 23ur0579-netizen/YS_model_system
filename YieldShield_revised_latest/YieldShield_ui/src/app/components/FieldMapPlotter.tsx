import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2, Search, Hand, Undo2, Trash2, CheckCircle2, Wand2, Info } from "lucide-react";
import { geocodeAddress, polygonAreaHa, scalePolygonToArea, polygonCentroid, LatLng } from "../lib/geo";

// Leaflet is loaded globally via a CDN <script> in index.html (free,
// OpenStreetMap tiles, no API key) — no npm package needed, same as
// MapPicker.tsx. This just types the bits of the global `L` object
// this component actually uses.
declare global {
  interface Window {
    L?: {
      map: (el: HTMLElement, opts?: any) => any;
      tileLayer: (url: string, opts?: any) => any;
      marker: (latlng: [number, number], opts?: any) => any;
      polygon: (latlngs: [number, number][], opts?: any) => any;
      polyline: (latlngs: [number, number][], opts?: any) => any;
      divIcon: (opts?: any) => any;
    };
  }
}

// Two free, no-API-key basemaps: the usual OSM street map, and Esri's
// World Imagery satellite tiles. Satellite shows actual rooftops, tree
// lines, and field edges — far easier to trace a real field boundary
// against than any stylized street map, which is the whole point of
// offering it here specifically for the corner-plotting flow.
const BASEMAPS = {
  streets: {
    url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxZoom: 19,
  },
} as const;

// Binalonan, Pangasinan town center — same default MapPicker.tsx uses.
const BINALONAN_CENTER: [number, number] = [16.0503, 120.5926];
// Roughly how close (in pixels on screen) a tap needs to land to the
// first corner to count as "close the shape" instead of "add a new one".
const CLOSE_SHAPE_PIXEL_RADIUS = 22;

function numberedDivIcon(n: number, done: boolean) {
  const bg = done ? "#059669" : "#0ea5e9";
  return window.L!.divIcon({
    className: "",
    html: `<div style="width:22px;height:22px;border-radius:9999px;background:${bg};color:white;font:600 11px system-ui;display:flex;align-items:center;justify-content:center;border:2px solid white;box-shadow:0 1px 3px rgba(0,0,0,.3)">${n}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

export function FieldMapPlotter({
  houseNo,
  streetZone,
  barangay,
  targetAreaHa,
  center,
  onCenterChange,
  boundary,
  onBoundaryChange,
}: {
  houseNo: string;
  streetZone: string;
  // Barangay label, e.g. "Bued" — municipality/province are fixed to
  // Binalonan, Pangasinan inside this component (see GEOCODE_SUFFIX).
  barangay: string;
  targetAreaHa: number | null;
  center: { lat: number; lng: number } | null;
  onCenterChange: (lat: number, lng: number) => void;
  boundary: LatLng[] | null;
  onBoundaryChange: (points: LatLng[] | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const [ready, setReady] = useState(!!window.L);
  const [basemap, setBasemap] = useState<"streets" | "satellite">("streets");

  const pinMarkerRef = useRef<any>(null);
  const polygonRef = useRef<any>(null);
  const openLineRef = useRef<any>(null);
  const vertexMarkersRef = useRef<any[]>([]);

  const [points, setPoints] = useState<LatLng[]>(boundary ?? []);
  const [plotting, setPlotting] = useState(false);
  const [geocoding, setGeocoding] = useState(false);
  const [geocodeStatus, setGeocodeStatus] = useState<{ kind: "approx" | "notfound" | "error"; text: string } | null>(null);

  // Refs mirror the latest state/props for the map's click handler, which
  // is attached once when the map is created — without this it would
  // only ever see the values from that first render.
  const pointsRef = useRef(points);
  const plottingRef = useRef(plotting);
  const onCenterChangeRef = useRef(onCenterChange);
  pointsRef.current = points;
  plottingRef.current = plotting;
  onCenterChangeRef.current = onCenterChange;

  const area = polygonAreaHa(points);
  const target = targetAreaHa && targetAreaHa > 0 ? targetAreaHa : null;
  const areaOffPct = target ? Math.abs(area - target) / target : 0;

  // Leaflet's CDN script normally finishes loading before this component
  // ever mounts, but poll briefly just in case (slow connection, etc.).
  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => {
      if (window.L) { setReady(true); clearInterval(id); }
    }, 100);
    return () => clearInterval(id);
  }, [ready]);

  // Create the map once (no tile layer here — that's handled by the
  // basemap effect below, which also runs on first mount).
  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    const L = window.L!;
    const start: [number, number] = center ? [center.lat, center.lng] : BINALONAN_CENTER;
    const map = L.map(containerRef.current, { center: start, zoom: center ? 17 : 13 });

    map.on("click", (e: any) => {
      if (!plottingRef.current) {
        // Not plotting a shape — fall back to the simple single-pin
        // behavior (same as the old MapPicker) so clicking anywhere on
        // the map just moves the pin.
        if (pointsRef.current.length === 0 && pinMarkerRef.current) {
          pinMarkerRef.current.setLatLng(e.latlng);
          onCenterChangeRef.current(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
          setGeocodeStatus(null);
        }
        return;
      }
      const pts = pointsRef.current;
      // Tapping back near the first corner closes the shape instead of
      // adding another point — easier to hit reliably on a phone than
      // requiring a pixel-perfect tap, since it's measured in screen
      // pixels rather than map distance.
      if (pts.length >= 3) {
        const firstPx = map.latLngToContainerPoint([pts[0].lat, pts[0].lng]);
        const clickPx = map.latLngToContainerPoint(e.latlng);
        const dist = Math.hypot(firstPx.x - clickPx.x, firstPx.y - clickPx.y);
        if (dist <= CLOSE_SHAPE_PIXEL_RADIUS) {
          setPlotting(false);
          return;
        }
      }
      setPoints((prev) => [...prev, { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }]);
    });

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Swap the basemap tile layer in/out. Runs once for the initial layer
  // too (the map-creation effect above deliberately doesn't add one),
  // and again any time the person toggles Map/Satellite.
  useEffect(() => {
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;
    if (tileLayerRef.current) map.removeLayer(tileLayerRef.current);
    const cfg = BASEMAPS[basemap];
    tileLayerRef.current = L.tileLayer(cfg.url, { attribution: cfg.attribution, maxZoom: cfg.maxZoom }).addTo(map);
    tileLayerRef.current.bringToBack();
  }, [basemap, ready]);

  // Redraw markers/polygon/pin whenever the point list changes.
  useEffect(() => {
    const map = mapRef.current;
    const L = window.L;
    if (!map || !L) return;

    vertexMarkersRef.current.forEach((m) => map.removeLayer(m));
    vertexMarkersRef.current = [];
    if (polygonRef.current) { map.removeLayer(polygonRef.current); polygonRef.current = null; }
    if (openLineRef.current) { map.removeLayer(openLineRef.current); openLineRef.current = null; }
    if (pinMarkerRef.current) { map.removeLayer(pinMarkerRef.current); pinMarkerRef.current = null; }

    if (points.length === 0) {
      // No corners plotted — fall back to the old single-pin behavior so
      // a farmer who doesn't want to plot a full shape still isn't stuck.
      const start: [number, number] = center ? [center.lat, center.lng] : BINALONAN_CENTER;
      const marker = L.marker(start, { draggable: true }).addTo(map);
      marker.on("dragend", () => {
        const pos = marker.getLatLng();
        onCenterChange(+pos.lat.toFixed(6), +pos.lng.toFixed(6));
      });
      pinMarkerRef.current = marker;
      return;
    }

    const latlngs: [number, number][] = points.map((p) => [p.lat, p.lng]);
    points.forEach((p, i) => {
      const marker = L.marker([p.lat, p.lng], {
        draggable: true,
        icon: numberedDivIcon(i + 1, points.length >= 3),
      }).addTo(map);
      marker.on("drag", () => {
        const pos = marker.getLatLng();
        setPoints((prev) => prev.map((pt, idx) => (idx === i ? { lat: +pos.lat.toFixed(6), lng: +pos.lng.toFixed(6) } : pt)));
      });
      vertexMarkersRef.current.push(marker);
    });

    if (points.length >= 3) {
      polygonRef.current = L.polygon(latlngs, { color: "#059669", weight: 2, fillColor: "#10b981", fillOpacity: 0.25 }).addTo(map);
      const c = polygonCentroid(points);
      onCenterChange(c.lat, c.lng);
    } else {
      openLineRef.current = L.polyline(latlngs, { color: "#0ea5e9", weight: 2, dashArray: "6 6" }).addTo(map);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, ready]);

  // Report the finished shape upward (only once it's an actual polygon).
  useEffect(() => {
    onBoundaryChange(points.length >= 3 ? points : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points]);

  const GEOCODE_SUFFIX = "Binalonan, Pangasinan, Philippines";

  async function findAddress() {
    const houseNoT = houseNo.trim();
    const streetZoneT = streetZone.trim();
    if (!houseNoT && !streetZoneT && !barangay.trim()) return;
    setGeocoding(true);
    setGeocodeStatus(null);
    try {
      // Try from most specific to least, dropping one piece at a time —
      // a rural PH address's house number is very often missing from OSM
      // even where the street/zone or barangay is mapped fine, so a
      // single miss on the full string shouldn't throw away the parts
      // that might actually be findable.
      const attempts: { query: string; label: "full" | "street" | "barangay" }[] = [];
      const full = [houseNoT, streetZoneT].filter(Boolean).join(" ");
      if (full) attempts.push({ query: `${full}, ${barangay}, ${GEOCODE_SUFFIX}`, label: "full" });
      if (streetZoneT && streetZoneT !== full) attempts.push({ query: `${streetZoneT}, ${barangay}, ${GEOCODE_SUFFIX}`, label: "street" });
      attempts.push({ query: `${barangay}, ${GEOCODE_SUFFIX}`, label: "barangay" });

      let found: LatLng | null = null;
      let matchedLevel: "full" | "street" | "barangay" = "barangay";
      for (const attempt of attempts) {
        found = await geocodeAddress(attempt.query);
        if (found) { matchedLevel = attempt.label; break; }
      }

      if (!found) {
        setGeocodeStatus({
          kind: "notfound",
          text: "Couldn't find this on the map — that's normal for very local addresses. Tap the map directly, or use \"Plot field corners\", to set your field's location.",
        });
        return;
      }
      mapRef.current?.flyTo([found.lat, found.lng], matchedLevel === "full" ? 18 : matchedLevel === "street" ? 16 : 15);
      if (points.length === 0) onCenterChange(found.lat, found.lng);
      if (matchedLevel === "street") {
        setGeocodeStatus({
          kind: "approx",
          text: "Found the street/zone, but not the exact house number (common for rural addresses) — the map is centered there. Tap the map, or use \"Plot field corners\", to mark the precise spot.",
        });
      } else if (matchedLevel === "barangay") {
        setGeocodeStatus({
          kind: "approx",
          text: "Found the barangay, but not that street/zone or house number — the map is centered there. Tap the map, or use \"Plot field corners\", to mark the precise spot.",
        });
      }
    } catch (err) {
      console.error("Geocoding failed", err);
      setGeocodeStatus({ kind: "error", text: "Couldn't reach the map search right now — you can still tap the map directly to set your field's location." });
    } finally {
      setGeocoding(false);
    }
  }

  function startPlotting() {
    setPoints([]);
    setPlotting(true);
    setGeocodeStatus(null);
  }
  function undoLastPoint() {
    setPoints((prev) => prev.slice(0, -1));
  }
  function clearPlot() {
    setPoints([]);
    setPlotting(false);
    setGeocodeStatus(null);
  }
  function autoAdjust() {
    if (!target) return;
    setPoints((prev) => scalePolygonToArea(prev, target));
  }

  return (
    <div>
      <div className="text-sm text-slate-700 mb-1.5 flex items-center gap-1">
        <MapPin className="h-3.5 w-3.5 text-slate-400" /> Field location
      </div>

      <div className="flex gap-1.5 mb-2">
        <button
          type="button"
          onClick={findAddress}
          disabled={geocoding || (!houseNo.trim() && !streetZone.trim())}
          className="flex-1 h-9 px-3 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 flex items-center justify-center gap-1.5"
        >
          {geocoding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Find this address on the map
        </button>
        {!plotting ? (
          <button
            type="button"
            onClick={startPlotting}
            className="h-9 px-3 rounded-lg border border-emerald-200 bg-emerald-50 text-sm text-emerald-700 hover:bg-emerald-100 flex items-center gap-1.5 whitespace-nowrap"
          >
            <Hand className="h-3.5 w-3.5" /> Plot field corners
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPlotting(false)}
            className="h-9 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm flex items-center gap-1.5 whitespace-nowrap"
          >
            <CheckCircle2 className="h-3.5 w-3.5" /> Done plotting
          </button>
        )}
      </div>

      {plotting && (
        <div className="mb-2 flex items-start gap-2 rounded-lg bg-sky-50 border border-sky-100 px-3 py-2 text-xs text-sky-800 leading-snug">
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Tap each corner of your field in order, then tap the first corner again (or "Done plotting") to close the shape.</span>
        </div>
      )}

      {geocodeStatus && (
        <div
          className={`mb-2 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-snug ${
            geocodeStatus.kind === "approx" ? "bg-amber-50 border-amber-100 text-amber-800" : "bg-slate-50 border-slate-200 text-slate-600"
          }`}
        >
          <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>{geocodeStatus.text}</span>
        </div>
      )}

      <div className="rounded-lg border border-slate-200 overflow-hidden relative h-[300px] sm:h-[420px] lg:h-[480px]">
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
        {ready && (
          <div className="absolute top-2 right-2 z-[1000] inline-flex rounded-lg overflow-hidden border border-slate-300 shadow-sm text-xs">
            <button
              type="button"
              onClick={() => setBasemap("streets")}
              className={`px-2.5 py-1.5 ${basemap === "streets" ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Map
            </button>
            <button
              type="button"
              onClick={() => setBasemap("satellite")}
              className={`px-2.5 py-1.5 ${basemap === "satellite" ? "bg-emerald-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}
            >
              Satellite
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs text-slate-500">
          {points.length >= 3
            ? `Plotted area: ${area.toFixed(2)} ha${target ? ` (target: ${target.toFixed(2)} ha)` : ""}`
            : points.length > 0
              ? `${points.length} corner${points.length === 1 ? "" : "s"} placed — add at least ${3 - points.length} more`
              : "Not plotted yet — tap the map to drop a pin, or use \"Plot field corners\" to draw the actual shape"}
        </div>
        <div className="flex items-center gap-1.5">
          {plotting && points.length > 0 && (
            <button type="button" onClick={undoLastPoint} className="h-7 px-2 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1">
              <Undo2 className="h-3 w-3" /> Undo
            </button>
          )}
          {points.length > 0 && (
            <button type="button" onClick={clearPlot} className="h-7 px-2 rounded-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1">
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          )}
        </div>
      </div>

      {points.length >= 3 && target && areaOffPct > 0.03 && (
        <button
          type="button"
          onClick={autoAdjust}
          className="mt-2 w-full h-9 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm hover:bg-amber-100 flex items-center justify-center gap-1.5"
        >
          <Wand2 className="h-3.5 w-3.5" /> Auto-adjust shape to match {target.toFixed(2)} ha
        </button>
      )}
    </div>
  );
}
