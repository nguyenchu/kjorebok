import type { GpsPoint, TripMode } from "@kjorebok/shared";
import { haversine, routeDistance } from "./geo.js";

const MAX_MODE_ACCURACY_METERS = 80;
const MAX_SEGMENT_GAP_MS = 2 * 60 * 1000;
const MAX_REASONABLE_SEGMENT_SPEED_KMH = 160;

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * q)));
  return values[index];
}

function toKmh(speedMs: number): number {
  return speedMs * 3.6;
}

/**
 * Detect trip mode from raw fixes, combining device-reported speed with speed
 * derived from consecutive fixes. Kept for routes until they are processed;
 * `processTrack` classifies from the smoothed track instead.
 */
export function detectTripMode(points: GpsPoint[]): TripMode {
  if (points.length < 2) return "WALK";

  const usablePoints = points.filter((point) => point.accuracy > 0 && point.accuracy <= MAX_MODE_ACCURACY_METERS);
  const route = usablePoints.length >= 2 ? usablePoints : points;

  const reportedSpeeds = route
    .map((point) => toKmh(Math.max(0, point.speed)))
    .filter((speed) => Number.isFinite(speed) && speed <= MAX_REASONABLE_SEGMENT_SPEED_KMH);

  const segmentSpeeds: number[] = [];
  let movingSegments = 0;
  let totalSegments = 0;

  for (let i = 1; i < route.length; i++) {
    const previous = route[i - 1];
    const current = route[i];
    const timeMs = new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime();
    if (!Number.isFinite(timeMs) || timeMs <= 0 || timeMs > MAX_SEGMENT_GAP_MS) continue;

    const distanceMeters = haversine(previous, current);
    const speedKmh = (distanceMeters / (timeMs / 1000)) * 3.6;
    if (!Number.isFinite(speedKmh) || speedKmh > MAX_REASONABLE_SEGMENT_SPEED_KMH) continue;

    totalSegments += 1;
    if (speedKmh >= MODE_MOVING_SPEED_KMH) movingSegments += 1;
    segmentSpeeds.push(speedKmh);
  }

  return classifyMode({
    speedsKmh: [...reportedSpeeds, ...segmentSpeeds],
    distanceKm: routeDistance(route) / 1000,
    movingRatio: totalSegments > 0 ? movingSegments / totalSegments : 0,
  });
}

/**
 * Classifies a trip from smoothed speeds while moving (stops excluded).
 *
 * Only walking is told apart from driving. A car in a 30 zone or a queue moves
 * at the same speeds as a bicycle or an e-bike, so speed cannot separate them,
 * and almost every trip in a kjørebok is a car: anything faster than walking
 * is CAR, and the user marks the occasional bike trip by hand.
 */
export function classifyMovingSpeeds(movingSpeedsKmh: number[]): TripMode {
  const speeds = movingSpeedsKmh.filter((speed) => Number.isFinite(speed)).sort((a, b) => a - b);
  if (speeds.length === 0) return "OTHER";

  const median = percentile(speeds, 0.5);
  const p90 = percentile(speeds, 0.9);

  if (median < 8 && p90 < 13) return "WALK";
  return "CAR";
}

/** Below this a moment counts as standing still for `movingRatio`. */
export const MODE_MOVING_SPEED_KMH = 2.5;

/**
 * Classifies a trip from raw speed samples using a few robust statistics
 * instead of a single speed threshold. The thresholds sit high to make up for
 * the noise in speeds derived from single fixes, which is why a brisk walk can
 * still come out as cycling.
 */
export function classifyMode({
  speedsKmh,
  distanceKm,
  movingRatio,
}: {
  speedsKmh: number[];
  distanceKm: number;
  /** Share of the trip spent at or above MODE_MOVING_SPEED_KMH. */
  movingRatio: number;
}): TripMode {
  const speeds = speedsKmh.filter((speed) => Number.isFinite(speed)).sort((a, b) => a - b);
  if (speeds.length === 0) return "OTHER";

  const median = percentile(speeds, 0.5);
  const p75 = percentile(speeds, 0.75);
  const p90 = percentile(speeds, 0.9);
  const max = speeds[speeds.length - 1];

  if (
    p90 >= 36 ||
    max >= 55 ||
    (median >= 18 && p75 >= 28) ||
    (distanceKm >= 3 && median >= 16 && movingRatio >= 0.45)
  ) {
    return "CAR";
  }

  if (
    p90 >= 22 ||
    max >= 32 ||
    (median >= 13 && p75 >= 18) ||
    (distanceKm >= 2 && median >= 12 && movingRatio >= 0.55)
  ) {
    return "EBIKE";
  }

  if (
    p90 >= 9 ||
    max >= 18 ||
    (median >= 5.5 && p75 >= 8) ||
    (distanceKm >= 0.8 && median >= 4.5 && movingRatio >= 0.6)
  ) {
    return "CYCLE";
  }

  return "WALK";
}
