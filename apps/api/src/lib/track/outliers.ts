import { haversine } from "./geo.js";
import type { TrackOptions, TrackPoint } from "./types.js";

/** Extra meters allowed between two fixes on top of their reported accuracy. */
const POSITION_SLACK_METERS = 10;

function canFollow(a: TrackPoint, b: TrackPoint, maxSpeedMs: number): boolean {
  const seconds = (b.time - a.time) / 1000;
  return haversine(a, b) <= maxSpeedMs * seconds + a.accuracy + b.accuracy + POSITION_SLACK_METERS;
}

/**
 * Keeps the longest sequence of fixes in which each one is physically
 * reachable from the previous kept one, allowing up to `outlierWindow` bad
 * fixes in a row to be skipped. Unlike comparing each fix to the last
 * accepted one, a wrong first fix cannot make every following good fix look
 * like the outlier.
 *
 * `points` must be sorted by time with no two at the same time.
 */
export function rejectImpossibleJumps(
  points: TrackPoint[],
  options: Pick<TrackOptions, "maxPlausibleSpeedMs" | "outlierWindow">,
): TrackPoint[] {
  const n = points.length;
  if (n <= 2) return points;

  const length = new Array<number>(n).fill(1);
  const previous = new Array<number>(n).fill(-1);

  for (let j = 1; j < n; j++) {
    const earliest = Math.max(0, j - options.outlierWindow - 1);
    // Nearest predecessor wins a tie, so no good fix is skipped needlessly.
    for (let i = j - 1; i >= earliest; i--) {
      if (length[i] + 1 > length[j] && canFollow(points[i], points[j], options.maxPlausibleSpeedMs)) {
        length[j] = length[i] + 1;
        previous[j] = i;
      }
    }
  }

  // Latest end among the longest chains, so the trip keeps its real end.
  let end = 0;
  for (let j = 1; j < n; j++) {
    if (length[j] >= length[end]) end = j;
  }

  const kept: TrackPoint[] = [];
  for (let k = end; k !== -1; k = previous[k]) kept.push(points[k]);
  return kept.reverse();
}
