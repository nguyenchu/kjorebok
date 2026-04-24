/**
 * Auto trip detection using expo-location background tasks.
 *
 * Tracking is intended to stay on continuously once permissions are granted.
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
const MAX_PENDING_POINTS = 500;
const MAX_USABLE_ACCURACY_METERS = 40;
const MAX_ROUTE_ACCURACY_METERS = 30;
const MIN_ROUTE_POINT_DISTANCE_METERS = 5;
// Windowed motion detection constants
const MOVEMENT_WINDOW_MS = 60 * 1000;
const STATIONARY_WINDOW_MS = 30 * 1000;
const SUSTAINED_MIN_AGE_MS = 30 * 1000;
const SUSTAINED_MOVE_DISTANCE_METERS = 30;
const STATIONARY_MAX_SPREAD_METERS = 15;
const DEFINITIVE_MOVING_SPEED_MS = 15 / 3.6;
const POSITION_WINDOW_MAX_SAMPLES = 60;
const TRIP_NOTIFICATION_CHANNEL = "trips";
const BACKGROUND_NOTIFICATION_CHANNEL = "no.kjorebok.app:kjorebok-background-location";

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
const MAX_START_FAIL_COUNT = 6;
const STALE_TRIP_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_ENTRIES = 20;

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
  recentEvents: TrackerLogEntry[];
}

let syncPromise: Promise<void> | null = null;

async function get(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

async function set(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

async function clear(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

async function getRecentEvents(): Promise<TrackerLogEntry[]> {
  const raw = await get(LOG_ENTRIES_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as TrackerLogEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendLog(message: string, level: LogLevel = "info"): Promise<void> {
  const nextEntry: TrackerLogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  const entries = await getRecentEvents();
  entries.unshift(nextEntry);
  await set(LOG_ENTRIES_KEY, JSON.stringify(entries.slice(0, MAX_LOG_ENTRIES)));
}

async function markSyncSuccess(timestamp = new Date().toISOString()): Promise<void> {
  await set(LAST_SYNC_AT_KEY, timestamp);
}

async function markTaskHeartbeat(timestamp = new Date().toISOString()): Promise<void> {
  await set(LAST_TASK_AT_KEY, timestamp);
}

async function getPendingPoints(): Promise<GpsPoint[]> {
  const raw = await get(PENDING_POINTS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as GpsPoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function setPendingPoints(points: GpsPoint[]): Promise<void> {
  await set(PENDING_POINTS_KEY, JSON.stringify(points.slice(-MAX_PENDING_POINTS)));
}

async function getLastPoint(): Promise<GpsPoint | null> {
  const raw = await get(LAST_POINT_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as GpsPoint;
    if (
      typeof parsed?.lat === "number" &&
      typeof parsed?.lng === "number" &&
      typeof parsed?.timestamp === "string"
    ) {
      return parsed;
    }
  } catch {}

  return null;
}

async function setLastPoint(point: GpsPoint): Promise<void> {
  await set(LAST_POINT_KEY, JSON.stringify(point));
}

type PositionSample = { lat: number; lng: number; timestamp: string };

async function getPositionWindow(): Promise<PositionSample[]> {
  const raw = await get(POSITION_WINDOW_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as PositionSample[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function setPositionWindow(samples: PositionSample[]): Promise<void> {
  await set(POSITION_WINDOW_KEY, JSON.stringify(samples.slice(-POSITION_WINDOW_MAX_SAMPLES)));
}

async function setStartReason(reason: string): Promise<void> {
  await set(START_REASON_KEY, reason);
}

async function getStartReason(): Promise<string> {
  return (await get(START_REASON_KEY)) ?? "Telefonen venter på tydelig bevegelse.";
}

async function setStartCandidateCount(count: number): Promise<void> {
  await set(START_CANDIDATE_COUNT_KEY, String(Math.max(0, count)));
}

async function getStartCandidateCount(): Promise<number> {
  return Number((await get(START_CANDIDATE_COUNT_KEY)) ?? "0");
}

async function setLastTelemetry(point: GpsPoint): Promise<void> {
  await set(LAST_SPEED_KEY, String(point.speed));
  await set(LAST_ACCURACY_KEY, String(point.accuracy));
}

async function getLastSpeedKmh(): Promise<number | null> {
  const raw = await get(LAST_SPEED_KEY);
  if (!raw) return null;

  const speed = Number(raw);
  return Number.isFinite(speed) ? speed * 3.6 : null;
}

async function getLastAccuracyMeters(): Promise<number | null> {
  const raw = await get(LAST_ACCURACY_KEY);
  if (!raw) return null;

  const accuracy = Number(raw);
  return Number.isFinite(accuracy) ? accuracy : null;
}

function haversineMeters(a: GpsPoint, b: GpsPoint): number {
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

function haversineLatLng(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineMeters(a as GpsPoint, b as GpsPoint);
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

function maxSpreadMeters(samples: PositionSample[]): number {
  if (samples.length < 2) return 0;
  let max = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const d = haversineLatLng(samples[i], samples[j]);
      if (d > max) max = d;
    }
  }
  return max;
}

async function recordPositionSample(point: GpsPoint, nowMs: number): Promise<PositionSample[]> {
  const window = await getPositionWindow();
  const cutoff = nowMs - MOVEMENT_WINDOW_MS;
  const pruned = window.filter((s) => new Date(s.timestamp).getTime() >= cutoff);

  if (isUsableAccuracy(point)) {
    pruned.push({ lat: point.lat, lng: point.lng, timestamp: point.timestamp });
  }

  if (pruned.length !== window.length || isUsableAccuracy(point)) {
    await setPositionWindow(pruned);
  }
  return pruned;
}

type MotionAssessment = {
  isMoving: boolean;
  isStationary: boolean;
};

function evaluateMotion(point: GpsPoint, window: PositionSample[], nowMs: number): MotionAssessment {
  const age = sampleAgeMs(window);
  const netDisp = window.length >= 2
    ? haversineLatLng(window[0], window[window.length - 1])
    : 0;

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

async function storeLocationTelemetry(point: GpsPoint): Promise<void> {
  await setLastTelemetry(point);
  await markTaskHeartbeat(point.timestamp);
}

async function enqueuePoint(point: GpsPoint): Promise<void> {
  await setLastPoint(point);

  if (point.accuracy <= 0 || point.accuracy > MAX_ROUTE_ACCURACY_METERS) {
    return;
  }

  const points = await getPendingPoints();
  const last = points[points.length - 1];

  if (last) {
    if (
      last.timestamp === point.timestamp &&
      last.lat === point.lat &&
      last.lng === point.lng
    ) {
      return;
    }
    if (haversineMeters(last, point) < MIN_ROUTE_POINT_DISTANCE_METERS) {
      return;
    }
  }

  points.push(point);
  await setPendingPoints(points);
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

async function flushPendingPoints(tripId: string): Promise<void> {
  if (syncPromise) {
    await syncPromise;
    return;
  }

  syncPromise = (async () => {
    while (true) {
      const points = await getPendingPoints();
      if (points.length === 0) break;

      const batch = points.slice(0, SYNC_BATCH_SIZE);
      await api.post(`/trips/${tripId}/points/batch`, { points: batch });
      await setPendingPoints(points.slice(batch.length));
      await markSyncSuccess();
    }
  })();

  try {
    await syncPromise;
  } finally {
    syncPromise = null;
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

async function startTrip(point: GpsPoint): Promise<boolean> {
  try {
    const startAddress = await reverseGeocode(point);
    const trip = await api.post<{ id: string }>("/trips", {
      startPoint: point,
      startAddress,
    });

    await clear(PENDING_POINTS_KEY);
    await setLastPoint(point);
    await markSyncSuccess();
    await set(ACTIVE_TRIP_KEY, trip.id);
    await set(STATE_KEY, "RECORDING");
    await setStartReason("Tur er aktiv.");
    await setStartCandidateCount(0);
    await appendLog("Tur startet automatisk.");
    await sendNotification("Tur startet", startAddress ? `Fra: ${startAddress}` : "GPS-sporing er aktiv.");
    return true;
  } catch (error) {
    await appendLog(
      `Kunne ikke starte tur${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
      "error"
    );
    await set(STATE_KEY, "IDLE");
    await setStartReason("Kunne ikke starte tur automatisk.");
    await setStartCandidateCount(0);
    return false;
  }
}

async function resetActiveTripState(): Promise<void> {
  await clear(PENDING_POINTS_KEY);
  await clear(ACTIVE_TRIP_KEY);
  await clear(STOP_TIME_KEY);
  await clear(LAST_POINT_KEY);
  await clear(POSITION_WINDOW_KEY);
  await clear(START_FAIL_COUNT_KEY);
  await setStartCandidateCount(0);
  await setStartReason("Telefonen venter på tydelig bevegelse.");
  await set(STATE_KEY, "IDLE");
}

async function finishTrip(tripId: string, endPoint: GpsPoint): Promise<void> {
  try {
    await flushPendingPoints(tripId);
    const endAddress = await reverseGeocode(endPoint);
    const result = await api.post<{ distanceMeters?: number } | null>(`/trips/${tripId}/end`, { endPoint, endAddress });
    await markSyncSuccess();
    await appendLog("Tur fullfort og sendt til server.");
    // result is null if server deleted the trip (too short)
    if (result && typeof result.distanceMeters === "number" && result.distanceMeters >= 50) {
      const km = (result.distanceMeters / 1000).toFixed(1);
      const addressNote = endAddress ? ` · ${endAddress}` : "";
      await sendNotification("Tur fullført", `${km} km${addressNote}`);
    }
  } catch (error) {
    if (isMissingActiveTripError(error)) {
      await appendLog("Aktiv tur fantes ikke lenger på serveren. Lokal turstatus ble nullstilt.", "warn");
      return;
    }
    await appendLog(
      `Kunne ikke fullfore tur${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
      "error"
    );
    throw error;
  } finally {
    await resetActiveTripState();
  }
}

async function closeStaleTrip(referenceTimestamp: number): Promise<boolean> {
  const tripId = await get(ACTIVE_TRIP_KEY);
  if (!tripId) return false;

  const lastPoint = await getLastPoint();
  if (!lastPoint) {
    await resetActiveTripState();
    return true;
  }

  const lastPointTime = new Date(lastPoint.timestamp).getTime();
  if (!Number.isFinite(lastPointTime)) {
    await resetActiveTripState();
    return true;
  }

  if (referenceTimestamp - lastPointTime < STALE_TRIP_TIMEOUT_MS) {
    return false;
  }

  await appendLog("Avsluttet gammel aktiv tur automatisk.");
  await finishTrip(tripId, lastPoint);
  return true;
}

async function handleLocation(loc: Location.LocationObject): Promise<void> {
  const point = toGpsPoint(loc);
  const nowMs = loc.timestamp;
  const hasGoodAccuracy = isUsableAccuracy(point);
  const window = await recordPositionSample(point, nowMs);
  const motion = evaluateMotion(point, window, nowMs);

  await storeLocationTelemetry(point);
  await closeStaleTrip(nowMs);
  const state = ((await get(STATE_KEY)) ?? "IDLE") as TrackerState;

  switch (state) {
    case "IDLE": {
      if (!hasGoodAccuracy) {
        await setStartReason(`Venter på bedre GPS-nøyaktighet. Siste måling var ${Math.round(point.accuracy)} meter.`);
        break;
      }
      if (motion.isMoving) {
        await set(STATE_KEY, "DETECTING_START");
        await setStartCandidateCount(1);
        await setStartReason("Oppdaget bevegelse. Bekrefter med ett punkt til før turen starter.");
        await appendLog("Oppdaget bevegelse som kan starte tur.");
      } else {
        await setStartReason("Venter på tydelig bevegelse før tur starter automatisk.");
      }
      break;
    }

    case "DETECTING_START": {
      if (!hasGoodAccuracy) {
        await setStartReason(`Venter på bedre GPS-nøyaktighet (${Math.round(point.accuracy)} m) før tur kan starte.`);
        break;
      }
      if (motion.isMoving) {
        await clear(START_FAIL_COUNT_KEY);
        await startTrip(point);
      } else {
        const failCount = Number((await get(START_FAIL_COUNT_KEY)) ?? "0") + 1;
        if (failCount >= MAX_START_FAIL_COUNT) {
          await clear(START_FAIL_COUNT_KEY);
          await set(STATE_KEY, "IDLE");
          await setStartCandidateCount(0);
          await setStartReason("Turstart ble avbrutt fordi bevegelsen stoppet opp igjen.");
          await appendLog("Avbrøt turstart fordi bevegelsen stoppet.", "warn");
        } else {
          await set(START_FAIL_COUNT_KEY, String(failCount));
          await setStartReason(`Venter — bevegelse usikker. Forsøk ${failCount}/${MAX_START_FAIL_COUNT}.`);
        }
      }
      break;
    }

    case "RECORDING": {
      const tripId = await get(ACTIVE_TRIP_KEY);
      if (!tripId) {
        await set(STATE_KEY, "IDLE");
        await setStartReason("Ingen aktiv tur akkurat nå.");
        return;
      }

      await enqueuePoint(point);
      await flushPendingPoints(tripId).catch(async (error) => {
        if (isMissingActiveTripError(error)) {
          await appendLog("Serveren manglet aktiv tur. Nullstilte lokal turstatus.", "warn");
          await resetActiveTripState();
          return;
        }
        await appendLog(
          `Kunne ikke sende punkter${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
          "error"
        );
      });

      if (motion.isStationary) {
        await set(STATE_KEY, "DETECTING_STOP");
        await set(STOP_TIME_KEY, String(nowMs));
        await setStartReason("Tur ser ut til å nærme seg stopp.");
        await appendLog("Mulig turstopp oppdaget.");
      } else {
        await setStartReason("Tur er aktiv.");
      }
      break;
    }

    case "DETECTING_STOP": {
      const tripId = await get(ACTIVE_TRIP_KEY);
      if (!tripId) {
        await set(STATE_KEY, "IDLE");
        await setStartReason("Ingen aktiv tur akkurat nå.");
        return;
      }

      await enqueuePoint(point);

      if (motion.isMoving && hasGoodAccuracy) {
        await set(STATE_KEY, "RECORDING");
        await clear(STOP_TIME_KEY);
        await flushPendingPoints(tripId).catch(async (error) => {
          if (isMissingActiveTripError(error)) {
            await appendLog("Serveren manglet aktiv tur etter stopp. Nullstilte lokal turstatus.", "warn");
            await resetActiveTripState();
            return;
          }
          await appendLog(
            `Kunne ikke sende punkter etter stopp${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
            "error"
          );
        });
        await setStartReason("Tur fortsetter.");
        await appendLog("Tur fortsetter etter kort stopp.");
        return;
      }

      const stopTime = Number((await get(STOP_TIME_KEY)) ?? "0");
      if (nowMs - stopTime >= STOP_CONFIRM_MS) {
        await finishTrip(tripId, point);
      }
      break;
    }
  }
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    await appendLog(`Bakgrunnsoppgave feilet: ${error.message}`, "error");
    console.error("[TripTracker]", error);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  try {
    await markTaskHeartbeat();
    for (const loc of locations) {
      await handleLocation(loc);
    }
  } catch (taskError) {
    await appendLog(
      `Feil under behandling av posisjon${taskError instanceof Error && taskError.message ? `: ${taskError.message}` : "."}`,
      "error"
    );
    console.error("[TripTracker]", taskError);
  }
});

export async function requestPermissions(): Promise<boolean> {
  const { status: notifStatus } = await Notifications.getPermissionsAsync();
  if (notifStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== "granted") {
      await appendLog("Mangler notifikasjonstillatelse — foreground service vil ikke vises.", "warn");
    }
  }

  const fgStatus = await Location.getForegroundPermissionsAsync();
  const fg =
    fgStatus.status === "granted"
      ? fgStatus
      : await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") {
    await setStartReason("Gi appen tilgang til posisjon mens den er i bruk.");
    await appendLog("Mangler forgrunnslokasjon.", "warn");
    return false;
  }

  const bgStatus = await Location.getBackgroundPermissionsAsync();
  const bg =
    bgStatus.status === "granted"
      ? bgStatus
      : await Location.requestBackgroundPermissionsAsync();

  if (bg.status !== "granted") {
    await setStartReason("Gi appen bakgrunnslokasjon for automatisk turstart.");
    await appendLog("Mangler bakgrunnslokasjon.", "warn");
  } else {
    await setStartReason("Tillatelser er klare. Telefonen kan starte tur automatisk.");
    await appendLog("Bakgrunnslokasjon er klar.");
  }

  return bg.status === "granted";
}

export async function ensureTrackingConfigured(): Promise<boolean> {
  await ensureNotificationChannel();
  const granted = await requestPermissions();
  if (!granted) return false;

  const providerStatus = await Location.getProviderStatusAsync().catch(() => null);
  if (providerStatus && !providerStatus.locationServicesEnabled) {
    await setStartReason("Skru på posisjonstjenester på telefonen.");
    await appendLog("Posisjonstjenester er av på telefonen.", "warn");
  }

  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 3000,
      distanceInterval: 10,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Kjørebok",
        notificationBody: "Automatisk tursporing kjører i bakgrunnen.",
      },
    });
    await setStartReason("Bakgrunnssporing er aktiv. Telefonen følger med etter ny tur.");
    await appendLog("Bakgrunnssporing ble startet.");
  } else {
    await setStartReason("Bakgrunnssporing er aktiv. Telefonen følger med etter ny tur.");
    await appendLog("Bakgrunnssporing er allerede aktiv.");
  }

  await closeStaleTrip(Date.now()).catch(() => {});

  const tripId = await get(ACTIVE_TRIP_KEY);
  if (tripId) {
    await flushPendingPoints(tripId).catch(async (error) => {
      await appendLog(
        `Kunne ikke sende ventende punkter ved oppstart${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
        "error"
      );
    });
  }

  return true;
}

export async function syncActiveTrip(): Promise<void> {
  await closeStaleTrip(Date.now());
  const tripId = await get(ACTIVE_TRIP_KEY);
  if (!tripId) {
    await appendLog("Ingen aktiv tur å synkronisere.", "warn");
    return;
  }
  try {
    await flushPendingPoints(tripId);
    await appendLog("Manuell synkronisering fullfort.");
  } catch (error) {
    if (isMissingActiveTripError(error)) {
      await appendLog("Aktiv tur fantes ikke lenger på serveren. Lokal turstatus ble nullstilt.", "warn");
      await resetActiveTripState();
      return;
    }
    await appendLog(
      `Manuell synkronisering feilet${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
      "error"
    );
    throw error;
  }
}

export async function startTripManually(): Promise<void> {
  const tripId = await get(ACTIVE_TRIP_KEY);
  if (tripId) {
    await setStartReason("Du har allerede en aktiv tur.");
    return;
  }

  const granted = await requestPermissions();
  if (!granted) {
    throw new Error("Bakgrunnslokasjon mangler.");
  }

  const location = await Location.getCurrentPositionAsync({
    accuracy: Location.Accuracy.High,
  });
  const point = toGpsPoint(location);
  const started = await startTrip(point);

  if (!started) {
    throw new Error("Kunne ikke starte tur manuelt.");
  }

  await setLastTelemetry(point);
  await setStartReason("Tur startet manuelt og registreres nå.");
  await appendLog("Tur startet manuelt.");
}

export async function stopActiveTripManually(): Promise<void> {
  const tripId = await get(ACTIVE_TRIP_KEY);
  if (!tripId) {
    await setStartReason("Ingen aktiv tur å stoppe.");
    throw new Error("Ingen aktiv tur å stoppe.");
  }

  const fallbackPoint = await getLastPoint();
  let point = fallbackPoint;

  try {
    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    point = toGpsPoint(location);
  } catch {
    // Fall back to the latest known point if a fresh reading is unavailable.
  }

  if (!point) {
    throw new Error("Fant ikke posisjon for å avslutte turen.");
  }

  await finishTrip(tripId, point);
  await setStartReason("Tur ble stoppet manuelt.");
  await appendLog("Tur stoppet manuelt.");
}

export async function stopTracking(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  await clear(STATE_KEY);
  await clear(ACTIVE_TRIP_KEY);
  await clear(STOP_TIME_KEY);
  await clear(PENDING_POINTS_KEY);
  await clear(LAST_POINT_KEY);
  await clear(POSITION_WINDOW_KEY);
  await clear(LAST_SPEED_KEY);
  await clear(LAST_ACCURACY_KEY);
  await clear(START_CANDIDATE_COUNT_KEY);
  await clear(START_FAIL_COUNT_KEY);
  await appendLog("Bakgrunnssporing ble stoppet.", "warn");
  await setStartReason("Bakgrunnssporing er stoppet.");
}

export async function getTrackerState(): Promise<TrackerDiagnostics> {
  const trackingEnabled = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  const [notificationPermission, availableNotificationChannels, foregroundPermission, backgroundPermission, providerStatus, lastPoint, lastTaskAt, lastSyncAt, token, recentEvents, lastSpeedKmh, lastAccuracyMeters, startCandidateCount, startReason] =
    await Promise.all([
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
      getLastPoint(),
      get(LAST_TASK_AT_KEY),
      get(LAST_SYNC_AT_KEY),
      getToken(),
      getRecentEvents(),
      getLastSpeedKmh(),
      getLastAccuracyMeters(),
      getStartCandidateCount(),
      getStartReason(),
    ]);

  return {
    state: ((await get(STATE_KEY)) ?? "IDLE") as TrackerState,
    activeTripId: await get(ACTIVE_TRIP_KEY),
    pendingPoints: (await getPendingPoints()).length,
    trackingEnabled,
    hasToken: Boolean(token),
    notificationPermission,
    tripNotificationChannel: TRIP_NOTIFICATION_CHANNEL,
    backgroundNotificationChannel: BACKGROUND_NOTIFICATION_CHANNEL,
    availableNotificationChannels,
    locationServicesEnabled: providerStatus?.locationServicesEnabled ?? false,
    foregroundPermission,
    backgroundPermission,
    lastPointTimestamp: lastPoint?.timestamp ?? null,
    lastTaskAt,
    lastSyncAt,
    lastSpeedKmh,
    lastAccuracyMeters,
    startCandidateCount,
    startReason,
    recentEvents,
  };
}
