const EARTH_RADIUS_METERS = 6371000;
const DEG = Math.PI / 180;

export interface LatLng {
  lat: number;
  lng: number;
}

/** Haversine distance in meters between two lat/lng points */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function routeDistance(points: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Flat east/north meters around an origin. The filter works in meters; the
 * inverse is exact, and distances are measured on the sphere afterwards, so
 * the projection's distortion over a trip only affects the smoothing.
 */
export interface LocalProjection {
  toLocal(point: LatLng): { x: number; y: number };
  toLatLng(x: number, y: number): LatLng;
}

export function localProjection(origin: LatLng): LocalProjection {
  const metersPerDegree = EARTH_RADIUS_METERS * DEG;
  const cosLat = Math.cos(origin.lat * DEG);
  return {
    toLocal: (point) => ({
      x: (point.lng - origin.lng) * metersPerDegree * cosLat,
      y: (point.lat - origin.lat) * metersPerDegree,
    }),
    toLatLng: (x, y) => ({
      lat: origin.lat + y / metersPerDegree,
      lng: origin.lng + x / (metersPerDegree * cosLat),
    }),
  };
}
