import type { TripMode } from "@kjorebok/shared";

/** One GPS fix as input to track processing. */
export interface TrackPoint {
  /** Epoch milliseconds of the fix. */
  time: number;
  lat: number;
  lng: number;
  /** Reported horizontal accuracy in meters (68 % radius). */
  accuracy: number;
  /** Device-reported speed in m/s, null when unknown. */
  speed: number | null;
}

export interface TrackOptions {
  /** Fixes reporting worse accuracy than this are not used at all. */
  maxAccuracyMeters: number;
  /** Two fixes further apart than this speed allows (plus their accuracy) cannot both be right. */
  maxPlausibleSpeedMs: number;
  /** How many fixes in a row a burst of bad ones may span and still be skipped over. */
  outlierWindow: number;
  /** Expected acceleration noise (m/s²) of the motion model. */
  accelerationSigma: number;
  /** Squared normalized innovation above which a fix is treated as an outlier. */
  gateChi2: number;
  /** Bounds for the step a position must move before it counts as distance. */
  minStepMeters: number;
  maxStepMeters: number;
  /** Below this speed (m/s) a stretch counts as stopped. */
  movingSpeedMs: number;
  /**
   * A stretch at least this long (s) whose positions all fit within
   * `stayMaxExtentMeters` is a stop: parked, or waiting in a queue. A parked
   * phone's error drifts slowly, which the filter cannot tell from creeping
   * forward, so stops are recognised by how little ground they cover.
   */
  stayMinSeconds: number;
  stayMaxExtentMeters: number;
  /**
   * A stop cannot contain a smoothed speed above this (m/s). Manoeuvring in a
   * car park or creeping through a garage stays within a small box but is
   * real driving; a parked phone's drift, or someone walking with it, is
   * slower than this.
   */
  stayMaxSpeedMs: number;
  /** Time without fixes (s) that is reported as a gap. */
  gapSeconds: number;
  /** Douglas–Peucker tolerance for the map line. */
  simplifyToleranceMeters: number;
}

export const DEFAULT_TRACK_OPTIONS: TrackOptions = {
  maxAccuracyMeters: 200,
  maxPlausibleSpeedMs: 70,
  outlierWindow: 30,
  accelerationSigma: 1,
  gateChi2: 30,
  minStepMeters: 8,
  maxStepMeters: 25,
  movingSpeedMs: 1,
  stayMinSeconds: 60,
  stayMaxExtentMeters: 50,
  stayMaxSpeedMs: 2.5,
  gapSeconds: 60,
  simplifyToleranceMeters: 3,
};

export interface TrackGap {
  start: string;
  end: string;
  seconds: number;
  meters: number;
}

export interface TrackStop {
  start: string;
  end: string;
  seconds: number;
  lat: number;
  lng: number;
}

export interface TrackLinePoint {
  timestamp: string;
  lat: number;
  lng: number;
  speedKmh: number;
}

export interface ProcessedTrack {
  version: number;
  distanceMeters: number;
  /** The old measure: straight lines between every fix in time order. */
  rawDistanceMeters: number;
  durationSeconds: number;
  movingSeconds: number;
  stoppedSeconds: number;
  maxSpeedKmh: number;
  avgMovingSpeedKmh: number;
  inputPointCount: number;
  usedPointCount: number;
  rejectedPointCount: number;
  mode: TripMode;
  stops: TrackStop[];
  gaps: TrackGap[];
  /** Smoothed and simplified line for the map. */
  line: TrackLinePoint[];
}
