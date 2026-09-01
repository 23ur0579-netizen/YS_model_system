import { useEffect, useRef, useState } from "react";
import { Loader2, Layers } from "lucide-react";

// Same Window.L augmentation as MapPicker.tsx/FieldMapPlotter.tsx —
// TypeScript requires every declaration of the same global interface
// member to match exactly, so this mirrors theirs verbatim even though
// this component only actually calls map/tileLayer/marker/polygon.
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

const BINALONAN_CENTER: [number, number] = [16.0503, 120.5926];

// Purely a viewer — no click/drag handlers at all, unlike MapPicker
// (drags a pin) or FieldMapPlotter (plots a whole boundary corner by
// corner). This just shows where a field actually is: a marker if
// only a pin was ever dropped for it, or the full plotted boundary
// polygon (with the map framed to show the whole thing) if one exists.
export function FieldLocationMap({
  latitude,
  longitude,
  boundary,
  heightPx = 260,
}: {
  latitude?: number;
  longitude?: number;
  boundary?: { lat: number; lng: number }[];
  heightPx?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const tileLayerRef = useRef<any>(null);
  const [ready, setReady] = useState(!!window.L);
  const [basemap, setBasemap] = useState<"streets" | "satellite">("satellite");

  const hasPoint = latitude != null && longitude != null;
  const hasBoundary = !!boundary && boundary.length >= 3;

  useEffect(() => {
    if (ready) return;
    const id = setInterval(() => {
      if (window.L) {
        setReady(true);
        clearInterval(id);
      }
    }, 100);
    return () => clearInterval(id);
  }, [ready]);

  useEffect(() => {
    if (!ready || !containerRef.current || mapRef.current) return;
    const L = window.L!;
    const start: [number, number] = hasPoint ? [latitude!, longitude!] : BINALONAN_CENTER;

    const map = L.map(containerRef.current, {
      center: start,
      zoom: hasBoundary || hasPoint ? 17 : 13,
      dragging: true,
      scrollWheelZoom: false,
      zoomControl: true,
    });
    tileLayerRef.current = L.tileLayer(BASEMAPS[basemap].url, {
      attribution: BASEMAPS[basemap].attribution,
      maxZoom: BASEMAPS[basemap].maxZoom,
    }).addTo(map);

    if (hasBoundary) {
      const latlngs = boundary!.map((p) => [p.lat, p.lng] as [number, number]);
      const poly = L.polygon(latlngs, { color: "#059669", weight: 2, fillColor: "#059669", fillOpacity: 0.18 }).addTo(map);
      map.fitBounds(poly.getBounds(), { padding: [24, 24] });
    } else if (hasPoint) {
      L.marker(start).addTo(map);
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
    };
    // Deliberately only initializes once per mount — a field's plotted
    // location doesn't change while its info panel is open, so there's
    // no prop-driven re-render path to wire up here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Basemap can still be toggled live without a full re-init.
  useEffect(() => {
    if (!mapRef.current || !tileLayerRef.current || !window.L) return;
    mapRef.current.removeLayer(tileLayerRef.current);
    tileLayerRef.current = window.L.tileLayer(BASEMAPS[basemap].url, {
      attribution: BASEMAPS[basemap].attribution,
      maxZoom: BASEMAPS[basemap].maxZoom,
    }).addTo(mapRef.current);
  }, [basemap]);

  if (!hasPoint && !hasBoundary) {
    return (
      <div
        className="rounded-lg border border-dashed border-slate-200 flex items-center justify-center text-sm text-slate-400 bg-slate-50"
        style={{ height: heightPx }}
      >
        No location was recorded for this field.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 overflow-hidden relative" style={{ height: heightPx }}>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 text-sm gap-2 z-[1000]">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading map…
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
      <button
        type="button"
        onClick={() => setBasemap((b) => (b === "streets" ? "satellite" : "streets"))}
        className="absolute bottom-2 right-2 z-[1000] px-2.5 py-1.5 rounded-md bg-white shadow border border-slate-200 text-xs text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
      >
        <Layers className="h-3 w-3" /> {basemap === "streets" ? "Satellite" : "Streets"}
      </button>
    </div>
  );
}
