import type { TripMode } from "@kjorebok/shared";

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(values.length - 1, Math.max(0, Math.floor(values.length * q)));
  return values[index];
}

/**
 * Classifies a trip from smoothed speeds while moving (stops excluded). These
 * are close to the true speed, so the thresholds are plain typical speeds:
 * walking under ~7 km/h, cycling ~12–20, e-bikes held near their 25 km/h
 * assist limit, and cars faster than any of them at some point.
 */
export function classifyMovingSpeeds(movingSpeedsKmh: number[]): TripMode {
  const speeds = movingSpeedsKmh.filter((speed) => Number.isFinite(speed)).sort((a, b) => a - b);
  if (speeds.length === 0) return "OTHER";

  const median = percentile(speeds, 0.5);
  const p90 = percentile(speeds, 0.9);
  // Not the max: a few seconds of a bad estimate should not decide the mode.
  const p98 = percentile(speeds, 0.98);

  if (p98 >= 55 || p90 >= 42 || median >= 32) return "CAR";
  if (median >= 19) return "EBIKE";
  if (median >= 8 || p90 >= 13) return "CYCLE";
  return "WALK";
}
