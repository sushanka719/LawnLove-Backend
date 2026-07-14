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
