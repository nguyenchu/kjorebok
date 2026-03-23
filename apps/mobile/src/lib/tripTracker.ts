/**
 * Auto trip detection using expo-location background tasks.
 *
 * State machine:
 *   IDLE  →  DETECTING_START (speed > START_SPEED_THRESHOLD for START_CONFIRM_POINTS consecutive points)
 *   DETECTING_START  →  RECORDING (confirmed moving)
 *   RECORDING  →  DETECTING_STOP (speed < STOP_SPEED_THRESHOLD)
 *   DETECTING_STOP  →  IDLE (stationary for STOP_CONFIRM_MS → end trip)
 *   DETECTING_STOP  →  RECORDING (speed picks up again → resume)
 */

import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api";
import type { GpsPoint } from "@kjorebok/shared";

export const BACKGROUND_LOCATION_TASK = "kjorebok-background-location";

const START_SPEED_MS = 5 / 3.6;       // 5 km/h in m/s
const STOP_SPEED_MS = 2 / 3.6;        // 2 km/h in m/s
const START_CONFIRM_POINTS = 3;        // consecutive fast points to start
const STOP_CONFIRM_MS = 3 * 60 * 1000; // 3 min stationary to stop

type TrackerState = "IDLE" | "DETECTING_START" | "RECORDING" | "DETECTING_STOP";

const STATE_KEY = "tracker_state";
const ACTIVE_TRIP_KEY = "tracker_active_trip_id";
const VEHICLE_KEY = "tracker_vehicle_id";
const FAST_COUNT_KEY = "tracker_fast_count";
const STOP_TIME_KEY = "tracker_stop_time";

async function get(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}
async function set(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}
async function clear(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
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
        const count = Number(await get(FAST_COUNT_KEY)) + 1;
        if (count >= START_CONFIRM_POINTS) {
          // Start a new trip
          const vehicleId = await get(VEHICLE_KEY);
          if (!vehicleId) {
            // No vehicle configured, stay idle
            await set(STATE_KEY, "IDLE");
            return;
          }
          try {
            const trip = await api.post<{ id: string }>("/trips", {
              vehicleId,
              startPoint: point,
            });
            await set(ACTIVE_TRIP_KEY, trip.id);
            await set(STATE_KEY, "RECORDING");
            await clear(FAST_COUNT_KEY);
          } catch {
            await set(STATE_KEY, "IDLE");
          }
        } else {
          await set(FAST_COUNT_KEY, String(count));
        }
      } else {
        // Dropped below threshold, reset
        await set(STATE_KEY, "IDLE");
        await clear(FAST_COUNT_KEY);
      }
      break;
    }

    case "RECORDING": {
      const tripId = await get(ACTIVE_TRIP_KEY);
      if (!tripId) { await set(STATE_KEY, "IDLE"); return; }

      try {
        await api.post(`/trips/${tripId}/points`, { point });
      } catch { /* best-effort, keep recording */ }

      if (speed < STOP_SPEED_MS) {
        await set(STATE_KEY, "DETECTING_STOP");
        await set(STOP_TIME_KEY, String(loc.timestamp));
      }
      break;
    }

    case "DETECTING_STOP": {
      const tripId = await get(ACTIVE_TRIP_KEY);
      if (!tripId) { await set(STATE_KEY, "IDLE"); return; }

      if (speed > START_SPEED_MS) {
        // Moving again — continue recording
        await set(STATE_KEY, "RECORDING");
        await clear(STOP_TIME_KEY);
        try {
          await api.post(`/trips/${tripId}/points`, { point });
        } catch { /* best-effort */ }
        return;
      }

      const stopTime = Number(await get(STOP_TIME_KEY));
      if (loc.timestamp - stopTime >= STOP_CONFIRM_MS) {
        // Stationary long enough — end trip
        try {
          await api.post(`/trips/${tripId}/end`, { endPoint: point });
        } finally {
          await clear(ACTIVE_TRIP_KEY);
          await clear(STOP_TIME_KEY);
          await set(STATE_KEY, "IDLE");
        }
      }
      break;
    }
  }
}

// Register the background task (must be called at module top level)
TaskManager.defineTask(BACKGROUND_LOCATION_TASK, ({ data, error }) => {
  if (error) { console.error("[TripTracker]", error); return; }
  const { locations } = data as { locations: Location.LocationObject[] };
  for (const loc of locations) {
    handleLocation(loc).catch(console.error);
  }
});

export async function requestPermissions(): Promise<boolean> {
  const { status: fg } = await Location.requestForegroundPermissionsAsync();
  if (fg !== "granted") return false;
  const { status: bg } = await Location.requestBackgroundPermissionsAsync();
  return bg === "granted";
}

export async function startTracking(vehicleId: string): Promise<void> {
  await set(VEHICLE_KEY, vehicleId);
  await set(STATE_KEY, "IDLE");

  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isRunning) return;

  await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, {
    accuracy: Location.Accuracy.High,
    timeInterval: 5000,      // 5s
    distanceInterval: 10,    // or every 10m
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: "Kjørebok",
      notificationBody: "Overvåker kjøring...",
    },
  });
}

export async function stopTracking(): Promise<void> {
  const isRunning = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => false);
  if (isRunning) {
    await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
  }
  await clear(STATE_KEY);
  await clear(VEHICLE_KEY);
}

export async function getTrackerState(): Promise<{ state: TrackerState; activeTripId: string | null }> {
  return {
    state: ((await get(STATE_KEY)) ?? "IDLE") as TrackerState,
    activeTripId: await get(ACTIVE_TRIP_KEY),
  };
}
