import type { TrackOptions } from "./types.js";

/** 2×2 matrix, row-major: [a, b, c, d] = [[a, b], [c, d]]. */
type Mat2 = [number, number, number, number];
type Vec2 = [number, number];

/** State of one axis: position and velocity, with covariance. */
interface AxisState {
  x: Vec2;
  P: Mat2;
}

const mul = (A: Mat2, B: Mat2): Mat2 => [
  A[0] * B[0] + A[1] * B[2],
  A[0] * B[1] + A[1] * B[3],
  A[2] * B[0] + A[3] * B[2],
  A[2] * B[1] + A[3] * B[3],
];
const transpose = (A: Mat2): Mat2 => [A[0], A[2], A[1], A[3]];
const add = (A: Mat2, B: Mat2): Mat2 => [A[0] + B[0], A[1] + B[1], A[2] + B[2], A[3] + B[3]];
const sub = (A: Mat2, B: Mat2): Mat2 => [A[0] - B[0], A[1] - B[1], A[2] - B[2], A[3] - B[3]];
const mulVec = (A: Mat2, v: Vec2): Vec2 => [A[0] * v[0] + A[1] * v[1], A[2] * v[0] + A[3] * v[1]];
function inverse(A: Mat2): Mat2 {
  const det = A[0] * A[3] - A[1] * A[2];
  return [A[3] / det, -A[1] / det, -A[2] / det, A[0] / det];
}
const transition = (dt: number): Mat2 => [1, dt, 0, 1];

/** Velocity is unknown at the start of a segment. */
const INITIAL_VELOCITY_VARIANCE = 30 ** 2;
/** After this many rejected fixes in a row the model, not the fixes, is assumed wrong. */
const MAX_CONSECUTIVE_REJECTED = 2;

/** Constant-velocity prediction with white-noise acceleration of spectral density q. */
function predict(state: AxisState, dt: number, q: number): AxisState {
  const F = transition(dt);
  const Q: Mat2 = [(q * dt ** 3) / 3, (q * dt ** 2) / 2, (q * dt ** 2) / 2, q * dt];
  return {
    x: mulVec(F, state.x),
    P: add(mul(mul(F, state.P), transpose(F)), Q),
  };
}

/** Position measurement z with variance r. */
function update(state: AxisState, z: number, r: number): AxisState {
  const [a, b, c, d] = state.P;
  const s = a + r;
  const k1 = a / s;
  const k2 = c / s;
  const innovation = z - state.x[0];
  return {
    x: [state.x[0] + k1 * innovation, state.x[1] + k2 * innovation],
    P: [(1 - k1) * a, (1 - k1) * b, c - k2 * a, d - k2 * b],
  };
}

export interface Measurement {
  /** Epoch milliseconds. */
  time: number;
  /** East/north meters in a local projection. */
  x: number;
  y: number;
  /** Standard deviation of each coordinate, in meters. */
  sigma: number;
}

export interface SmoothedState {
  /** Index into the measurements passed in. */
  index: number;
  time: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  positionSigma: number;
  velocitySigma: number;
}

interface Step {
  index: number;
  dt: number;
  predicted: [AxisState, AxisState];
  filtered: [AxisState, AxisState];
}

function startState(m: Measurement): [AxisState, AxisState] {
  const r = m.sigma ** 2;
  return [
    { x: [m.x, 0], P: [r, 0, 0, INITIAL_VELOCITY_VARIANCE] },
    { x: [m.y, 0], P: [r, 0, 0, INITIAL_VELOCITY_VARIANCE] },
  ];
}

/** Rauch–Tung–Striebel backward pass over one segment of filtered steps. */
function smoothSegment(steps: Step[]): AxisState[][] {
  const smoothed = steps.map((step) => [...step.filtered]);
  for (let k = steps.length - 2; k >= 0; k--) {
    const next = steps[k + 1];
    const F = transition(next.dt);
    for (let axis = 0; axis < 2; axis++) {
      const filtered = steps[k].filtered[axis];
      const predicted = next.predicted[axis];
      const later = smoothed[k + 1][axis];
      const gain = mul(mul(filtered.P, transpose(F)), inverse(predicted.P));
      const correction = mulVec(gain, [later.x[0] - predicted.x[0], later.x[1] - predicted.x[1]]);
      smoothed[k][axis] = {
        x: [filtered.x[0] + correction[0], filtered.x[1] + correction[1]],
        P: add(filtered.P, mul(mul(gain, sub(later.P, predicted.P)), transpose(gain))),
      };
    }
  }
  return smoothed;
}

/**
 * Kalman filter with a constant-velocity model on each axis, followed by an
 * RTS smoother: every position is estimated from the fixes both before and
 * after it, which is possible because the whole trip is known.
 *
 * Fixes too far from where the model expected them are dropped. If several in
 * a row are, the vehicle really did something the model did not expect, so a
 * new segment starts there instead of smoothing across the break.
 */
export function smoothTrack(
  measurements: Measurement[],
  options: Pick<TrackOptions, "accelerationSigma" | "gateChi2">,
): { states: SmoothedState[]; rejected: number } {
  if (measurements.length === 0) return { states: [], rejected: 0 };

  const q = options.accelerationSigma ** 2;
  const segments: Step[][] = [];
  let segment: Step[] = [];
  let rejected = 0;
  let consecutiveRejected = 0;

  const start = (index: number) => {
    const state = startState(measurements[index]);
    segment = [{ index, dt: 0, predicted: state, filtered: state }];
    segments.push(segment);
  };
  start(0);

  for (let i = 1; i < measurements.length; i++) {
    const m = measurements[i];
    const last = segment[segment.length - 1];
    const dt = (m.time - measurements[last.index].time) / 1000;
    const r = m.sigma ** 2;

    const predicted: [AxisState, AxisState] = [
      predict(last.filtered[0], dt, q),
      predict(last.filtered[1], dt, q),
    ];
    const innovationX = m.x - predicted[0].x[0];
    const innovationY = m.y - predicted[1].x[0];
    const normalized =
      innovationX ** 2 / (predicted[0].P[0] + r) + innovationY ** 2 / (predicted[1].P[0] + r);

    if (normalized > options.gateChi2) {
      if (consecutiveRejected < MAX_CONSECUTIVE_REJECTED) {
        consecutiveRejected++;
        rejected++;
        continue;
      }
      consecutiveRejected = 0;
      start(i);
      continue;
    }

    consecutiveRejected = 0;
    segment.push({
      index: i,
      dt,
      predicted,
      filtered: [update(predicted[0], m.x, r), update(predicted[1], m.y, r)],
    });
  }

  const states: SmoothedState[] = [];
  for (const steps of segments) {
    const smoothed = smoothSegment(steps);
    steps.forEach((step, k) => {
      const [ax, ay] = smoothed[k];
      states.push({
        index: step.index,
        time: measurements[step.index].time,
        x: ax.x[0],
        y: ay.x[0],
        vx: ax.x[1],
        vy: ay.x[1],
        positionSigma: Math.sqrt(Math.max(ax.P[0], ay.P[0])),
        velocitySigma: Math.sqrt(Math.max(ax.P[3], ay.P[3])),
      });
    });
  }

  return { states, rejected };
}
