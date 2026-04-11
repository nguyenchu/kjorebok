/**
 * Auto trip detection using expo-location background tasks.
 *
 * Tracking is intended to stay on continuously once permissions are granted.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as TaskManager from "expo-task-manager";
import { api, getToken } from "./api";
import type { GpsPoint } from "@kjorebok/shared";

export const BACKGROUND_LOCATION_TASK = "kjorebok-background-location";

const START_SPEED_MS = 3 / 3.6;
const STOP_SPEED_MS = 1 / 3.6;
const START_CONFIRM_POINTS = 2;
const STOP_CONFIRM_MS = 3 * 60 * 1000;
const SYNC_BATCH_SIZE = 25;
const MAX_PENDING_POINTS = 500;
const MAX_START_ACCURACY_METERS = 80;
const MIN_MOVEMENT_DISTANCE_METERS = 20;
const MAX_SAMPLE_AGE_MS = 2 * 60 * 1000;

type TrackerState = "IDLE" | "DETECTING_START" | "RECORDING" | "DETECTING_STOP";

const STATE_KEY = "tracker_state";
const ACTIVE_TRIP_KEY = "tracker_active_trip_id";
const FAST_COUNT_KEY = "tracker_fast_count";
const STOP_TIME_KEY = "tracker_stop_time";
const PENDING_POINTS_KEY = "tracker_pending_points";
const LAST_POINT_KEY = "tracker_last_point";
const LAST_SAMPLE_KEY = "tracker_last_sample";
const LAST_TASK_AT_KEY = "tracker_last_task_at";
const LAST_SYNC_AT_KEY = "tracker_last_sync_at";
const LOG_ENTRIES_KEY = "tracker_log_entries";
const STALE_TRIP_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_LOG_ENTRIES = 20;

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
  locationServicesEnabled: boolean;
  foregroundPermission: Location.PermissionStatus;
  backgroundPermission: Location.PermissionStatus;
  lastPointTimestamp: string | null;
  lastTaskAt: string | null;
  lastSyncAt: string | null;
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

async function getLastSample(): Promise<GpsPoint | null> {
  const raw = await get(LAST_SAMPLE_KEY);
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

async function setLastSample(point: GpsPoint): Promise<void> {
  await set(LAST_SAMPLE_KEY, JSON.stringify(point));
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
  return point.accuracy > 0 && point.accuracy <= MAX_START_ACCURACY_METERS;
}

async function detectMovement(point: GpsPoint): Promise<boolean> {
  if (point.speed > START_SPEED_MS) {
    return true;
  }

  const previous = await getLastSample();
  if (!previous) return false;

  const age = Math.abs(new Date(point.timestamp).getTime() - new Date(previous.timestamp).getTime());
  if (age > MAX_SAMPLE_AGE_MS) return false;
  if (!isUsableAccuracy(point) || !isUsableAccuracy(previous)) return false;

  return haversineMeters(previous, point) >= MIN_MOVEMENT_DISTANCE_METERS;
}

async function storeLocationSample(point: GpsPoint): Promise<void> {
  await setLastSample(point);
  await markTaskHeartbeat(point.timestamp);
}

async function enqueuePoint(point: GpsPoint): Promise<void> {
  const points = await getPendingPoints();
  const last = points[points.length - 1];

  if (
    last &&
    last.timestamp === point.timestamp &&
    last.lat === point.lat &&
    last.lng === point.lng
  ) {
    return;
  }

  points.push(point);
  await setPendingPoints(points);
  await setLastPoint(point);
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
    await clear(FAST_COUNT_KEY);
    await appendLog("Tur startet automatisk.");
    return true;
  } catch (error) {
    await appendLog(
      `Kunne ikke starte tur${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
      "error"
    );
    await set(STATE_KEY, "IDLE");
    await clear(FAST_COUNT_KEY);
    return false;
  }
}

async function resetActiveTripState(): Promise<void> {
  await clear(PENDING_POINTS_KEY);
  await clear(ACTIVE_TRIP_KEY);
  await clear(STOP_TIME_KEY);
  await clear(LAST_POINT_KEY);
  await clear(LAST_SAMPLE_KEY);
  await set(STATE_KEY, "IDLE");
}

async function finishTrip(tripId: string, endPoint: GpsPoint): Promise<void> {
  try {
    await flushPendingPoints(tripId);
    const endAddress = await reverseGeocode(endPoint);
    await api.post(`/trips/${tripId}/end`, { endPoint, endAddress });
    await markSyncSuccess();
    await appendLog("Tur fullfort og sendt til server.");
  } catch (error) {
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
  const speed = point.speed;
  const moving = await detectMovement(point);
  const hasGoodAccuracy = isUsableAccuracy(point);

  await storeLocationSample(point);
  await closeStaleTrip(loc.timestamp);
  const state = ((await get(STATE_KEY)) ?? "IDLE") as TrackerState;

  switch (state) {
    case "IDLE": {
      if (moving && hasGoodAccuracy) {
        await set(STATE_KEY, "DETECTING_START");
        await set(FAST_COUNT_KEY, "1");
        await appendLog("Oppdaget bevegelse som kan starte tur.");
      }
      break;
    }

    case "DETECTING_START": {
      if (moving && hasGoodAccuracy) {
        const count = Number((await get(FAST_COUNT_KEY)) ?? "0") + 1;
        if (count >= START_CONFIRM_POINTS) {
          await startTrip(point);
        } else {
          await set(FAST_COUNT_KEY, String(count));
        }
      } else {
        await set(STATE_KEY, "IDLE");
        await clear(FAST_COUNT_KEY);
        await appendLog("Avbrøt turstart fordi farten falt igjen.", "warn");
      }
      break;
    }

    case "RECORDING": {
      const tripId = await get(ACTIVE_TRIP_KEY);
      if (!tripId) {
        await set(STATE_KEY, "IDLE");
        return;
      }

      await enqueuePoint(point);
      await flushPendingPoints(tripId).catch(async (error) => {
        await appendLog(
          `Kunne ikke sende punkter${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
          "error"
        );
      });

      if (speed < STOP_SPEED_MS && hasGoodAccuracy) {
        await set(STATE_KEY, "DETECTING_STOP");
        await set(STOP_TIME_KEY, String(loc.timestamp));
        await appendLog("Mulig turstopp oppdaget.");
      }
      break;
    }

    case "DETECTING_STOP": {
      const tripId = await get(ACTIVE_TRIP_KEY);
      if (!tripId) {
        await set(STATE_KEY, "IDLE");
        return;
      }

      await enqueuePoint(point);

      if (moving && hasGoodAccuracy) {
        await set(STATE_KEY, "RECORDING");
        await clear(STOP_TIME_KEY);
        await flushPendingPoints(tripId).catch(async (error) => {
          await appendLog(
            `Kunne ikke sende punkter etter stopp${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
            "error"
          );
        });
        await appendLog("Tur fortsetter etter kort stopp.");
        return;
      }

      const stopTime = Number((await get(STOP_TIME_KEY)) ?? "0");
      if (loc.timestamp - stopTime >= STOP_CONFIRM_MS) {
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
    await appendLog("Mangler forgrunnslokasjon.", "warn");
    return false;
  }

  const bgStatus = await Location.getBackgroundPermissionsAsync();
  const bg =
    bgStatus.status === "granted"
      ? bgStatus
      : await Location.requestBackgroundPermissionsAsync();

  if (bg.status !== "granted") {
    await appendLog("Mangler bakgrunnslokasjon.", "warn");
  } else {
    await appendLog("Bakgrunnslokasjon er klar.");
  }

  return bg.status === "granted";
}

export async function ensureTrackingConfigured(): Promise<boolean> {
  const granted = await requestPermissions();
  if (!granted) return false;

  const providerStatus = await Location.getProviderStatusAsync().catch(() => null);
  if (providerStatus && !providerStatus.locationServicesEnabled) {
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
    await appendLog("Bakgrunnssporing ble startet.");
  } else {
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
    await appendLog(
      `Manuell synkronisering feilet${error instanceof Error && error.message ? `: ${error.message}` : "."}`,
      "error"
    );
    throw error;
  }
}

export async function stopTracking(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }

  await clear(STATE_KEY);
  await clear(ACTIVE_TRIP_KEY);
  await clear(FAST_COUNT_KEY);
  await clear(STOP_TIME_KEY);
  await clear(PENDING_POINTS_KEY);
  await clear(LAST_POINT_KEY);
  await clear(LAST_SAMPLE_KEY);
  await appendLog("Bakgrunnssporing ble stoppet.", "warn");
}

export async function getTrackerState(): Promise<TrackerDiagnostics> {
  const trackingEnabled = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  const [foregroundPermission, backgroundPermission, providerStatus, lastPoint, lastTaskAt, lastSyncAt, token, recentEvents] =
    await Promise.all([
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
    ]);

  return {
    state: ((await get(STATE_KEY)) ?? "IDLE") as TrackerState,
    activeTripId: await get(ACTIVE_TRIP_KEY),
    pendingPoints: (await getPendingPoints()).length,
    trackingEnabled,
    hasToken: Boolean(token),
    locationServicesEnabled: providerStatus?.locationServicesEnabled ?? false,
    foregroundPermission,
    backgroundPermission,
    lastPointTimestamp: lastPoint?.timestamp ?? null,
    lastTaskAt,
    lastSyncAt,
    recentEvents,
  };
}
