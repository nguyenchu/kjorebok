/**
 * Synthetic GPS traces with a known true path, so tests can check processed
 * distance against the real one. Deterministic for a given seed.
 */
import { localProjection } from "../src/lib/track/geo.js";
import type { TrackPoint } from "../src/lib/track/index.js";

const ORIGIN = { lat: 59.91, lng: 10.75 };
const START_TIME = Date.UTC(2026, 9, 15, 8, 0, 0);

interface Segment {
  duration: number;
  speed: number;
  position: (tau: number) => { x: number; y: number };
}

export class Route {
  private segments: Segment[] = [];
  private x = 0;
  private y = 0;
  /** Radians, 0 = north, clockwise. */
  private heading = 0;
  trueDistance = 0;

  straight(meters: number, speedMs: number): this {
    const { x, y, heading } = this;
    this.segments.push({
      duration: meters / speedMs,
      speed: speedMs,
      position: (tau) => ({
        x: x + Math.sin(heading) * speedMs * tau,
        y: y + Math.cos(heading) * speedMs * tau,
      }),
    });
    this.x += Math.sin(heading) * meters;
    this.y += Math.cos(heading) * meters;
    this.trueDistance += meters;
    return this;
  }

  /** Turn by `degrees` (positive = right) along a circle of `radius`. */
  turn(degrees: number, radius: number, speedMs: number): this {
    const angle = (Math.abs(degrees) * Math.PI) / 180;
    const sign = Math.sign(degrees);
    const { x, y, heading } = this;
    // Centre lies to the right (sign 1) or left (sign -1) of travel.
    const cx = x + sign * Math.cos(heading) * radius;
    const cy = y - sign * Math.sin(heading) * radius;
    const startAngle = Math.atan2(y - cy, x - cx);
    const length = angle * radius;
    this.segments.push({
      duration: length / speedMs,
      speed: speedMs,
      position: (tau) => {
        const a = startAngle - sign * (speedMs * tau) / radius;
        return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
      },
    });
    const end = startAngle - sign * angle;
    this.x = cx + radius * Math.cos(end);
    this.y = cy + radius * Math.sin(end);
    this.heading += sign * angle;
    this.trueDistance += length;
    return this;
  }

  stop(seconds: number): this {
    const { x, y } = this;
    this.segments.push({ duration: seconds, speed: 0, position: () => ({ x, y }) });
    return this;
  }

  get duration(): number {
    return this.segments.reduce((sum, s) => sum + s.duration, 0);
  }

  at(t: number): { x: number; y: number; speed: number } {
    let start = 0;
    for (const segment of this.segments) {
      if (t <= start + segment.duration) {
        return { ...segment.position(t - start), speed: segment.speed };
      }
      start += segment.duration;
    }
    const last = this.segments[this.segments.length - 1];
    return { ...last.position(last.duration), speed: 0 };
  }
}

function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SampleOptions {
  intervalSeconds: number;
  /** Reported accuracy; the actual noise is drawn to match it. */
  accuracy: number;
  seed?: number;
  /** 0 = independent noise per fix, near 1 = slowly drifting like a parked phone. */
  correlation?: number;
  /** Seconds with no fixes, e.g. a tunnel. */
  skip?: [number, number][];
  /** Report speed as unknown. */
  unknownSpeed?: boolean;
}

export function sample(route: Route, options: SampleOptions): TrackPoint[] {
  const rand = random(options.seed ?? 1);
  const gaussian = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const sigma = options.accuracy / 1.5;
  const rho = options.correlation ?? 0;
  const projection = localProjection(ORIGIN);
  let nx = gaussian() * sigma;
  let ny = gaussian() * sigma;

  const points: TrackPoint[] = [];
  for (let t = 0; t <= route.duration + 1e-9; t += options.intervalSeconds) {
    nx = rho * nx + Math.sqrt(1 - rho * rho) * gaussian() * sigma;
    ny = rho * ny + Math.sqrt(1 - rho * rho) * gaussian() * sigma;
    if (options.skip?.some(([from, to]) => t > from && t < to)) continue;
    const truth = route.at(t);
    const { lat, lng } = projection.toLatLng(truth.x + nx, truth.y + ny);
    points.push({
      time: START_TIME + Math.round(t * 1000),
      lat,
      lng,
      accuracy: options.accuracy,
      speed: options.unknownSpeed ? null : Math.max(0, truth.speed + gaussian() * 0.3),
    });
  }
  return points;
}

/** Moves one fix by the given meters east/north. */
export function displace(point: TrackPoint, east: number, north: number): TrackPoint {
  const projection = localProjection(point);
  const { lat, lng } = projection.toLatLng(east, north);
  return { ...point, lat, lng };
}

export const kmh = (value: number) => value / 3.6;
