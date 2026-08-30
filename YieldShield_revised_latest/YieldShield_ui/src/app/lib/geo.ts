// Small geodesic helpers for plotting a field's boundary on the map in
// AddFieldModal — no mapping/GIS library needed, just enough spherical
// trig for farm-plot-sized polygons (a few hectares at most).

const EARTH_RADIUS_M = 6378137; // WGS-84 equatorial radius — matches the OSM tiles/Leaflet already in use

export type LatLng = { lat: number; lng: number };

function meanLatRadOf(points: LatLng[]): number {
  return ((points.reduce((s, p) => s + p.lat, 0) / points.length) * Math.PI) / 180;
}

// Equirectangular projection centered on the polygon's own mean latitude
// — plenty accurate at the scale of a single farm plot, and far simpler
// than a full geodesic (e.g. Vincenty) treatment for an area this small.
function projectPoints(points: LatLng[], meanLatRad: number) {
  return points.map((p) => ({
    x: ((p.lng * Math.PI) / 180) * EARTH_RADIUS_M * Math.cos(meanLatRad),
    y: ((p.lat * Math.PI) / 180) * EARTH_RADIUS_M,
  }));
}

function unprojectPoints(pts: { x: number; y: number }[], meanLatRad: number): LatLng[] {
  return pts.map((p) => ({
    lat: (p.y / EARTH_RADIUS_M) * (180 / Math.PI),
    lng: (p.x / (EARTH_RADIUS_M * Math.cos(meanLatRad))) * (180 / Math.PI),
  }));
}

function shoelaceAreaM2(pts: { x: number; y: number }[]): number {
  if (pts.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function polygonAreaM2(points: LatLng[]): number {
  if (points.length < 3) return 0;
  return shoelaceAreaM2(projectPoints(points, meanLatRadOf(points)));
}

export function polygonAreaHa(points: LatLng[]): number {
  return polygonAreaM2(points) / 10000;
}

// Uniformly scales the plotted shape around its own centroid so its
// area matches targetHa exactly, preserving the outline the farmer
// actually drew (just bigger/smaller) rather than replacing it with a
// generic rectangle.
export function scalePolygonToArea(points: LatLng[], targetHa: number): LatLng[] {
  if (points.length < 3 || targetHa <= 0) return points;
  const meanLatRad = meanLatRadOf(points);
  const pts = projectPoints(points, meanLatRad);
  const currentM2 = shoelaceAreaM2(pts);
  if (currentM2 <= 0) return points;
  const factor = Math.sqrt((targetHa * 10000) / currentM2);
  const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
  const scaled = pts.map((p) => ({ x: cx + (p.x - cx) * factor, y: cy + (p.y - cy) * factor }));
  return unprojectPoints(scaled, meanLatRad).map((p) => ({ lat: +p.lat.toFixed(6), lng: +p.lng.toFixed(6) }));
}

export function polygonCentroid(points: LatLng[]): LatLng {
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / points.length,
    lng: points.reduce((s, p) => s + p.lng, 0) / points.length,
  };
}

// Nominatim — OpenStreetMap's free geocoder, same OSM stack the map
// tiles already come from, no API key needed. This is meant for
// occasional, user-initiated lookups (one tap = one request), which
// stays well within Nominatim's fair-use policy for an app this size;
// a high-traffic deployment should eventually run its own instance
// rather than calling the public one directly.
export async function geocodeAddress(query: string): Promise<LatLng | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=ph&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("The map search is unavailable right now.");
  const results = await res.json();
  if (!Array.isArray(results) || results.length === 0) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}
