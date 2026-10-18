import { requireOptionalNativeModule, type EventSubscription } from "expo-modules-core";

export type MotionActivityKind = "automotive" | "walking" | "running" | "cycling" | "stationary";

export interface MotionTransitionEvent {
  activity: MotionActivityKind;
  transition: "enter" | "exit";
  /** Wall-clock milliseconds. */
  timestamp: number;
}

export interface MotionActivitySample {
  activity: MotionActivityKind;
  confidence: "low" | "medium" | "high";
  timestamp: number;
}

export interface MotionPermissionResponse {
  status: "granted" | "denied" | "undetermined";
  granted: boolean;
  canAskAgain: boolean;
}

interface NativeMotionActivity {
  isAvailable(): boolean;
  getPermissionsAsync(): Promise<MotionPermissionResponse>;
  requestPermissionsAsync(): Promise<MotionPermissionResponse>;
  startTransitionsAsync(taskName: string): Promise<void>;
  stopTransitionsAsync(taskName: string): Promise<void>;
  hasStartedTransitionsAsync(taskName: string): Promise<boolean>;
  queryRecentAsync(minutes: number): Promise<MotionActivitySample[]>;
  addListener(
    eventName: "onActivityChange",
    listener: (payload: { events: MotionTransitionEvent[] }) => void
  ): EventSubscription;
}

/**
 * Null on a binary built before this module existed — an over-the-air JS
 * update must keep working there, just without motion detection.
 */
const native = requireOptionalNativeModule<NativeMotionActivity>("MotionActivity");

export function isMotionActivityAvailable(): boolean {
  try {
    return native?.isAvailable() ?? false;
  } catch {
    return false;
  }
}

const UNAVAILABLE: MotionPermissionResponse = { status: "denied", granted: false, canAskAgain: false };

export async function getMotionPermissionsAsync(): Promise<MotionPermissionResponse> {
  return native ? native.getPermissionsAsync() : UNAVAILABLE;
}

export async function requestMotionPermissionsAsync(): Promise<MotionPermissionResponse> {
  return native ? native.requestPermissionsAsync() : UNAVAILABLE;
}

/**
 * Android delivers transitions to the expo-task-manager task with this name,
 * also when the app is not running. iOS has no such wake-up; it emits them to
 * `addMotionTransitionListener` while the app is alive instead.
 */
export async function startMotionTransitionsAsync(taskName: string): Promise<void> {
  await native?.startTransitionsAsync(taskName);
}

export async function stopMotionTransitionsAsync(taskName: string): Promise<void> {
  await native?.stopTransitionsAsync(taskName);
}

export async function hasStartedMotionTransitionsAsync(taskName: string): Promise<boolean> {
  return native ? native.hasStartedTransitionsAsync(taskName) : false;
}

/** Activity history for the last `minutes`. Always empty on Android. */
export async function queryRecentMotionAsync(minutes: number): Promise<MotionActivitySample[]> {
  return native ? native.queryRecentAsync(minutes) : [];
}

export function addMotionTransitionListener(
  listener: (events: MotionTransitionEvent[]) => void
): EventSubscription | null {
  return native?.addListener("onActivityChange", ({ events }) => listener(events)) ?? null;
}
