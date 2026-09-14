/**
 * Auto trip detection using expo-location background tasks.
 *
 * Tracking is intended to stay on continuously once permissions are granted.
 *
 * Background invocations get a small, interruptible CPU budget — especially on
 * iOS — so the whole tracker state is read once into a snapshot, mutated in
 * memory across a whole location batch, and written back once. Every entry
 * point runs through `serialize` so overlapping task callbacks can never
 * interleave two reads of the same state and start duplicate trips.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";
import { api, getToken } from "./api";
import type { GpsPoint } from "@kjorebok/shared";

export const BACKGROUND_LOCATION_TASK = "kjorebok-background-location";

const STOP_CONFIRM_MS = 3 * 60 * 1000;
const SYNC_BATCH_SIZE = 25;
const MAX_PENDING_POINTS = 2000;
const MAX_USABLE_ACCURACY_METERS = 40;
const MAX_ROUTE_ACCURACY_METERS = 30;
/** Relaxed ceiling used to avoid gaps when accuracy stays poor for a while. */
const FALLBACK_ROUTE_ACCURACY_METERS = 75;
const ROUTE_GAP_TOLERANCE_MS = 60 * 1000;
const MIN_ROUTE_POINT_DISTANCE_METERS = 5;
// Windowed motion detection constants
const MOVEMENT_WINDOW_MS = 60 * 1000;
/**
 * Must stay wider than SUSTAINED_MIN_AGE_MS. Samples are filtered to this
 * window and then required to span SUSTAINED_MIN_AGE_MS; when the two were
 * both 30 s that could only hold if the oldest sample landed exactly on the
 * cutoff millisecond. Real GPS timestamps never line up that way, so the span
 * came out just under the threshold every time and a stopped car was never
 * recognised as stopped — trips stayed open until something else closed them.
 */
const STATIONARY_WINDOW_MS = 45 * 1000;
const SUSTAINED_MIN_AGE_MS = 30 * 1000;
const SUSTAINED_MOVE_DISTANCE_METERS = 30;
const STATIONARY_MAX_SPREAD_METERS = 15;
const DEFINITIVE_MOVING_SPEED_MS = 15 / 3.6;
const POSITION_WINDOW_MAX_SAMPLES = 60;
const TRIP_NOTIFICATION_CHANNEL = "trips";
const BACKGROUND_NOTIFICATION_CHANNEL = "com.nguyenchu.kjorebok:kjorebok-background-location";

type TrackerState = "IDLE" | "DETECTING_START" | "RECORDING" | "DETECTING_STOP";

const STATE_KEY = "tracker_state";
const ACTIVE_TRIP_KEY = "tracker_active_trip_id";
const STOP_TIME_KEY = "tracker_stop_time";
const PENDING_POINTS_KEY = "tracker_pending_points";
const LAST_POINT_KEY = "tracker_last_point";
const POSITION_WINDOW_KEY = "tracker_position_window";
const LAST_TASK_AT_KEY = "tracker_last_task_at";
const LAST_SYNC_AT_KEY = "tracker_last_sync_at";
const LOG_ENTRIES_KEY = "tracker_log_entries";
const LAST_SPEED_KEY = "tracker_last_speed";
const LAST_ACCURACY_KEY = "tracker_last_accuracy";
const START_CANDIDATE_COUNT_KEY = "tracker_start_candidate_count";
const START_REASON_KEY = "tracker_start_reason";
const START_FAIL_COUNT_KEY = "tracker_start_fail_count";
const LAST_ROUTE_POINT_AT_KEY = "tracker_last_route_point_at";
const SELECTED_VEHICLE_KEY = "tracker_selected_vehicle";
const LOCATION_MODE_KEY = "tracker_location_mode";
const MAX_START_FAIL_COUNT = 6;
const STALE_TRIP_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_ENTRIES = 20;

const SNAPSHOT_KEYS = [
  STATE_KEY,
  ACTIVE_TRIP_KEY,
  STOP_TIME_KEY,
  PENDING_POINTS_KEY,
  LAST_POINT_KEY,
  POSITION_WINDOW_KEY,
  LAST_SYNC_AT_KEY,
  LOG_ENTRIES_KEY,
  LAST_SPEED_KEY,
  LAST_ACCURACY_KEY,
  START_CANDIDATE_COUNT_KEY,
  START_REASON_KEY,
  START_FAIL_COUNT_KEY,
  LAST_ROUTE_POINT_AT_KEY,
  SELECTED_VEHICLE_KEY,
  LOCATION_MODE_KEY,
] as const;

const DEFAULT_START_REASON = "Telefonen venter på tydelig bevegelse.";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

type LogLevel = "info" | "warn" | "error";

export interface TrackerLogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
}

export interface TrackerDiagnostics {
  state: TrackerState;
  activeTripId: string | null;
  pendingPoints: number;
  trackingEnabled: boolean;
  hasToken: boolean;
  notificationPermission: Notifications.PermissionStatus;
  tripNotificationChannel: string;
  backgroundNotificationChannel: string;
  availableNotificationChannels: Array<{
    id: string;
    name: string | null;
    importance: number;
  }>;
  locationServicesEnabled: boolean;
  foregroundPermission: Location.PermissionStatus;
  backgroundPermission: Location.PermissionStatus;
  lastPointTimestamp: string | null;
  lastTaskAt: string | null;
  lastSyncAt: string | null;
  lastSpeedKmh: number | null;
  lastAccuracyMeters: number | null;
  startCandidateCount: number;
  startReason: string;
  selectedVehicleId: string | null;
  recentEvents: TrackerLogEntry[];
}

type PositionSample = { lat: number; lng: number; timestamp: string };

/**
 * The whole tracker state, held in memory for the duration of one invocation.
 * `dirty` keys are the only ones written back, so a snapshot that only read
 * state costs nothing on the way out.
 */
interface Snapshot {
  state: TrackerState;
  activeTripId: string | null;
  stopTime: number | null;
  pendingPoints: GpsPoint[];
  lastPoint: GpsPoint | null;
  positionWindow: PositionSample[];
  lastSyncAt: string | null;
  logEntries: TrackerLogEntry[];
  lastSpeed: number | null;
  lastAccuracy: number | null;
  startCandidateCount: number;
  startReason: string;
  startFailCount: number;
  lastRoutePointAt: number | null;
  selectedVehicleId: string | null;
  /** Last applied location profile, so a restart is only paid for on change. */
  locationMode: LocationMode | null;
  dirty: Set<string>;
}

/**
 * Serializes every entry point. Two background callbacks firing while the app
 * is alive share this module instance, and without the queue both could read
 * state "IDLE" and each POST a new trip.
 */
let workQueue: Promise<unknown> = Promise.resolve();

function serialize<T>(fn: () => Promise<T>): Promise<T> {
  const run = () => fn();
  const next = workQueue.then(run, run);
  workQueue = next.catch(() => undefined);
  return next;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function parseNumber(raw: string | null): number | null {
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function isGpsPoint(value: unknown): value is GpsPoint {
  const point = value as GpsPoint | null;
  return (
    typeof point?.lat === "number" &&
    typeof point?.lng === "number" &&
    typeof point?.timestamp === "string"
  );
}

async function loadSnapshot(): Promise<Snapshot> {
  const entries = await AsyncStorage.multiGet(SNAPSHOT_KEYS as unknown as string[]);
  const map = new Map(entries);
  const read = (key: string) => map.get(key) ?? null;

  const lastPoint = parseJson<GpsPoint | null>(read(LAST_POINT_KEY), null);
  const positionWindow = parseJson<PositionSample[]>(read(POSITION_WINDOW_KEY), []);
  const pendingPoints = parseJson<GpsPoint[]>(read(PENDING_POINTS_KEY), []);
  const logEntries = parseJson<TrackerLogEntry[]>(read(LOG_ENTRIES_KEY), []);

  return {
    state: (read(STATE_KEY) ?? "IDLE") as TrackerState,
    activeTripId: read(ACTIVE_TRIP_KEY),
    stopTime: parseNumber(read(STOP_TIME_KEY)),
    pendingPoints: Array.isArray(pendingPoints) ? pendingPoints.filter(isGpsPoint) : [],
    lastPoint: isGpsPoint(lastPoint) ? lastPoint : null,
    positionWindow: Array.isArray(positionWindow) ? positionWindow : [],
    lastSyncAt: read(LAST_SYNC_AT_KEY),
    logEntries: Array.isArray(logEntries) ? logEntries : [],
    lastSpeed: parseNumber(read(LAST_SPEED_KEY)),
    lastAccuracy: parseNumber(read(LAST_ACCURACY_KEY)),
    startCandidateCount: parseNumber(read(START_CANDIDATE_COUNT_KEY)) ?? 0,
    startReason: read(START_REASON_KEY) ?? DEFAULT_START_REASON,
    startFailCount: parseNumber(read(START_FAIL_COUNT_KEY)) ?? 0,
    lastRoutePointAt: parseNumber(read(LAST_ROUTE_POINT_AT_KEY)),
    selectedVehicleId: read(SELECTED_VEHICLE_KEY),
    locationMode: (read(LOCATION_MODE_KEY) as LocationMode | null) ?? null,
    dirty: new Set(),
  };
}

function serializeValue(snapshot: Snapshot, key: string): string | null {
  switch (key) {
    case STATE_KEY:
      return snapshot.state;
    case ACTIVE_TRIP_KEY:
      return snapshot.activeTripId;
    case STOP_TIME_KEY:
      return snapshot.stopTime === null ? null : String(snapshot.stopTime);
    case PENDING_POINTS_KEY:
      return JSON.stringify(snapshot.pendingPoints);
    case LAST_POINT_KEY:
      return snapshot.lastPoint ? JSON.stringify(snapshot.lastPoint) : null;
    case POSITION_WINDOW_KEY:
      return JSON.stringify(snapshot.positionWindow);
    case LAST_SYNC_AT_KEY:
      return snapshot.lastSyncAt;
    case LOG_ENTRIES_KEY:
      return JSON.stringify(snapshot.logEntries);
    case LAST_SPEED_KEY:
      return snapshot.lastSpeed === null ? null : String(snapshot.lastSpeed);
    case LAST_ACCURACY_KEY:
      return snapshot.lastAccuracy === null ? null : String(snapshot.lastAccuracy);
    case START_CANDIDATE_COUNT_KEY:
      return String(snapshot.startCandidateCount);
    case START_REASON_KEY:
      return snapshot.startReason;
    case START_FAIL_COUNT_KEY:
      return String(snapshot.startFailCount);
    case LAST_ROUTE_POINT_AT_KEY:
      return snapshot.lastRoutePointAt === null ? null : String(snapshot.lastRoutePointAt);
    case SELECTED_VEHICLE_KEY:
      return snapshot.selectedVehicleId;
    case LOCATION_MODE_KEY:
      return snapshot.locationMode;
    default:
      return null;
  }
}

async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  if (snapshot.dirty.size === 0) return;

  const writes: Array<[string, string]> = [];
  const removals: string[] = [];

  for (const key of snapshot.dirty) {
    const value = serializeValue(snapshot, key);
    if (value === null) removals.push(key);
    else writes.push([key, value]);
  }

  snapshot.dirty.clear();

  await Promise.all([
    writes.length > 0 ? AsyncStorage.multiSet(writes) : Promise.resolve(),
    removals.length > 0 ? AsyncStorage.multiRemove(removals) : Promise.resolve(),
  ]);
}

function touch(snapshot: Snapshot, ...keys: string[]): void {
  for (const key of keys) snapshot.dirty.add(key);
}

function setStartReason(snapshot: Snapshot, reason: string): void {
  if (snapshot.startReason === reason) return;
  snapshot.startReason = reason;
  touch(snapshot, START_REASON_KEY);
}

function log(snapshot: Snapshot, message: string, level: LogLevel = "info"): void {
  snapshot.logEntries.unshift({
    timestamp: new Date().toISOString(),
    level,
    message,
  });
  snapshot.logEntries = snapshot.logEntries.slice(0, MAX_LOG_ENTRIES);
  touch(snapshot, LOG_ENTRIES_KEY);
}

function markSyncSuccess(snapshot: Snapshot): void {
  snapshot.lastSyncAt = new Date().toISOString();
  touch(snapshot, LAST_SYNC_AT_KEY);
}

async function markTaskHeartbeat(timestamp = new Date().toISOString()): Promise<void> {
  await AsyncStorage.setItem(LAST_TASK_AT_KEY, timestamp);
}

function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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

function isUsableAccuracy(point: GpsPoint): boolean {
  return point.accuracy > 0 && point.accuracy <= MAX_USABLE_ACCURACY_METERS;
}

function sampleAgeMs(samples: PositionSample[]): number {
  if (samples.length < 2) return 0;
  const first = new Date(samples[0].timestamp).getTime();
  const last = new Date(samples[samples.length - 1].timestamp).getTime();
  return Math.max(0, last - first);
}

function samplesInLastMs(samples: PositionSample[], windowMs: number, nowMs: number): PositionSample[] {
  const cutoff = nowMs - windowMs;
  return samples.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
}

/**
 * Bounding-box diagonal rather than an O(n²) pairwise scan — same decision at
 * the 15 m threshold, but cheap enough to run on every point in a batch.
 */
function maxSpreadMeters(samples: PositionSample[]): number {
  if (samples.length < 2) return 0;

  let minLat = samples[0].lat;
  let maxLat = samples[0].lat;
  let minLng = samples[0].lng;
  let maxLng = samples[0].lng;

  for (const sample of samples) {
    if (sample.lat < minLat) minLat = sample.lat;
    if (sample.lat > maxLat) maxLat = sample.lat;
    if (sample.lng < minLng) minLng = sample.lng;
    if (sample.lng > maxLng) maxLng = sample.lng;
  }

  return haversineMeters({ lat: minLat, lng: minLng }, { lat: maxLat, lng: maxLng });
}

function recordPositionSample(snapshot: Snapshot, point: GpsPoint, nowMs: number): PositionSample[] {
  const cutoff = nowMs - MOVEMENT_WINDOW_MS;
  const pruned = snapshot.positionWindow.filter((s) => new Date(s.timestamp).getTime() >= cutoff);
  const usable = isUsableAccuracy(point);

  if (usable) {
    pruned.push({ lat: point.lat, lng: point.lng, timestamp: point.timestamp });
  }

  if (usable || pruned.length !== snapshot.positionWindow.length) {
    snapshot.positionWindow = pruned.slice(-POSITION_WINDOW_MAX_SAMPLES);
    touch(snapshot, POSITION_WINDOW_KEY);
  }

  return snapshot.positionWindow;
}

type MotionAssessment = {
  isMoving: boolean;
  isStationary: boolean;
};

function evaluateMotion(point: GpsPoint, window: PositionSample[], nowMs: number): MotionAssessment {
  const age = sampleAgeMs(window);
  const netDisp =
    window.length >= 2 ? haversineMeters(window[0], window[window.length - 1]) : 0;

  const fastPathMoving = point.speed >= DEFINITIVE_MOVING_SPEED_MS;
  const windowMoving = age >= SUSTAINED_MIN_AGE_MS && netDisp >= SUSTAINED_MOVE_DISTANCE_METERS;

  const recent = samplesInLastMs(window, STATIONARY_WINDOW_MS, nowMs);
  const recentAge = sampleAgeMs(recent);
  const spread = maxSpreadMeters(recent);
  const isStationary =
    recentAge >= SUSTAINED_MIN_AGE_MS &&
    spread < STATIONARY_MAX_SPREAD_METERS &&
    point.speed < DEFINITIVE_MOVING_SPEED_MS;

  return {
    isMoving: fastPathMoving || windowMoving,
    isStationary,
  };
}

/**
 * Drops every second point from the older half instead of truncating the head,
 * so a long offline trip keeps its real start rather than losing it.
 */
function decimatePendingPoints(points: GpsPoint[]): GpsPoint[] {
  const half = Math.floor(points.length / 2);
  const older = points.slice(0, half).filter((_, index) => index % 2 === 0);
  return [...older, ...points.slice(half)];
}

function enqueuePoint(snapshot: Snapshot, point: GpsPoint, nowMs: number): void {
  snapshot.lastPoint = point;
  touch(snapshot, LAST_POINT_KEY);

  if (point.accuracy <= 0) return;

  // Poor accuracy normally disqualifies a point, but rejecting every one of
  // them through a tunnel or urban canyon punches a hole in the recorded
  // distance — which is the number the whole logbook exists to report.
  const gapMs = snapshot.lastRoutePointAt === null ? 0 : nowMs - snapshot.lastRoutePointAt;
  const ceiling =
    gapMs >= ROUTE_GAP_TOLERANCE_MS ? FALLBACK_ROUTE_ACCURACY_METERS : MAX_ROUTE_ACCURACY_METERS;
  if (point.accuracy > ceiling) return;

  const last = snapshot.pendingPoints[snapshot.pendingPoints.length - 1];
  if (last) {
    if (last.timestamp === point.timestamp && last.lat === point.lat && last.lng === point.lng) {
      return;
    }
    if (haversineMeters(last, point) < MIN_ROUTE_POINT_DISTANCE_METERS) {
      return;
    }
  }

  snapshot.pendingPoints.push(point);
  if (snapshot.pendingPoints.length > MAX_PENDING_POINTS) {
    snapshot.pendingPoints = decimatePendingPoints(snapshot.pendingPoints);
  }
  snapshot.lastRoutePointAt = nowMs;
  touch(snapshot, PENDING_POINTS_KEY, LAST_ROUTE_POINT_AT_KEY);
}

function toGpsPoint(loc: Location.LocationObject): GpsPoint {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    speed: Math.max(0, loc.coords.speed ?? 0),
    heading: loc.coords.heading ?? 0,
    accuracy: loc.coords.accuracy ?? 0,
    timestamp: new Date(loc.timestamp).toISOString(),
  };
}

function formatAddress(parts: Location.LocationGeocodedAddress | null): string | null {
  if (!parts) return null;

  const street = [parts.street, parts.streetNumber].filter(Boolean).join(" ").trim();
  const locality = [parts.postalCode, parts.city].filter(Boolean).join(" ").trim();
  const region = [street, locality, parts.district || parts.region || parts.country]
    .filter(Boolean)
    .join(", ")
    .trim();

  return region || null;
}

async function reverseGeocode(point: GpsPoint): Promise<string | null> {
  try {
    const matches = await Location.reverseGeocodeAsync({
      latitude: point.lat,
      longitude: point.lng,
    });

    return formatAddress(matches[0] ?? null);
  } catch {
    return null;
  }
}

/**
 * Sends queued points and removes exactly what the server accepted. Earlier
 * this rewrote the queue as `points.slice(batch.length)` from a list read
 * before the request, silently discarding anything appended while it was in
 * flight.
 */
async function flushPendingPoints(snapshot: Snapshot, tripId: string): Promise<void> {
  while (snapshot.pendingPoints.length > 0) {
    const batch = snapshot.pendingPoints.slice(0, SYNC_BATCH_SIZE);
    await api.post(`/trips/${tripId}/points/batch`, { points: batch });
    snapshot.pendingPoints = snapshot.pendingPoints.slice(batch.length);
    touch(snapshot, PENDING_POINTS_KEY);
    markSyncSuccess(snapshot);
  }
}

function isMissingActiveTripError(error: unknown): boolean {
  return error instanceof Error && error.message === "Active trip not found";
}

async function sendNotification(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: "default" },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: 1,
        channelId: TRIP_NOTIFICATION_CHANNEL,
      },
    });
  } catch {
    // Notifications are best-effort
  }
}

async function ensureNotificationChannel(): Promise<void> {
  if (Platform.OS !== "android") return;

  try {
    await Notifications.setNotificationChannelAsync(TRIP_NOTIFICATION_CHANNEL, {
      name: "Turer",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 250, 150, 250],
      enableVibrate: true,
    });
    // Pre-create the foreground-service channel so expo-location attaches its
    // persistent notification to a visible channel instead of the silent
    // IMPORTANCE_LOW one it would otherwise create on first start.
    await Notifications.setNotificationChannelAsync(BACKGROUND_NOTIFICATION_CHANNEL, {
      name: "Bakgrunnssporing",
      description: "Viser når Kjørebok følger med på posisjon i bakgrunnen.",
      importance: Notifications.AndroidImportance.DEFAULT,
      sound: null,
      enableVibrate: false,
      showBadge: false,
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    });
  } catch {
    // Safe to ignore — channel creation is best-effort
  }
}

/**
 * While a trip is running the distance filter has to be off. iOS maps
 * `distanceInterval` to CLLocationManager.distanceFilter and ignores
 * `timeInterval` entirely, so any non-zero filter means a parked car — which
 * never moves that far — stops producing locations at all. `handleLocation`
 * then never runs again, and since both the stop confirmation and
 * `closeStaleTrip` live inside it, the trip could only be closed half an hour
 * later by the app being reopened or by the server's cleanup. Trips got the
 * wrong end time, and driving again within that window merged two trips into
 * one.
 *
 * Filtering costs nothing while actually driving anyway: at 80 km/h the GPS fix
 * rate is the real limit, not the 10 m filter. Idle keeps a filter purely to
 * save battery — there we only need to notice that movement has begun.
 */
type LocationMode = "idle" | "active";

const IDLE_DISTANCE_INTERVAL_METERS = 20;

async function startBackgroundLocationUpdates(mode: LocationMode): Promise<void> {
  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: mode === "active" ? 2000 : 10000,
    distanceInterval: mode === "active" ? 0 : IDLE_DISTANCE_INTERVAL_METERS,
    showsBackgroundLocationIndicator: true,
    // Without these iOS decides on its own that the user has stopped, pauses
    // location updates, and never resumes them — the app then misses every
    // trip until it is manually reopened.
    activityType: Location.ActivityType.AutomotiveNavigation,
    pausesUpdatesAutomatically: false,
    foregroundService: {
      notificationTitle: "Kjørebok",
      notificationBody: "Automatisk tursporing kjører i bakgrunnen.",
    },
  });
}

function modeForState(state: TrackerState): LocationMode {
  return state === "RECORDING" || state === "DETECTING_STOP" ? "active" : "idle";
}

/** Restarts location updates only when the mode actually changes. */
async function applyLocationMode(snapshot: Snapshot): Promise<void> {
  const wanted = modeForState(snapshot.state);
  if (snapshot.locationMode === wanted) return;

  try {
    await startBackgroundLocationUpdates(wanted);
    snapshot.locationMode = wanted;
    touch(snapshot, LOCATION_MODE_KEY);
  } catch (error) {
    const message = error instanceof Error && error.message ? `: ${error.message}` : ".";
    log(snapshot, `Kunne ikke bytte posisjonsmodus${message}`, "warn");
  }
}

async function startTrip(snapshot: Snapshot, point: GpsPoint): Promise<boolean> {
  try {
    const startAddress = await reverseGeocode(point);
    const trip = await api.post<{ id: string }>("/trips", {
      startPoint: point,
      startAddress,
      ...(snapshot.selectedVehicleId ? { vehicleId: snapshot.selectedVehicleId } : {}),
    });

    snapshot.pendingPoints = [];
    snapshot.lastPoint = point;
    snapshot.lastRoutePointAt = new Date(point.timestamp).getTime();
    snapshot.activeTripId = trip.id;
    snapshot.state = "RECORDING";
    snapshot.startCandidateCount = 0;
    snapshot.startFailCount = 0;
    markSyncSuccess(snapshot);
    setStartReason(snapshot, "Tur er aktiv.");
    log(snapshot, "Tur startet automatisk.");
    touch(
      snapshot,
      PENDING_POINTS_KEY,
      LAST_POINT_KEY,
      LAST_ROUTE_POINT_AT_KEY,
      ACTIVE_TRIP_KEY,
      STATE_KEY,
      START_CANDIDATE_COUNT_KEY,
      START_FAIL_COUNT_KEY
    );
    await sendNotification("Tur startet", startAddress ? `Fra: ${startAddress}` : "GPS-sporing er aktiv.");
    return true;
  } catch (error) {
    const message = error instanceof Error && error.message ? `: ${error.message}` : ".";
    log(snapshot, `Kunne ikke starte tur${message}`, "error");
    // Stay in DETECTING_START rather than dropping to IDLE: the usual cause is
    // a dead network at the start of the drive, and the next fix retries
    // instead of abandoning the trip.
    snapshot.state = "DETECTING_START";
    setStartReason(snapshot, "Kunne ikke starte tur ennå. Prøver igjen ved neste posisjon.");
    touch(snapshot, STATE_KEY);
    return false;
  }
}

function resetActiveTripState(snapshot: Snapshot): void {
  snapshot.pendingPoints = [];
  snapshot.activeTripId = null;
  snapshot.stopTime = null;
  snapshot.lastPoint = null;
  snapshot.positionWindow = [];
  snapshot.startFailCount = 0;
  snapshot.startCandidateCount = 0;
  snapshot.lastRoutePointAt = null;
  snapshot.state = "IDLE";
  setStartReason(snapshot, DEFAULT_START_REASON);
  touch(
    snapshot,
    PENDING_POINTS_KEY,
    ACTIVE_TRIP_KEY,
    STOP_TIME_KEY,
    LAST_POINT_KEY,
    POSITION_WINDOW_KEY,
    START_FAIL_COUNT_KEY,
    START_CANDIDATE_COUNT_KEY,
    LAST_ROUTE_POINT_AT_KEY,
    STATE_KEY
  );
}

/**
 * Ends the trip on the server. Local state is only cleared once the server has
 * the data (or has confirmed the trip is gone) — clearing it unconditionally
 * used to throw away unsent points and leave the trip open server-side.
 */
async function finishTrip(snapshot: Snapshot, tripId: string, endPoint: GpsPoint): Promise<void> {
  try {
    await flushPendingPoints(snapshot, tripId);
    const endAddress = await reverseGeocode(endPoint);
    const result = await api.post<{ distanceMeters?: number } | null>(`/trips/${tripId}/end`, {
      endPoint,
      endAddress,
    });
    markSyncSuccess(snapshot);
    log(snapshot, "Tur fullført og sendt til server.");
    resetActiveTripState(snapshot);

    // result is null if server deleted the trip (too short)
    if (result && typeof result.distanceMeters === "number" && result.distanceMeters >= 50) {
      const km = (result.distanceMeters / 1000).toFixed(1);
      const addressNote = endAddress ? ` · ${endAddress}` : "";
      await sendNotification("Tur fullført", `${km} km${addressNote}`);
    }
  } catch (error) {
    if (isMissingActiveTripError(error)) {
      log(snapshot, "Aktiv tur fantes ikke lenger på serveren. Lokal turstatus ble nullstilt.", "warn");
      resetActiveTripState(snapshot);
      return;
    }

    const message = error instanceof Error && error.message ? `: ${error.message}` : ".";
    log(snapshot, `Kunne ikke fullføre tur${message}`, "error");
    setStartReason(snapshot, "Turen er ferdig, men venter på å bli sendt til serveren.");
    throw error;
  }
}

async function closeStaleTrip(snapshot: Snapshot, referenceTimestamp: number): Promise<boolean> {
  if (!snapshot.activeTripId) return false;

  const lastPoint = snapshot.lastPoint;
  if (!lastPoint) {
    resetActiveTripState(snapshot);
    return true;
  }

  const lastPointTime = new Date(lastPoint.timestamp).getTime();
  if (!Number.isFinite(lastPointTime)) {
    resetActiveTripState(snapshot);
    return true;
  }

  if (referenceTimestamp - lastPointTime < STALE_TRIP_TIMEOUT_MS) {
    return false;
  }

  log(snapshot, "Avsluttet gammel aktiv tur automatisk.");
  await finishTrip(snapshot, snapshot.activeTripId, lastPoint);
  return true;
}

async function handleLocation(snapshot: Snapshot, loc: Location.LocationObject): Promise<void> {
  const point = toGpsPoint(loc);
  const nowMs = loc.timestamp;
  const hasGoodAccuracy = isUsableAccuracy(point);
  const window = recordPositionSample(snapshot, point, nowMs);
  const motion = evaluateMotion(point, window, nowMs);

  snapshot.lastSpeed = point.speed;
  snapshot.lastAccuracy = point.accuracy;
  touch(snapshot, LAST_SPEED_KEY, LAST_ACCURACY_KEY);

  // Wall-clock, not the point timestamp: a queued location delivered late must
  // not look like a 30-minute-old trip. A failure here must not abort the rest
  // of the batch — the trip stays open and the next fix retries.
  await closeStaleTrip(snapshot, Date.now()).catch(() => undefined);

  switch (snapshot.state) {
    case "IDLE": {
      if (!hasGoodAccuracy) {
        setStartReason(
          snapshot,
          `Venter på bedre GPS-nøyaktighet. Siste måling var ${Math.round(point.accuracy)} meter.`
        );
        break;
      }
      if (motion.isMoving) {
        snapshot.state = "DETECTING_START";
        snapshot.startCandidateCount = 1;
        touch(snapshot, STATE_KEY, START_CANDIDATE_COUNT_KEY);
        setStartReason(snapshot, "Oppdaget bevegelse. Bekrefter med ett punkt til før turen starter.");
        log(snapshot, "Oppdaget bevegelse som kan starte tur.");
      } else {
        setStartReason(snapshot, "Venter på tydelig bevegelse før tur starter automatisk.");
      }
      break;
    }

    case "DETECTING_START": {
      if (!hasGoodAccuracy) {
        setStartReason(
          snapshot,
          `Venter på bedre GPS-nøyaktighet (${Math.round(point.accuracy)} m) før tur kan starte.`
        );
        break;
      }
      if (motion.isMoving) {
        snapshot.startFailCount = 0;
        touch(snapshot, START_FAIL_COUNT_KEY);
        await startTrip(snapshot, point);
      } else {
        const failCount = snapshot.startFailCount + 1;
        if (failCount >= MAX_START_FAIL_COUNT) {
          snapshot.startFailCount = 0;
          snapshot.state = "IDLE";
          snapshot.startCandidateCount = 0;
          touch(snapshot, START_FAIL_COUNT_KEY, STATE_KEY, START_CANDIDATE_COUNT_KEY);
          setStartReason(snapshot, "Turstart ble avbrutt fordi bevegelsen stoppet opp igjen.");
          log(snapshot, "Avbrøt turstart fordi bevegelsen stoppet.", "warn");
        } else {
          snapshot.startFailCount = failCount;
          touch(snapshot, START_FAIL_COUNT_KEY);
          setStartReason(snapshot, `Venter — bevegelse usikker. Forsøk ${failCount}/${MAX_START_FAIL_COUNT}.`);
        }
      }
      break;
    }

    case "RECORDING": {
      const tripId = snapshot.activeTripId;
      if (!tripId) {
        snapshot.state = "IDLE";
        touch(snapshot, STATE_KEY);
        setStartReason(snapshot, "Ingen aktiv tur akkurat nå.");
        return;
      }

      enqueuePoint(snapshot, point, nowMs);
      await flushWithRecovery(snapshot, tripId, "Kunne ikke sende punkter");

      if (motion.isStationary) {
        snapshot.state = "DETECTING_STOP";
        snapshot.stopTime = nowMs;
        touch(snapshot, STATE_KEY, STOP_TIME_KEY);
        setStartReason(snapshot, "Tur ser ut til å nærme seg stopp.");
        log(snapshot, "Mulig turstopp oppdaget.");
      } else {
        setStartReason(snapshot, "Tur er aktiv.");
      }
      break;
    }

    case "DETECTING_STOP": {
      const tripId = snapshot.activeTripId;
      if (!tripId) {
        snapshot.state = "IDLE";
        touch(snapshot, STATE_KEY);
        setStartReason(snapshot, "Ingen aktiv tur akkurat nå.");
        return;
      }

      enqueuePoint(snapshot, point, nowMs);

      if (motion.isMoving && hasGoodAccuracy) {
        snapshot.state = "RECORDING";
        snapshot.stopTime = null;
        touch(snapshot, STATE_KEY, STOP_TIME_KEY);
        await flushWithRecovery(snapshot, tripId, "Kunne ikke sende punkter etter stopp");
        setStartReason(snapshot, "Tur fortsetter.");
        log(snapshot, "Tur fortsetter etter kort stopp.");
        return;
      }

      if (snapshot.stopTime !== null && nowMs - snapshot.stopTime >= STOP_CONFIRM_MS) {
        // A failed end leaves the trip recoverable instead of bubbling out of
        // the batch and skipping the remaining locations.
        await finishTrip(snapshot, tripId, point).catch(() => undefined);
      }
      break;
    }
  }
}

async function flushWithRecovery(snapshot: Snapshot, tripId: string, context: string): Promise<void> {
  try {
    await flushPendingPoints(snapshot, tripId);
  } catch (error) {
    if (isMissingActiveTripError(error)) {
      log(snapshot, "Serveren manglet aktiv tur. Nullstilte lokal turstatus.", "warn");
      resetActiveTripState(snapshot);
      return;
    }
    const message = error instanceof Error && error.message ? `: ${error.message}` : ".";
    log(snapshot, `${context}${message}`, "error");
  }
}

/** iOS delivers batches that are not guaranteed to be ordered. */
function sortLocations(locations: Location.LocationObject[]): Location.LocationObject[] {
  return [...locations].sort((a, b) => a.timestamp - b.timestamp);
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    await serialize(async () => {
      const snapshot = await loadSnapshot();
      log(snapshot, `Bakgrunnsoppgave feilet: ${error.message}`, "error");
      await saveSnapshot(snapshot);
    });
    console.error("[TripTracker]", error);
    return;
  }

  const { locations } = (data ?? {}) as { locations?: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  await serialize(async () => {
    await markTaskHeartbeat();
    const snapshot = await loadSnapshot();
    try {
      for (const loc of sortLocations(locations)) {
        await handleLocation(snapshot, loc);
      }
    } catch (taskError) {
      const message =
        taskError instanceof Error && taskError.message ? `: ${taskError.message}` : ".";
      log(snapshot, `Feil under behandling av posisjon${message}`, "error");
      console.error("[TripTracker]", taskError);
    } finally {
      // Once per batch rather than per location: the filter only needs to match
      // the state the batch settled on.
      await applyLocationMode(snapshot);
      // Always persist: a mid-batch failure must not discard the points and
      // state changes the earlier locations already produced.
      await saveSnapshot(snapshot);
    }
  });
});

export async function requestPermissions(): Promise<boolean> {
  const { status: notifStatus } = await Notifications.getPermissionsAsync();
  if (notifStatus !== "granted") {
    await Notifications.requestPermissionsAsync();
  }

  const fgStatus = await Location.getForegroundPermissionsAsync();
  const fg =
    fgStatus.status === "granted" ? fgStatus : await Location.requestForegroundPermissionsAsync();

  const snapshot = await loadSnapshot();
  try {
    if (fg.status !== "granted") {
      setStartReason(snapshot, "Gi appen tilgang til posisjon mens den er i bruk.");
      log(snapshot, "Mangler forgrunnslokasjon.", "warn");
      return false;
    }

    const bgStatus = await Location.getBackgroundPermissionsAsync();
    const bg =
      bgStatus.status === "granted" ? bgStatus : await Location.requestBackgroundPermissionsAsync();

    if (bg.status !== "granted") {
      setStartReason(snapshot, "Gi appen bakgrunnslokasjon for automatisk turstart.");
      log(snapshot, "Mangler bakgrunnslokasjon.", "warn");
    } else {
      setStartReason(snapshot, "Tillatelser er klare. Telefonen kan starte tur automatisk.");
      log(snapshot, "Bakgrunnslokasjon er klar.");
    }

    return bg.status === "granted";
  } finally {
    await saveSnapshot(snapshot);
  }
}

export async function ensureTrackingConfigured(): Promise<boolean> {
  await ensureNotificationChannel();
  const granted = await requestPermissions();
  if (!granted) return false;

  return serialize(async () => {
    const snapshot = await loadSnapshot();
    try {
      const providerStatus = await Location.getProviderStatusAsync().catch(() => null);
      if (providerStatus && !providerStatus.locationServicesEnabled) {
        setStartReason(snapshot, "Skru på posisjonstjenester på telefonen.");
        log(snapshot, "Posisjonstjenester er av på telefonen.", "warn");
      }

      const mode = modeForState(snapshot.state);
      const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(
        () => false
      );
      if (!isRunning) {
        await startBackgroundLocationUpdates(mode);
        snapshot.locationMode = mode;
        touch(snapshot, LOCATION_MODE_KEY);
        setStartReason(snapshot, "Bakgrunnssporing er aktiv. Telefonen følger med etter ny tur.");
        log(snapshot, "Bakgrunnssporing ble startet.");
      } else if (Platform.OS === "android") {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
        await startBackgroundLocationUpdates(mode);
        snapshot.locationMode = mode;
        touch(snapshot, LOCATION_MODE_KEY);
        setStartReason(snapshot, "Bakgrunnssporing ble startet på nytt. Telefonen følger med etter ny tur.");
        log(snapshot, "Bakgrunnssporing ble startet på nytt for å gjenopprette bakgrunnsvarsel.");
      } else {
        // A restart the app did not make (or a crash) can leave the filter out
        // of step with the state it should match.
        await applyLocationMode(snapshot);
        setStartReason(snapshot, "Bakgrunnssporing er aktiv. Telefonen følger med etter ny tur.");
        log(snapshot, "Bakgrunnssporing er allerede aktiv.");
      }

      await closeStaleTrip(snapshot, Date.now()).catch(() => {});

      if (snapshot.activeTripId) {
        await flushWithRecovery(snapshot, snapshot.activeTripId, "Kunne ikke sende ventende punkter ved oppstart");
      }

      return true;
    } finally {
      await saveSnapshot(snapshot);
    }
  });
}

export async function syncActiveTrip(): Promise<void> {
  return serialize(async () => {
    const snapshot = await loadSnapshot();
    try {
      await closeStaleTrip(snapshot, Date.now());
      const tripId = snapshot.activeTripId;
      if (!tripId) {
        log(snapshot, "Ingen aktiv tur å synkronisere.", "warn");
        return;
      }

      try {
        await flushPendingPoints(snapshot, tripId);
        log(snapshot, "Manuell synkronisering fullført.");
      } catch (error) {
        if (isMissingActiveTripError(error)) {
          log(snapshot, "Aktiv tur fantes ikke lenger på serveren. Lokal turstatus ble nullstilt.", "warn");
          resetActiveTripState(snapshot);
          return;
        }
        const message = error instanceof Error && error.message ? `: ${error.message}` : ".";
        log(snapshot, `Manuell synkronisering feilet${message}`, "error");
        throw error;
      }
    } finally {
      await saveSnapshot(snapshot);
    }
  });
}

export async function startTripManually(): Promise<void> {
  const granted = await requestPermissions();
  if (!granted) {
    throw new Error("Bakgrunnslokasjon mangler.");
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });

  return serialize(async () => {
    const snapshot = await loadSnapshot();
    try {
      if (snapshot.activeTripId) {
        setStartReason(snapshot, "Du har allerede en aktiv tur.");
        return;
      }

      const point = toGpsPoint(location);
      const started = await startTrip(snapshot, point);
      if (!started) {
        throw new Error("Kunne ikke starte tur manuelt.");
      }

      snapshot.lastSpeed = point.speed;
      snapshot.lastAccuracy = point.accuracy;
      touch(snapshot, LAST_SPEED_KEY, LAST_ACCURACY_KEY);
      setStartReason(snapshot, "Tur startet manuelt og registreres nå.");
      log(snapshot, "Tur startet manuelt.");
    } finally {
      await applyLocationMode(snapshot);
      await saveSnapshot(snapshot);
    }
  });
}

export async function stopActiveTripManually(): Promise<void> {
  let fresh: Location.LocationObject | null = null;
  try {
    fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  } catch {
    // Fall back to the latest known point if a fresh reading is unavailable.
  }

  return serialize(async () => {
    const snapshot = await loadSnapshot();
    try {
      const tripId = snapshot.activeTripId;
      if (!tripId) {
        setStartReason(snapshot, "Ingen aktiv tur å stoppe.");
        throw new Error("Ingen aktiv tur å stoppe.");
      }

      const point = fresh ? toGpsPoint(fresh) : snapshot.lastPoint;
      if (!point) {
        throw new Error("Fant ikke posisjon for å avslutte turen.");
      }

      await finishTrip(snapshot, tripId, point);
      setStartReason(snapshot, "Tur ble stoppet manuelt.");
      log(snapshot, "Tur stoppet manuelt.");
    } finally {
      await applyLocationMode(snapshot);
      await saveSnapshot(snapshot);
    }
  });
}

export async function stopTracking(): Promise<void> {
  return serialize(async () => {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(
      () => false
    );
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
    }

    const snapshot = await loadSnapshot();
    resetActiveTripState(snapshot);
    snapshot.lastSpeed = null;
    snapshot.lastAccuracy = null;
    // Updates are off, so no profile is in force — the next start must apply one.
    snapshot.locationMode = null;
    touch(snapshot, LAST_SPEED_KEY, LAST_ACCURACY_KEY, LOCATION_MODE_KEY);
    log(snapshot, "Bakgrunnssporing ble stoppet.", "warn");
    setStartReason(snapshot, "Bakgrunnssporing er stoppet.");
    await saveSnapshot(snapshot);
  });
}

export async function getSelectedVehicleId(): Promise<string | null> {
  return AsyncStorage.getItem(SELECTED_VEHICLE_KEY);
}

/** Applied to the next trip that starts; an active trip keeps the vehicle it began with. */
export async function setSelectedVehicleId(vehicleId: string | null): Promise<void> {
  if (vehicleId) await AsyncStorage.setItem(SELECTED_VEHICLE_KEY, vehicleId);
  else await AsyncStorage.removeItem(SELECTED_VEHICLE_KEY);
}

export async function getTrackerState(): Promise<TrackerDiagnostics> {
  const [
    snapshot,
    trackingEnabled,
    notificationPermission,
    availableNotificationChannels,
    foregroundPermission,
    backgroundPermission,
    providerStatus,
    lastTaskAt,
    token,
  ] = await Promise.all([
    loadSnapshot(),
    Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false),
    Notifications.getPermissionsAsync()
      .then((result) => result.status)
      .catch(() => "undetermined" as Notifications.PermissionStatus),
    Platform.OS === "android"
      ? Notifications.getNotificationChannelsAsync()
          .then((channels) =>
            channels.map((channel) => ({
              id: channel.id,
              name: channel.name,
              importance: channel.importance,
            }))
          )
          .catch(() => [])
      : Promise.resolve([]),
    Location.getForegroundPermissionsAsync()
      .then((result) => result.status)
      .catch(() => "undetermined" as Location.PermissionStatus),
    Location.getBackgroundPermissionsAsync()
      .then((result) => result.status)
      .catch(() => "undetermined" as Location.PermissionStatus),
    Location.getProviderStatusAsync().catch(() => null),
    AsyncStorage.getItem(LAST_TASK_AT_KEY),
    getToken(),
  ]);

  return {
    state: snapshot.state,
    activeTripId: snapshot.activeTripId,
    pendingPoints: snapshot.pendingPoints.length,
    trackingEnabled,
    hasToken: Boolean(token),
    notificationPermission,
    tripNotificationChannel: TRIP_NOTIFICATION_CHANNEL,
    backgroundNotificationChannel: BACKGROUND_NOTIFICATION_CHANNEL,
    availableNotificationChannels,
    locationServicesEnabled: providerStatus?.locationServicesEnabled ?? false,
    foregroundPermission,
    backgroundPermission,
    lastPointTimestamp: snapshot.lastPoint?.timestamp ?? null,
    lastTaskAt,
    lastSyncAt: snapshot.lastSyncAt,
    lastSpeedKmh: snapshot.lastSpeed === null ? null : snapshot.lastSpeed * 3.6,
    lastAccuracyMeters: snapshot.lastAccuracy,
    startCandidateCount: snapshot.startCandidateCount,
    startReason: snapshot.startReason,
    selectedVehicleId: snapshot.selectedVehicleId,
    recentEvents: snapshot.logEntries,
  };
}
