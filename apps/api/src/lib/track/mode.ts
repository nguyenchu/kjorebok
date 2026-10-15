import type { TripMode } from "@kjorebok/shared";

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * q)));
  return values[index];
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
