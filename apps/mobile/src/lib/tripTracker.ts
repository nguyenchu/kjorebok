/**
 * Auto trip detection using expo-location background tasks.
 *
 * Tracking is intended to stay on continuously once permissions are granted
 * and a vehicle has been selected.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { api } from "./api";
import type { GpsPoint } from "@kjorebok/shared";

export const BACKGROUND_LOCATION_TASK = "kjorebok-background-location";

const START_SPEED_MS = 5 / 3.6;
const STOP_SPEED_MS = 2 / 3.6;
const START_CONFIRM_POINTS = 3;
const STOP_CONFIRM_MS = 3 * 60 * 1000;
const SYNC_BATCH_SIZE = 25;
const MAX_PENDING_POINTS = 500;

type TrackerState = "IDLE" | "DETECTING_START" | "RECORDING" | "DETECTING_STOP";

const STATE_KEY = "tracker_state";
const ACTIVE_TRIP_KEY = "tracker_active_trip_id";
const FAST_COUNT_KEY = "tracker_fast_count";
const STOP_TIME_KEY = "tracker_stop_time";
const PENDING_POINTS_KEY = "tracker_pending_points";

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
    await set(ACTIVE_TRIP_KEY, trip.id);
    await set(STATE_KEY, "RECORDING");
    await clear(FAST_COUNT_KEY);
    return true;
  } catch {
    await set(STATE_KEY, "IDLE");
    await clear(FAST_COUNT_KEY);
    return false;
  }
}

async function handleLocation(loc: Location.LocationObject): Promise<void> {
  const point = toGpsPoint(loc);
  const speed = point.speed;
  const state = ((await get(STATE_KEY)) ?? "IDLE") as TrackerState;

  switch (state) {
    case "IDLE": {
      if (speed > START_SPEED_MS) {
        await set(STATE_KEY, "DETECTING_START");
        await set(FAST_COUNT_KEY, "1");
      }
      break;
    }

    case "DETECTING_START": {
      if (speed > START_SPEED_MS) {
        const count = Number((await get(FAST_COUNT_KEY)) ?? "0") + 1;
        if (count >= START_CONFIRM_POINTS) {
          await startTrip(point);
        } else {
          await set(FAST_COUNT_KEY, String(count));
        }
      } else {
        await set(STATE_KEY, "IDLE");
        await clear(FAST_COUNT_KEY);
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
      await flushPendingPoints(tripId).catch(() => {});

      if (speed < STOP_SPEED_MS) {
        await set(STATE_KEY, "DETECTING_STOP");
        await set(STOP_TIME_KEY, String(loc.timestamp));
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

      if (speed > START_SPEED_MS) {
        await set(STATE_KEY, "RECORDING");
        await clear(STOP_TIME_KEY);
        await flushPendingPoints(tripId).catch(() => {});
        return;
      }

      const stopTime = Number((await get(STOP_TIME_KEY)) ?? "0");
      if (loc.timestamp - stopTime >= STOP_CONFIRM_MS) {
        try {
          await flushPendingPoints(tripId);
          const endAddress = await reverseGeocode(point);
          await api.post(`/trips/${tripId}/end`, { endPoint: point, endAddress });
        } finally {
          await clear(PENDING_POINTS_KEY);
          await clear(ACTIVE_TRIP_KEY);
          await clear(STOP_TIME_KEY);
          await set(STATE_KEY, "IDLE");
        }
      }
      break;
    }
  }
}

TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
  if (error) {
    console.error("[TripTracker]", error);
    return;
  }

  const { locations } = data as { locations: Location.LocationObject[] };
  try {
    for (const loc of locations) {
      await handleLocation(loc);
    }
  } catch (taskError) {
    console.error("[TripTracker]", taskError);
  }
});

export async function requestPermissions(): Promise<boolean> {
  const fgStatus = await Location.getForegroundPermissionsAsync();
  const fg =
    fgStatus.status === "granted"
      ? fgStatus
      : await Location.requestForegroundPermissionsAsync();
  if (fg.status !== "granted") return false;

  const bgStatus = await Location.getBackgroundPermissionsAsync();
  const bg =
    bgStatus.status === "granted"
      ? bgStatus
      : await Location.requestBackgroundPermissionsAsync();

  return bg.status === "granted";
}

export async function ensureTrackingConfigured(): Promise<boolean> {
  const granted = await requestPermissions();
  if (!granted) return false;

  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (!isRunning) {
    await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      distanceInterval: 10,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Kjørebok",
        notificationBody: "Sporing er alltid aktiv for å fange opp turer automatisk.",
      },
    });
  }

  const tripId = await get(ACTIVE_TRIP_KEY);
  if (tripId) {
    await flushPendingPoints(tripId).catch(() => {});
  }

  return true;
}

export async function syncActiveTrip(): Promise<void> {
  const tripId = await get(ACTIVE_TRIP_KEY);
  if (!tripId) return;
  await flushPendingPoints(tripId);
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
}

export async function getTrackerState(): Promise<{
  state: TrackerState;
  activeTripId: string | null;
  pendingPoints: number;
  trackingEnabled: boolean;
}> {
  const trackingEnabled = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);

  return {
    state: ((await get(STATE_KEY)) ?? "IDLE") as TrackerState,
    activeTripId: await get(ACTIVE_TRIP_KEY),
    pendingPoints: (await getPendingPoints()).length,
    trackingEnabled,
  };
}
