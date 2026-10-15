import type { Prisma } from "@prisma/client/index.js";
import type { GpsPoint } from "@kjorebok/shared";
import { prisma } from "./prisma.js";
import {
  processTrack,
  type ProcessedTrack,
  type TrackLinePoint,
  type TrackPoint,
} from "./track/index.js";

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

/** The trip's fixes as input to track processing, with unknown speed kept as null. */
export async function loadTrackPoints(db: Db, tripId: string): Promise<TrackPoint[]> {
  const rows = await db.tripPoint.findMany({
    where: { tripId },
    orderBy: { recordedAt: "asc" },
    select: { recordedAt: true, lat: true, lng: true, accuracy: true, speed: true },
  });
  return rows.map((row) => ({
    time: row.recordedAt.getTime(),
    lat: row.lat,
    lng: row.lng,
    accuracy: row.accuracy,
    speed: row.speed,
  }));
}

/**
 * Trip columns derived from its processed track. While a trip is running only
 * the figures shown live change; the map line, stops, mode and processing
 * version are written once it is complete, or when it is reprocessed.
 */
export function trackColumns(track: ProcessedTrack, complete: boolean) {
  const first = track.line[0] ?? null;
  const last = track.line[track.line.length - 1] ?? null;
  return {
    distanceMeters: track.distanceMeters,
    rawDistanceMeters: track.rawDistanceMeters,
    maxSpeedKmh: track.maxSpeedKmh,
    avgMovingSpeedKmh: track.avgMovingSpeedKmh,
    movingSeconds: track.movingSeconds,
    stoppedSeconds: track.stoppedSeconds,
    pointCount: track.inputPointCount,
    rejectedPointCount: track.rejectedPointCount,
    startLat: first?.lat ?? null,
    startLng: first?.lng ?? null,
    endLat: last?.lat ?? null,
    endLng: last?.lng ?? null,
    ...(complete
      ? {
          mode: track.mode,
          track: track.line as unknown as Prisma.InputJsonValue,
          stops: track.stops as unknown as Prisma.InputJsonValue,
          processingVersion: track.version,
        }
      : {}),
  } satisfies Prisma.TripUpdateInput;
}

/** Processes the trip's stored fixes. */
export async function processTripPoints(db: Db, tripId: string): Promise<ProcessedTrack> {
  return processTrack(await loadTrackPoints(db, tripId));
}

/**
 * The stored map line in the GpsPoint shape clients render as `route`, or
 * null when the trip has not been processed yet.
 */
export function trackToRoute(track: Prisma.JsonValue | null): GpsPoint[] | null {
  if (!Array.isArray(track)) return null;
  return (track as unknown as TrackLinePoint[]).map((point) => ({
    lat: point.lat,
    lng: point.lng,
    speed: point.speedKmh / 3.6,
    heading: 0,
    accuracy: 0,
    timestamp: point.timestamp,
  }));
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
