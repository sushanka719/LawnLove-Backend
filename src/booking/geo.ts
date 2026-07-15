// Mirror of LawnFrontend/lib/geo.ts so lawn area can be recomputed server-side
// from the submitted boundary — client-sent areas/prices are never trusted.
export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_METERS = 6378137;
const SQ_METERS_PER_SQ_FOOT = 0.09290304;

function toLocalMeters(point: LatLng, origin: LatLng) {
  const latRad = (origin.lat * Math.PI) / 180;
  const x =
    ((point.lng - origin.lng) *
      Math.PI *
      EARTH_RADIUS_METERS *
      Math.cos(latRad)) /
    180;
  const y = ((point.lat - origin.lat) * Math.PI * EARTH_RADIUS_METERS) / 180;
  return { x, y };
}

// Great-circle distance in meters between two points. Used to sanity-check that
// an agent started a job near the property (soft flag, not a hard gate).
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polygonAreaSqFt(points: LatLng[]): number {
  if (points.length < 3) {
    return 0;
  }

  const origin = points[0];
  const projected = points.map((point) => toLocalMeters(point, origin));

  let areaMeters = 0;
  for (let i = 0; i < projected.length; i++) {
    const current = projected[i];
    const next = projected[(i + 1) % projected.length];
    areaMeters += current.x * next.y - next.x * current.y;
  }
  areaMeters = Math.abs(areaMeters) / 2;

  return areaMeters / SQ_METERS_PER_SQ_FOOT;
}
