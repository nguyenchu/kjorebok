import { haversine, localProjection, routeDistance, type LatLng } from "./geo.js";
import { smoothTrack, type SmoothedState } from "./kalman.js";
import { classifyMovingSpeeds } from "./mode.js";
import { rejectImpossibleJumps } from "./outliers.js";
import { simplifyIndices } from "./simplify.js";
import {
  DEFAULT_TRACK_OPTIONS,
  type ProcessedTrack,
  type TrackGap,
  type TrackOptions,
  type TrackPoint,
  type TrackStop,
} from "./types.js";

/** Bump when the output for the same points changes, so stored results can be recomputed. */
export const TRACK_PROCESSING_VERSION = 2;

/**
 * Android and iOS report the radius that holds the true position 68 % of the
 * time. For a 2D normal distribution that radius is about 1.5 σ per axis.
 */
const ACCURACY_TO_SIGMA = 1 / 1.5;
/** Nobody's phone is better than this, whatever it claims. */
const MIN_SIGMA_METERS = 2;
/** Speeds with more uncertainty than this (right after a gap, say) do not count toward the max. */
const MAX_SPEED_SIGMA_MS = 3;

const toKmh = (speedMs: number) => speedMs * 3.6;
const isoTime = (ms: number) => new Date(ms).toISOString();

/** Valid fixes in time order; of two at the same moment the more accurate one is kept. */
function cleanPoints(points: TrackPoint[], maxAccuracyMeters: number): TrackPoint[] {
  const valid = points
    .filter(
      (p) =>
        Number.isFinite(p.time) &&
        Number.isFinite(p.lat) &&
        Number.isFinite(p.lng) &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180 &&
        p.accuracy > 0 &&
        p.accuracy <= maxAccuracyMeters,
    )
    .sort((a, b) => a.time - b.time);

  const unique: TrackPoint[] = [];
  for (const point of valid) {
    const last = unique[unique.length - 1];
    if (last && last.time === point.time) {
      if (point.accuracy < last.accuracy) unique[unique.length - 1] = point;
      continue;
    }
    unique.push(point);
  }
  return unique;
}

/**
 * Index ranges [first, last] where the vehicle stayed put: at least
 * `stayMinSeconds` long with every position inside a box whose diagonal is at
 * most `stayMaxExtentMeters` and no smoothed speed above `stayMaxSpeedMs`.
 * Ranges do not overlap and are in order.
 */
function findStays(states: SmoothedState[], options: TrackOptions): [number, number][] {
  const tooFast = (state: SmoothedState) => Math.hypot(state.vx, state.vy) > options.stayMaxSpeedMs;
  const stays: [number, number][] = [];
  let i = 0;
  while (i < states.length - 1) {
    if (tooFast(states[i])) {
      i++;
      continue;
    }
    let minX = states[i].x;
    let maxX = minX;
    let minY = states[i].y;
    let maxY = minY;
    let k = i + 1;
    for (; k < states.length; k++) {
      if (tooFast(states[k])) break;
      const { x, y } = states[k];
      const extent = Math.hypot(Math.max(maxX, x) - Math.min(minX, x), Math.max(maxY, y) - Math.min(minY, y));
      if (extent > options.stayMaxExtentMeters) break;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    const last = k - 1;
    if ((states[last].time - states[i].time) / 1000 >= options.stayMinSeconds) {
      const previous = stays[stays.length - 1];
      // One wandering fix can end a stay early; the next one then starts right
      // after it at the same spot, and both are really the same stop.
      if (
        previous &&
        previous[1] === i - 1 &&
        distanceBetween(meanPosition(states, previous), meanPosition(states, [i, last])) <=
          options.stayMaxExtentMeters / 2
      ) {
        previous[1] = last;
      } else {
        stays.push([i, last]);
      }
      i = k;
    } else {
      i++;
    }
  }
  return stays;
}

function meanPosition(states: SmoothedState[], [first, last]: [number, number]) {
  let x = 0;
  let y = 0;
  for (let i = first; i <= last; i++) {
    x += states[i].x;
    y += states[i].y;
  }
  const count = last - first + 1;
  return { x: x / count, y: y / count };
}

const distanceBetween = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

interface DistanceNode {
  position: LatLng;
  sigma: number;
}

/**
 * Distance along the smoothed track, counting a step only once the position
 * has moved further than its own uncertainty from where the last step ended,
 * so the little wander left after smoothing adds nothing.
 */
function measureDistance(nodes: DistanceNode[], options: TrackOptions): number {
  let anchor = 0;
  let distance = 0;
  for (let i = 1; i < nodes.length; i++) {
    const step = haversine(nodes[anchor].position, nodes[i].position);
    const noise = 2 * Math.max(nodes[anchor].sigma, nodes[i].sigma);
    const threshold = Math.min(options.maxStepMeters, Math.max(options.minStepMeters, noise));
    if (step >= threshold) {
      distance += step;
      anchor = i;
    }
  }
  return distance;
}

function centroid(positions: LatLng[]): LatLng {
  const sum = positions.reduce((acc, p) => ({ lat: acc.lat + p.lat, lng: acc.lng + p.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / positions.length, lng: sum.lng / positions.length };
}

function emptyResult(input: TrackPoint[], used: TrackPoint[]): ProcessedTrack {
  const first = used[0];
  const last = used[used.length - 1];
  const durationSeconds = first && last ? (last.time - first.time) / 1000 : 0;
  return {
    version: TRACK_PROCESSING_VERSION,
    distanceMeters: 0,
    rawDistanceMeters: routeDistance(used),
    durationSeconds,
    movingSeconds: 0,
    stoppedSeconds: durationSeconds,
    maxSpeedKmh: 0,
    avgMovingSpeedKmh: 0,
    inputPointCount: input.length,
    usedPointCount: used.length,
    rejectedPointCount: input.length - used.length,
    mode: "OTHER",
    stops: [],
    gaps: [],
    line: used.map((p) => ({ timestamp: isoTime(p.time), lat: p.lat, lng: p.lng, speedKmh: 0 })),
  };
}

/**
 * Turns a trip's raw fixes into the numbers the logbook reports:
 *
 * 1. drop invalid fixes and order by time
 * 2. drop fixes no vehicle could have reached (`rejectImpossibleJumps`)
 * 3. smooth with a Kalman filter and RTS smoother, dropping fixes the model
 *    finds implausible (`smoothTrack`)
 * 4. collapse stops to a single position (`findStays`)
 * 5. measure distance along what is left, ignoring movement within the
 *    noise (`measureDistance`)
 * 6. derive speed, moving time and mode from the smoothed velocity
 *
 * Pure: the same points and options always give the same result.
 */
export function processTrack(input: TrackPoint[], overrides: Partial<TrackOptions> = {}): ProcessedTrack {
  const options = { ...DEFAULT_TRACK_OPTIONS, ...overrides };

  const cleaned = cleanPoints(input, options.maxAccuracyMeters);
  const plausible = rejectImpossibleJumps(cleaned, options);
  if (plausible.length < 2) return emptyResult(input, plausible);

  const projection = localProjection(plausible[0]);
  const measurements = plausible.map((p) => ({
    time: p.time,
    ...projection.toLocal(p),
    sigma: Math.max(MIN_SIGMA_METERS, p.accuracy * ACCURACY_TO_SIGMA),
  }));
  const { states } = smoothTrack(measurements, options);
  if (states.length < 2) return emptyResult(input, states.map((s) => plausible[s.index]));

  const positions = states.map((s) => projection.toLatLng(s.x, s.y));
  const speeds = states.map((s) => Math.hypot(s.vx, s.vy));

  const stays = findStays(states, options);
  const stayOf = new Array<number>(states.length).fill(-1);
  stays.forEach(([first, last], stay) => {
    for (let i = first; i <= last; i++) {
      stayOf[i] = stay;
      speeds[i] = 0;
    }
  });
  const stops: TrackStop[] = stays.map(([first, last]) => ({
    start: isoTime(states[first].time),
    end: isoTime(states[last].time),
    seconds: (states[last].time - states[first].time) / 1000,
    ...centroid(positions.slice(first, last + 1)),
  }));

  const nodes: DistanceNode[] = [];
  for (let i = 0; i < states.length; i++) {
    const stay = stayOf[i];
    if (stay === -1) {
      nodes.push({ position: positions[i], sigma: states[i].positionSigma });
    } else if (i === stays[stay][0]) {
      nodes.push({ position: stops[stay], sigma: 0 });
    }
  }
  const distanceMeters = measureDistance(nodes, options);

  let movingSeconds = 0;
  const gaps: TrackGap[] = [];
  for (let i = 1; i < states.length; i++) {
    const seconds = (states[i].time - states[i - 1].time) / 1000;
    const meters = haversine(positions[i - 1], positions[i]);
    const isGap = seconds > options.gapSeconds;
    if (isGap) {
      gaps.push({ start: isoTime(states[i - 1].time), end: isoTime(states[i].time), seconds, meters });
    }
    if (stayOf[i] !== -1 && stayOf[i] === stayOf[i - 1]) continue;
    // Across a gap the velocity estimate says little; the average over it is more honest.
    const speed = isGap ? meters / seconds : (speeds[i - 1] + speeds[i]) / 2;
    if (speed >= options.movingSpeedMs) movingSeconds += seconds;
  }

  const durationSeconds = (states[states.length - 1].time - states[0].time) / 1000;
  const confidentSpeeds = speeds.filter((_, i) => states[i].velocitySigma <= MAX_SPEED_SIGMA_MS);
  const maxSpeedMs = (confidentSpeeds.length > 0 ? confidentSpeeds : speeds).reduce(
    (max, speed) => Math.max(max, speed),
    0,
  );
  const speedsKmh = speeds.map(toKmh);

  const line = simplifyIndices(states, options.simplifyToleranceMeters).map((i) => ({
    timestamp: isoTime(states[i].time),
    lat: positions[i].lat,
    lng: positions[i].lng,
    speedKmh: speedsKmh[i],
  }));

  return {
    version: TRACK_PROCESSING_VERSION,
    distanceMeters,
    rawDistanceMeters: routeDistance(cleaned),
    durationSeconds,
    movingSeconds,
    stoppedSeconds: durationSeconds - movingSeconds,
    maxSpeedKmh: toKmh(maxSpeedMs),
    avgMovingSpeedKmh: movingSeconds > 0 ? toKmh(distanceMeters / movingSeconds) : 0,
    inputPointCount: input.length,
    usedPointCount: states.length,
    rejectedPointCount: input.length - states.length,
    mode: classifyMovingSpeeds(speedsKmh.filter((speed) => speed >= toKmh(options.movingSpeedMs))),
    stops,
    gaps,
    line,
  };
}
