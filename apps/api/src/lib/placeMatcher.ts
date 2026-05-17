import type { Place } from "@kjorebok/shared";

function haversine(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) *
      Math.cos((bLat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function findMatchingPlace(
  places: Place[],
  lat: number | null | undefined,
  lng: number | null | undefined,
): Place | null {
  if (lat == null || lng == null) return null;
  let best: { place: Place; distance: number } | null = null;
  for (const place of places) {
    const distance = haversine(lat, lng, place.lat, place.lng);
    if (distance <= place.radiusMeters && (!best || distance < best.distance)) {
      best = { place, distance };
    }
  }
  return best?.place ?? null;
}
