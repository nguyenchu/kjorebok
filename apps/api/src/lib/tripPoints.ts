import type { Prisma } from "@prisma/client/index.js";
import type { GpsPoint } from "@kjorebok/shared";
import { prisma } from "./prisma.js";

type Db = Prisma.TransactionClient | typeof prisma;

/** A fix as the app sends it. speed/heading are null when the device did not know. */
export interface IncomingPoint {
  lat: number;
  lng: number;
  accuracy: number;
  speed: number | null;
  heading: number | null;
  altitude?: number | null;
  altitudeAccuracy?: number | null;
  timestamp: string;
}

/** Haversine distance in meters between two lat/lng points */
export function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function routeDistance(points: { lat: number; lng: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

export function toPointRow(point: IncomingPoint) {
  return {
    recordedAt: new Date(point.timestamp),
    lat: point.lat,
    lng: point.lng,
    accuracy: point.accuracy,
    speed: point.speed,
    heading: point.heading,
    altitude: point.altitude ?? null,
    altitudeAccuracy: point.altitudeAccuracy ?? null,
  };
}

/**
 * Stores fixes for a trip. Fixes already stored (same timestamp) are skipped,
 * so a batch the app resends after a lost response is not counted twice.
 * Returns how many were new.
 */
export async function insertPoints(db: Db, tripId: string, points: IncomingPoint[]): Promise<number> {
  if (points.length === 0) return 0;
  const result = await db.tripPoint.createMany({
    data: points.map((point) => ({ tripId, ...toPointRow(point) })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * The trip's route in time order, in the shape clients already render.
 * Unknown speed/heading are reported as 0 until the shared GpsPoint type
 * allows null; nothing that reads this route uses those two fields.
 */
export async function loadRoute(db: Db, tripId: string): Promise<GpsPoint[]> {
  const rows = await db.tripPoint.findMany({
    where: { tripId },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, lat: true, lng: true, accuracy: true, speed: true, heading: true },
  });
  return rows.map((row) => ({
    lat: row.lat,
    lng: row.lng,
    speed: row.speed ?? 0,
    heading: row.heading ?? 0,
    accuracy: row.accuracy,
    timestamp: row.recordedAt.toISOString(),
  }));
}

/** Trip columns derived from its route. */
export function summarizeRoute(route: GpsPoint[]) {
  const first = route[0] ?? null;
  const last = route[route.length - 1] ?? null;
  return {
    distanceMeters: routeDistance(route),
    startLat: first?.lat ?? null,
    startLng: first?.lng ?? null,
    endLat: last?.lat ?? null,
    endLng: last?.lng ?? null,
  };
}

/**
 * Runs `fn` in a transaction holding a row lock on the user's active trip, so
 * concurrent batches and the end request cannot interleave their
 * read-compute-write of the trip's derived columns. Resolves to null when the
 * trip does not exist, belongs to someone else or is no longer active.
 */
export async function withActiveTrip<T>(
  userId: string,
  tripId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<{ result: T } | null> {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Trip"
      WHERE "id" = ${tripId} AND "userId" = ${userId} AND "status" = 'ACTIVE'
      FOR UPDATE`;
    if (locked.length === 0) return null;
    return { result: await fn(tx) };
  });
}
