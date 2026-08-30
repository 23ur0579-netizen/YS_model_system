import { useEffect, useRef, useState } from "react";
import { MapPin, Loader2 } from "lucide-react";
import { useT } from "../i18n";

// Leaflet is loaded globally via a CDN <script> in index.html (free,
// OpenStreetMap tiles, no API key) — no npm package needed. This
// mirrors FieldMapPlotter.tsx's identical `declare global` augmentation
// of Window.L verbatim (TypeScript requires every declaration of the
// same global interface member to match exactly, or it's a compile
// error) even though this component only actually calls map/tileLayer/
// marker — the rest exist purely so the two declarations agree.
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

// Binalonan, Pangasinan town center — same coordinates already used for
// the real NASA POWER climate data in data/binalonan.ts. Used as the
// default pin/center when a field doesn't have coordinates yet.
const BINALONAN_CENTER: [number, number] = [16.0503, 120.5926];

export function MapPicker({
  latitude,
  longitude,
  onChange,
}: {
  latitude: number | null;
  longitude: number | null;
  onChange: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const [ready, setReady] = useState(!!window.L);
  const t = useT();

  // Leaflet's CDN script normally finishes loading before this component
  // ever mounts, but poll briefly just in case (slow connection, etc.).
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
    const start: [number, number] = latitude != null && longitude != null ? [latitude, longitude] : BINALONAN_CENTER;

    const map = L.map(containerRef.current, { center: start, zoom: latitude != null ? 16 : 13 });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    }).addTo(map);

    const marker = L.marker(start, { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const pos = marker.getLatLng();
      onChange(+pos.lat.toFixed(6), +pos.lng.toFixed(6));
    });
    map.on("click", (e: any) => {
      marker.setLatLng(e.latlng);
      onChange(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6));
    });

    mapRef.current = map;
    markerRef.current = marker;

    // If a pin already exists (editing), report it back immediately so
    // the form's lat/lng state matches what's actually shown.
    if (latitude == null || longitude == null) {
      onChange(start[0], start[1]);
    }

    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Intentionally only initialize once — the marker is dragged/clicked
    // from here on, not re-driven by prop changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  return (
    <div>
      <div className="text-sm text-slate-700 mb-1.5 flex items-center gap-1">
        <MapPin className="h-3.5 w-3.5 text-slate-400" /> {t("map.pinLocation")}
      </div>
      <div className="rounded-lg border border-slate-200 overflow-hidden relative" style={{ height: 220 }}>
        {!ready && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-50 text-slate-400 text-sm gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("map.loadingMap")}
          </div>
        )}
        <div ref={containerRef} className="w-full h-full" />
      </div>
      <div className="text-xs text-slate-400 mt-1.5">
        {t("map.clickOrDrag")}
        {latitude != null && longitude != null && ` ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`}
      </div>
    </div>
  );
}
